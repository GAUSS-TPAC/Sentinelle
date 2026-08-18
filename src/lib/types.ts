export type ColumnSchema = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'null' | 'date';
};

export type DataRow = Record<string, unknown>;
