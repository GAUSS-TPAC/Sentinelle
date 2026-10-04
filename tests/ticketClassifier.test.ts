import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicClassify, parseClassification } from '../src/lib/ticketClassifier.ts';
import { CAUSAL_CATEGORY_NAMES } from '../src/lib/taxonomy.ts';

test('une réponse JSON entourée de balises markdown est acceptée', () => {
  const parsed = parseClassification(
    '```json\n{"categorie_causale":"Frais non justifiés","sous_categorie":"frais cachés","confiance":0.8,"justification":"ok"}\n```',
  );
  assert.equal(parsed.categorie_causale, 'Frais non justifiés');
  assert.equal(parsed.confiance, 0.8);
});

test('une catégorie hors taxonomie est rejetée', () => {
  assert.throws(() => parseClassification('{"categorie_causale":"Inventée","confiance":1}'));
});

test('la confiance est bornée à [0, 1], et vaut 0,5 si elle manque', () => {
  const cat = CAUSAL_CATEGORY_NAMES[0];
  assert.equal(parseClassification(JSON.stringify({ categorie_causale: cat, confiance: 7 })).confiance, 1);
  assert.equal(parseClassification(JSON.stringify({ categorie_causale: cat, confiance: -1 })).confiance, 0);
  assert.equal(parseClassification(JSON.stringify({ categorie_causale: cat })).confiance, 0.5);
});

test('le repli heuristique rend toujours une catégorie de la taxonomie', () => {
  for (const texte of ['on m’a prélevé deux fois', 'mon compte est bloqué', 'bonjour']) {
    assert.ok(CAUSAL_CATEGORY_NAMES.includes(heuristicClassify(texte).categorie_causale));
  }
});
