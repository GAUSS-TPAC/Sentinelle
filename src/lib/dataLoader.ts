import type { ColumnSchema, DataRow } from './types';

export function inferType(value: unknown): ColumnSchema['type'] {
  if (value === null || value === undefined || value === '') return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number' && !Number.isNaN(value)) return 'number';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return 'date';
    const asNum = Number(trimmed);
    if (trimmed !== '' && !Number.isNaN(asNum)) return 'number';
    return 'string';
  }
  return 'string';
}

export function inferSchema(rows: DataRow[]): ColumnSchema[] {
  if (rows.length === 0) return [];

  const columns = Object.keys(rows[0]);
  const sample = rows.slice(0, 100);

  return columns.map((name) => {
    const counts: Record<ColumnSchema['type'], number> = {
      string: 0,
      number: 0,
      boolean: 0,
      null: 0,
      date: 0,
    };
    for (const row of sample) {
      counts[inferType(row[name])]++;
    }
    const type = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] ??
      'string') as ColumnSchema['type'];
    return { name, type };
  });
}

export function loadCSV(file: File): Promise<{ rows: DataRow[]; schema: ColumnSchema[] }> {
  return new Promise((resolve, reject) => {
    import('papaparse').then(({ default: Papa }) => {
      Papa.parse<DataRow>(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        complete: (results) => {
          const rows = results.data.filter((row) =>
            Object.values(row).some((v) => v !== null && v !== undefined && v !== ''),
          );
          resolve({ rows, schema: inferSchema(rows) });
        },
        error: (err) => reject(err),
      });
    });
  });
}

export async function loadJSON(
  file: File,
): Promise<{ rows: DataRow[]; schema: ColumnSchema[] }> {
  const text = await file.text();
  const parsed = JSON.parse(text) as unknown;
  let rows: DataRow[];

  if (Array.isArray(parsed)) {
    rows = parsed as DataRow[];
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)) {
    rows = (parsed as { data: DataRow[] }).data;
  } else {
    throw new Error('JSON must be an array of objects or { "data": [...] }');
  }

  return { rows, schema: inferSchema(rows) };
}

export function getPreviewRows(rows: DataRow[], limit = 10): DataRow[] {
  return rows.slice(0, limit);
}

export function countNulls(rows: DataRow[], column: string): number {
  return rows.filter(
    (r) => r[column] === null || r[column] === undefined || r[column] === '',
  ).length;
}
