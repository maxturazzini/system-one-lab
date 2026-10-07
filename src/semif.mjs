// SemIf vero come secondo motore. Il modello gira nel sidecar Python (semif/server.py), che usa
// il codice di SemIf senza modifiche. Qui sta solo l'adattatore: le domande in formato Jev
// diventano righe SemIf ({ id, state, question, options }) e i risultati tornano nella forma
// delle risposte di Jev, così metriche e interfaccia restano identiche.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Limite di semif_phase1.core.LETTERS (A-P). Il sidecar lo conferma in /status.
export const MAX_OPTIONS = 16;

export function semifConfig(env = process.env) {
  const port = Number(env.SEMIF_PORT || 4318);
  return {
    url: env.SEMIF_URL || `http://127.0.0.1:${port}`,
    port,
    python: env.SEMIF_PYTHON || join(homedir(), '.venvs', 'semif', 'bin', 'python'),
    mode: env.SEMIF_MODE === 'serial' ? 'serial' : 'direct',
    threads: env.SEMIF_THREADS ? Number(env.SEMIF_THREADS) : null,
    spawn: !env.SEMIF_URL,
  };
}

// Le opzioni di una domanda Jev, nell'ordine in cui SemIf assegna le lettere.
export function questionOptions(question) {
  if (question?.type === 'choice') {
    return Object.entries(question.criteria ?? {}).map(([id, description]) => ({ id, description: description || id }));
  }
  if (question?.type === 'boolean') {
    return [
      { id: 'true', description: question.criteria?.true ?? 'Sì.' },
      { id: 'false', description: question.criteria?.false ?? 'No.' },
    ];
  }
  if (question?.type === 'score') {
    return (question.criteria ?? []).map((description, level) => ({ id: String(level), description: description || `Livello ${level}.` }));
  }
  return [];
}

// Lo state viaggia come testo JSON con rientro di uno spazio: è il formato delle righe con cui
// semif-score ha valutato i bandi TED il 22/09 (results/ted20.jsonl), quindi lo stesso prompt.
export function stateForSemif(state) {
  return typeof state === 'string' ? state : JSON.stringify(state, null, 1);
}

export function buildRows({ state, questions, recordId = 'manual' }) {
  const rows = [];
  const skipped = {};
  const evidence = stateForSemif(state);
  for (const [questionId, question] of Object.entries(questions)) {
    const options = questionOptions(question);
    if (options.length < 2 || options.length > MAX_OPTIONS) {
      skipped[questionId] = `SemIf gestisce da 2 a ${MAX_OPTIONS} opzioni, questa domanda ne ha ${options.length}.`;
      continue;
    }
    rows.push({ id: `${recordId}__${questionId}`, questionId, state: evidence, question: question.instructions, options });
  }
  return { rows, skipped };
}

export function toAnswer(question, optionIds, probabilities) {
  const byKey = Object.fromEntries(optionIds.map((id, index) => [id, probabilities[index]]));
  if (question.type === 'boolean') return { type: 'boolean', probability: byKey.true };
  if (question.type === 'score') {
    const score = optionIds.reduce((sum, id, index) => sum + Number(id) * probabilities[index], 0);
    return { type: 'score', score, probabilities: byKey };
  }
  const best = probabilities.indexOf(Math.max(...probabilities));
  return { type: 'choice', choice: optionIds[best], probabilities: byKey };
}

// Traduce la risposta del sidecar. Un errore su una riga salta quella domanda, non il record.
export function collectAnswers(rows, questions, payload) {
  const byId = new Map((payload.results ?? []).map(result => [result.id, result]));
  const answers = {};
  const skipped = {};
  const details = {};
  let inputTokens = 0;
  for (const row of rows) {
    const result = byId.get(row.id);
    if (!result || result.error) {
      skipped[row.questionId] = `Errore di SemIf: ${result?.error ?? 'nessun risultato'}`;
      continue;
    }
    answers[row.questionId] = toAnswer(questions[row.questionId], result.option_ids, result.probabilities);
    inputTokens += Number(result.input_tokens) || 0;
    details[row.questionId] = {
      optionLogits: result.option_logits,
      allowedTokenMass: result.allowed_token_mass,
      inputTokens: result.input_tokens,
      totalSeconds: result.total_seconds,
      promptSha256: result.prompt_sha256,
    };
  }
  return { answers, skipped, details, inputTokens };
}

async function sidecar(path, { method = 'GET', body, config = semifConfig() } = {}) {
  let response;
  try {
    response = await fetch(`${config.url}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const error = new Error(`Sidecar SemIf non raggiungibile su ${config.url}. Vedete la sezione SemIf del README.`);
    error.statusCode = 503;
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Sidecar SemIf: HTTP ${response.status}`);
    error.statusCode = response.status === 400 ? 400 : 503;
    throw error;
  }
  return payload;
}

export async function getSemifStatus(config = semifConfig()) {
  try {
    return { reachable: true, ...(await sidecar('/status', { config })) };
  } catch (error) {
    return { reachable: false, error: error.message };
  }
}

export function loadSemifModel(modelId, config = semifConfig()) {
  return sidecar('/load', { method: 'POST', body: { modelId }, config });
}

function checkpointSummary(metadata, mode) {
  if (!metadata) return null;
  return {
    source: metadata.source,
    revision: metadata.revision,
    backend: metadata.backend,
    gguf: metadata.gguf,
    threads: metadata.threads,
    mode,
  };
}

export async function evaluateWithSemif({ state, questions, recordId }, config = semifConfig()) {
  const startedAt = performance.now();
  const { rows, skipped } = buildRows({ state, questions, recordId });
  let collected = { answers: {}, skipped: {}, details: {}, inputTokens: 0 };
  let payload = {};
  if (rows.length) {
    payload = await sidecar('/score', {
      method: 'POST',
      body: { rows: rows.map(({ questionId, ...row }) => row) },
      config,
    });
    collected = collectAnswers(rows, questions, payload);
  }
  return {
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    answers: collected.answers,
    skipped: { ...skipped, ...collected.skipped },
    usage: { inputTokens: collected.inputTokens },
    checkpoint: checkpointSummary(payload.metadata, payload.mode),
    details: collected.details,
  };
}

// Avvia il sidecar con il Python dell'ambiente SemIf, se non ne gira già uno.
export async function startSemifSidecar(config = semifConfig()) {
  if (!config.spawn) return { started: false, reason: `uso il sidecar esterno ${config.url}` };
  if ((await getSemifStatus(config)).reachable) return { started: false, reason: 'già attivo' };
  if (!existsSync(config.python)) return { started: false, reason: `Python di SemIf non trovato in ${config.python}` };
  const args = [join(ROOT, 'semif', 'server.py'), '--port', String(config.port), '--mode', config.mode];
  if (config.threads) args.push('--threads', String(config.threads));
  const child = spawn(config.python, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  const stop = () => child.kill();
  process.once('exit', stop);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      stop();
      process.exit(0);
    });
  }
  return { started: true, reason: `${config.python} semif/server.py` };
}
