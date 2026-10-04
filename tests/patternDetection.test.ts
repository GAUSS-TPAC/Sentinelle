import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPatterns } from '../src/lib/patternDetection.ts';
import type { Ticket } from '../src/lib/types.ts';

const ticket = (id: string, date: string, extra: Partial<Ticket> = {}): Ticket => ({
  id,
  texte_brut: 'x',
  categorie_causale: 'Frais non justifiés',
  date_creation: date,
  statut: 'nouveau',
  ...extra,
});

test('un pic de volume est détecté sur un export ancien', () => {
  // Fichier arrêté fin août, analysé en octobre : la fenêtre se referme sur le fichier.
  const tickets = ['2026-08-20', '2026-08-25', '2026-08-28', '2026-08-31'].map((d, i) => ticket(`t${i}`, d));
  const volume = detectPatterns(tickets, new Date('2026-10-05')).filter((p) => p.type === 'volume');
  assert.equal(volume.length, 1);
  assert.equal(volume[0].tickets_lies.length, 4);
  assert.equal(volume[0].severite, 'moyenne');
});

test('une réclamation postérieure à `now` n’est jamais comptée', () => {
  const tickets = [
    ticket('a', '2026-06-10'),
    ticket('b', '2026-06-12'),
    ticket('c', '2026-06-14'),
    ticket('futur', '2026-06-20'),
  ];
  const patterns = detectPatterns(tickets, new Date('2026-06-15'));
  assert.equal(patterns.filter((p) => p.type === 'volume').length, 0);
});

test('les réclamations hors fenêtre de 14 jours ne comptent pas', () => {
  const tickets = [
    ticket('a', '2026-07-01'),
    ticket('b', '2026-07-02'),
    ticket('c', '2026-08-30'),
    ticket('d', '2026-08-31'),
  ];
  assert.equal(detectPatterns(tickets, new Date('2026-10-05')).length, 0);
});

test('les réclamations non classées ne forment pas de pic', () => {
  const tickets = ['2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31'].map((d, i) =>
    ticket(`t${i}`, d, { categorie_causale: '' }),
  );
  assert.equal(detectPatterns(tickets, new Date('2026-09-01')).length, 0);
});

test('non-conformité COBAC : statut en retard ou délai supérieur à 45 jours', () => {
  const tickets = [
    ticket('a', '2026-03-01', { statut: 'en_retard' }),
    ticket('b', '2026-03-02', { delai_reponse_jours: 46 }),
    ticket('c', '2026-03-03', { delai_reponse_jours: 45 }),
    ticket('d', '2026-03-04', { delai_reponse_jours: null }),
  ];
  const cobac = detectPatterns(tickets, new Date('2026-10-05')).filter((p) => p.type === 'conformite_cobac');
  assert.equal(cobac.length, 1);
  assert.deepEqual(cobac[0].tickets_lies, ['a', 'b']);
  assert.equal(cobac[0].severite, 'elevee');
});
