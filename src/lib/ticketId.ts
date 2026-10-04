/**
 * Identifiant de ticket déterministe, dérivé du contenu de la ligne importée.
 *
 * Un identifiant aléatoire faisait de chaque réimport du même fichier un nouveau jeu de
 * lignes en base : le portefeuille doublait à chaque essai. Dérivé du contenu, le même
 * fichier retombe sur les mêmes lignes, et l'upsert les met à jour au lieu de les dupliquer.
 *
 * `scope` porte l'organisation : `tickets.id` est une clé primaire globale, donc deux banques
 * important le même fichier (l'échantillon de démonstration, typiquement) doivent obtenir
 * des identifiants distincts — sinon la seconde tenterait d'écraser les lignes de la première
 * et la RLS rejetterait tout son lot.
 *
 * `occurrence` distingue deux lignes strictement identiques d'un même fichier (même texte,
 * même date) : ce sont deux réclamations, pas un doublon à fusionner.
 */
function hash32(input: string, seed: number): number {
  let h = seed ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 0x01000193);
    h = (h << 13) | (h >>> 19);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const SEEDS = [0x811c9dc5, 0x9e3779b9, 0x7f4a7c15, 0x2545f491];

export function stableTicketId(scope: string, texte: string, date: string, occurrence: number): string {
  const input = `${scope}\u0000${texte}\u0000${date}\u0000${occurrence}`;
  const hex = SEEDS.map((seed) => hash32(input, seed).toString(16).padStart(8, '0')).join('');
  // Mise en forme UUID (la colonne est de type uuid), nibbles de version et de variante posés.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/** Attribue les identifiants d'un lot en numérotant les lignes identiques. */
export function createTicketIdFactory(scope: string): (texte: string, date: string) => string {
  const seen = new Map<string, number>();
  return (texte, date) => {
    const key = `${texte}\u0000${date}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return stableTicketId(scope, texte, date, occurrence);
  };
}
