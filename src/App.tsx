import { useMemo, useState } from 'react';
import { AlertTriangle, Cloud, Download, FileText, FileUp, Loader2, ShieldCheck, Upload } from 'lucide-react';
import { AccountMenu } from '@/components/AccountMenu';
import { SentinelleLogo } from '@/components/SentinelleLogo';
import { AuthScreen } from '@/components/AuthScreen';
import { ImportDialog } from '@/components/ImportDialog';
import { OnboardingScreen } from '@/components/OnboardingScreen';
import { useAuth } from '@/auth/AuthProvider';
import { SegmentedControl } from '@/components/SegmentedControl';
import { useTicketWorkspace } from '@/hooks/useTicketWorkspace';
import { downloadText } from '@/lib/dataExporter';
import { categoryTagStyle } from '@/lib/categoryColor';
import type { DetectedPattern } from '@/lib/types';

/** Onglet « toutes catégories » — valeur sentinelle, distincte de toute catégorie réelle. */
const ALL_TAB = '__toutes__';
/** Regroupe les tickets encore sans catégorie (avant classification, ou repli en échec). */
const UNCLASSIFIED_TAB = '__non_classees__';

const SEVERITY_LABEL: Record<DetectedPattern['severite'], string> = {
  critique: 'Critique',
  elevee: 'Élevée',
  moyenne: 'Moyenne',
  faible: 'Faible',
};

const SEVERITY_COLOR: Record<DetectedPattern['severite'], string> = {
  critique: 'var(--color-danger-critical)',
  elevee: 'var(--color-danger-high)',
  moyenne: 'var(--color-warning)',
  faible: 'var(--color-ink-faint)',
};

function PatternBanner({ pattern }: { pattern: DetectedPattern }) {
  const color = SEVERITY_COLOR[pattern.severite];
  return (
    <div
      className="flex items-center gap-3.5 px-4 py-3 rounded-lg border"
      style={{ backgroundColor: `color-mix(in oklch, ${color} 9%, var(--color-surface))`, borderColor: `color-mix(in oklch, ${color} 28%, var(--color-line))` }}
    >
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: `color-mix(in oklch, ${color} 20%, transparent)` }}
      >
        <AlertTriangle className="w-4 h-4" style={{ color }} />
      </div>
      <p className="flex-1 text-[13.5px] text-ink">{pattern.description}</p>
      <span
        className="font-mono text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded"
        style={{ color, backgroundColor: `color-mix(in oklch, ${color} 16%, transparent)` }}
      >
        {SEVERITY_LABEL[pattern.severite]}
      </span>
    </div>
  );
}

function TabButton({
  label, count, active, dotColor, onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  dotColor?: string;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12.5px] font-medium whitespace-nowrap transition-colors"
      style={{
        borderColor: active ? 'var(--color-accent)' : 'var(--color-line-soft)',
        backgroundColor: active
          ? 'color-mix(in oklch, var(--color-accent) 14%, var(--color-surface))'
          : 'var(--color-surface)',
        color: active ? 'var(--color-ink)' : 'var(--color-ink-soft)',
      }}
    >
      {dotColor && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />}
      {label}
      <span className="font-mono text-[11px] text-ink-faint">{count}</span>
    </button>
  );
}

