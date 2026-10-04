import type { DataRow, Ticket } from './types';
import { TICKET_STATUSES, type TicketStatus } from './taxonomy';
import { createTicketIdFactory } from './ticketId';

/**
 * Champs d'un ticket qu'un fichier importé peut alimenter. `categorie_attendue` n'est pas
 * persisté : c'est la catégorie déjà connue côté client, utilisée pour mesurer la précision
 * de l'IA contre une référence (colonne « Précision vs. référence » de l'interface).
 */
export type TicketField =
  | 'texte_brut'
  | 'date_creation'
  | 'statut'
  | 'delai_reponse_jours'
  | 'categorie_attendue';

export type ColumnMapping = Record<TicketField, string | null>;

export type MappingTarget = {
  field: TicketField;
  label: string;
  hint: string;
  required: boolean;
};

export const MAPPING_TARGETS: MappingTarget[] = [
  {
    field: 'texte_brut',
    label: 'Texte de la réclamation',
    hint: "C'est la seule colonne indispensable — l'IA classe à partir d'elle.",
    required: true,
  },
  {
    field: 'date_creation',
    label: 'Date de réception',
    hint: 'Sert au calcul du délai COBAC. À défaut, la date du jour est utilisée.',
    required: false,
  },
  {
    field: 'statut',
    label: 'Statut',
    hint: 'nouveau · en_cours · resolu · en_retard. À défaut, « nouveau ».',
    required: false,
  },
  {
    field: 'delai_reponse_jours',
    label: 'Délai de réponse (jours)',
    hint: 'Nombre de jours écoulés. Au-delà de 45, la réclamation est non conforme.',
    required: false,
  },
  {
    field: 'categorie_attendue',
    label: 'Catégorie déjà connue (facultatif)',
    hint: "Si ton fichier contient déjà un classement manuel, il sert de référence pour mesurer la précision de l'IA.",
    required: false,
  },
];

/** Minuscule, sans accent, séparateurs uniformisés — pour comparer des en-têtes écrits à la main. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Synonymes rencontrés dans les exports de réclamations (français, anglais, jargon bancaire).
const ALIASES: Record<TicketField, string[]> = {
  texte_brut: [
    'texte_brut', 'texte', 'reclamation', 'description', 'commentaire', 'message', 'motif',
    'objet', 'plainte', 'contenu', 'libelle', 'detail', 'observation', 'verbatim', 'complaint',
    'remarque', 'doleance', 'corps', 'texte_reclamation', 'description_reclamation',
  ],
  date_creation: [
    'date_creation', 'date', 'date_reception', 'date_ouverture', 'date_depot', 'created_at',
    'date_saisie', 'date_enregistrement', 'received_at', 'date_plainte', 'horodatage',
  ],
  statut: ['statut', 'status', 'etat', 'state', 'situation', 'avancement'],
  delai_reponse_jours: [
    'delai_reponse_jours', 'delai', 'delai_reponse', 'jours', 'duree', 'delai_traitement',
    'sla', 'nb_jours', 'anciennete', 'age', 'days',
  ],
  categorie_attendue: [
    'categorie_causale', 'categorie', 'category', 'type', 'classification', 'typologie',
    'motif_categorie', 'nature', 'famille', 'rubrique',
  ],
};

/**
 * Correspondance approximative d'un en-tête, par mots entiers plutôt que par sous-chaîne.
 *
 * La containment brute était piégeuse : l'alias « age » (ancienneté en jours) capturait la
 * colonne « Agence » — présente dans quasiment tous les exports bancaires — et le délai de
 * traitement se perdait alors en silence, faussant le calcul de conformité COBAC sans le
 * moindre message. On exige donc que l'alias apparaisse comme suite de mots entiers ; la
 * sous-chaîne n'est tolérée que pour les alias assez longs pour ne pas collisionner
 * (« delai » dans « delaireponse », écrit sans séparateur).
 */
function matchesLoosely(norm: string, alias: string): boolean {
  const tokens = norm.split('_').filter(Boolean);
  const aliasTokens = alias.split('_').filter(Boolean);

  const contiguous = tokens.some((_, i) => aliasTokens.every((t, k) => tokens[i + k] === t));
  if (contiguous) return true;
  if (alias.length >= 5 && norm.includes(alias)) return true;
  return norm.length >= 5 && alias.includes(norm);
}

