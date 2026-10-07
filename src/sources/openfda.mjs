// openFDA enforcement reports: richiami di alimenti, farmaci e dispositivi negli Stati Uniti.
// Etichetta ricavata: fda_classification (classe I, II o III, nascosta a Jev).

import { fetchJson, truncate } from './common.mjs';

const OPENFDA_ENDPOINTS = [
  { domain: 'food', endpoint: 'https://api.fda.gov/food/enforcement.json' },
  { domain: 'drug', endpoint: 'https://api.fda.gov/drug/enforcement.json' },
  { domain: 'device', endpoint: 'https://api.fda.gov/device/enforcement.json' },
];

function mapFdaClass(classification = '') {
  const value = classification.trim().toLowerCase();
  if (value === 'class i') return 'class_i';
  if (value === 'class ii') return 'class_ii';
  if (value === 'class iii') return 'class_iii';
  return 'unknown';
}

function stripFdaClass(value) {
  return truncate(value, 7_000).replace(/\bclass\s+i{1,3}\b/gi, '[official class withheld]');
}

function normalizeOpenFda(record, domain, endpoint) {
  const id = `${domain}-${record.recall_number || record.event_id || crypto.randomUUID()}`;
  const sourceUrl = new URL(endpoint);
  if (record.recall_number) sourceUrl.searchParams.set('search', `recall_number:"${record.recall_number}"`);
  return {
    id,
    title: `${domain.toUpperCase()} · ${truncate(record.product_description, 150) || record.recall_number || 'FDA enforcement report'}`,
    summary: stripFdaClass(record.reason_for_recall).slice(0, 240),
    sourceUrl: sourceUrl.toString(),
    publishedAt: record.report_date ?? null,
    state: {
      source: 'FDA Recall Enterprise System via openFDA',
      domain,
      product_description: truncate(record.product_description, 5_000),
      reason_for_recall: stripFdaClass(record.reason_for_recall),
      recalling_firm: record.recalling_firm ?? null,
      distribution_pattern: truncate(record.distribution_pattern, 3_000),
      product_quantity: record.product_quantity ?? null,
      voluntary_or_mandated: record.voluntary_mandated ?? null,
      initial_firm_notification: record.initial_firm_notification ?? null,
    },
    expected: {
      fda_classification: mapFdaClass(record.classification),
      official_classification: record.classification ?? null,
      recall_number: record.recall_number ?? null,
      status: record.status ?? null,
    },
  };
}

export async function fetchRecords({ limit, query }) {
  const perDomain = Math.max(2, Math.ceil(limit / OPENFDA_ENDPOINTS.length) + 1);
  const requests = OPENFDA_ENDPOINTS.map(async ({ domain, endpoint }) => {
    const target = new URL(endpoint);
    target.searchParams.set('limit', String(perDomain));
    target.searchParams.set('sort', 'report_date:desc');
    if (query) target.searchParams.set('search', `reason_for_recall:${query}`);
    const payload = await fetchJson(target, { allowNotFound: true });
    return {
      target: target.toString(),
      records: (payload?.results ?? []).map(record => normalizeOpenFda(record, domain, endpoint)),
    };
  });

  const responses = await Promise.all(requests);
  const records = responses
    .flatMap(response => response.records)
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, limit);

  return {
    sourceRequest: responses.map(response => response.target),
    records,
  };
}
