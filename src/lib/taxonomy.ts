// Taxonomie causale — validée avec l'utilisateur avant génération du dataset synthétique.
// Partagée entre le client (affichage) et le serveur (prompt de classification).

export type CausalCategory = {
  categorie: string;
  sousCategories: string[];
};

export const CAUSAL_TAXONOMY: CausalCategory[] = [
  {
    categorie: 'Transaction Mobile Money échouée',
    sousCategories: ['débit sans crédit', 'transfert bloqué', 'retrait agent refusé'],
  },
  {
    categorie: 'Double débit / débit erroné',
    sousCategories: ['double prélèvement', 'montant incorrect'],
  },
  {
    categorie: 'Frais non justifiés',
    sousCategories: ['frais cachés', 'frais de retrait abusifs'],
  },
  {
    categorie: 'Erreur de destinataire',
    sousCategories: ['mauvais numéro crédité', 'transfert vers tiers'],
  },
  {
    categorie: 'Fraude / hameçonnage',
    sousCategories: ['SIM swap', 'code PIN compromis', 'faux agent'],
  },
  {
    categorie: 'Compte bloqué / KYC',
    sousCategories: ['blocage après contrôle', "pièce d'identité rejetée"],
  },
  {
    categorie: 'Litige agent Mobile Money',
    sousCategories: ['agent insolvable', 'refus de service', 'sur-facturation'],
  },
  {
    categorie: 'Panne / indisponibilité technique',
    sousCategories: ['service indisponible', 'appli plantée pendant transaction'],
  },
  {
    categorie: 'Délai de traitement excessif',
    sousCategories: ['réponse non reçue sous 45 jours'],
  },
  {
    categorie: 'Autre / non catégorisé',
    sousCategories: [],
  },
];

export const CAUSAL_CATEGORY_NAMES = CAUSAL_TAXONOMY.map((c) => c.categorie);

export const TICKET_STATUSES = ['nouveau', 'en_cours', 'resolu', 'en_retard'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Seuil réglementaire COBAC R-2020/06 : réponse finale sous 45 jours. */
export const COBAC_DEADLINE_DAYS = 45;
