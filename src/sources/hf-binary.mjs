// Un dataset di Hugging Face con un testo e un'etichetta binaria, letto dal datasets-server pubblico.
// Etichetta ricavata: quella indicata da params.expectedKey (vero se l'etichetta vale params.positiveValue).

import { fetchJson, matchesQuery, mixedSample, truncate } from './common.mjs';

const HF_ROWS_ENDPOINT = 'https://datasets-server.huggingface.co/rows';
const PAGE_SIZE = 100;
const MAX_ROWS = 1_000;

async function fetchPage(params) {
  const target = new URL(HF_ROWS_ENDPOINT);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, String(value));
  return { target: target.toString(), payload: await fetchJson(target) };
}

async function fetchAllRows(params) {
  const first = await fetchPage({ ...params, offset: 0, length: PAGE_SIZE });
  const total = Math.min(Number(first.payload.num_rows_total ?? 0), MAX_ROWS);
  const offsets = [];
  for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) offsets.push(offset);
  const rest = await Promise.all(offsets.map(offset => fetchPage({
    ...params,
    offset,
    length: Math.min(PAGE_SIZE, total - offset),
  })));
  const pages = [first, ...rest];
  return {
    targets: pages.map(page => page.target),
    rows: pages.flatMap(page => page.payload.rows ?? []),
  };
}

export async function fetchRecords({ limit, query, params, datasetId }) {
  const {
    dataset,
    config = 'default',
    split = 'test',
    textField = 'text',
    labelField = 'label',
    positiveValue = 1,
    textKey = 'testo',
    expectedKey,
    positiveShare = 0.5,
    summary = '',
  } = params;
  if (!dataset || !expectedKey) throw new Error('hf-binary: servono i parametri dataset ed expectedKey.');

  const { targets, rows } = await fetchAllRows({ dataset, config, split });
  const candidates = rows.filter(item => matchesQuery(item.row?.[textField], query));
  const isPositive = item => item.row[labelField] === positiveValue;
  const picked = mixedSample(candidates.filter(item => !isPositive(item)), candidates.filter(isPositive), limit, positiveShare);

  return {
    sourceRequest: targets,
    totalAvailable: candidates.length,
    records: picked.map(({ row_idx: rowIndex, row }) => {
      const text = String(row[textField] ?? '');
      return {
        id: `${datasetId}-${rowIndex}`,
        title: truncate(text.replace(/\s+/g, ' '), 140),
        summary,
        sourceUrl: `https://huggingface.co/datasets/${dataset}/viewer/${config}/${split}?row=${rowIndex}`,
        publishedAt: null,
        state: { [textKey]: truncate(text, 5_000) },
        expected: {
          [expectedKey]: row[labelField] === positiveValue,
          official_label: row[labelField],
        },
      };
    }),
  };
}
