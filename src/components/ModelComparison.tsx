import { useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, Download, Loader2 } from 'lucide-react';
import { benchmarkToMarkdown, classerScores, type ModelScore } from '@/lib/modelBenchmark';
import { downloadText } from '@/lib/dataExporter';
import type { ModelInfo } from '@/lib/modelCatalog';
import type { BenchmarkProgress } from '@/hooks/useTicketWorkspace';

const TAILLES = [10, 20, 50] as const;

function pct(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(0)} %`;
}

/**
 * Banc de comparaison de modèles.
 *
 * Volontairement un tableau et non un graphique : on compare deux à cinq modèles sur six
 * mesures, ce qu'un tableau rend plus lisible et plus citable qu'un diagramme. Le classement
 * se lit dans l'ordre des lignes, et le modèle recommandé porte une mention écrite — jamais
 * une couleur seule, qui exclurait une partie des lecteurs.
 */
export function ModelComparison({
  models,
  scores,
  echantillon,
  progress,
  isBenchmarking,
  nbEtiquetes,
  onRun,
}: {
  models: ModelInfo[];
  scores: ModelScore[] | null;
  echantillon: number;
  progress: BenchmarkProgress;
  isBenchmarking: boolean;
  nbEtiquetes: number;
  onRun: (modelIds: string[], taille: number) => void;
}) {
  const utilisables = models.filter((m) => m.disponible && m.model);
  const [selection, setSelection] = useState<string[]>([]);
  const [taille, setTaille] = useState<number>(10);

  /**
   * Le catalogue arrive de façon asynchrone : au premier rendu il peut être vide, et une
   * sélection calculée une seule fois à l'initialisation resterait alors vide pour toujours.
   * On coche donc tout dès que la liste devient disponible, et seulement à ce moment — pour ne
   * pas réintroduire un modèle que l'utilisateur vient de décocher.
   */
  const clefCatalogue = utilisables.map((m) => m.id).join('|');
  useEffect(() => {
    if (clefCatalogue) setSelection(clefCatalogue.split('|'));
  }, [clefCatalogue]);

  const bascule = (id: string) =>
    setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const classes = scores ? classerScores(scores) : [];
  const meilleur = classes.find((s) => s.soumises > 0 && s.exactes > 0) ?? null;
  const plafond = Math.min(taille, nbEtiquetes);

  return (
    <section className="border border-line-soft rounded-[10px] bg-surface">
      <header className="flex items-center gap-2.5 px-4 py-3 border-b border-line-soft">
        <BarChart3 className="w-4 h-4 text-ink-soft shrink-0" />
        <h2 className="font-semibold text-sm flex-1">Comparaison de modèles</h2>
        {scores && scores.length > 0 && (
          <button
            onClick={() => downloadText(benchmarkToMarkdown(scores, echantillon), 'comparaison-modeles.md', 'text/markdown')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line text-[12px] font-medium text-ink-soft hover:bg-elevated hover:text-ink transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Exporter
          </button>
        )}
      </header>

      <div className="px-4 py-3.5 flex flex-col gap-3.5">
        {nbEtiquetes === 0 ? (
          <p className="text-[13px] text-ink-soft">
            Aucune réclamation ne porte de catégorie de référence. Pour mesurer l'exactitude d'un
            modèle, importe un fichier dont une colonne contient un classement déjà connu, et
            associe-la au champ « Catégorie déjà connue » à l'import.
          </p>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="font-mono text-[10.5px] uppercase tracking-wide text-ink-faint mb-1.5">
                Modèles à comparer
              </legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {utilisables.map((m) => (
                  <label key={m.id} className="inline-flex items-start gap-2 text-[13px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selection.includes(m.id)}
                      onChange={() => bascule(m.id)}
                      disabled={isBenchmarking}
                      className="mt-0.5 accent-[var(--color-accent)]"
                    />
                    <span>
                      {m.label}
                      <span className="text-ink-faint"> · {m.emplacement === 'cloud' ? 'cloud' : 'local'}</span>
                      {m.avertissement ? (
                        <span className="block text-[11.5px] text-warning mt-0.5 max-w-[30rem]">
                          <AlertTriangle className="w-3 h-3 inline-block mr-1 -mt-0.5" />
                          {m.avertissement}
                        </span>
                      ) : (
                        m.note && (
                          <span className="block text-[11.5px] text-ink-faint mt-0.5">{m.note}</span>
                        )
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex items-end gap-3 flex-wrap">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">
                  Taille de l'échantillon
                </span>
                <select
                  value={taille}
                  onChange={(e) => setTaille(Number(e.target.value))}
                  disabled={isBenchmarking}
                  className="px-2.5 py-2 rounded-lg border border-line bg-surface text-ink text-[13px]"
                >
                  {TAILLES.map((n) => (
                    <option key={n} value={n}>
                      {n} réclamation{n > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <button
                onClick={() => onRun(selection, taille)}
                disabled={isBenchmarking || selection.length === 0}
                className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-line bg-surface text-ink text-[13px] font-medium disabled:opacity-50 hover:bg-elevated transition-colors"
              >
                {isBenchmarking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />}
                Lancer la comparaison
              </button>

              <p className="text-[12px] text-ink-soft max-w-[26rem]">
                {selection.length} modèle(s) × {plafond} réclamation(s) ={' '}
                <strong className="font-semibold">{selection.length * plafond} appels</strong>. Un
                modèle local sur ce processeur demande une trentaine de secondes par réclamation.
              </p>
            </div>

            {progress && (
              <p aria-live="polite" className="font-mono text-[12px] text-ink-soft">
                {progress.model} — {progress.done}/{progress.total}
              </p>
            )}
          </>
        )}

        {classes.length > 0 && (
          <div className="overflow-x-auto border border-line-soft rounded-lg">
            <table className="w-full text-[13px] border-collapse">
              <caption className="sr-only">
                Exactitude, disponibilité et latence des modèles comparés sur {echantillon} réclamations
              </caption>
              <thead>
                <tr className="bg-elevated border-b border-line-soft">
                  {['Modèle', 'Lieu', 'Exactitude', 'Si répond', 'Replis', 'Latence méd.', '600 récl.', 'Confiance', 'Écart calib.'].map((h) => (
                    <th key={h} scope="col" className="text-left px-3 py-2.5 font-semibold text-[11px] tracking-wide uppercase text-ink-faint whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classes.map((s) => (
                  <tr key={s.modelId} className="border-b border-line-soft last:border-0">
                    <th scope="row" className="text-left px-3 py-2.5 font-medium font-normal">
                      {s.label}
                      {meilleur?.modelId === s.modelId && (
                        <span className="ml-2 font-mono text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded text-success" style={{ backgroundColor: 'color-mix(in oklch, var(--color-success) 14%, transparent)' }}>
                          Meilleur
                        </span>
                      )}
                    </th>
                    <td className="px-3 py-2.5 text-ink-soft">{s.emplacement === 'cloud' ? 'cloud' : 'local'}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums">
                      {s.exactes}/{s.soumises} · {pct(s.exactitude)}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-ink-soft">{pct(s.exactitudeSiRepond)}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums">
                      {s.replis > 0 ? <span className="text-danger-high">{s.replis}</span> : <span className="text-ink-faint">0</span>}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-ink-soft">
                      {s.latenceMedianeMs === null ? '—' : `${(s.latenceMedianeMs / 1000).toFixed(1)} s`}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-ink-soft whitespace-nowrap">
                      {s.minutesPour600 === null ? '—' : `~${s.minutesPour600.toFixed(0)} min`}
                      {s.limiteParQuota && (
                        <span
                          className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-faint"
                          title="Durée dictée par le quota de requêtes/minute, pas par la vitesse du modèle."
                        >
                          quota
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-ink-soft">{pct(s.confianceMoyenne)}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums">
                      {s.ecartCalibration === null ? (
                        '—'
                      ) : (
                        /* La couleur ne porte jamais seule l'information : au-delà de 20 points
                           d'écart, une mention écrite dit explicitement que le modèle se
                           surestime — lisible sans percevoir la nuance de rouge. */
                        <span className={s.ecartCalibration > 0.2 ? 'text-danger-high' : 'text-ink-soft'}>
                          {s.ecartCalibration > 0 ? '+' : ''}
                          {(s.ecartCalibration * 100).toFixed(0)} pts
                          {s.ecartCalibration > 0.2 && (
                            <span className="block text-[10.5px] not-italic">se surestime</span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {classes.length > 0 && (
          <p className="text-[12px] text-ink-soft leading-relaxed">
            <strong className="font-semibold">Exactitude</strong> : un repli heuristique compte
            comme une erreur — le modèle n'a pas répondu.{' '}
            <strong className="font-semibold">Écart de calibration</strong> : confiance
            auto-déclarée moins exactitude observée ; positif, le modèle se surestime et sa
            confiance ne peut pas servir à décider quels dossiers faire relire.{' '}
            <strong className="font-semibold">600 récl.</strong> : marqué « quota » quand la durée
            vient du plafond de requêtes/minute et non de la vitesse du modèle — réduire la
            latence n'y changerait alors rien. La référence vient du fichier importé : elle vaut
            ce que vaut le classement manuel qui l'a produite.
          </p>
        )}
      </div>
    </section>
  );
}
