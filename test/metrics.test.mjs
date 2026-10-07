import test from 'node:test';
import assert from 'node:assert/strict';

import { compareWithExpected, summarizeBatch } from '../src/metrics.mjs';

test('compares only expected fields that have an answer', () => {
  const comparisons = compareWithExpected({
    class: { type: 'choice', choice: 'class_i' },
    urgent: { type: 'boolean', probability: 0.8 },
  }, {
    class: 'class_i',
    urgent: true,
    official_note: 'hidden metadata',
  });
  assert.deepEqual(comparisons, [
    { questionId: 'class', expected: 'class_i', predicted: 'class_i', match: true },
    { questionId: 'urgent', expected: true, predicted: true, match: true, confidence: 0.8 },
  ]);
});

test('accepts any official label when several apply and reports confidence', () => {
  const comparisons = compareWithExpected({
    purpose: { type: 'choice', choice: 'digitalizzazione', probabilities: { digitalizzazione: 0.7, investimenti: 0.3 } },
    route: { type: 'choice', choice: 'carte_di_credito', probabilities: { carte_di_credito: 0.9 } },
    large: { type: 'boolean', probability: 0.2 },
    empty: { type: 'choice', choice: 'x' },
  }, {
    purpose: ['innovazione_ricerca', 'digitalizzazione'],
    route: 'nessuna_opzione_valida',
    large: false,
    empty: [],
  });
  assert.deepEqual(comparisons, [
    { questionId: 'purpose', expected: ['innovazione_ricerca', 'digitalizzazione'], predicted: 'digitalizzazione', match: true, confidence: 0.7 },
    { questionId: 'route', expected: 'nessuna_opzione_valida', predicted: 'carte_di_credito', match: false, confidence: 0.9 },
    { questionId: 'large', expected: false, predicted: false, match: true, confidence: 0.8 },
  ]);
});

test('summarizes batch accuracy and latency', () => {
  const summary = summarizeBatch([
    {
      durationMs: 100,
      comparisons: [{ questionId: 'class', expected: 'i', predicted: 'i', match: true }],
    },
    {
      durationMs: 200,
      comparisons: [{ questionId: 'class', expected: 'ii', predicted: 'i', match: false }],
    },
  ]);
  assert.equal(summary.caseCount, 2);
  assert.equal(summary.accuracy, 0.5);
  assert.equal(summary.averageLatencyMs, 150);
  assert.deepEqual(summary.perQuestion.class, { total: 2, correct: 1, accuracy: 0.5 });
});
