import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';

import {
  MAX_OPTIONS,
  buildRows,
  evaluateWithSemif,
  getSemifStatus,
  questionOptions,
  semifConfig,
  toAnswer,
} from '../src/semif.mjs';

const TED20 = new URL('../results/ted20.jsonl', import.meta.url);
const TED_QUESTIONS = new URL('../datasets/ted-italia/questions.json', import.meta.url);

test('turns every Jev question type into SemIf options', () => {
  assert.deepEqual(questionOptions({ type: 'choice', criteria: { refund: 'Rimborso.', repair: 'Riparazione.' } }), [
    { id: 'refund', description: 'Rimborso.' },
    { id: 'repair', description: 'Riparazione.' },
  ]);
  assert.deepEqual(questionOptions({ type: 'boolean', criteria: { true: 'Va bloccato.', false: 'Può passare.' } }), [
    { id: 'true', description: 'Va bloccato.' },
    { id: 'false', description: 'Può passare.' },
  ]);
  assert.deepEqual(questionOptions({ type: 'boolean' }).map(option => option.id), ['true', 'false']);
  assert.deepEqual(questionOptions({ type: 'score', criteria: ['Bassa', 'Media', 'Alta'] }), [
    { id: '0', description: 'Bassa' },
    { id: '1', description: 'Media' },
    { id: '2', description: 'Alta' },
  ]);
});

test('builds one SemIf row per question and skips what SemIf cannot score', () => {
  const tooMany = Object.fromEntries(Array.from({ length: MAX_OPTIONS + 1 }, (_, index) => [`o${index}`, `Opzione ${index}.`]));
  const { rows, skipped } = buildRows({
    recordId: 'r1',
    state: { titolo: 'Bando voucher digitali' },
    questions: {
      natura: { type: 'choice', instructions: 'Che contratto è?', criteria: { a: 'Uno', b: 'Due' } },
      troppe: { type: 'choice', instructions: 'Quale?', criteria: tooMany },
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'r1__natura');
  assert.equal(rows[0].questionId, 'natura');
  assert.equal(rows[0].state, '{\n "titolo": "Bando voucher digitali"\n}');
  assert.equal(rows[0].question, 'Che contratto è?');
  assert.match(skipped.troppe, /da 2 a 16 opzioni/);

  const text = buildRows({ state: 'testo libero', questions: { q: { type: 'boolean', instructions: 'Sì?' } } });
  assert.equal(text.rows[0].state, 'testo libero');
  assert.equal(text.rows[0].id, 'manual__q');
});

// Le righe con cui semif-score ha misurato l'88% sui bandi TED il 22/09: il lab deve ricostruirle
// identiche, perché da quelle SemIf costruisce il prompt (stesso prompt_sha256, stesso risultato).
test('rebuilds exactly the TED rows scored by semif-score on 22/09', t => {
  if (!existsSync(TED20)) {
    t.skip('results/ted20.jsonl non presente (escluso da Git)');
    return;
  }
  const measured = readFileSync(TED20, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const questions = JSON.parse(readFileSync(TED_QUESTIONS, 'utf8'));
  const records = new Map();
  for (const row of measured) {
    const [recordId, questionId] = row.id.split('__');
    const record = records.get(recordId) ?? { state: JSON.parse(row.state), questions: {} };
    record.questions[questionId] = questions[questionId];
    records.set(recordId, record);
  }
  const rebuilt = [...records].flatMap(([recordId, record]) => buildRows({ recordId, ...record }).rows)
    .map(({ questionId, ...row }) => row);
  assert.equal(rebuilt.length, measured.length);
  assert.deepEqual(rebuilt, measured);
});

test('returns answers in the same shape as Jev', () => {
  assert.deepEqual(toAnswer({ type: 'boolean' }, ['true', 'false'], [0.3, 0.7]), { type: 'boolean', probability: 0.3 });
  assert.deepEqual(toAnswer({ type: 'choice' }, ['low', 'high'], [0.25, 0.75]), {
    type: 'choice',
    choice: 'high',
    probabilities: { low: 0.25, high: 0.75 },
  });
  const score = toAnswer({ type: 'score' }, ['0', '1', '2'], [0.2, 0.3, 0.5]);
  assert.equal(score.type, 'score');
  assert.ok(Math.abs(score.score - 1.3) < 1e-9);
  assert.deepEqual(score.probabilities, { 0: 0.2, 1: 0.3, 2: 0.5 });
});

async function fakeSidecar(handler) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, body: body ? JSON.parse(body) : null });
    const [status, payload] = handler(request, body ? JSON.parse(body) : null);
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = semifConfig({ SEMIF_URL: `http://127.0.0.1:${server.address().port}` });
  return { config, requests, close: () => new Promise(resolve => server.close(resolve)) };
}

test('sends SemIf rows to the sidecar and maps results back to Jev answers', async () => {
  const sidecar = await fakeSidecar((request, body) => [200, {
    mode: 'direct',
    metadata: { source: 'openbmb/MiniCPM5-2B', revision: 'abc', backend: 'llamacpp', gguf: { file: 'x.gguf' }, threads: 8 },
    results: body.rows.map(row => row.id.endsWith('rotto')
      ? { id: row.id, error: 'ValueError: troppo lungo' }
      : {
        id: row.id,
        option_ids: row.options.map(option => option.id),
        probabilities: row.options.length === 2 ? [0.8, 0.2] : [0.1, 0.2, 0.7],
        option_logits: [],
        input_tokens: 100,
        total_seconds: 0.5,
        prompt_sha256: 'sha',
      }),
  }]);
  try {
    const run = await evaluateWithSemif({
      recordId: 'r7',
      state: { testo: 'ciao' },
      questions: {
        blocca: { type: 'boolean', instructions: 'Bloccare?' },
        livello: { type: 'score', instructions: 'Quanto?', criteria: ['Basso', 'Medio', 'Alto'] },
        rotto: { type: 'choice', instructions: 'Quale?', criteria: { a: 'A', b: 'B' } },
      },
    }, sidecar.config);
    assert.equal(sidecar.requests[0].url, '/score');
    assert.deepEqual(sidecar.requests[0].body.rows.map(row => row.id), ['r7__blocca', 'r7__livello', 'r7__rotto']);
    assert.ok(sidecar.requests[0].body.rows.every(row => !('questionId' in row)));
    assert.deepEqual(run.answers.blocca, { type: 'boolean', probability: 0.8 });
    assert.ok(Math.abs(run.answers.livello.score - 1.6) < 1e-9);
    assert.match(run.skipped.rotto, /troppo lungo/);
    assert.equal(run.usage.inputTokens, 200);
    assert.equal(run.checkpoint.source, 'openbmb/MiniCPM5-2B');
    assert.equal(run.details.blocca.promptSha256, 'sha');
  } finally {
    await sidecar.close();
  }
});

test('reports an unreachable sidecar without throwing', async () => {
  const status = await getSemifStatus(semifConfig({ SEMIF_URL: 'http://127.0.0.1:9' }));
  assert.equal(status.reachable, false);
  assert.match(status.error, /non raggiungibile/);
});
