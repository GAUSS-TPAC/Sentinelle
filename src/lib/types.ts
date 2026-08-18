export type ColumnSchema = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'null' | 'date';
};

export type DataRow = Record<string, unknown>;

export type Ticket = {
  id: string;
  texte_brut: string;
  categorie_causale: string;
  sous_categorie?: string;
  date_creation: string;
  statut: 'nouveau' | 'en_cours' | 'resolu' | 'en_retard';
  provider_utilise?: string;
  delai_reponse_jours?: number | null;
  confiance?: number;
  justification?: string;
};

export type DetectedPattern = {
  id: string;
  description: string;
  categorie_causale: string;
  tickets_lies: string[];
  date_detection: string;
  severite: 'faible' | 'moyenne' | 'elevee' | 'critique';
  type: 'volume' | 'conformite_cobac';
};
