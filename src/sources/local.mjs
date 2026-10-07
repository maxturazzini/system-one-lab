// Record scritti a mano in un file JSONL dentro la cartella del dataset: una riga per record,
// con state e le etichette attese. Serve a provare Jev e SemIf sul proprio processo.

import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { matchesQuery, shuffle, truncate } from './common.mjs';

const TITLE_KEYS = ['title', 'titolo', 'oggetto', 'subject'];

// Senza un title esplicito nel record, si usa il campo che più probabilmente lo fa da titolo.
function titleFor(state) {
  const text = typeof state === 'string'
    ? state
    : TITLE_KEYS.map(key => state[key]).find(value => typeof value === 'string')
      ?? Object.values(state).find(value => typeof value === 'string')
      ?? JSON.stringify(state);
  return truncate(String(text).replace(/\s+/g, ' '), 140);
}

// params.file: nome del file nella cartella (default records.jsonl); params.order: "file" o "random".
export async function fetchRecords({ limit, query, params, datasetId, folder }) {
  const fileName = params.file ?? 'records.jsonl';
  const file = resolve(folder, fileName);
  if (!file.startsWith(`${resolve(folder)}${sep}`)) throw new Error('local: il file deve stare nella cartella del dataset.');

  const lines = (await readFile(file, 'utf8')).split('\n').map(line => line.trim()).filter(Boolean);
  const records = lines.map((line, index) => {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      throw new Error(`${fileName}: la riga ${index + 1} non è JSON valido.`);
    }
    if (item?.state === undefined || item.state === null) throw new Error(`${fileName}: la riga ${index + 1} non ha uno state.`);
    return {
      id: String(item.id ?? `${datasetId}-${index + 1}`),
      title: item.title ?? titleFor(item.state),
      summary: item.summary ?? '',
      sourceUrl: item.sourceUrl ?? '',
      publishedAt: null,
      state: item.state,
      expected: item.expected ?? {},
    };
  });

  const matching = records.filter(record => matchesQuery(JSON.stringify(record.state), query));
  const ordered = params.order === 'random' ? shuffle(matching) : matching;
  return {
    sourceRequest: `${datasetId}/${fileName}`,
    totalAvailable: matching.length,
    records: ordered.slice(0, limit),
  };
}
