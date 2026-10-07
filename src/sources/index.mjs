// Gli adattatori disponibili. dataset.json ne sceglie uno con source.adapter.
// Ogni adattatore esporta fetchRecords({ limit, query, params, datasetId, folder }) e restituisce
// { records, sourceRequest, totalAvailable? }, con record { id, title, summary, sourceUrl, publishedAt, state, expected }.

import * as clinc from './clinc.mjs';
import * as cpsc from './cpsc.mjs';
import * as hfBinary from './hf-binary.mjs';
import * as incentivi from './incentivi.mjs';
import * as local from './local.mjs';
import * as openfda from './openfda.mjs';
import * as safetyGate from './safety-gate.mjs';
import * as ted from './ted.mjs';

export const SOURCES = {
  clinc,
  cpsc,
  'hf-binary': hfBinary,
  incentivi,
  local,
  openfda,
  'safety-gate': safetyGate,
  ted,
};
