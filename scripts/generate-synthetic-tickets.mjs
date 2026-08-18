// Génère un jeu de données synthétique de réclamations bancaires/mobile money
// camerounaises — 100% inventé, aucune donnée réelle. Sortie : public/sample-tickets.csv
//
// Usage: node scripts/generate-synthetic-tickets.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VILLES = [
  'Yaoundé', 'Douala', 'Bafoussam', 'Garoua', 'Maroua', 'Bamenda',
  'Buea', 'Ngaoundéré', 'Ebolowa', 'Kribi', 'Limbe', 'Dschang',
];
const OPERATEURS = ['MTN Mobile Money', 'Orange Money', 'la banque'];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randMontant = () => randInt(2, 450) * 1000; // FCFA
const randDate = () => {
  const daysAgo = randInt(0, 150);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};

// { categorie, sousCategories: [...], templates: [(ctx) => string] }
const CATEGORIES = [
  {
    categorie: 'Transaction Mobile Money échouée',
    sousCategories: ['débit sans crédit', 'transfert bloqué', 'retrait agent refusé'],
    templates: [
      (c) => `Bonjour, j'ai envoyé ${c.montant} FCFA à mon frère via ${c.op} depuis ${c.ville} hier soir mais l'argent n'est jamais arrivé chez lui. Mon compte a été débité. Merci de vérifier.`,
      (c) => `Svp j'ai voulu retirer ${c.montant} FCFA chez l'agent ${c.op} à ${c.ville}, la transaction a échoué mais mon solde a quand même baissé. Ça fait 2 jours j'attends.`,
      (c) => `Je viens signaler que le transfert de ${c.montant} F que j'ai fait ce matin est resté bloqué en attente depuis plus de 6h, le bénéficiaire n'a rien reçu.`,
      (c) => `Ma transaction ${c.op} de ${c.montant} FCFA a échoué avec message d'erreur mais le montant a disparu de mon compte quand même. Je veux comprendre.`,
    ],
  },
  {
    categorie: 'Double débit / débit erroné',
    sousCategories: ['double prélèvement', 'montant incorrect'],
    templates: [
      (c) => `On m'a prélevé ${c.montant} FCFA DEUX FOIS pour le même paiement de facture ce matin à ${c.ville}. Je veux le remboursement du deuxième débit svp.`,
      (c) => `Bonjour, j'ai fait un seul transfert de ${c.montant} F mais je vois deux débits identiques sur mon relevé du ${c.date}. C'est une erreur de votre système.`,
      (c) => `Je constate que le montant débité (${c.montant + randInt(500,5000)} FCFA) ne correspond pas au montant que j'ai validé (${c.montant} FCFA) sur l'application.`,
    ],
  },
  {
    categorie: 'Frais non justifiés',
    sousCategories: ['frais cachés', 'frais de retrait abusifs'],
    templates: [
      (c) => `Pourquoi on m'a prélevé des frais de ${randInt(200,3000)} FCFA que je ne comprends pas sur mon compte, aucune explication n'a été donnée.`,
      (c) => `Les frais de retrait chez l'agent ${c.op} à ${c.ville} sont plus élevés que ce qui est affiché normalement. On m'a pris ${randInt(500,4000)} F de trop.`,
      (c) => `Depuis le mois dernier je vois des frais mensuels sur mon compte que personne ne m'a jamais expliqués. Merci de clarifier ces prélèvements.`,
    ],
  },
  {
    categorie: 'Erreur de destinataire',
    sousCategories: ['mauvais numéro crédité', 'transfert vers tiers'],
    templates: [
      (c) => `J'ai fait une erreur en tapant le numéro et j'ai envoyé ${c.montant} FCFA à une personne que je ne connais pas. Est-ce possible d'annuler ou récupérer ?`,
      (c) => `Le transfert que j'ai initié devait aller vers mon compte épargne mais je constate que c'est un autre compte qui a été crédité de ${c.montant} F.`,
      (c) => `Svp j'ai reçu ${c.montant} FCFA sur mon compte ${c.op} qui ne m'appartient pas, ce n'est pas pour moi, comment je peux le renvoyer à l'expéditeur ?`,
    ],
  },
  {
    categorie: 'Fraude / hameçonnage',
    sousCategories: ['SIM swap', 'code PIN compromis', 'faux agent'],
    templates: [
      (c) => `On m'a appelé en se faisant passer pour un agent ${c.op} et j'ai reçu un message demandant mon code secret, j'ai peur qu'on ait vidé mon compte à ${c.ville}.`,
      (c) => `Ma carte SIM a arrêté de fonctionner d'un coup et quelques heures après il y a eu un retrait de ${c.montant} FCFA que je n'ai pas fait. Je pense à une fraude.`,
      (c) => `Quelqu'un a réussi à faire des transactions sur mon compte sans mon accord pour un total de ${c.montant} F, je n'ai communiqué mon code à personne.`,
    ],
  },
  {
    categorie: 'Compte bloqué / KYC',
    sousCategories: ['blocage après contrôle', 'pièce d\'identité rejetée'],
    templates: [
      (c) => `Mon compte ${c.op} est bloqué depuis ${randInt(3,20)} jours après un contrôle, j'ai déjà envoyé ma pièce d'identité mais rien ne bouge. C'est urgent, j'ai besoin de mon argent.`,
      (c) => `J'ai déposé ma CNI pour vérification KYC mais on me dit que le document est refusé sans explication claire, mon compte reste bloqué à ${c.ville}.`,
      (c) => `Depuis la mise à jour de mes informations mon compte est suspendu, je ne peux plus rien faire, ni retrait ni transfert.`,
    ],
  },
  {
    categorie: 'Litige agent Mobile Money',
    sousCategories: ['agent insolvable', 'refus de service', 'sur-facturation'],
    templates: [
      (c) => `L'agent ${c.op} à ${c.ville} a refusé de me faire mon retrait de ${c.montant} FCFA en disant qu'il n'a pas de liquide, alors que c'est marqué agent actif.`,
      (c) => `Je suis allé chez l'agent pour un dépôt de ${c.montant} F, il a pris l'argent mais mon compte n'a jamais été crédité, il ne répond plus au téléphone.`,
      (c) => `L'agent m'a demandé des frais supplémentaires non prévus pour un simple retrait, ${randInt(500,2000)} FCFA de plus que le tarif normal.`,
    ],
  },
  {
    categorie: 'Panne / indisponibilité technique',
    sousCategories: ['service indisponible', 'appli plantée pendant transaction'],
    templates: [
      (c) => `L'application a planté au moment où je validais mon transfert de ${c.montant} FCFA, je ne sais pas si la transaction est passée ou non.`,
      (c) => `Le service ${c.op} est indisponible depuis ce matin à ${c.ville}, impossible de faire un retrait ni de consulter mon solde.`,
      (c) => `USSD ne répond plus depuis hier, message "service momentanément indisponible" à chaque tentative de transaction.`,
    ],
  },
  {
    categorie: 'Délai de traitement excessif',
    sousCategories: ['réponse non reçue sous 45 jours'],
    templates: [
      (c) => `J'ai fait une réclamation il y a plus de deux mois pour mon transfert bloqué de ${c.montant} FCFA et je n'ai toujours reçu aucune réponse.`,
      (c) => `Cela fait ${randInt(46,90)} jours que j'attends une réponse finale à ma réclamation numéro précédente, c'est beaucoup trop long.`,
      (c) => `Depuis mon dépôt de dossier le ${c.date} je n'ai eu aucune nouvelle de votre service réclamations concernant mon dossier.`,
    ],
  },
  {
    categorie: 'Autre / non catégorisé',
    sousCategories: [],
    templates: [
      (c) => `Bonjour, j'ai une question générale sur les nouveaux tarifs annoncés à ${c.ville}, pouvez-vous m'expliquer les changements ?`,
      (c) => `Je voudrais suggérer que l'application ${c.op} affiche l'historique sur une plus longue période, c'est difficile de retrouver une transaction ancienne.`,
      (c) => `Je n'arrive pas à me connecter à mon compte en ligne depuis le changement de mot de passe, pouvez-vous m'aider ?`,
    ],
  },
];

