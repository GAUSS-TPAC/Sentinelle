import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTicketsFromRows, guessMapping, type ColumnMapping } from '../src/lib/columnMapping.ts';

const mapping: ColumnMapping = {
  texte_brut: 'Texte',
  date_creation: 'Date',
  statut: 'Statut',
  delai_reponse_jours: 'Délai',
  categorie_attendue: null,
};

test('une date jour/mois/année est lue dans l’ordre CEMAC', () => {
  const { tickets } = buildTicketsFromRows([{ Texte: 'a', Date: '03/07/2026', Statut: '', Délai: '' }], mapping);
  assert.equal(tickets[0].date_creation, '2026-07-03');
});

test('un délai vide reste inconnu au lieu de valoir zéro', () => {
  const { tickets } = buildTicketsFromRows(
    [
      { Texte: 'a', Date: '2026-01-01', Statut: '', Délai: '' },
      { Texte: 'b', Date: '2026-01-01', Statut: '', Délai: '52 jours' },
    ],
    mapping,
  );
  assert.equal(tickets[0].delai_reponse_jours, null);
  assert.equal(tickets[1].delai_reponse_jours, 52);
});

test('les lignes sans texte sont écartées et comptées', () => {
  const built = buildTicketsFromRows(
    [
      { Texte: '  ', Date: '', Statut: '', Délai: '' },
      { Texte: 'a', Date: '', Statut: '', Délai: '' },
    ],
    mapping,
  );
  assert.equal(built.tickets.length, 1);
  assert.equal(built.skipped, 1);
});

test('réimporter le même fichier redonne les mêmes identifiants', () => {
  const rows = [
    { Texte: 'a', Date: '2026-01-01', Statut: '', Délai: '' },
    { Texte: 'b', Date: '2026-01-02', Statut: '', Délai: '' },
  ];
  const premier = buildTicketsFromRows(rows, mapping, 'org-1').tickets.map((t) => t.id);
  const second = buildTicketsFromRows(rows, mapping, 'org-1').tickets.map((t) => t.id);
  assert.deepEqual(premier, second);
  for (const id of premier) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('deux lignes identiques restent deux réclamations distinctes', () => {
  const row = { Texte: 'a', Date: '2026-01-01', Statut: '', Délai: '' };
  const ids = buildTicketsFromRows([row, row], mapping, 'org-1').tickets.map((t) => t.id);
  assert.notEqual(ids[0], ids[1]);
});

test('deux organisations n’obtiennent jamais le même identifiant', () => {
  const rows = [{ Texte: 'a', Date: '2026-01-01', Statut: '', Délai: '' }];
  const a = buildTicketsFromRows(rows, mapping, 'org-1').tickets[0].id;
  const b = buildTicketsFromRows(rows, mapping, 'org-2').tickets[0].id;
  assert.notEqual(a, b);
});

test('la colonne « Agence » n’est pas prise pour un délai', () => {
  const guessed = guessMapping(['Description', 'Agence', 'Date']);
  assert.equal(guessed.texte_brut, 'Description');
  assert.equal(guessed.delai_reponse_jours, null);
});
