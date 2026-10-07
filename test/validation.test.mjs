import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeEvaluationRequest, parseStateInput } from '../src/validation.mjs';
import { summarizeRuns } from '../src/summary.mjs';

test('parseStateInput keeps JSON objects structured', () => {
  assert.deepEqual(parseStateInput('{"ticket":"duplicate charge"}'), { ticket: 'duplicate charge' });
});

test('parseStateInput accepts plain text', () => {
  assert.equal(parseStateInput('plain complaint text'), 'plain complaint text');
});

test('normalizes a mixed evaluation request', () => {
  const result = normalizeEvaluationRequest({
    state: { text: 'example' },
    repetitions: 3,
    questions: {
      route: {
        type: 'choice',
        instructions: 'Choose a route.',
        criteria: { billing: 'Billing issue', support: 'Support issue' },
      },
      urgent: {
        type: 'boolean',
        instructions: 'Is this urgent?',
      },
      risk: {
        type: 'score',
        instructions: 'Rate risk.',
        criteria: ['low', 'medium', 'high'],
      },
    },
  });
  assert.equal(result.repetitions, 3);
  assert.equal(Object.keys(result.questions).length, 3);
});

test('rejects malformed choice criteria', () => {
  assert.throws(() => normalizeEvaluationRequest({
    state: 'x',
    questions: {
      route: { type: 'choice', instructions: 'Choose.', criteria: { only: 'One option' } },
    },
  }), /2 a 255/);
});

test('summarizes consistency across runs', () => {
  const questions = {
    urgent: { type: 'boolean' },
    route: { type: 'choice' },
    severity: { type: 'score' },
  };
  const runs = [
    {
      durationMs: 100,
      answers: {
        urgent: { probability: 0.8 },
        route: { choice: 'billing', probabilities: { billing: 0.9, support: 0.1 } },
        severity: { score: 1.8, probabilities: { 0: 0.1, 1: 0.1, 2: 0.8 } },
      },
    },
    {
      durationMs: 200,
      answers: {
        urgent: { probability: 0.6 },
        route: { choice: 'billing', probabilities: { billing: 0.7, support: 0.3 } },
        severity: { score: 1.4, probabilities: { 0: 0.1, 1: 0.4, 2: 0.5 } },
      },
    },
  ];
  const summary = summarizeRuns(runs, questions);
  assert.equal(summary.latencyMs.average, 150);
  assert.equal(summary.questions.urgent.averageProbability, 0.7);
  assert.deepEqual(summary.questions.route.selected, { billing: 2 });
  assert.equal(summary.questions.route.averageProbabilities.billing, 0.8);
  assert.equal(summary.questions.severity.averageScore, 1.6);
});