/**
 * Devine la correspondance à partir des en-têtes. Correspondance exacte d'abord, puis
 * inclusion — « Description de la réclamation » doit tomber sur `texte_brut`. Une colonne
 * déjà attribuée n'est pas réutilisée pour un autre champ.
 */
export function guessMapping(columns: string[]): ColumnMapping {
  const normalized = columns.map((c) => ({ raw: c, norm: normalize(c) }));
  const mapping = {
    texte_brut: null, date_creation: null, statut: null,
    delai_reponse_jours: null, categorie_attendue: null,
  } as ColumnMapping;
  const taken = new Set<string>();

  for (const pass of ['exact', 'partial'] as const) {
    for (const target of MAPPING_TARGETS) {
      if (mapping[target.field]) continue;
      const aliases = ALIASES[target.field];

      const hit = normalized.find(({ raw, norm }) => {
        if (taken.has(raw)) return false;
        return pass === 'exact' ? aliases.includes(norm) : aliases.some((a) => matchesLoosely(norm, a));
      });

      if (hit) {
        mapping[target.field] = hit.raw;
        taken.add(hit.raw);
      }
    }
  }

  return mapping;
}

const STATUS_ALIASES: Record<string, TicketStatus> = {
  nouveau: 'nouveau', new: 'nouveau', ouvert: 'nouveau', open: 'nouveau', recu: 'nouveau',
  en_cours: 'en_cours', in_progress: 'en_cours', encours: 'en_cours', traitement: 'en_cours',
  pending: 'en_cours', assigne: 'en_cours',
  resolu: 'resolu', resolved: 'resolu', closed: 'resolu', ferme: 'resolu', clos: 'resolu',
  traite: 'resolu', done: 'resolu',
  en_retard: 'en_retard', overdue: 'en_retard', retard: 'en_retard', late: 'en_retard',
};

function parseStatus(value: string): TicketStatus {
  const norm = normalize(value);
  if ((TICKET_STATUSES as readonly string[]).includes(norm)) return norm as TicketStatus;
  return STATUS_ALIASES[norm] ?? 'nouveau';
}

/**
 * Ramène une date au format ISO court. Gère l'ISO, le format Excel déjà converti, et les
 * écritures jour/mois/année séparées par / . ou - — l'ordre jour-mois est l'usage en zone
 * CEMAC, donc 03/07/2026 est le 3 juillet, jamais le 7 mars.
 */
function parseDate(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);

  const dmy = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    const iso = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function parseDays(value: string): number | null {
  // Number('') vaut 0 : sans ce garde-fou, une cellule vide ou « n/a » deviendrait un délai
  // de 0 jour, donc une réclamation conforme au seuil COBAC. On veut « inconnu », pas « 0 ».
  const cleaned = String(value).replace(',', '.').replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export type BuiltTickets = {
  tickets: (Ticket & { categorie_attendue?: string })[];
  /** Lignes écartées faute de texte de réclamation exploitable. */
  skipped: number;
};

/**
 * `scope` est l'identifiant de l'organisation (vide en mode démo sans comptes) : il entre dans
 * l'identifiant des tickets, voir `ticketId.ts`.
 */
export function buildTicketsFromRows(rows: DataRow[], mapping: ColumnMapping, scope = ''): BuiltTickets {
  const today = new Date().toISOString().slice(0, 10);
  const nextId = createTicketIdFactory(scope);
  const tickets: (Ticket & { categorie_attendue?: string })[] = [];
  let skipped = 0;

  for (const row of rows) {
    const read = (field: TicketField): string => {
      const column = mapping[field];
      if (!column) return '';
      const value = row[column];
      return value === null || value === undefined ? '' : String(value).trim();
    };

    const texte = read('texte_brut');
    if (!texte) {
      skipped += 1;
      continue;
    }

    const attendue = read('categorie_attendue');
    // L'identifiant s'appuie sur la date lue dans le fichier, pas sur la date du jour
    // substituée : sinon un fichier sans colonne de date changerait d'identifiants chaque jour.
    const dateLue = parseDate(read('date_creation'));
    tickets.push({
      id: nextId(texte, dateLue ?? ''),
      texte_brut: texte,
      categorie_causale: '',
      sous_categorie: '',
      date_creation: dateLue ?? today,
      statut: mapping.statut ? parseStatus(read('statut')) : 'nouveau',
      delai_reponse_jours: mapping.delai_reponse_jours ? parseDays(read('delai_reponse_jours')) : null,
      ...(attendue ? { categorie_attendue: attendue } : {}),
    });
  }

  return { tickets, skipped };
}
