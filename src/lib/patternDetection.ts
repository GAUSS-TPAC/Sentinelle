import type { DetectedPattern, Ticket } from './types';
import { COBAC_DEADLINE_DAYS } from './taxonomy';

/** Nombre de tickets de la même catégorie sur la fenêtre glissante à partir duquel on parle de "pattern émergent". */
const VOLUME_WINDOW_DAYS = 14;
const VOLUME_THRESHOLD = 4;
const DAY_MS = 86_400_000;

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
 *
 * La fenêtre de volume se referme sur la réclamation la plus récente du portefeuille, et non
 * sur `now` : un export de réclamations s'arrête à sa date d'extraction, et une fenêtre ancrée
 * sur le jour de l'analyse serait vide dès que le fichier a plus de deux semaines. `now` reste
 * une borne haute stricte — une réclamation datée après `now` n'est jamais comptée, ce qui
 * permet de rejouer l'historique à une date passée sans voir l'avenir.
 */
export function detectPatterns(tickets: Ticket[], now: Date = new Date()): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const nowMs = now.getTime();

  // --- 1. Pics de volume par catégorie causale ---
  const dated = tickets
    .map((ticket) => ({ ticket, time: new Date(ticket.date_creation).getTime() }))
    .filter(({ ticket, time }) => ticket.categorie_causale && !Number.isNaN(time) && time <= nowMs);

  if (dated.length > 0) {
    const windowEnd = Math.max(...dated.map((d) => d.time));
    const windowStart = windowEnd - VOLUME_WINDOW_DAYS * DAY_MS;
    const debut = new Date(windowStart).toISOString().slice(0, 10);
    const fin = new Date(windowEnd).toISOString().slice(0, 10);

    const byCategory = new Map<string, Ticket[]>();
    for (const { ticket, time } of dated) {
      if (time < windowStart) continue;
      if (!byCategory.has(ticket.categorie_causale)) byCategory.set(ticket.categorie_causale, []);
      byCategory.get(ticket.categorie_causale)!.push(ticket);
    }

    for (const [categorie, recent] of byCategory) {
      if (recent.length < VOLUME_THRESHOLD) continue;
      patterns.push({
        id: `pattern-volume-${categorie}`,
        description: `${recent.length} réclamations "${categorie}" reçues du ${debut} au ${fin} (${VOLUME_WINDOW_DAYS} jours) — pic potentiel d'incident.`,
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
