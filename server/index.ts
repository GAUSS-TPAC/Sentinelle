import express from 'express';
import cors from 'cors';
import 'dotenv/config';

const app = express();
const PORT = Number(process.env.API_PORT ?? process.env.PORT) || 3001;

// gemini | anthropic | openai | selfhosted | auto
const AI_PROVIDER = process.env.AI_PROVIDER ?? 'auto';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-3-5-haiku-latest';
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

const GEMINI_MODELS = (
  process.env.GEMINI_MODEL
    ? [process.env.GEMINI_MODEL]
    : ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash']
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
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasOpenaiKey: Boolean(process.env.OPENAI_API_KEY),
  });
});

function isRetryableAIError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  const message = err instanceof Error ? err.message : String(err);
  return (
    status === 429 ||
    status === 404 ||
    message.includes('RESOURCE_EXHAUSTED') ||
    /quota exceeded|rate.?limit|limit:\s*0/i.test(message)
  );
}

/**
 * Provider-agnostic AI text generation. Extend `providerOrder` / add an `attemptX`
 * function to plug in a new provider without touching call sites (routes just
 * call `generateAIText(system, user)` and get back `{ text, provider, model }`).
 */
export async function generateAIText(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ text: string; provider: string; model: string }> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const failures: string[] = [];

  try {
    const attemptOpenAI = async (): Promise<{ text: string; provider: string; model: string }> => {
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
        signal: controller.signal,
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
        try {
          const text = await callGeminiRaw(
            geminiKey,
            model,
            systemPrompt,
            userPrompt,
            controller.signal,
          );
          return { text, provider: 'gemini', model };
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          if (isRetryableAIError(err)) {
            console.warn(`Gemini ${model} unavailable, trying next model...`);
            continue;
          }
          throw err;
        }
      }
      throw new Error(
        `Gemini quota exceeded on all models. Wait a few minutes or add ANTHROPIC_API_KEY / OPENAI_API_KEY. Last: ${lastError.slice(0, 160)}`,
      );
    };

    const attemptAnthropic = async (): Promise<{ text: string; provider: string; model: string }> => {
      if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY is not configured');
      const text = await callAnthropicRaw(anthropicKey, systemPrompt, userPrompt, controller.signal);
      return { text, provider: 'anthropic', model: ANTHROPIC_MODEL };
    };

    const attemptSelfHosted = async (): Promise<{ text: string; provider: string; model: string }> => {
      const text = await callSelfHostedRaw(systemPrompt, userPrompt, controller.signal);
      return { text, provider: 'selfhosted', model: SELF_HOSTED_MODEL };
    };

    const providerOrder: Array<'openai' | 'gemini' | 'anthropic' | 'selfhosted'> =
      AI_PROVIDER === 'openai'
        ? ['openai']
        : AI_PROVIDER === 'gemini'
          ? ['gemini']
          : AI_PROVIDER === 'anthropic'
            ? ['anthropic']
            : AI_PROVIDER === 'selfhosted'
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
        if (provider === 'openai') return await attemptOpenAI();
        if (provider === 'gemini') return await attemptGemini();
        if (provider === 'selfhosted') return await attemptSelfHosted();
        return await attemptAnthropic();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${provider}: ${msg.slice(0, 160)}`);
        if (AI_PROVIDER !== 'auto') throw err;
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
    const err = new Error(body) as Error & { status?: number };
    err.status = response.status;
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

// TODO (étape 2.5, après validation de la taxonomie causale + schéma Supabase) :
//   POST /api/classify-ticket, GET /api/patterns, POST /api/generate-report

app.listen(PORT, () => {
  console.log(
    `Racine API server on http://localhost:${PORT} (AI_PROVIDER=${AI_PROVIDER}, Gemini models: ${GEMINI_MODELS.join(', ')}, self-hosted: ${SELF_HOSTED_BASE_URL} [${SELF_HOSTED_MODEL}])`,
  );
});
