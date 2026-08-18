import { AlertTriangle, Download, FileText, Loader2, ShieldAlert, Upload } from 'lucide-react';
import { useTicketWorkspace } from '@/hooks/useTicketWorkspace';
import { downloadText } from '@/lib/dataExporter';
import type { DetectedPattern } from '@/lib/types';

const SEVERITY_STYLES: Record<DetectedPattern['severite'], string> = {
  critique: 'bg-red-950 border-red-700 text-red-200',
  elevee: 'bg-orange-950 border-orange-700 text-orange-200',
  moyenne: 'bg-yellow-950 border-yellow-700 text-yellow-200',
  faible: 'bg-neutral-800 border-neutral-600 text-neutral-300',
};

const CATEGORY_COLORS = [
  'bg-sky-900 text-sky-200',
  'bg-purple-900 text-purple-200',
  'bg-emerald-900 text-emerald-200',
  'bg-amber-900 text-amber-200',
  'bg-rose-900 text-rose-200',
  'bg-indigo-900 text-indigo-200',
  'bg-teal-900 text-teal-200',
  'bg-fuchsia-900 text-fuchsia-200',
  'bg-lime-900 text-lime-200',
  'bg-neutral-700 text-neutral-200',
];

function categoryColor(categorie: string, allCategories: string[]): string {
  const index = allCategories.indexOf(categorie);
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length] ?? CATEGORY_COLORS[CATEGORY_COLORS.length - 1];
}

export default function App() {
  const {
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
  } = useTicketWorkspace();

  const categories = [...new Set(tickets.map((t) => t.categorie_causale).filter(Boolean))];
  const hasClassified = tickets.some((t) => t.categorie_causale);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Racine</h1>
          <p className="text-sm text-neutral-500">
            Triage causal de réclamations bancaires — zone CEMAC
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="provider" className="text-sm text-neutral-400">
            Provider IA
          </label>
          <select
            id="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as 'gemini' | 'selfhosted')}
            className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
          >
            <option value="gemini">☁️ Cloud (Gemini)</option>
            <option value="selfhosted">🔒 Auto-hébergé (Ollama / Gemma)</option>
          </select>
        </div>
      </header>

      <main className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={loadSampleTickets}
            disabled={isLoading}
            className="inline-flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 px-3 py-2 rounded text-sm"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Charger l'échantillon (150 tickets)
          </button>

          <button
            onClick={classifyAll}
            disabled={tickets.length === 0 || isClassifying}
            className="inline-flex items-center gap-2 bg-sky-800 hover:bg-sky-700 disabled:opacity-50 px-3 py-2 rounded text-sm"
          >
            {isClassifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
            {isClassifying
              ? `Classification… ${classifyProgress.done}/${classifyProgress.total}`
              : 'Classer les tickets'}
          </button>

          <button
            onClick={generateReport}
            disabled={!hasClassified || isGeneratingReport}
            className="inline-flex items-center gap-2 bg-emerald-800 hover:bg-emerald-700 disabled:opacity-50 px-3 py-2 rounded text-sm"
          >
            {isGeneratingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Générer le rapport de conformité
          </button>

          {accuracy && (
            <span className="text-sm text-neutral-400 ml-auto">
              Précision vs. étiquette de référence : {accuracy.correct}/{accuracy.total} (
              {(accuracy.ratio * 100).toFixed(0)}%)
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-950 border border-red-700 text-red-200 rounded px-3 py-2 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {patterns.length > 0 && (
          <div className="space-y-2">
            {patterns.map((p) => (
              <div
                key={p.id}
                className={`flex items-start gap-2 border rounded px-3 py-2 text-sm ${SEVERITY_STYLES[p.severite]}`}
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold uppercase text-xs mr-2">{p.severite}</span>
                  {p.description}
                </div>
              </div>
            ))}
          </div>
        )}

        {reportMarkdown && (
          <div className="border border-neutral-700 rounded p-4 space-y-2 bg-neutral-900">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Rapport de conformité</h2>
              <button
                onClick={() => downloadText(reportMarkdown, 'racine_rapport_conformite.md', 'text/markdown;charset=utf-8')}
                className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300"
              >
                <Download className="w-4 h-4" /> Télécharger
              </button>
            </div>
            <pre className="text-xs whitespace-pre-wrap text-neutral-300 max-h-96 overflow-auto">
              {reportMarkdown}
            </pre>
          </div>
        )}

        <div className="border border-neutral-800 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Réclamation</th>
                <th className="text-left px-3 py-2 font-medium">Catégorie causale</th>
                <th className="text-left px-3 py-2 font-medium">Statut</th>
                <th className="text-left px-3 py-2 font-medium">Délai (j)</th>
                <th className="text-left px-3 py-2 font-medium">Provider</th>
              </tr>
            </thead>
            <tbody>
              {tickets.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-neutral-500">
                    Aucun ticket chargé — clique sur "Charger l'échantillon".
                  </td>
                </tr>
              )}
              {tickets.map((t) => (
                <tr key={t.id} className="border-t border-neutral-800">
                  <td className="px-3 py-2 max-w-md truncate" title={t.texte_brut}>
                    {t.texte_brut}
                  </td>
                  <td className="px-3 py-2">
                    {t.categorie_causale ? (
                      <span className={`px-2 py-0.5 rounded text-xs ${categoryColor(t.categorie_causale, categories)}`}>
                        {t.categorie_causale}
                      </span>
                    ) : (
                      <span className="text-neutral-600 text-xs">à classer</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-400">{t.statut}</td>
                  <td className="px-3 py-2 text-neutral-400">{t.delai_reponse_jours ?? '—'}</td>
                  <td className="px-3 py-2 text-neutral-500 text-xs">{t.provider_utilise ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
