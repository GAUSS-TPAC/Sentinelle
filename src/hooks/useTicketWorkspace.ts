import { useCallback, useMemo, useState } from 'react';
import type { DetectedPattern, Ticket } from '@/lib/types';

export type AIProviderChoice = 'gemini' | 'selfhosted';

type WorkingTicket = Ticket & { categorie_attendue?: string };

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
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [reportMarkdown, setReportMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec du chargement');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const classifyAll = useCallback(async () => {
    if (tickets.length === 0) return;
    setIsClassifying(true);
    setError(null);
    setClassifyProgress({ done: 0, total: tickets.length });

    try {
      const classified = await withConcurrency(
        tickets,
        4,
        async (ticket) => {
          const res = await fetch('/api/classify-ticket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texte_brut: ticket.texte_brut, provider }),
          });
          const data = (await res.json()) as {
            categorie_causale: string;
            sous_categorie: string;
            confiance: number;
            provider: string;
          };
          return { ...ticket, ...data, provider_utilise: data.provider } as WorkingTicket;
        },
        (done, total) => setClassifyProgress({ done, total }),
      );

      setTickets(classified);

      // Persistance Supabase best-effort : si non configuré côté serveur, l'API répond 501
      // et on l'ignore silencieusement — l'appli reste utilisable 100% en mémoire.
      fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickets: classified }),
      }).catch(() => {});

      const patternsRes = await fetch('/api/patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickets: classified }),
      });
      const { patterns: detected } = (await patternsRes.json()) as { patterns: DetectedPattern[] };
      setPatterns(detected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la classification');
    } finally {
      setIsClassifying(false);
    }
  }, [tickets, provider]);

  const generateReport = useCallback(async () => {
    setIsGeneratingReport(true);
    setError(null);
    try {
      const res = await fetch('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    isGeneratingReport,
    reportMarkdown,
    error,
    accuracy,
    loadSampleTickets,
    classifyAll,
    generateReport,
  };
}
