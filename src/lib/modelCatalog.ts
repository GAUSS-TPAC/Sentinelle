import { apiFetch } from './apiClient';

/** Décrit un modèle utilisable, tel que le serveur le rapporte (voir GET /api/models). */
export type ModelInfo = {
  id: string;
  provider: 'gemini' | 'selfhosted' | 'openai' | 'anthropic';
  model: string;
  label: string;
  emplacement: 'cloud' | 'local';
  disponible: boolean;
  tailleOctets?: number;
  rpmLimite?: number;
  /** Information neutre (quota, taille). */
  note?: string;
  /** Problème réel : modèle indisponible, ou dont l'usage fait échouer le lot. */
  avertissement?: string;
};

export type ModelCatalog = {
  models: ModelInfo[];
  ramDisponibleOctets: number | null;
};

export async function fetchModelCatalog(): Promise<ModelCatalog> {
  const res = await apiFetch('/api/models');
  if (!res.ok) throw new Error(`Catalogue de modèles indisponible (HTTP ${res.status})`);
  return (await res.json()) as ModelCatalog;
}
