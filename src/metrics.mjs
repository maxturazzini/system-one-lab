function predictedValue(answer) {
  if (!answer) return undefined;
  if (answer.type === 'choice' || answer.choice !== undefined) return answer.choice;
  if (answer.type === 'boolean' || answer.probability !== undefined) return Number(answer.probability) >= 0.5;
  if (answer.type === 'score' || answer.score !== undefined) return Number(answer.score);
  return undefined;
}

function answerConfidence(answer, predicted) {
  if (!answer) return undefined;
  if (answer.type === 'choice' || answer.choice !== undefined) {
    const value = Number(answer.probabilities?.[answer.choice]);
    return Number.isFinite(value) ? value : undefined;
  }
  if (answer.type === 'boolean' || answer.probability !== undefined) {
    const value = Number(answer.probability);
    if (!Number.isFinite(value)) return undefined;
    return predicted ? value : 1 - value;
  }
  return undefined;
}

// Un array di etichette ufficiali vale come "una qualsiasi di queste".
function matchesExpected(predicted, expectedValue) {
  if (Array.isArray(expectedValue)) return expectedValue.some(value => String(value) === String(predicted));
  return String(predicted) === String(expectedValue);
}

export function compareWithExpected(answers, expected = {}) {
  const comparisons = [];
  for (const [questionId, expectedValue] of Object.entries(expected)) {
    if (!Object.hasOwn(answers ?? {}, questionId)) continue;
    if (expectedValue === undefined || expectedValue === null) continue;
    if (Array.isArray(expectedValue) && !expectedValue.length) continue;
    const predicted = predictedValue(answers[questionId]);
    const comparison = {
      questionId,
      expected: expectedValue,
      predicted,
      match: matchesExpected(predicted, expectedValue),
    };
    const confidence = answerConfidence(answers[questionId], predicted);
    if (confidence !== undefined) comparison.confidence = confidence;
    comparisons.push(comparison);
  }
  return comparisons;
}

export function summarizeBatch(evaluatedCases) {
  const comparisons = evaluatedCases.flatMap(item => item.comparisons ?? []);
  const correct = comparisons.filter(item => item.match).length;
  const perQuestion = {};

  for (const comparison of comparisons) {
    const bucket = perQuestion[comparison.questionId] ?? { total: 0, correct: 0 };
    bucket.total += 1;
    if (comparison.match) bucket.correct += 1;
    perQuestion[comparison.questionId] = bucket;
  }

  for (const bucket of Object.values(perQuestion)) {
    bucket.accuracy = bucket.total ? bucket.correct / bucket.total : null;
  }

  const latencies = evaluatedCases.map(item => Number(item.durationMs)).filter(Number.isFinite);
  return {
    caseCount: evaluatedCases.length,
    comparableJudgments: comparisons.length,
    correctJudgments: correct,
    accuracy: comparisons.length ? correct / comparisons.length : null,
    averageLatencyMs: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
    perQuestion,
  };
}