const STATUTS = ['nouveau', 'en_cours', 'resolu', 'en_retard'];
const STATUT_WEIGHTS = [0.35, 0.25, 0.3, 0.1];
function weightedStatut() {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < STATUTS.length; i++) {
    acc += STATUT_WEIGHTS[i];
    if (r <= acc) return STATUTS[i];
  }
  return STATUTS[STATUTS.length - 1];
}

const TARGET_TOTAL = 150;
const rows = [];
let ticketIndex = 0;

for (const cat of CATEGORIES) {
  const perCategory = Math.round(TARGET_TOTAL / CATEGORIES.length);
  for (let i = 0; i < perCategory; i++) {
    const ctx = { montant: randMontant(), ville: rand(VILLES), op: rand(OPERATEURS), date: randDate() };
    const texte = rand(cat.templates)(ctx);
    const statut = weightedStatut();
    const delai = statut === 'resolu' ? randInt(1, 44) : statut === 'en_retard' ? randInt(46, 95) : null;

    ticketIndex += 1;
    rows.push({
      texte_brut: texte,
      categorie_causale: cat.categorie,
      sous_categorie: cat.sousCategories.length ? rand(cat.sousCategories) : '',
      date_creation: ctx.date,
      statut,
      delai_reponse_jours: delai ?? '',
    });
  }
}

// petit brassage pour ne pas avoir les tickets triés par catégorie
for (let i = rows.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [rows[i], rows[j]] = [rows[j], rows[i]];
}

const header = ['texte_brut', 'categorie_causale', 'sous_categorie', 'date_creation', 'statut', 'delai_reponse_jours'];
const csvEscape = (v) => `"${String(v).replace(/"/g, '""')}"`;
const csv = [header.join(','), ...rows.map((r) => header.map((h) => csvEscape(r[h])).join(','))].join('\n');

const outPath = path.resolve(__dirname, '..', 'public', 'sample-tickets.csv');
writeFileSync(outPath, csv, 'utf-8');
console.log(`Généré ${rows.length} tickets synthétiques → ${outPath}`);

const counts = {};
for (const r of rows) counts[r.categorie_causale] = (counts[r.categorie_causale] ?? 0) + 1;
console.table(counts);
