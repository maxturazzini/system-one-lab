// CPSC: richiami di prodotti di consumo negli Stati Uniti.
// Etichette ricavate: primary_hazard e customer_action.

import { fetchJson, firstNonEmpty, isoDateDaysAgo, truncate } from './common.mjs';

const CPSC_ENDPOINT = 'https://www.saferproducts.gov/RestWebServices/Recall';

function mapCpscHazard(record) {
  const text = [record.Title, ...(record.Hazards ?? []).map(item => item.Name)].join(' ').toLowerCase();
  if (text.includes('chok')) return 'choking';
  if (text.includes('poison') || text.includes('lead')) return 'poisoning';
  if (text.includes('fire') || text.includes('burn') || text.includes('flamm')) return 'fire_burn';
  if (text.includes('electric') || text.includes('shock') || text.includes('electroc')) return 'electrical';
  if (text.includes('fall') || text.includes('tip-over') || text.includes('entrap')) return 'fall_entrapment';
  if (text.includes('ingest') || text.includes('swallow') || text.includes('magnet')) return 'ingestion';
  if (text.includes('lacer') || text.includes('cut')) return 'laceration';
  return 'other';
}

function mapCpscRemedy(record) {
  const option = firstNonEmpty(record.RemedyOptions).toLowerCase();
  if (option.includes('refund')) return 'refund';
  if (option.includes('repair')) return 'repair';
  if (option.includes('replace')) return 'replace';
  if (option.includes('dispose')) return 'dispose';
  if (option.includes('instruction')) return 'new_instructions';
  return 'other';
}

function normalizeCpsc(record) {
  const product = record.Products?.[0] ?? {};
  const hazards = (record.Hazards ?? []).map(item => truncate(item.Name, 2_000)).filter(Boolean);
  const injuries = (record.Injuries ?? []).map(item => truncate(item.Name, 2_000)).filter(Boolean);
  const remedies = (record.Remedies ?? []).map(item => truncate(item.Name, 3_000)).filter(Boolean);
  return {
    id: String(record.RecallID),
    title: record.Title || product.Name || `Recall ${record.RecallNumber}`,
    summary: truncate(hazards[0] || record.Description, 240),
    sourceUrl: record.URL || 'https://www.cpsc.gov/Recalls',
    publishedAt: record.RecallDate ?? null,
    state: {
      source: 'CPSC Recall Database',
      title: truncate(record.Title, 1_500),
      product: {
        name: product.Name ?? null,
        type: product.Type ?? null,
        units: product.NumberOfUnits ?? null,
      },
      description: truncate(record.Description, 5_000),
      hazards,
      injuries,
      official_remedy_text: remedies,
      manufactured_in: (record.ManufacturerCountries ?? []).map(item => item.Country).filter(Boolean),
    },
    expected: {
      primary_hazard: mapCpscHazard(record),
      customer_action: mapCpscRemedy(record),
      official_hazards: hazards,
      official_remedy_options: (record.RemedyOptions ?? []).map(item => item.Option).filter(Boolean),
      recall_number: record.RecallNumber ?? null,
    },
  };
}

// params.days: finestra dei richiami, in giorni.
export async function fetchRecords({ limit, query, params }) {
  const target = new URL(CPSC_ENDPOINT);
  target.searchParams.set('format', 'json');
  target.searchParams.set('RecallDateStart', isoDateDaysAgo(params.days ?? 120));
  if (query) target.searchParams.set('Hazard', query);

  const payload = await fetchJson(target);
  const records = (Array.isArray(payload) ? payload : [])
    .sort((a, b) => new Date(b.RecallDate) - new Date(a.RecallDate))
    .slice(0, limit)
    .map(normalizeCpsc);

  return {
    sourceRequest: target.toString(),
    records,
  };
}
