// TED, Tenders Electronic Daily: gli avvisi di gara pubblicati nell'Unione europea.
// Etichette ricavate: sales_route (dal CPV) e contract_nature, con i campi ufficiali in chiaro nello state.

import { fetchJsonPost, truncate } from './common.mjs';

const TED_ENDPOINT = 'https://api.ted.europa.eu/v3/notices/search';

const FIELDS = [
  'publication-number',
  'notice-title',
  'buyer-name',
  'classification-cpv',
  'contract-nature',
  'publication-date',
];

function localizedValue(value, language = 'ita') {
  const candidate = value?.[language] ?? value?.eng ?? Object.values(value ?? {})[0];
  if (Array.isArray(candidate)) return candidate.find(Boolean) ?? '';
  return String(candidate ?? '');
}

function mapCpvSector(code = '') {
  const division = String(code).replace(/\D/g, '').slice(0, 2);
  const sectors = {
    digital_it: ['30', '32', '48', '64', '72'],
    healthcare_life_sciences: ['33', '85'],
    construction_infrastructure: ['44', '45', '71'],
    transport_logistics: ['34', '60', '63'],
    energy_environment_utilities: ['09', '31', '41', '65', '76', '90'],
    professional_business_services: ['66', '70', '73', '79'],
    education_culture: ['80', '92'],
    food_agriculture_hospitality: ['03', '15', '16', '55', '77'],
    industrial_goods_maintenance: ['14', '18', '19', '24', '35', '37', '38', '39', '42', '43', '50', '51'],
  };
  for (const [sector, divisions] of Object.entries(sectors)) {
    if (divisions.includes(division)) return sector;
  }
  return 'other_public_personal';
}

function mapContractNature(value = '') {
  const normalized = String(value).toLowerCase();
  if (normalized === 'services') return 'services';
  if (normalized === 'supplies') return 'supplies';
  if (normalized === 'works') return 'works';
  return 'other';
}

// Lo state contiene tutto quello che TED restituisce sull'avviso, in chiaro. I riferimenti sono
// le traduzioni dei campi ufficiali nelle categorie del lab: il CPV nei dieci settori commerciali,
// la natura del contratto nelle quattro opzioni della domanda.
function normalizeNotice(record) {
  const publicationNumber = String(record['publication-number'] ?? 'unknown');
  const title = localizedValue(record['notice-title'], 'ita');
  const buyer = localizedValue(record['buyer-name'], 'ita');
  const cpvList = [...new Set(record['classification-cpv'] ?? [])];
  const contractNature = [...new Set(record['contract-nature'] ?? [])][0] ?? '';
  return {
    id: publicationNumber,
    title: truncate(title, 220),
    sourceUrl: record.links?.html?.ITA || `https://ted.europa.eu/it/notice/-/detail/${publicationNumber}`,
    publishedAt: record['publication-date'] ?? null,
    summary: `${buyer || 'Committente non indicato'} · CPV ${cpvList.join(', ') || 'n/d'}`,
    state: {
      fonte: 'TED - Tenders Electronic Daily',
      titolo_bando: truncate(title, 5_000),
      committente: truncate(buyer, 1_000),
      data_pubblicazione: record['publication-date'] ?? null,
      cpv: cpvList,
      natura_contratto: contractNature || null,
    },
    expected: {
      sales_route: mapCpvSector(cpvList[0] ?? ''),
      contract_nature: mapContractNature(contractNature),
      official_cpv: cpvList,
      official_contract_nature: contractNature,
    },
  };
}

// params.filters: clausole della expert query di TED, unite in AND.
export async function fetchRecords({ limit, query, params }) {
  const cleanQuery = String(query ?? '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const filters = params.filters ?? ['buyer-country=ITA', 'publication-date>=today(-30)'];
  const parts = [...filters, cleanQuery ? `FT~"${cleanQuery}"` : null].filter(Boolean);

  const requestBody = {
    query: `${parts.join(' AND ')} SORT BY publication-date DESC`,
    fields: FIELDS,
    page: 1,
    limit: Math.min(50, Math.max(limit * 2, params.minFetch ?? 10)),
    scope: params.scope ?? 'ACTIVE',
    checkQuerySyntax: false,
    paginationMode: 'PAGE_NUMBER',
    onlyLatestVersions: true,
  };

  const payload = await fetchJsonPost(TED_ENDPOINT, requestBody);
  const records = (payload.notices ?? [])
    .map(normalizeNotice)
    .filter(record => record.state.titolo_bando && (!params.requireCpv || record.expected.official_cpv?.length))
    .slice(0, limit);

  return {
    sourceRequest: { endpoint: TED_ENDPOINT, body: requestBody },
    totalAvailable: payload.totalNoticeCount,
    records,
  };
}
