import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { fetchModelCatalog, type ModelInfo } from '@/lib/modelCatalog';
import {
  scoreModel,
  type BenchmarkAttempt,
  type ModelScore,
} from '@/lib/modelBenchmark';
import type { DetectedPattern, Ticket } from '@/lib/types';

export type AIProviderChoice = 'gemini' | 'selfhosted';

export type BenchmarkProgress = { model: string; done: number; total: number } | null;

type WorkingTicket = Ticket & { categorie_attendue?: string };

/**
 * Bilan de fiabilité d'un lot. Un repli heuristique renvoie un HTTP 200 et une catégorie
 * plausible : sans ce décompte, un rapport de conformité peut reposer sur du classement par
 * mots-clés sans que personne ne s'en aperçoive.
 */
export type ClassifyStats = { total: number; fallback: number; reason: string | null };

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let done = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
      done += 1;
      onProgress?.(done, items.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export function useTicketWorkspace() {
  const [tickets, setTickets] = useState<WorkingTicket[]>([]);
  const [patterns, setPatterns] = useState<DetectedPattern[]>([]);
  const [provider, setProvider] = useState<AIProviderChoice>('gemini');
  const [isLoading, setIsLoading] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [classifyProgress, setClassifyProgress] = useState({ done: 0, total: 0 });
  const [classifyStats, setClassifyStats] = useState<ClassifyStats | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [reportMarkdown, setReportMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const [benchmarkScores, setBenchmarkScores] = useState<ModelScore[] | null>(null);
  const [benchmarkSample, setBenchmarkSample] = useState(0);
  const [benchmarkProgress, setBenchmarkProgress] = useState<BenchmarkProgress>(null);
  const [isBenchmarking, setIsBenchmarking] = useState(false);

  /**
   * Catalogue chargé une fois : la liste des modèles Ollama installés change au rythme de
   * l'opérateur, pas de l'utilisateur. Un échec est silencieux — l'application reste
   * utilisable avec le modèle par défaut du serveur.
   */
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const catalogue = await fetchModelCatalog();
        if (!active) return;
        setModels(catalogue.models);
      } catch {
        // Catalogue indisponible : le serveur choisira seul son modèle.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  /** Modèles du provider actuellement sélectionné, utilisables seulement. */
  const modelsForProvider = useMemo(
    () => models.filter((m) => m.provider === provider && m.disponible && m.model),
    [models, provider],
  );

  /**
   * Le modèle choisi doit toujours appartenir au provider courant : basculer de « cloud » à
   * « auto-hébergé » sans resélectionner enverrait un nom de modèle Gemini à Ollama.
   *
   * À défaut de choix explicite, on retient le premier modèle *sans avertissement* plutôt que
   * le premier de la liste : Ollama énumère ses modèles dans son propre ordre, et un modèle
   * plus gros que la mémoire disponible ferait échouer tout un lot sans que l'utilisateur ait
   * rien sélectionné. Un défaut ne doit pas être un piège.
   */
  const selectedModel = useMemo(() => {
    const choisi = modelsForProvider.find((m) => m.id === modelId);
    if (choisi) return choisi;
    return modelsForProvider.find((m) => !m.avertissement) ?? modelsForProvider[0] ?? null;
  }, [modelsForProvider, modelId]);

  const loadSampleTickets = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/sample-tickets.csv');
      if (!res.ok) throw new Error(`Impossible de charger l'échantillon (${res.status})`);
      const { default: Papa } = await import('papaparse');
      const text = await res.text();
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });

      const loaded: WorkingTicket[] = parsed.data.map((row) => ({
        id: crypto.randomUUID(),
        texte_brut: row.texte_brut ?? '',
        categorie_causale: '',
        categorie_attendue: row.categorie_causale,
        sous_categorie: '',
        date_creation: row.date_creation ?? new Date().toISOString().slice(0, 10),
        statut: (row.statut as WorkingTicket['statut']) ?? 'nouveau',
        delai_reponse_jours: row.delai_reponse_jours ? Number(row.delai_reponse_jours) : null,
      }));

      setTickets(loaded);
      setPatterns([]);
      setReportMarkdown(null);
      setSourceName('Échantillon de démonstration');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec du chargement');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** Remplace le portefeuille courant par un fichier importé (CSV / Excel / JSON). */
  /**
   * Remet le plan de travail à zéro, côté navigateur uniquement.
   *
   * Ne touche délibérément pas au portefeuille persisté dans Supabase : un rechargement de
   * la page le réaffiche. Purger la base est une action destructrice et irréversible, qui
   * n'a pas sa place derrière un bouton de remise à zéro de l'affichage — d'autant que les
   * données sont partagées avec toute l'organisation.
   */
  const resetWorkspace = useCallback(() => {
    setTickets([]);
    setPatterns([]);
    setReportMarkdown(null);
    setError(null);
    setSourceName(null);
    setClassifyStats(null);
    setClassifyProgress({ done: 0, total: 0 });
  }, []);

  const importTickets = useCallback((imported: WorkingTicket[], fileName: string) => {
    setTickets(imported);
    setPatterns([]);
    setReportMarkdown(null);
    setError(null);
    setSourceName(fileName);
  }, []);

  /**
   * Relit le portefeuille déjà persisté de l'organisation, au chargement. Sans cela, les
   * données survivent en base mais n'apparaissent jamais : un collègue invité rejoindrait
   * l'organisation pour tomber sur un écran vide. Silencieux en cas d'échec — Supabase non
   * configuré (501), pas de session (401) ou pas d'organisation (403) sont des états normaux
   * en mode démo, pas des erreurs à afficher.
   */
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await apiFetch('/api/tickets');
        if (!res.ok) return;
        const { tickets: persisted } = (await res.json()) as { tickets: WorkingTicket[] };
        if (!active || persisted.length === 0) return;
        setTickets(persisted);
        setSourceName('Portefeuille de l’organisation');
      } catch {
        // Réseau indisponible : l'appli reste utilisable, on n'affiche rien.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const classifyAll = useCallback(async () => {
    if (tickets.length === 0) return;
    setIsClassifying(true);
    setError(null);
    setClassifyStats(null);
    setClassifyProgress({ done: 0, total: tickets.length });

    const fallbackReasons: string[] = [];

    try {
      const classified = await withConcurrency(
        tickets,
        // Concurrence volontairement basse. Le palier gratuit de Gemini plafonne le débit et
        // le serveur applique déjà son propre limiteur (GEMINI_RPM) ; monter plus haut
        // n'accélère rien, cela ne fait qu'allonger la file d'attente côté serveur et
        // rapprocher chaque requête de son délai d'expiration.
        2,
        async (ticket) => {
          const res = await apiFetch('/api/classify-ticket', {
            method: 'POST',
            body: JSON.stringify({
              texte_brut: ticket.texte_brut,
              provider,
              ...(selectedModel ? { model: selectedModel.model } : {}),
            }),
          });
          const data = (await res.json()) as {
            categorie_causale: string;
            sous_categorie: string;
            confiance: number;
            provider: string;
            source?: 'ai' | 'fallback';
            error?: string;
          };
          if (data.source === 'fallback' && data.error) fallbackReasons.push(data.error);
          return { ...ticket, ...data, provider_utilise: data.provider } as WorkingTicket;
        },
        (done, total) => setClassifyProgress({ done, total }),
      );

      setTickets(classified);
      setClassifyStats({
        total: classified.length,
        fallback: classified.filter((t) => t.provider_utilise === 'heuristic').length,
        reason: fallbackReasons[0] ?? null,
      });

      // Persistance Supabase : awaitée avant la détection de patterns, qui relit l'historique
      // persisté côté serveur pour croiser les lots — sans await, le lot courant pouvait
      // manquer à l'appel. Si Supabase n'est pas configuré, l'API répond 501 : cas normal,
      // l'appli reste utilisable 100% en mémoire. Tout autre échec est signalé plutôt
      // qu'avalé (la classification, elle, reste affichée).
      const persistRes = await apiFetch('/api/tickets', {
        method: 'POST',
        body: JSON.stringify({ tickets: classified }),
      }).catch(() => null);

      if (persistRes && !persistRes.ok && persistRes.status !== 501) {
        const detail = await persistRes
          .json()
          .then((body: { error?: string }) => body.error)
          .catch(() => null);
        setError(`Classification terminée, mais la persistance a échoué : ${detail ?? `HTTP ${persistRes.status}`}`);
      }

      const patternsRes = await apiFetch('/api/patterns', {
        method: 'POST',
        body: JSON.stringify({ tickets: classified }),
      });
      const { patterns: detected } = (await patternsRes.json()) as { patterns: DetectedPattern[] };
      setPatterns(detected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la classification');
    } finally {
      setIsClassifying(false);
    }
  }, [tickets, provider, selectedModel]);

  /**
   * Compare plusieurs modèles sur un même échantillon de réclamations déjà étiquetées.
   *
   * Trois choix de méthode qui conditionnent la validité du résultat :
   *
   *  - **Même échantillon pour tous les modèles**, tiré une seule fois. Comparer deux modèles
   *    sur deux tirages différents ne mesurerait que la chance du tirage.
   *  - **Aucune écriture.** Le banc ne persiste rien et ne touche pas au portefeuille affiché :
   *    c'est une mesure, pas un classement de production. Sans cela, comparer trois modèles
   *    écraserait trois fois le classement du portefeuille.
   *  - **Un seul appel à la fois pour un modèle local.** Ollama sérialise de toute façon sur
   *    deux cœurs ; paralléliser n'accélère rien et fausse la latence mesurée.
   */
  const runBenchmark = useCallback(
    async (modelIds: string[], tailleEchantillon: number) => {
      const etiquetes = tickets.filter((t) => t.categorie_attendue);
      if (etiquetes.length === 0) {
        setError(
          "Comparaison impossible : aucune réclamation ne porte de catégorie de référence. Importe un fichier dont une colonne contient un classement déjà connu (champ « Catégorie déjà connue » de l'écran d'import).",
        );
        return;
      }
      const choisis = models.filter((m) => modelIds.includes(m.id) && m.disponible && m.model);
      if (choisis.length === 0) {
        setError('Comparaison impossible : aucun modèle sélectionné.');
        return;
      }

      setIsBenchmarking(true);
      setError(null);
      setBenchmarkScores(null);

      // Échantillon déterministe *et* étalé sur tout le fichier : on prend des indices
      // régulièrement espacés plutôt que les n premières lignes. Un export de réclamations est
      // presque toujours trié par date, et les n premières lignes appartiennent alors à une
      // poignée de catégories — on mesurerait la performance du modèle sur un seul type de
      // réclamation en croyant mesurer sa performance générale. Déterministe reste essentiel :
      // on compare des mesures entre elles, pas des tirages.
      const voulu = Math.min(Math.max(1, tailleEchantillon), etiquetes.length);
      const pas = etiquetes.length / voulu;
      const echantillon = Array.from(
        { length: voulu },
        (_, i) => etiquetes[Math.floor(i * pas)],
      );
      setBenchmarkSample(echantillon.length);

      try {
        const scores: ModelScore[] = [];

        for (const m of choisis) {
          const attempts: BenchmarkAttempt[] = [];
          setBenchmarkProgress({ model: m.label, done: 0, total: echantillon.length });

          await withConcurrency(
            echantillon,
            m.emplacement === 'local' ? 1 : 2,
            async (ticket) => {
              const debut = performance.now();
              try {
                const res = await apiFetch('/api/classify-ticket', {
                  method: 'POST',
                  body: JSON.stringify({
                    texte_brut: ticket.texte_brut,
                    provider: m.provider,
                    model: m.model,
                  }),
                });
                const data = (await res.json()) as {
                  categorie_causale?: string;
                  confiance?: number;
                  source?: 'ai' | 'fallback';
                };
                attempts.push({
                  obtenue: data.categorie_causale ?? '',
                  attendue: ticket.categorie_attendue ?? '',
                  confiance: typeof data.confiance === 'number' ? data.confiance : null,
                  repli: data.source === 'fallback',
                  latenceMs: performance.now() - debut,
                });
              } catch {
                // Échec réseau : compté comme une non-réponse du modèle, pas ignoré.
                attempts.push({
                  obtenue: '',
                  attendue: ticket.categorie_attendue ?? '',
                  confiance: null,
                  repli: true,
                  latenceMs: performance.now() - debut,
                });
              }
            },
            (done, total) => setBenchmarkProgress({ model: m.label, done, total }),
          );

          scores.push(scoreModel(m.id, m.label, m.emplacement, attempts, m.rpmLimite));
          setBenchmarkScores([...scores]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Échec de la comparaison de modèles');
      } finally {
        setIsBenchmarking(false);
        setBenchmarkProgress(null);
      }
    },
    [tickets, models],
  );

  const generateReport = useCallback(async () => {
    setIsGeneratingReport(true);
    setError(null);
    try {
      const res = await apiFetch('/api/generate-report', {
        method: 'POST',
        body: JSON.stringify({ tickets, patterns }),
      });
      const { markdown } = (await res.json()) as { markdown: string };
      setReportMarkdown(markdown);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la génération du rapport');
    } finally {
      setIsGeneratingReport(false);
    }
  }, [tickets, patterns]);

  const accuracy = useMemo(() => {
    const withExpected = tickets.filter((t) => t.categorie_attendue && t.categorie_causale);
    if (withExpected.length === 0) return null;
    const correct = withExpected.filter((t) => t.categorie_attendue === t.categorie_causale).length;
    return { correct, total: withExpected.length, ratio: correct / withExpected.length };
  }, [tickets]);

  return {
    tickets,
    patterns,
    provider,
    setProvider,
    isLoading,
    isClassifying,
    classifyProgress,
    classifyStats,
    isGeneratingReport,
    reportMarkdown,
    error,
    accuracy,
    sourceName,
    models,
    modelsForProvider,
    selectedModel,
    setModelId,
    benchmarkScores,
    benchmarkSample,
    benchmarkProgress,
    isBenchmarking,
    runBenchmark,
    loadSampleTickets,
    importTickets,
    resetWorkspace,
    classifyAll,
    generateReport,
  };
}
