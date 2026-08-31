import express, { type Request } from 'express';
import cors from 'cors';
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import {
  CLASSIFICATION_SYSTEM_PROMPT,
  buildClassificationPrompt,
  heuristicClassify,
  parseClassification,
} from '../src/lib/ticketClassifier.ts';
import { detectPatterns } from '../src/lib/patternDetection.ts';
import { buildComplianceReport, complianceReportToMarkdown } from '../src/lib/complianceReport.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DetectedPattern, Ticket } from '../src/lib/types.ts';
import { clientForAccessToken, hasSupabase, hasSupabaseAuth, supabase } from './db.ts';

const app = express();
const PORT = Number(process.env.API_PORT ?? process.env.PORT) || 3001;

// gemini | anthropic | openai | selfhosted | auto
const AI_PROVIDER = process.env.AI_PROVIDER ?? 'auto';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-3-5-haiku-latest';
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

// Échelle de repli, du moins cher au plus capable. Uniquement des modèles `flash` /
// `flash-lite` : ce sont les seuls éligibles au palier gratuit de l'API Gemini. Les modèles
// `pro` sont volontairement absents — leur quota gratuit est à 0, ils exigent un compte de
// facturation, donc les inclure exposerait à des frais. Versions épinglées plutôt que des
// alias `-latest`, qui peuvent basculer vers un modèle payant sans prévenir.
const GEMINI_MODELS = (
  process.env.GEMINI_MODEL
    ? [process.env.GEMINI_MODEL]
    : ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash']
) as string[];

// Self-hosted (Ollama, OpenAI-compatible /v1/chat/completions) — souveraineté des données.
const SELF_HOSTED_BASE_URL = process.env.SELF_HOSTED_BASE_URL ?? 'http://localhost:11434';
const SELF_HOSTED_MODEL = process.env.SELF_HOSTED_MODEL ?? 'gemma3:1b';

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    provider: AI_PROVIDER,
    geminiModels: GEMINI_MODELS,
    anthropicModel: ANTHROPIC_MODEL,
    openaiModel: OPENAI_MODEL,
    selfHostedBaseUrl: SELF_HOSTED_BASE_URL,
    selfHostedModel: SELF_HOSTED_MODEL,
    geminiRpm: GEMINI_RPM,
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasOpenaiKey: Boolean(process.env.OPENAI_API_KEY),
    hasSupabase,
  });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deux familles d'erreurs « réessayables », qui appellent des réactions opposées :
 *
 *   - `throttle` (429 / RESOURCE_EXHAUSTED) : le quota est momentanément saturé. Il faut
 *     **attendre**. Réessayer immédiatement ne fait qu'ajouter à la congestion.
 *   - `gone` (404, `limit: 0`) : le modèle a été retiré, ou n'existe pas au palier gratuit.
 *     Attendre n'y changera rien, il faut passer au modèle suivant sans délai.
 *
 * Les confondre était le défaut d'origine : un simple 429 faisait cycler les quatre modèles
 * de `GEMINI_MODELS` en quelques millisecondes, épuisait la chaîne, et le ticket repartait
 * avec un classement par mots-clés sans que rien ne le signale.
 */
function aiErrorKind(err: unknown): 'throttle' | 'gone' | 'fatal' {
  const status = (err as { status?: number }).status;
  const message = err instanceof Error ? err.message : String(err);

  // `limit: 0` = modèle hors palier gratuit (compte de facturation exigé) : inutile d'attendre.
  if (status === 404 || /limit:\s*0/.test(message) || /not found|is not supported/i.test(message)) {
    return 'gone';
  }
  if (
    status === 429 ||
    message.includes('RESOURCE_EXHAUSTED') ||
    /quota exceeded|rate.?limit/i.test(message)
  ) {
    return 'throttle';
  }
  return 'fatal';
}

/** Délai réclamé par le serveur : en-tête `Retry-After`, ou `retryDelay` du corps d'erreur Google. */
function retryAfterMs(err: unknown): number | null {
  const header = (err as { retryAfter?: string }).retryAfter;
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const asDate = Date.parse(header);
    if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  }
  const message = err instanceof Error ? err.message : String(err);
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  return match ? Number(match[1]) * 1000 : null;
}

// ------------------------------------------------------- limiteur de débit Gemini (palier gratuit)
//
// Le palier gratuit plafonne les modèles `flash-lite` autour de 15 requêtes/minute. On vise
// volontairement plus bas : mieux vaut un lot un peu plus lent qu'une rafale de 429 qui
// retombe en silence sur le classement par mots-clés.
//
// Le compteur est global au processus, pas par requête : il tient donc face à plusieurs
// onglets, plusieurs utilisateurs ou plusieurs lots simultanés — ce qu'une simple baisse de
// concurrence côté navigateur ne peut pas garantir.
const GEMINI_RPM = Number(process.env.GEMINI_RPM) || 10;
const GEMINI_MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES) || 4;

