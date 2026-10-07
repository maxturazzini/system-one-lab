function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function averageProbabilityMaps(maps) {
  const keys = new Set(maps.flatMap(map => Object.keys(map ?? {})));
  return Object.fromEntries([...keys].map(key => [
    key,
    round(mean(maps.map(map => Number(map?.[key])))),
  ]));
}

export function summarizeRuns(runs, questions) {
  const latencies = runs.map(run => run.durationMs);
  const summary = {
    runCount: runs.length,
    latencyMs: {
      min: round(Math.min(...latencies), 1),
      average: round(mean(latencies), 1),
      p50: round(percentile(latencies, 0.5), 1),
      max: round(Math.max(...latencies), 1),
    },
    questions: {},
  };

  for (const [id, question] of Object.entries(questions)) {
    const answers = runs.map(run => run.answers?.[id]).filter(Boolean);
    if (question.type === 'boolean') {
      const probabilities = answers.map(answer => Number(answer.probability));
      summary.questions[id] = {
        type: 'boolean',
        averageProbability: round(mean(probabilities)),
        minProbability: round(Math.min(...probabilities)),
        maxProbability: round(Math.max(...probabilities)),
      };
    }

    if (question.type === 'choice') {
      const selected = {};
      for (const answer of answers) selected[answer.choice] = (selected[answer.choice] ?? 0) + 1;
      summary.questions[id] = {
        type: 'choice',
        selected,
        averageProbabilities: averageProbabilityMaps(answers.map(answer => answer.probabilities)),
      };
    }

    if (question.type === 'score') {
      const scores = answers.map(answer => Number(answer.score));
      summary.questions[id] = {
        type: 'score',
        averageScore: round(mean(scores)),
        minScore: round(Math.min(...scores)),
        maxScore: round(Math.max(...scores)),
        averageProbabilities: averageProbabilityMaps(answers.map(answer => answer.probabilities)),
      };
    }
  }

  return summary;
}
