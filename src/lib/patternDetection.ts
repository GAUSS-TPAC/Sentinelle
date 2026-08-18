import type { DetectedPattern, Ticket } from './types';
import { COBAC_DEADLINE_DAYS } from './taxonomy';

/** Nombre de tickets de la même catégorie sur la fenêtre glissante à partir duquel on parle de "pattern émergent". */
const VOLUME_WINDOW_DAYS = 14;
const VOLUME_THRESHOLD = 4;

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

function severityFromCount(count: number, threshold: number): DetectedPattern['severite'] {
  const ratio = count / threshold;
  if (ratio >= 2.5) return 'critique';
  if (ratio >= 1.75) return 'elevee';
  if (ratio >= 1) return 'moyenne';
  return 'faible';
}

/**
 * Détection de patterns en deux temps, purement déterministe (pas d'appel IA — rapide, gratuit,
 * reproductible) :
 *  1. Volume : pic de réclamations de même catégorie causale sur une fenêtre glissante.
 *  2. Conformité COBAC : tout ticket en retard (>45j sans réponse finale) est un pattern à lui seul,
 *     puisque c'est une non-conformité individuelle au règlement R-2020/06, pas un phénomène de volume.
 */
export function detectPatterns(tickets: Ticket[], now: Date = new Date()): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // --- 1. Pics de volume par catégorie causale ---
  const byCategory = new Map<string, Ticket[]>();
  for (const t of tickets) {
    if (!byCategory.has(t.categorie_causale)) byCategory.set(t.categorie_causale, []);
    byCategory.get(t.categorie_causale)!.push(t);
  }

  for (const [categorie, group] of byCategory) {
    const recent = group.filter((t) => daysBetween(new Date(t.date_creation), now) <= VOLUME_WINDOW_DAYS);
    if (recent.length >= VOLUME_THRESHOLD) {
      patterns.push({
        id: `pattern-volume-${categorie}`,
        description: `${recent.length} réclamations "${categorie}" détectées sur les ${VOLUME_WINDOW_DAYS} derniers jours — pic potentiel d'incident.`,
        categorie_causale: categorie,
        tickets_lies: recent.map((t) => t.id),
        date_detection: now.toISOString(),
        severite: severityFromCount(recent.length, VOLUME_THRESHOLD),
        type: 'volume',
      });
    }
  }

  // --- 2. Non-conformité COBAC (délai > 45 jours) ---
  const enRetard = tickets.filter(
    (t) => t.statut === 'en_retard' || (t.delai_reponse_jours ?? 0) > COBAC_DEADLINE_DAYS,
  );
  if (enRetard.length > 0) {
    patterns.push({
      id: 'pattern-cobac-delai',
      description: `${enRetard.length} réclamation(s) sans réponse finale sous ${COBAC_DEADLINE_DAYS} jours — non-conformité au règlement COBAC R-2020/06 (art. délai de réponse).`,
      categorie_causale: 'Délai de traitement excessif',
      tickets_lies: enRetard.map((t) => t.id),
      date_detection: now.toISOString(),
      severite: enRetard.length >= 3 ? 'critique' : 'elevee',
      type: 'conformite_cobac',
    });
  }

  return patterns;
}