const geminiCallTimestamps: number[] = [];
let geminiGate: Promise<void> = Promise.resolve();

/**
 * Réserve un créneau d'appel. Les candidats sont sérialisés (chaîne de promesses) : sans
 * cela, deux requêtes concurrentes liraient la même fenêtre glissante et passeraient toutes
 * les deux. Seule l'*admission* est sérialisée — les appels réseau, eux, restent parallèles.
 */
async function acquireGeminiSlot(deadline: number): Promise<void> {
  const previous = geminiGate;
  let release!: () => void;
  geminiGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;

  try {
    for (;;) {
      const now = Date.now();
      while (geminiCallTimestamps.length > 0 && now - geminiCallTimestamps[0] >= 60_000) {
        geminiCallTimestamps.shift();
      }
      if (geminiCallTimestamps.length < GEMINI_RPM) {
        geminiCallTimestamps.push(now);
        return;
      }
      const waitMs = 60_000 - (now - geminiCallTimestamps[0]) + 50;
      if (now + waitMs > deadline) {
        throw new Error(
          `Quota Gemini saturé : ${GEMINI_RPM} requêtes/minute déjà consommées, prochain créneau dans ${Math.ceil(waitMs / 1000)}s (au-delà du budget de cette requête).`,
        );
      }
      await sleep(waitMs);
    }
  } finally {
    release();
  }
}

/**
 * Provider-agnostic AI text generation. Extend `providerOrder` / add an `attemptX`
 * function to plug in a new provider without touching call sites (routes just
 * call `generateAIText(system, user)` and get back `{ text, provider, model }`).
 */
