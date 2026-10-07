import 'dotenv/config';

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchDataset, getDatasetCatalog } from './src/datasets.mjs';
import { compareWithExpected, summarizeBatch } from './src/metrics.mjs';
import { evaluateWithActiveProvider, getProviderStatus } from './src/providers/index.mjs';
import { evaluateWithSemif, getSemifStatus, loadSemifModel, startSemifSidecar } from './src/semif.mjs';
import { summarizeRuns } from './src/summary.mjs';
import { normalizeEvaluationRequest } from './src/validation.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4317);
const MAX_BODY_BYTES = 500_000;

const STATIC_FILES = new Map([
  ['/', join(PUBLIC_DIR, 'index.html')],
  ['/index.html', join(PUBLIC_DIR, 'index.html')],
  ['/app.js', join(PUBLIC_DIR, 'app.js')],
  ['/styles.css', join(PUBLIC_DIR, 'styles.css')],
  ['/assets/aimax-bubble.svg', join(PUBLIC_DIR, 'assets', 'aimax-bubble.svg')],
  ['/assets/aimax-logo.svg', join(PUBLIC_DIR, 'assets', 'aimax-logo.svg')],
  ['/semif-client.js', join(PUBLIC_DIR, 'semif-client.js')],
  // Moduli puri condivisi con il server: il browser calcola le metriche di SemIf allo stesso modo.
  ['/lib/metrics.mjs', join(ROOT, 'src', 'metrics.mjs')],
  ['/lib/summary.mjs', join(ROOT, 'src', 'summary.mjs')],
  ['/lib/validation.mjs', join(ROOT, 'src', 'validation.mjs')],
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

// Il browser parla solo con questo server: Jev passa dal provider, SemIf dal sidecar locale.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "style-src 'self'",
  "script-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  // Incorniciabile solo da sé stesso e dai pannelli webview di VS Code (AIMax Viewer), non da siti esterni.
  "frame-ancestors 'self' vscode-webview: vscode-file:",
].join('; ');

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
}

function json(response, statusCode, payload) {
  setSecurityHeaders(response);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      const error = new Error('Richiesta troppo grande.');
      error.statusCode = 413;
      throw error;
    }
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    const error = new Error('Body JSON non valido.');
    error.statusCode = 400;
    throw error;
  }
}

async function serveStatic(pathname, response) {
  const filePath = STATIC_FILES.get(pathname);
  if (!filePath) return false;
  const data = await readFile(filePath);
  setSecurityHeaders(response);
  response.writeHead(200, {
    'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  response.end(data);
  return true;
}

async function handleEvaluate(request, response) {
  const payload = normalizeEvaluationRequest(await readJsonBody(request));
  const runs = [];
  for (let index = 0; index < payload.repetitions; index += 1) {
    runs.push(await evaluateWithActiveProvider(payload));
  }

  const provider = getProviderStatus();
  json(response, 200, {
    provider: provider.label,
    model: provider.model,
    zeroDataRetentionRequested: provider.zeroDataRetention,
    privacyMode: provider.privacyLabel ?? (provider.zeroDataRetention ? 'Zero Data Retention requested' : null),
    generatedAt: new Date().toISOString(),
    summary: summarizeRuns(runs, payload.questions),
    runs,
  });
}

async function handleDatasetFetch(request, response) {
  const payload = await readJsonBody(request);
  const result = await fetchDataset(payload.datasetId, {
    limit: payload.limit,
    query: payload.query,
  });
  json(response, 200, result);
}

async function handleBatchEvaluate(request, response) {
  const payload = await readJsonBody(request);
  if (!Array.isArray(payload.cases) || payload.cases.length < 1 || payload.cases.length > 20) {
    const error = new Error('cases deve contenere da 1 a 20 record.');
    error.statusCode = 400;
    throw error;
  }

  const evaluatedCases = [];
  for (const item of payload.cases) {
    const normalized = normalizeEvaluationRequest({
      state: item.state,
      questions: item.questions,
      repetitions: 1,
    });
    const run = await evaluateWithActiveProvider(normalized);
    evaluatedCases.push({
      id: item.id,
      title: item.title,
      sourceUrl: item.sourceUrl,
      durationMs: run.durationMs,
      answers: run.answers,
      usage: run.usage,
      comparisons: compareWithExpected(run.answers, item.expected),
    });
  }

  const provider = getProviderStatus();
  json(response, 200, {
    provider: provider.label,
    model: provider.model,
    zeroDataRetentionRequested: provider.zeroDataRetention,
    privacyMode: provider.privacyLabel ?? (provider.zeroDataRetention ? 'Zero Data Retention requested' : null),
    generatedAt: new Date().toISOString(),
    summary: summarizeBatch(evaluatedCases),
    cases: evaluatedCases,
  });
}

async function handleSemifEvaluate(request, response) {
  const payload = await readJsonBody(request);
  const { state, questions } = normalizeEvaluationRequest({ state: payload.state, questions: payload.questions });
  const recordId = typeof payload.recordId === 'string' && payload.recordId ? payload.recordId : 'manual';
  json(response, 200, await evaluateWithSemif({ state, questions, recordId }));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      json(response, 200, {
        ok: true,
        provider: getProviderStatus(),
        privacy: {
          requestBodiesLogged: false,
          resultsPersistedByLab: false,
          publicDataOnlyRecommended: true,
        },
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/datasets') {
      json(response, 200, { datasets: await getDatasetCatalog() });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/datasets/fetch') {
      await handleDatasetFetch(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/evaluate') {
      await handleEvaluate(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/evaluate-batch') {
      await handleBatchEvaluate(request, response);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/semif/status') {
      json(response, 200, await getSemifStatus());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/semif/load') {
      const payload = await readJsonBody(request);
      json(response, 202, await loadSemifModel(String(payload.modelId ?? '')));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/semif/evaluate') {
      await handleSemifEvaluate(request, response);
      return;
    }

    if (request.method === 'GET' && await serveStatic(url.pathname, response)) return;

    json(response, 404, { error: 'Risorsa non trovata.' });
  } catch (error) {
    const statusCode = Number(error.statusCode) || 500;
    const message = statusCode >= 500 && process.env.NODE_ENV === 'production'
      ? 'Errore interno del lab.'
      : error.message;
    json(response, statusCode, { error: message });
    if (statusCode >= 500) console.error(`[jev-lab] ${error.name}: ${error.message}`);
  }
});

const semifSidecar = await startSemifSidecar();

server.listen(PORT, HOST, () => {
  const provider = getProviderStatus();
  console.log(`Jev Business Decision Lab: http://${HOST}:${PORT}`);
  console.log(`Provider: ${provider.label} · model ${provider.model} · key ${provider.configured ? 'configured' : 'missing'}`);
  console.log(`SemIf: sidecar ${semifSidecar.started ? 'avviato' : 'non avviato'} (${semifSidecar.reason})`);
  console.log(`Privacy: ${provider.privacyLabel ?? `ZDR requested ${provider.zeroDataRetention ? 'yes' : 'no'}`} · request bodies are not logged`);
});
