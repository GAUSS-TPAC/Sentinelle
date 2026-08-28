import type { DataRow } from './types';

export type ParsedSheet = {
  rows: DataRow[];
  columns: string[];
  fileName: string;
  /** Feuilles disponibles dans le classeur — vide pour un CSV/JSON (une seule « feuille »). */
  sheets: string[];
  activeSheet: string | null;
};

const CSV_EXTENSIONS = ['csv', 'txt', 'tsv'];

function extensionOf(fileName: string): string {
  return fileName.toLowerCase().split('.').pop() ?? '';
}

/**
 * Les cellules Excel remontent typées (Date, number, boolean). On repasse tout en chaîne
 * pour que la correspondance de colonnes et l'IA travaillent sur la même matière qu'un CSV,
 * en préservant les dates au format ISO plutôt que la représentation locale du navigateur.
 */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

async function readCsv(file: File): Promise<ParsedSheet> {
  const { default: Papa } = await import('papaparse');
  const text = await file.text();
  // delimiter: '' laisse Papa détecter le séparateur — les exports Excel francophones
  // utilisent le point-virgule, pas la virgule.
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    delimiter: '',
    transformHeader: (h) => h.trim(),
  });

  const rows = (parsed.data as DataRow[]).filter((row) =>
    Object.values(row).some((v) => v !== null && v !== undefined && String(v).trim() !== ''),
  );
  const columns = (parsed.meta.fields ?? []).filter(Boolean);

  if (columns.length === 0) throw new Error("Aucune colonne détectée — le fichier a-t-il une ligne d'en-tête ?");
  return { rows, columns, fileName: file.name, sheets: [], activeSheet: null };
}

async function readXlsx(file: File, sheet?: string): Promise<ParsedSheet> {
  // read-excel-file v9 : un seul appel rend tout le classeur ({ sheet, data }[]), donc
  // changer d'onglet ne relit pas le fichier — on repioche dans ce qui est déjà en mémoire.
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  const workbook = await readXlsxFile(file);

  const sheets = workbook.map((s) => s.sheet);
  const target = workbook.find((s) => s.sheet === sheet) ?? workbook[0];
  if (!target) throw new Error('Le classeur ne contient aucune feuille.');

  const matrix = target.data as unknown[][];
  if (matrix.length === 0) throw new Error(`La feuille « ${target.sheet} » est vide.`);

  const header = matrix[0].map((c, i) => cellToString(c) || `colonne_${i + 1}`);
  const rows: DataRow[] = matrix
    .slice(1)
    .map((line) => Object.fromEntries(header.map((name, i) => [name, cellToString(line[i])])))
    .filter((row) => Object.values(row).some((v) => String(v).trim() !== ''));

  return { rows, columns: header, fileName: file.name, sheets, activeSheet: target.sheet };
}

async function readJsonFile(file: File): Promise<ParsedSheet> {
  const parsed = JSON.parse(await file.text()) as unknown;
  const rows = Array.isArray(parsed)
    ? (parsed as DataRow[])
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)
      ? ((parsed as { data: DataRow[] }).data)
      : null;

  if (!rows) throw new Error('Le JSON doit être un tableau d’objets, ou { "data": [...] }.');
  if (rows.length === 0) throw new Error('Le fichier JSON ne contient aucune ligne.');

  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return { rows, columns, fileName: file.name, sheets: [], activeSheet: null };
}

/**
 * Point d'entrée unique de l'import. `sheet` ne sert qu'aux classeurs Excel, pour relire
 * un autre onglet une fois que l'utilisateur l'a choisi.
 */
export async function readSpreadsheet(file: File, sheet?: string): Promise<ParsedSheet> {
  const ext = extensionOf(file.name);

  if (CSV_EXTENSIONS.includes(ext)) return readCsv(file);
  if (ext === 'xlsx') return readXlsx(file, sheet);
  if (ext === 'json') return readJsonFile(file);
  if (ext === 'xls') {
    throw new Error(
      "Le format .xls (Excel 97-2003) n'est pas pris en charge. Ouvre le fichier dans Excel ou LibreOffice, puis « Enregistrer sous » au format .xlsx.",
    );
  }
  throw new Error(`Format non pris en charge (.${ext}). Formats acceptés : .csv, .xlsx, .json.`);
}

export const ACCEPTED_FILE_TYPES = '.csv,.tsv,.txt,.xlsx,.json';