export async function generateAIText(
  systemPrompt: string,
  userPrompt: string,
  forceProvider?: 'openai' | 'gemini' | 'anthropic' | 'selfhosted',
): Promise<{ text: string; provider: string; model: string }> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const isSelfHosted = (forceProvider ?? AI_PROVIDER) === 'selfhosted';

  // Deux garde-fous distincts, là où il n'y en avait qu'un seul.
  //
  // `attemptTimeoutMs` borne *un* appel réseau. Ollama en CPU peut prendre du temps à charger
  // le modèle en mémoire au premier appel ("cold start") — mesuré ~28s une fois chaud ; les
  // providers cloud répondent en quelques secondes.
  //
  // `timeoutMs` borne la requête entière, réessais et attentes de quota compris. L'ancien
  // code n'avait que ce budget-là, partagé par les quatre modèles Gemini : le moindre
  // ralentissement le consommait, et la requête retombait sur l'heuristique.
  const attemptTimeoutMs = isSelfHosted ? 90_000 : 30_000;
  const timeoutMs = isSelfHosted ? 240_000 : 180_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const deadline = Date.now() + timeoutMs;
  const failures: string[] = [];

  /** Un appel réseau, borné par `attemptTimeoutMs` sans consommer le budget des autres. */
  const withAttemptTimeout = async <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const attemptController = new AbortController();
    const onOverallAbort = () => attemptController.abort();
    controller.signal.addEventListener('abort', onOverallAbort, { once: true });
    const timer = setTimeout(() => attemptController.abort(), attemptTimeoutMs);
    try {
      return await fn(attemptController.signal);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onOverallAbort);
    }
  };

  try {
    const attemptOpenAI = async (signal: AbortSignal): Promise<{ text: string; provider: string; model: string }> => {
      if (!openaiKey) throw new Error('OPENAI_API_KEY is not configured');
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: 0.3,
          max_tokens: 2048,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal,
      });
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(data.error?.message ?? 'OpenAI failed');
      const text = data.choices?.[0]?.message?.content?.trim() ?? '';
      if (!text) throw new Error('Empty OpenAI response');
      return { text, provider: 'openai', model: OPENAI_MODEL };
    };

    const attemptGemini = async (): Promise<{ text: string; provider: string; model: string }> => {
      if (!geminiKey) throw new Error('GEMINI_API_KEY is not configured');
      let lastError = 'All Gemini models failed';

      for (const model of GEMINI_MODELS) {
        // Les quotas gratuits Gemini sont comptés par modèle : basculer sur le suivant a donc
        // du sens — mais seulement après avoir laissé sa chance au modèle courant, attente
        // comprise. Enchaîner les quatre modèles sans jamais attendre ne libère aucun quota.
        for (let attempt = 0; attempt < GEMINI_MAX_RETRIES; attempt += 1) {
          try {
            await acquireGeminiSlot(deadline);
            const text = await withAttemptTimeout((signal) =>
              callGeminiRaw(geminiKey, model, systemPrompt, userPrompt, signal),
            );
            return { text, provider: 'gemini', model };
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            const kind = aiErrorKind(err);

            if (kind === 'gone') {
              console.warn(`Gemini ${model} indisponible (retiré, ou hors palier gratuit) — modèle suivant`);
              break;
            }
            if (kind !== 'throttle') throw err;

            const waitMs = retryAfterMs(err) ?? Math.min(2_000 * 2 ** attempt, 30_000);
            if (attempt === GEMINI_MAX_RETRIES - 1 || Date.now() + waitMs > deadline) {
              console.warn(`Gemini ${model} toujours saturé après ${attempt + 1} tentative(s) — modèle suivant`);
              break;
            }
            console.warn(
              `Gemini ${model} saturé (429) — nouvelle tentative dans ${Math.round(waitMs / 1000)}s`,
            );
            await sleep(waitMs);
          }
        }
      }

      throw new Error(
        `Aucun modèle Gemini disponible après réessais (quota 429 persistant, ou modèles retirés — vérifier GEMINI_MODELS). Baisser GEMINI_RPM (actuellement ${GEMINI_RPM}), attendre quelques minutes, ou ajouter ANTHROPIC_API_KEY / OPENAI_API_KEY. Dernière erreur : ${lastError.slice(0, 160)}`,
      );
    };

    const attemptAnthropic = async (signal: AbortSignal): Promise<{ text: string; provider: string; model: string }> => {
      if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY is not configured');
      const text = await callAnthropicRaw(anthropicKey, systemPrompt, userPrompt, signal);
      return { text, provider: 'anthropic', model: ANTHROPIC_MODEL };
    };

    const attemptSelfHosted = async (signal: AbortSignal): Promise<{ text: string; provider: string; model: string }> => {
      const text = await callSelfHostedRaw(systemPrompt, userPrompt, signal);
      return { text, provider: 'selfhosted', model: SELF_HOSTED_MODEL };
    };

    // Une requête peut forcer un provider précis (ex: sélecteur cloud/auto-hébergé dans
    // l'UI) sans redémarrer le serveur ; sinon on retombe sur AI_PROVIDER défini en .env.
    const effectiveProvider = forceProvider ?? AI_PROVIDER;
    const providerOrder: Array<'openai' | 'gemini' | 'anthropic' | 'selfhosted'> =
      effectiveProvider === 'openai'
        ? ['openai']
        : effectiveProvider === 'gemini'
          ? ['gemini']
          : effectiveProvider === 'anthropic'
            ? ['anthropic']
            : effectiveProvider === 'selfhosted'
              ? ['selfhosted']
              : ['openai', 'gemini', 'anthropic'];

    for (const provider of providerOrder) {
      const hasKey =
        provider === 'selfhosted' ||
        (provider === 'openai' && openaiKey) ||
        (provider === 'gemini' && geminiKey) ||
        (provider === 'anthropic' && anthropicKey);
      if (!hasKey) continue;

      try {
        if (provider === 'openai') return await withAttemptTimeout(attemptOpenAI);
        if (provider === 'gemini') return await attemptGemini();
        if (provider === 'selfhosted') return await withAttemptTimeout(attemptSelfHosted);
        return await withAttemptTimeout(attemptAnthropic);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${provider}: ${msg.slice(0, 160)}`);
        if (effectiveProvider !== 'auto') throw err;
        console.warn(`${provider} failed, trying next provider:`, msg.slice(0, 120));
      }
    }

    throw new Error(
      failures.length
        ? `All AI providers failed. ${failures.join(' | ')}`
        : 'No AI key configured. Set GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY in .env, or set AI_PROVIDER=selfhosted with Ollama running',
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function callGeminiRaw(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  signal: AbortSignal,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.3 },
    }),
    signal,
  });
  const body = await response.text();
  if (!response.ok) {
    const err = new Error(body) as Error & { status?: number; retryAfter?: string };
    err.status = response.status;
    // Google indique souvent le délai à respecter ; l'honorer vaut mieux que le deviner.
    err.retryAfter = response.headers.get('retry-after') ?? undefined;
    throw err;
  }
  const data = JSON.parse(body) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
  if (!text) throw new Error('Gemini returned empty response');
  return text;
}

async function callAnthropicRaw(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal,
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`Anthropic API error: ${body}`);

  const data = JSON.parse(body) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === 'text')?.text?.trim() ?? '';
  if (!text) throw new Error('Claude returned an empty response');
  return text;
}

/** Ollama exposes an OpenAI-compatible /v1/chat/completions endpoint — no API key needed. */
async function callSelfHostedRaw(
  systemPrompt: string,
  userPrompt: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(`${SELF_HOSTED_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SELF_HOSTED_MODEL,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal,
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Self-hosted (Ollama) error: ${body.slice(0, 200)}. Is "ollama serve" running and "${SELF_HOSTED_MODEL}" pulled?`,
    );
  }
  const data = JSON.parse(body) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) throw new Error('Self-hosted model returned empty response');
  return text;
}

app.post('/api/classify-ticket', async (req, res) => {
  const { texte_brut: texteBrut, provider } = req.body as { texte_brut?: string; provider?: string };

  if (!texteBrut?.trim()) {
    res.status(400).json({ error: 'texte_brut is required' });
    return;
  }

  const forceProvider =
    provider === 'gemini' || provider === 'anthropic' || provider === 'openai' || provider === 'selfhosted'
      ? provider
      : undefined;

  try {
    const { text, provider: usedProvider, model } = await generateAIText(
      CLASSIFICATION_SYSTEM_PROMPT,
      buildClassificationPrompt(texteBrut),
      forceProvider,
    );
    const classification = parseClassification(text);
    res.json({ ...classification, provider: usedProvider, model, source: 'ai' });
  } catch (err) {
    // Filet de sécurité : on ne bloque jamais un ticket faute d'IA disponible.
    const fallback = heuristicClassify(texteBrut);
    res.json({
      ...fallback,
      provider: 'heuristic',
      model: 'keyword-fallback',
      source: 'fallback',
      error: err instanceof Error ? err.message : 'AI classification failed',
    });
  }
});

// ---------------------------------------------------------------- persistance Supabase
//
// Trois régimes, du plus protégé au plus permissif :
//   1. jeton porté par la requête  → client sous RLS, données cloisonnées par organisation ;
//   2. authentification configurée mais aucun jeton → 401, on ne sert rien ;
//   3. authentification non configurée (pas de clé anonyme) → service_role sans organisation,
//      c'est le mode démo local d'avant l'ajout des comptes.
// Sans Supabase du tout, les routes répondent 501 et le frontend continue en mémoire.

type Workspace =
  | { ok: true; db: SupabaseClient; organisationId: string | null }
  | { ok: false; status: number; message: string };

async function resolveWorkspace(req: Request): Promise<Workspace> {
  const header = req.header('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    if (hasSupabaseAuth) {
      return { ok: false, status: 401, message: 'Authentification requise' };
    }
    if (!supabase) return { ok: false, status: 501, message: 'Supabase not configured' };
    return { ok: true, db: supabase, organisationId: null };
  }

  const db = clientForAccessToken(token);
  if (!db) return { ok: false, status: 501, message: 'Supabase not configured' };

  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData.user) {
    return { ok: false, status: 401, message: 'Session invalide ou expirée' };
  }

  // La RLS filtre déjà `membres` sur auth.uid() — on lit simplement la première organisation
  // du compte. Sans organisation, l'utilisateur n'a pas terminé son onboarding.
  const { data: membre, error: membreError } = await db
    .from('membres')
    .select('organisation_id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membreError) {
    // PGRST205 = table absente du cache de schéma : la migration 002 n'a pas été exécutée.
    // Sans ce message, l'opérateur reçoit une erreur PostgREST brute qui ne dit pas quoi faire.
    if (membreError.code === 'PGRST205') {
      return {
        ok: false,
        status: 503,
        message:
          "Schéma incomplet : exécute supabase/002_organisations.sql dans Supabase (SQL Editor). Voir AUTH.md.",
      };
    }
    return { ok: false, status: 500, message: membreError.message };
  }
  if (!membre) return { ok: false, status: 403, message: "Aucune organisation rattachée à ce compte" };

  return { ok: true, db, organisationId: membre.organisation_id as string };
}

// PostgREST rejette tout objet contenant un champ absent du schéma. Le front travaille sur
// des tickets enrichis (categorie_attendue issue du CSV, provider/model/source renvoyés par
// /api/classify-ticket), donc on ne persiste que les colonnes de la table plutôt que de
// faire confiance à la forme envoyée par le client.
const TICKET_COLUMNS = [
  'id',
  'texte_brut',
  'categorie_causale',
  'sous_categorie',
  'date_creation',
  'statut',
  'provider_utilise',
  'delai_reponse_jours',
  'confiance',
  'justification',
] as const;

function toTicketRow(ticket: Ticket, organisationId: string | null): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const column of TICKET_COLUMNS) {
    const value = (ticket as Record<string, unknown>)[column];
    if (value !== undefined) row[column] = value;
  }
  if (organisationId) row.organisation_id = organisationId;
  return row;
}

app.get('/api/tickets', async (req, res) => {
  const ws = await resolveWorkspace(req);
  if (!ws.ok) {
    res.status(ws.status).json({ error: ws.message });
    return;
  }

  const { data, error } = await ws.db
    .from('tickets')
    .select('*')
    .order('date_creation', { ascending: false });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ tickets: data as Ticket[] });
});

app.post('/api/tickets', async (req, res) => {
  const { tickets } = req.body as { tickets?: Ticket[] };
  if (!Array.isArray(tickets)) {
    res.status(400).json({ error: 'tickets array is required' });
    return;
  }

  const ws = await resolveWorkspace(req);
  if (!ws.ok) {
    res.status(ws.status).json({ error: ws.message });
    return;
  }
  if (tickets.length === 0) {
    res.json({ tickets: [] });
    return;
  }

  const { data, error } = await ws.db
    .from('tickets')
    .upsert(tickets.map((t) => toTicketRow(t, ws.organisationId)), { onConflict: 'id' })
    .select();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ tickets: data as Ticket[] });
});

app.post('/api/patterns', async (req, res) => {
  const { tickets, persistedOnly } = req.body as { tickets?: Ticket[]; persistedOnly?: boolean };

  if (!Array.isArray(tickets) && !persistedOnly) {
    res.status(400).json({ error: 'tickets array is required' });
    return;
  }

  const ws = await resolveWorkspace(req);

  // La détection de patterns n'exige pas Supabase : sans persistance, on analyse le lot reçu
  // et on répond quand même, plutôt que de bloquer la fonctionnalité principale.
  let dataset: Ticket[] = tickets ?? [];
  if (ws.ok) {
    // Détection « dans le temps » : on fusionne le lot envoyé avec l'historique de
    // l'organisation, pour repérer des patterns au-delà du seul lot en cours.
    const { data, error } = await ws.db.from('tickets').select('*');
    if (!error && data) {
      const byId = new Map<string, Ticket>();
      for (const t of data as Ticket[]) byId.set(t.id, t);
      for (const t of dataset) byId.set(t.id, t);
      dataset = Array.from(byId.values());
    }
  }

  const patterns = detectPatterns(dataset);

  if (ws.ok && patterns.length > 0) {
    const rows = patterns.map((p) => ({
      id: p.id,
      description: p.description,
      categorie_causale: p.categorie_causale,
      tickets_lies: p.tickets_lies,
      date_detection: p.date_detection,
      severite: p.severite,
      type: p.type,
      ...(ws.organisationId ? { organisation_id: ws.organisationId } : {}),
    }));
    // Clé composite depuis la migration 002 : l'identifiant de pattern est déterministe et
    // donc partagé entre organisations, seule la paire (organisation, id) est unique.
    const onConflict = ws.organisationId ? 'organisation_id,id' : 'id';
    await ws.db.from('patterns_detectes').upsert(rows, { onConflict });
  }

  res.json({ patterns });
});

app.get('/api/patterns', async (req, res) => {
  const ws = await resolveWorkspace(req);
  if (!ws.ok) {
    res.status(ws.status).json({ error: ws.message });
    return;
  }

  const { data, error } = await ws.db
    .from('patterns_detectes')
    .select('*')
    .order('date_detection', { ascending: false });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ patterns: data as DetectedPattern[] });
});

app.post('/api/generate-report', (req, res) => {
  const { tickets, patterns } = req.body as { tickets?: Ticket[]; patterns?: ReturnType<typeof detectPatterns> };

  if (!Array.isArray(tickets)) {
    res.status(400).json({ error: 'tickets array is required' });
    return;
  }

  const resolvedPatterns = patterns ?? detectPatterns(tickets);
  const report = buildComplianceReport(tickets, resolvedPatterns);
  res.json({ report, markdown: complianceReportToMarkdown(report) });
});

// Service unique en production (Railway/Render) : Express sert le build Vite (dist/) en
// plus de l'API, sur le même port. En dev, Vite sert le frontend séparément (port 5173)
// et proxy /api vers ce serveur — voir vite.config.ts.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(
    `Sentinelle API server on http://localhost:${PORT} (AI_PROVIDER=${AI_PROVIDER}, Gemini models: ${GEMINI_MODELS.join(', ')}, self-hosted: ${SELF_HOSTED_BASE_URL} [${SELF_HOSTED_MODEL}])`,
  );
});
