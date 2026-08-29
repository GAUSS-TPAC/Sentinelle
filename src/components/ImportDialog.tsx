import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import {
  MAPPING_TARGETS,
  buildTicketsFromRows,
  guessMapping,
  type ColumnMapping,
  type TicketField,
} from '@/lib/columnMapping';
import { ACCEPTED_FILE_TYPES, readSpreadsheet, type ParsedSheet } from '@/lib/spreadsheet';
import type { Ticket } from '@/lib/types';

type ImportedTicket = Ticket & { categorie_attendue?: string };

export type ImportDialogProps = {
  open: boolean;
  onClose: () => void;
  onImport: (tickets: ImportedTicket[], fileName: string) => void;
};

const FIELD_LABEL = 'text-[12.5px] font-medium text-ink';
const SELECT_CLASS =
  'w-full px-2.5 py-2 rounded-lg border border-line bg-elevated text-ink text-[12.5px] outline-none focus-visible:border-accent';

export function ImportDialog({ open, onClose, onImport }: ImportDialogProps) {
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setSheet(null);
    setFile(null);
    setMapping(null);
    setError(null);
    setIsDragging(false);
  }, []);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const parse = useCallback(async (target: File, sheetName?: string) => {
    setIsParsing(true);
    setError(null);
    try {
      const parsed = await readSpreadsheet(target, sheetName);
      if (parsed.rows.length === 0) throw new Error('Le fichier ne contient aucune ligne de données.');
      setSheet(parsed);
      setFile(target);
      setMapping(guessMapping(parsed.columns));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lecture du fichier impossible');
      setSheet(null);
      setMapping(null);
    } finally {
      setIsParsing(false);
    }
  }, []);

  if (!open) return null;

  const preview = sheet && mapping ? buildTicketsFromRows(sheet.rows, mapping) : null;
  const canImport = Boolean(mapping?.texte_brut) && (preview?.tickets.length ?? 0) > 0;

  return (
    // Voile assis sur l'encre, pas sur le fond : sur un thème clair, un voile clair ne
    // détacherait pas le dialogue de la page derrière lui.
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6"
      style={{ backgroundColor: 'color-mix(in oklch, var(--color-ink) 45%, transparent)' }}
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Importer des réclamations"
        className="w-full max-w-3xl my-auto rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-line-soft">
          <div>
            <h2 className="text-[14px] font-semibold">Importer des réclamations</h2>
            <p className="text-[12px] text-ink-faint mt-0.5">
              CSV, Excel (.xlsx) ou JSON — le fichier est lu dans ton navigateur, il n'est jamais téléversé.
            </p>
          </div>
          <button
            onClick={close}
            aria-label="Fermer"
            className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-elevated transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-5 py-4 flex flex-col gap-4">
          {error && (
            <div
              className="flex items-start gap-2 px-3.5 py-2.5 rounded-lg border border-line text-[12.5px] text-danger-critical"
              style={{ backgroundColor: 'color-mix(in oklch, var(--color-danger-critical) 10%, var(--color-surface))' }}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          {!sheet ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) void parse(dropped);
              }}
              onClick={() => inputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2.5 py-12 rounded-xl border-2 border-dashed cursor-pointer transition-colors"
              style={{
                borderColor: isDragging ? 'var(--color-accent)' : 'var(--color-line)',
                backgroundColor: isDragging
                  ? 'color-mix(in oklch, var(--color-accent) 8%, var(--color-surface))'
                  : 'var(--color-base)',
              }}
            >
              {isParsing ? (
                <Loader2 className="w-6 h-6 animate-spin text-ink-faint" />
              ) : (
                <Upload className="w-6 h-6 text-ink-faint" />
              )}
              <p className="text-[13px] text-ink">
                {isParsing ? 'Lecture du fichier…' : 'Dépose un fichier ici, ou clique pour parcourir'}
              </p>
              <p className="font-mono text-[11px] text-ink-faint">.csv · .xlsx · .json</p>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                className="hidden"
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  if (picked) void parse(picked);
                  e.target.value = '';
                }}
              />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 flex-wrap">
                <FileSpreadsheet className="w-4 h-4 text-accent shrink-0" />
                <span className="text-[13px] text-ink font-medium">{sheet.fileName}</span>
                <span className="font-mono text-[11.5px] text-ink-faint">
                  {sheet.rows.length} ligne(s) · {sheet.columns.length} colonne(s)
                </span>

                {sheet.sheets.length > 1 && (
                  <label className="flex items-center gap-1.5 ml-1">
                    <span className="text-[12px] text-ink-soft">Feuille</span>
                    <select
                      value={sheet.activeSheet ?? ''}
                      onChange={(e) => file && void parse(file, e.target.value)}
                      className="px-2 py-1 rounded-md border border-line bg-elevated text-ink text-[12px] outline-none"
                    >
                      {sheet.sheets.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                )}

                <button
                  onClick={reset}
                  className="ml-auto text-[12.5px] text-ink-faint hover:text-ink underline underline-offset-2"
                >
                  Changer de fichier
                </button>
              </div>

              <div>
                <h3 className="text-[12.5px] font-semibold text-ink mb-1">Correspondance des colonnes</h3>
                <p className="text-[12px] text-ink-faint mb-3">
                  Devinée à partir des en-têtes — vérifie et corrige si besoin.
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  {MAPPING_TARGETS.map((target) => (
                    <label key={target.field} className="flex flex-col gap-1.5">
                      <span className={FIELD_LABEL}>
                        {target.label}
                        {target.required && <span className="text-danger-high ml-1">*</span>}
                      </span>
                      <select
                        className={SELECT_CLASS}
                        value={mapping?.[target.field] ?? ''}
                        onChange={(e) =>
                          setMapping((m) =>
                            m ? { ...m, [target.field as TicketField]: e.target.value || null } : m,
                          )
                        }
                      >
                        <option value="">— aucune —</option>
                        {sheet.columns.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <span className="text-[11.5px] text-ink-faint leading-snug">{target.hint}</span>
                    </label>
                  ))}
                </div>
              </div>

              {preview && preview.tickets.length > 0 && (
                <div>
                  <h3 className="text-[12.5px] font-semibold text-ink mb-2">
                    Aperçu — {preview.tickets.length} réclamation(s) prêtes
                    {preview.skipped > 0 && (
                      <span className="font-normal text-ink-faint">
                        {' '}· {preview.skipped} ligne(s) ignorée(s), texte de réclamation vide
                      </span>
                    )}
                  </h3>
                  <div className="border border-line-soft rounded-lg overflow-hidden overflow-x-auto">
                    <table className="w-full text-[12px] border-collapse">
                      <thead>
                        <tr className="bg-elevated">
                          <th className="text-left px-3 py-2 font-semibold text-[10.5px] uppercase tracking-wide text-ink-faint">Réclamation</th>
                          <th className="text-left px-3 py-2 font-semibold text-[10.5px] uppercase tracking-wide text-ink-faint w-28">Date</th>
                          <th className="text-left px-3 py-2 font-semibold text-[10.5px] uppercase tracking-wide text-ink-faint w-24">Statut</th>
                          <th className="text-left px-3 py-2 font-semibold text-[10.5px] uppercase tracking-wide text-ink-faint w-16">Délai</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.tickets.slice(0, 4).map((t) => (
                          <tr key={t.id} className="border-t border-line-soft">
                            <td className="px-3 py-2 max-w-sm truncate text-ink-soft" title={t.texte_brut}>{t.texte_brut}</td>
                            <td className="px-3 py-2 font-mono text-[11.5px] text-ink-faint">{t.date_creation}</td>
                            <td className="px-3 py-2 text-ink-soft">{t.statut}</td>
                            <td className="px-3 py-2 font-mono text-[11.5px] text-ink-faint">{t.delai_reponse_jours ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {!mapping?.texte_brut && (
                <p className="text-[12.5px] text-danger-high">
                  Désigne la colonne contenant le texte de la réclamation pour continuer.
                </p>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-line-soft">
          <button
            onClick={close}
            className="px-3.5 py-2 rounded-lg border border-line bg-surface text-ink text-[13px] font-medium hover:bg-elevated transition-colors"
          >
            Annuler
          </button>
          <button
            disabled={!canImport}
            onClick={() => {
              if (!preview || !sheet) return;
              onImport(preview.tickets, sheet.fileName);
              close();
            }}
            className="px-4 py-2 rounded-lg text-[13px] font-semibold disabled:opacity-40 transition-colors"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-ink)' }}
          >
            Importer {preview ? `${preview.tickets.length} réclamation(s)` : ''}
          </button>
        </footer>
      </div>
    </div>
  );
}
