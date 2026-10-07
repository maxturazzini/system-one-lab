// I dataset vivono in datasets/<id>/: dataset.json (metadati e fonte), questions.json (le domande)
// e, facoltativo, profile.json (entra nello state). Le cartelle si rileggono a ogni richiesta:
// una cartella nuova compare ricaricando la pagina. Nelle cartelle solo JSON: il codice sta negli adattatori.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SOURCES } from './sources/index.mjs';
import { truncate } from './sources/common.mjs';
import { normalizeEvaluationRequest } from './validation.mjs';

export const DATASETS_DIR = fileURLToPath(new URL('../datasets/', import.meta.url));

const MAX_LIMIT = 20;
const DATASET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const warnings = new Set();

function clampLimit(value) {
  const parsed = Number(value ?? 8);
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(parsed)));
}

async function readJson(path, { optional = false } = {}) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (optional && error.code === 'ENOENT') return undefined;
    throw new Error(error.code === 'ENOENT' ? `manca ${path.split('/').at(-1)}` : error.message);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path.split('/').at(-1)} non è JSON valido: ${error.message}`);
  }
}

async function loadDataset(dir, id) {
  const folder = join(dir, id);
  const config = await readJson(join(folder, 'dataset.json'));
  const questions = await readJson(join(folder, 'questions.json'));
  const profile = await readJson(join(folder, 'profile.json'), { optional: true });
  if (!config?.name) throw new Error('dataset.json: manca name.');
  if (!SOURCES[config.source?.adapter]) throw new Error(`dataset.json: adattatore sconosciuto "${config.source?.adapter}".`);
  // Stesse regole delle richieste a Jev: una domanda malformata si scopre qui, non a metà batch.
  normalizeEvaluationRequest({ state: {}, questions });
  return { id, folder, config, questions, profile };
}

function warnOnce(message) {
  if (warnings.has(message)) return;
  warnings.add(message);
  console.warn(`[jev-lab] ${message}`);
}

export async function loadDatasets(dir = DATASETS_DIR) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const datasets = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !DATASET_ID.test(entry.name)) continue;
    try {
      datasets.push(await loadDataset(dir, entry.name));
    } catch (error) {
      warnOnce(`dataset "${entry.name}" ignorato: ${error.message}`);
    }
  }
  return datasets.sort((a, b) => (a.config.order ?? 1_000) - (b.config.order ?? 1_000) || a.config.name.localeCompare(b.config.name));
}

function catalogEntry({ id, config }) {
  return {
    id,
    name: config.name,
    owner: config.owner ?? '',
    businessQuestion: config.businessQuestion ?? '',
    sourceUrl: config.sourceUrl ?? '',
    apiUrl: config.apiUrl ?? '',
    license: config.license ?? '',
    freshness: config.freshness ?? '',
    warning: config.warning ?? '',
    queryLabel: config.queryLabel ?? 'Filtro facoltativo',
    queryPlaceholder: config.queryPlaceholder ?? '',
    maxBatch: config.maxBatch ?? 3,
  };
}

export async function getDatasetCatalog(dir = DATASETS_DIR) {
  return (await loadDatasets(dir)).map(catalogEntry);
}

// staticState apre lo state, il profilo lo chiude: lo state della fonte resta in mezzo.
function composeState(config, profile, state) {
  if (!config.staticState && profile === undefined) return state;
  const base = state && typeof state === 'object' && !Array.isArray(state) ? state : { contenuto: state };
  return {
    ...(config.staticState ?? {}),
    ...base,
    ...(profile === undefined ? {} : { [config.profileKey ?? 'profilo_azienda']: profile }),
  };
}

export async function fetchDataset(datasetId, options = {}, dir = DATASETS_DIR) {
  const dataset = (await loadDatasets(dir)).find(item => item.id === datasetId);
  if (!dataset) {
    const error = new Error(`Dataset sconosciuto: ${datasetId}`);
    error.statusCode = 404;
    throw error;
  }

  const { config, questions, profile, folder } = dataset;
  const result = await SOURCES[config.source.adapter].fetchRecords({
    limit: clampLimit(options.limit),
    query: truncate(options.query, 100),
    params: config.source.params ?? {},
    datasetId,
    folder,
  });

  return {
    datasetId,
    fetchedAt: new Date().toISOString(),
    sourceRequest: result.sourceRequest,
    ...(result.totalAvailable === undefined ? {} : { totalAvailable: result.totalAvailable }),
    records: result.records.map(record => ({
      ...record,
      state: composeState(config, profile, record.state),
      questions,
    })),
  };
}