function Workspace() {
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
    sourceName,
    loadSampleTickets,
    importTickets,
    classifyAll,
    generateReport,
  } = useTicketWorkspace();

  const [isImportOpen, setIsImportOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(ALL_TAB);

  const hasClassified = tickets.some((t) => t.categorie_causale);

  // Un onglet par catégorie effectivement présente, ordonné du plus gros volume au plus
  // petit : ce sont les catégories les plus lourdes qui intéressent le chargé de conformité.
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tickets) {
      const key = t.categorie_causale || UNCLASSIFIED_TAB;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => (a[0] === UNCLASSIFIED_TAB ? 1 : b[0] === UNCLASSIFIED_TAB ? -1 : b[1] - a[1]))
      .map(([categorie, count]) => ({ categorie, count }));
  }, [tickets]);

  // L'onglet actif peut disparaître après un nouvel import ou une reclassification.
  const currentTab = activeTab !== ALL_TAB && !groups.some((g) => g.categorie === activeTab)
    ? ALL_TAB
    : activeTab;

  const visibleTickets = useMemo(() => {
    if (currentTab === ALL_TAB) return tickets;
    if (currentTab === UNCLASSIFIED_TAB) return tickets.filter((t) => !t.categorie_causale);
    return tickets.filter((t) => t.categorie_causale === currentTab);
  }, [tickets, currentTab]);

  return (
    <div className="min-h-screen bg-base text-ink font-sans">
      {/* ===== En-tête ===== */}
      <header className="flex items-center justify-between gap-4 flex-wrap px-8 py-5 border-b border-line-soft bg-surface">
        <div className="flex items-center gap-3.5">
          <SentinelleLogo size={34} className="text-ink shrink-0" />
          <div>
            <div className="text-[15.5px] font-semibold tracking-tight leading-tight">Sentinelle</div>
            <div className="font-mono text-[10.5px] tracking-wide uppercase text-ink-faint mt-0.5">
              Triage causal · zone CEMAC
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-success)_22%,transparent)]" />
            <span className="text-[12.5px] text-ink-soft">Service actif</span>
          </div>

          <AccountMenu />

          <SegmentedControl
            label="Provider IA"
            value={provider}
            onValueChange={(v) => setProvider(v as 'gemini' | 'selfhosted')}
            options={[
              {
                value: 'gemini',
                ariaLabel: 'Cloud · Gemini',
                label: (
                  <>
                    <Cloud className="w-3.5 h-3.5" />
                    Cloud · Gemini
                  </>
                ),
              },
              {
                value: 'selfhosted',
                ariaLabel: 'Auto-hébergé · Ollama',
                label: (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Auto-hébergé · Ollama
                  </>
                ),
              },
            ]}
          />
        </div>
      </header>

      {/* ===== Barre d'outils ===== */}
      <div className="flex items-center gap-3 px-8 py-4.5 border-b border-line-soft flex-wrap">
        <button
          onClick={loadSampleTickets}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-line bg-surface text-ink text-[13px] font-medium disabled:opacity-50 hover:bg-elevated transition-colors"
        >
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Charger l'échantillon
        </button>

        <button
          onClick={() => setIsImportOpen(true)}
          className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-line bg-surface text-ink text-[13px] font-medium hover:bg-elevated transition-colors"
        >
          <FileUp className="w-3.5 h-3.5" />
          Importer un fichier
        </button>

        <button
          onClick={classifyAll}
          disabled={tickets.length === 0 || isClassifying}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-semibold disabled:opacity-50 transition-colors"
          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-ink)' }}
        >
          {isClassifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
          {isClassifying ? `Classification… ${classifyProgress.done}/${classifyProgress.total}` : 'Classer les tickets'}
        </button>

        <button
          onClick={generateReport}
          disabled={!hasClassified || isGeneratingReport}
          className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-line bg-surface text-ink text-[13px] font-medium disabled:opacity-50 hover:bg-elevated transition-colors"
        >
          {isGeneratingReport ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          Générer le rapport de conformité
        </button>

        {sourceName && (
          <span className="ml-auto font-mono text-[11.5px] text-ink-faint truncate max-w-[16rem]" title={sourceName}>
            {sourceName} · {tickets.length} réclamation(s)
          </span>
        )}

        {accuracy && (
          <div className={`${sourceName ? '' : 'ml-auto'} flex items-center gap-2 px-3.5 py-2 rounded-lg bg-surface border border-line-soft`}>
            <span className="font-mono text-xs text-ink-soft">Précision vs. référence</span>
            <span className="font-mono text-xs font-semibold text-success">
              {accuracy.correct}/{accuracy.total} · {(accuracy.ratio * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      <main className="px-8 py-6 flex flex-col gap-2.5">
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-line text-[13.5px] text-danger-critical" style={{ backgroundColor: 'color-mix(in oklch, var(--color-danger-critical) 10%, var(--color-surface))' }}>
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {patterns.map((p) => (
          <PatternBanner key={p.id} pattern={p} />
        ))}

        {/* ===== Onglets par catégorie causale ===== */}
        {groups.length > 1 && (
          <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Catégories causales">
            <TabButton
              label="Toutes"
              count={tickets.length}
              active={currentTab === ALL_TAB}
              onClick={() => setActiveTab(ALL_TAB)}
            />
            {groups.map(({ categorie, count }) => (
              <TabButton
                key={categorie}
                label={categorie === UNCLASSIFIED_TAB ? 'Non classées' : categorie}
                count={count}
                active={currentTab === categorie}
                dotColor={categorie === UNCLASSIFIED_TAB ? undefined : categoryTagStyle(categorie).color}
                onClick={() => setActiveTab(categorie)}
              />
            ))}
          </div>
        )}

        {/* ===== Table ===== */}
        <div className="mt-3 border border-line-soft rounded-[10px] overflow-hidden overflow-x-auto">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="bg-elevated">
                <th className="text-left px-4 py-2.5 font-semibold text-[11px] tracking-wide uppercase text-ink-faint">Réclamation</th>
                <th className="text-left px-4 py-2.5 font-semibold text-[11px] tracking-wide uppercase text-ink-faint w-56">Catégorie causale</th>
                <th className="text-left px-4 py-2.5 font-semibold text-[11px] tracking-wide uppercase text-ink-faint w-28">Statut</th>
                <th className="text-left px-4 py-2.5 font-semibold text-[11px] tracking-wide uppercase text-ink-faint w-20">Délai</th>
                <th className="text-left px-4 py-2.5 font-semibold text-[11px] tracking-wide uppercase text-ink-faint w-28">Confiance</th>
              </tr>
            </thead>
            <tbody>
              {visibleTickets.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-ink-faint text-sm">
                    {tickets.length === 0
                      ? 'Aucune réclamation chargée — importe un fichier, ou charge l’échantillon.'
                      : 'Aucune réclamation dans cette catégorie.'}
                  </td>
                </tr>
              )}
              {visibleTickets.map((t) => (
                <tr key={t.id} className="border-t border-line-soft">
                  <td className="px-4 py-3 max-w-md truncate text-ink-soft" title={t.texte_brut}>
                    {t.texte_brut}
                  </td>
                  <td className="px-4 py-3">
                    {t.categorie_causale ? (
                      <span className="inline-block px-2.5 py-1 rounded-full text-[11.5px] font-medium" style={categoryTagStyle(t.categorie_causale)}>
                        {t.categorie_causale}
                      </span>
                    ) : (
                      <span className="text-ink-faint text-xs">à classer</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-ink-soft text-[12.5px]">
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: t.statut === 'en_retard' ? 'var(--color-danger-critical)' : t.statut === 'en_cours' ? 'var(--color-warning)' : 'var(--color-ink-soft)' }}
                      />
                      {t.statut}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12.5px]" style={{ color: (t.delai_reponse_jours ?? 0) > 45 ? 'var(--color-danger-high)' : 'var(--color-ink-faint)' }}>
                    {t.delai_reponse_jours ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {t.confiance != null ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-10 h-1 rounded-full bg-line">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(t.confiance * 100)}%` }} />
                        </div>
                        <span className="font-mono text-[11px] text-ink-faint">{Math.round(t.confiance * 100)}%</span>
                      </div>
                    ) : (
                      <span className="text-ink-faint text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {reportMarkdown && (
          <div className="border border-line-soft rounded-[10px] p-4 mt-3 bg-surface">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-sm">Rapport de conformité</h2>
              <button
                onClick={() => downloadText(reportMarkdown, 'racine_rapport_conformite.md', 'text/markdown;charset=utf-8')}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium"
                style={{ color: 'var(--color-success)' }}
              >
                <Download className="w-3.5 h-3.5" /> Télécharger
              </button>
            </div>
            <pre className="text-xs whitespace-pre-wrap text-ink-soft max-h-96 overflow-auto font-mono">{reportMarkdown}</pre>
          </div>
        )}
      </main>

      <ImportDialog
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImport={(imported, fileName) => {
          importTickets(imported, fileName);
          setActiveTab(ALL_TAB);
        }}
      />
    </div>
  );
}

/**
 * Porte d'entree : session puis organisation. Tant que Supabase Auth n'est pas configure
 * (VITE_SUPABASE_ANON_KEY absente), on sert directement le plan de travail : la demo locale
 * reste utilisable sans comptes, exactement comme avant l'ajout de cette couche.
 */
export default function App() {
  const { configured, loading, session, organisation } = useAuth();

  if (!configured) return <Workspace />;

  if (loading) {
    return (
      <div className="min-h-screen bg-base text-ink flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-ink-faint" />
      </div>
    );
  }

  if (!session) return <AuthScreen />;
  if (!organisation) return <OnboardingScreen />;
  return <Workspace />;
}
