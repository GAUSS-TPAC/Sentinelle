import { CAUSAL_TAXONOMY, CAUSAL_CATEGORY_NAMES } from './taxonomy';

export type ClassificationResult = {
  categorie_causale: string;
  sous_categorie: string;
  confiance: number;
  justification: string;
};

const taxonomyBlock = CAUSAL_TAXONOMY.map(
  (c) => `- ${c.categorie}${c.sousCategories.length ? ` (sous-catégories : ${c.sousCategories.join(', ')})` : ''}`,
).join('\n');

export const CLASSIFICATION_SYSTEM_PROMPT = `Tu es un moteur de triage causal de réclamations bancaires pour des banques et opérateurs mobile money de la zone CEMAC (Cameroun, Gabon, Tchad, Congo, RCA, Guinée équatoriale).

Un client soumet une réclamation en français informel, parfois avec du vocabulaire mobile money local (MoMo, Orange Money, agent, flash, recharge, etc.). Ta tâche : classer STRICTEMENT le texte dans une des catégories causales suivantes (aucune autre catégorie n'est autorisée) :

${taxonomyBlock}

Réponds UNIQUEMENT avec un objet JSON valide, sans balise markdown, au format exact :
{"categorie_causale": "...", "sous_categorie": "...", "confiance": 0.0, "justification": "une phrase courte en français"}

Règles :
- "categorie_causale" doit être EXACTEMENT une des catégories listées ci-dessus (copie exacte de la chaîne).
- "sous_categorie" doit être une des sous-catégories de la catégorie choisie, ou "" si la catégorie n'en a pas / aucune ne correspond précisément.
- "confiance" est un nombre entre 0 et 1.
- Si le texte ne correspond à rien de précis, utilise "Autre / non catégorisé".`;

export function buildClassificationPrompt(texteReclamation: string): string {
  return `Réclamation à classer :\n"""${texteReclamation.trim()}"""`;
}

function stripMarkdownFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function parseClassification(raw: string): ClassificationResult {
  const text = stripMarkdownFences(raw);
  const parsed = JSON.parse(text) as Partial<ClassificationResult>;

  if (!parsed.categorie_causale || !CAUSAL_CATEGORY_NAMES.includes(parsed.categorie_causale)) {
    throw new Error(`Catégorie invalide ou absente dans la réponse IA: ${parsed.categorie_causale}`);
  }

  return {
    categorie_causale: parsed.categorie_causale,
    sous_categorie: parsed.sous_categorie ?? '',
    confiance: typeof parsed.confiance === 'number' ? Math.max(0, Math.min(1, parsed.confiance)) : 0.5,
    justification: parsed.justification ?? '',
  };
}

/** Filet de sécurité si l'IA échoue (quota, timeout, JSON invalide) — classement par mots-clés. */
export function heuristicClassify(texte: string): ClassificationResult {
  const t = texte.toLowerCase();
  const rules: Array<{ re: RegExp; categorie: string; sousCategorie: string }> = [
    { re: /double|deux fois|prélevé.*deux/, categorie: 'Double débit / débit erroné', sousCategorie: 'double prélèvement' },
    { re: /frais|prélèvement mensuel|tarif/, categorie: 'Frais non justifiés', sousCategorie: 'frais cachés' },
    { re: /mauvais numéro|erreur.*numéro|pas pour moi/, categorie: 'Erreur de destinataire', sousCategorie: 'mauvais numéro crédité' },
    { re: /fraude|pirat|vol[ée]|code secret|sim.?swap|faux agent/, categorie: 'Fraude / hameçonnage', sousCategorie: 'code PIN compromis' },
    { re: /bloqu[ée]|kyc|pièce d'identité|cni/, categorie: 'Compte bloqué / KYC', sousCategorie: 'blocage après contrôle' },
    { re: /agent.*(refus|insolv|répond plus)/, categorie: 'Litige agent Mobile Money', sousCategorie: 'agent insolvable' },
    { re: /planté|indisponible|panne|ussd/, categorie: 'Panne / indisponibilité technique', sousCategorie: 'service indisponible' },
    { re: /45 jours|deux mois|aucune réponse|aucune nouvelle/, categorie: 'Délai de traitement excessif', sousCategorie: 'réponse non reçue sous 45 jours' },
    { re: /débit|transfert|retrait|envoyé.*fcfa|momo|orange money/, categorie: 'Transaction Mobile Money échouée', sousCategorie: 'transfert bloqué' },
  ];

  for (const rule of rules) {
    if (rule.re.test(t)) {
      return {
        categorie_causale: rule.categorie,
        sous_categorie: rule.sousCategorie,
        confiance: 0.3,
        justification: 'Classement heuristique (secours) par mots-clés — IA indisponible.',
      };
    }
  }

  return {
    categorie_causale: 'Autre / non catégorisé',
    sous_categorie: '',
    confiance: 0.2,
    justification: 'Aucun mot-clé reconnu — classement par défaut.',
  };
}
