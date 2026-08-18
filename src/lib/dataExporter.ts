import type { DataRow } from './types';

export type ExportFormat = 'csv' | 'json';

export const EXPORT_FORMATS: { value: ExportFormat; label: string; extension: string }[] = [
  { value: 'csv', label: 'CSV', extension: '.csv' },
  { value: 'json', label: 'JSON', extension: '.json' },
];

export function exportBaseName(fileName: string): string {
  const stripped = fileName.replace(/\.[^.]+$/, '').trim();
  return stripped || 'racine_export';
}

export async function rowsToCSV(rows: DataRow[]): Promise<string> {
  const { default: Papa } = await import('papaparse');
  return Papa.unparse(rows);
}

export function rowsToJSON(rows: DataRow[]): string {
  return JSON.stringify(rows, null, 2);
}

export function downloadText(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportExtension(format: ExportFormat): string {
  return EXPORT_FORMATS.find((f) => f.value === format)?.extension ?? '.csv';
}

export async function downloadRows(
  rows: DataRow[],
  fileName: string,
  format: ExportFormat,
): Promise<void> {
  if (rows.length === 0) throw new Error('No rows to download');

  const base = exportBaseName(fileName);
  const ext = exportExtension(format);

  switch (format) {
    case 'csv': {
      const csv = await rowsToCSV(rows);
      downloadText(csv, `${base}_processed${ext}`, 'text/csv;charset=utf-8');
      break;
    }
    case 'json': {
      downloadText(rowsToJSON(rows), `${base}_processed${ext}`, 'application/json');
      break;
    }
    default:
      throw new Error(`Unsupported export format: ${String(format)}`);
  }
}
