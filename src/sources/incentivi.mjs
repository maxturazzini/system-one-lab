// Incentivi.gov.it: il catalogo nazionale degli incentivi alle imprese (MIMIT).
// Etichette ricavate: finalita, forma_agevolazione, grande_impresa_ammessa.

import { fetchJson, slugify, truncate } from './common.mjs';

// Lo stesso endpoint Solr da cui la pagina Open Data del sito genera il proprio export.
const INCENTIVI_SOLR = 'https://www.incentivi.gov.it/solr/coredrupal/select';

const FINALITA = {
  'Sostegno investimenti': 'investimenti',
  'Sostegno liquidità': 'liquidita',
  Internazionalizzazione: 'internazionalizzazione',
  'Innovazione e ricerca': 'innovazione_ricerca',
  Digitalizzazione: 'digitalizzazione',
  'Transizione ecologica': 'transizione_ecologica',
  "Start up/Sviluppo d'impresa": 'startup_sviluppo_impresa',
  "Crisi d'impresa": 'crisi_impresa',
  'Inclusione sociale': 'inclusione_sociale',
  'Imprenditoria giovanile': 'imprenditoria_giovanile',
  'Imprenditoria femminile': 'imprenditoria_femminile',
  'Formazione (lavoro, occupazione, riqualificazione professionale dei lavoratori)': 'formazione_lavoro',
  'Rafforzamento del capitale': 'rafforzamento_capitale',
};

const FORMA = {
  'Contributo/Fondo perduto': 'fondo_perduto',
  'Prestito/Anticipo rimborsabile': 'prestito_agevolato',
  'Agevolazione fiscale': 'agevolazione_fiscale',
  'Capitale di rischio': 'capitale_di_rischio',
  'Interventi a garanzia': 'garanzia',
  'Riduzione dei contributi di previdenza sociale': 'decontribuzione',
};

const FIELDS = [
  'id',
  'zs_nid',
  'zs_title',
  'zs_body',
  'zs_url',
  'zs_field_subject_grant',
  'zs_field_open_date',
  'zs_field_close_date',
  'zm_field_regions_value',
  'zm_field_scopes_value',
  'zm_field_support_form_value',
  'zm_field_dimensions_value',
];

function mapLabels(values, dictionary) {
  return [...new Set((values ?? []).map(value => dictionary[value] ?? slugify(value)))];
}

function normalizeIncentivo(doc) {
  const regions = doc.zm_field_regions_value ?? [];
  const territory = regions.length > 3 ? `${regions.length} regioni` : regions.join(', ') || 'territorio non indicato';
  const dimensions = doc.zm_field_dimensions_value ?? [];
  const classifiedDimensions = dimensions.filter(value => !/non classificabile/i.test(value));
  const closeDate = doc.zs_field_close_date ? doc.zs_field_close_date.slice(0, 10) : null;
  return {
    id: String(doc.zs_nid ?? doc.id),
    title: truncate(doc.zs_title, 220),
    summary: `${doc.zs_field_subject_grant || 'Ente non indicato'} · ${territory} · ${closeDate ? `chiude il ${closeDate}` : 'senza scadenza indicata'}`,
    sourceUrl: doc.zs_url ? `https://www.incentivi.gov.it${doc.zs_url}` : 'https://www.incentivi.gov.it/it/catalogo',
    publishedAt: doc.zs_field_open_date ?? null,
    state: {
      fonte: 'Incentivi.gov.it - catalogo nazionale degli incentivi alle imprese',
      titolo: truncate(doc.zs_title, 1_000),
      ente_gestore: doc.zs_field_subject_grant ?? null,
      territorio: regions,
      apertura: doc.zs_field_open_date ? doc.zs_field_open_date.slice(0, 10) : null,
      chiusura: closeDate ?? 'non indicata',
      descrizione: truncate(doc.zs_body, 5_000),
    },
    expected: {
      finalita: mapLabels(doc.zm_field_scopes_value, FINALITA),
      forma_agevolazione: mapLabels(doc.zm_field_support_form_value, FORMA),
      grande_impresa_ammessa: classifiedDimensions.length ? classifiedDimensions.includes('Grande Impresa') : null,
      official_finalita: doc.zm_field_scopes_value ?? [],
      official_forma: doc.zm_field_support_form_value ?? [],
      official_dimensioni: dimensions,
    },
  };
}

function solrPhrase(value) {
  return String(value ?? '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function fetchRecords({ limit, query }) {
  // I campi zs_* sono solo memorizzati, non indicizzati: niente filtri o ordinamenti lato Solr.
  // Prima si scarica l'indice leggero di tutte le schede, poi il dettaglio di quelle scelte.
  const phrase = solrPhrase(query);
  const today = new Date().toISOString().slice(0, 10);

  const index = new URL(INCENTIVI_SOLR);
  index.searchParams.set('q', phrase ? `tum_X3b_it_title_ft:"${phrase}" OR tum_X3b_it_body_ft:"${phrase}"` : '*:*');
  index.searchParams.set('fl', 'id,zs_field_open_date,zs_field_close_date');
  index.searchParams.set('rows', '8000');
  index.searchParams.set('wt', 'json');
  const indexPayload = await fetchJson(index);

  const open = (indexPayload.response?.docs ?? [])
    .filter(doc => !doc.zs_field_close_date || doc.zs_field_close_date.slice(0, 10) >= today)
    .sort((a, b) => String(b.zs_field_open_date ?? '').localeCompare(String(a.zs_field_open_date ?? '')));
  const selected = open.slice(0, limit);

  const result = {
    sourceRequest: [index.toString()],
    totalAvailable: open.length,
    records: [],
  };
  if (!selected.length) return result;

  const detail = new URL(INCENTIVI_SOLR);
  detail.searchParams.set('q', `id:(${selected.map(doc => `"${doc.id}"`).join(' OR ')})`);
  detail.searchParams.set('fl', FIELDS.join(','));
  detail.searchParams.set('rows', String(selected.length));
  detail.searchParams.set('wt', 'json');
  const detailPayload = await fetchJson(detail);
  const byId = new Map((detailPayload.response?.docs ?? []).map(doc => [doc.id, doc]));

  result.sourceRequest.push(detail.toString());
  result.records = selected.map(doc => byId.get(doc.id)).filter(Boolean).map(normalizeIncentivo);
  return result;
}
