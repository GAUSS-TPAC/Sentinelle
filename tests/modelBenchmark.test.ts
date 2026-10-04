import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classerScores, scoreModel, type BenchmarkAttempt } from '../src/lib/modelBenchmark.ts';

const attempt = (extra: Partial<BenchmarkAttempt>): BenchmarkAttempt => ({
  obtenue: 'A',
  attendue: 'A',
  confiance: 0.9,
  repli: false,
  latenceMs: 1000,
  ...extra,
});

test('un repli heuristique compte comme une erreur, même si la catégorie est la bonne', () => {
  const score = scoreModel('m', 'm', 'cloud', [
    attempt({}),
    attempt({ obtenue: 'B' }),
    attempt({ repli: true, confiance: 0.3 }),
    attempt({ repli: true, confiance: 0.3 }),
  ]);
  assert.equal(score.exactes, 1);
  assert.equal(score.replis, 2);
  assert.equal(score.exactitude, 0.25);
  assert.equal(score.exactitudeSiRepond, 0.5);
  // La confiance des replis n'entre pas dans la calibration du modèle.
  assert.equal(score.confianceMoyenne, 0.9);
  assert.ok(Math.abs(score.ecartCalibration! - 0.4) < 1e-9);
});

test('la durée estimée retient le quota quand il est plus contraignant que la latence', () => {
  const bride = scoreModel('m', 'm', 'cloud', [attempt({})], 10);
  assert.equal(bride.minutesPour600, 60);
  assert.equal(bride.limiteParQuota, true);

  const libre = scoreModel('m', 'm', 'local', [attempt({ latenceMs: 36_000 })]);
  assert.equal(libre.minutesPour600, 360);
  assert.equal(libre.limiteParQuota, false);
});

test('un modèle qui ne répond jamais n’a ni exactitude conditionnelle ni calibration', () => {
  const score = scoreModel('m', 'm', 'local', [attempt({ repli: true, confiance: null })]);
  assert.equal(score.exactitude, 0);
  assert.equal(score.exactitudeSiRepond, null);
  assert.equal(score.ecartCalibration, null);
});

test('classement : exactitude décroissante, puis latence croissante', () => {
  const lent = scoreModel('lent', 'lent', 'local', [attempt({ latenceMs: 5000 })]);
  const rapide = scoreModel('rapide', 'rapide', 'cloud', [attempt({ latenceMs: 1000 })]);
  const faux = scoreModel('faux', 'faux', 'cloud', [attempt({ obtenue: 'B', latenceMs: 10 })]);
  assert.deepEqual(classerScores([faux, lent, rapide]).map((s) => s.modelId), ['rapide', 'lent', 'faux']);
});
