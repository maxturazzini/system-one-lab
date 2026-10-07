// Safety Gate: le allerte UE sui prodotti non alimentari pericolosi, dal report settimanale in italiano.
// Etichette ricavate: tipo_rischio e misura_adottata.

import { fetchText, matchesQuery, truncate } from './common.mjs';

const SAFETY_GATE_REPORTS = 'https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/it';

function decodeXmlEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function xmlField(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  if (!match) return null;
  const cdata = match[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  const text = (cdata ? cdata[1] : decodeXmlEntities(match[1])).trim();
  return text || null;
}

function parseReports(xml) {
  return [...xml.matchAll(/<weeklyReport>([\s\S]*?)<\/weeklyReport>/g)]
    .map(([, block]) => {
      const [day, month, year] = String(xmlField(block, 'publicationDate') ?? '').split('/');
      return {
        reference: xmlField(block, 'reference'),
        publishedAt: year ? `${year}-${month}-${day}` : null,
        url: xmlField(block, 'URL'),
      };
    })
    .filter(report => report.url)
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

function mapRisk(value = '') {
  const text = value.toLowerCase();
  if (text.includes('elettric')) return 'scossa_elettrica';
  if (text.includes('chimic')) return 'rischio_chimico';
  if (/soffoc|ostruzione|strangol|asfiss/.test(text)) return 'soffocamento';
  if (/incendio|ustion|esplos/.test(text)) return 'incendio_ustioni';
  if (/vista|udit/.test(text)) return 'vista_udito';
  if (/lesion|tagli|ferit/.test(text)) return 'lesioni_tagli';
  if (text.includes('ambiente')) return 'ambiente';
  return 'altro';
}

function mapMeasure(value = '') {
  const text = value.toLowerCase();
  if (/richiamo|recall/.test(text)) return 'richiamo_consumatori';
  if (text.includes('ritiro')) return 'ritiro_dal_mercato';
  if (/online|listino/.test(text)) return 'rimozione_online';
  if (/frontiera|distruzione/.test(text)) return 'respinto_o_distrutto';
  if (/divieto|cessazione/.test(text)) return 'stop_vendite';
  if (/avvert|marcatura/.test(text)) return 'avvertenze';
  return 'altro';
}

function normalizeAlert(block, report) {
  const field = tag => xmlField(block, tag);
  const riskTypes = String(field('riskType') ?? '').split(',').map(item => item.trim()).filter(Boolean);
  // Il campo measures concatena operatore, categoria e data senza separatori: si isolano le categorie.
  const measures = [...String(field('measures') ?? '').matchAll(/Categoria di misure:\s*([\s\S]*?)(?=Data di applicazione|Tipo di operatore|Categoria di misure|$)/g)]
    .map(([, value]) => value.trim())
    .filter(Boolean);
  const product = field('product');
  const brand = field('brand');
  return {
    id: field('caseNumber') ?? crypto.randomUUID(),
    title: truncate([product, brand].filter(Boolean).join(' · ') || 'Allerta Safety Gate', 220),
    summary: `${field('category') ?? 'Categoria non indicata'} · notificato da ${field('notifyingCountry') ?? 'n/d'} · ${report.reference ?? 'report settimanale'}`,
    sourceUrl: field('reference') ?? 'https://ec.europa.eu/safety-gate-alerts/screen/webReport',
    publishedAt: report.publishedAt,
    state: {
      fonte: 'Safety Gate - sistema di allerta rapida UE per i prodotti non alimentari',
      categoria: field('category'),
      prodotto: product,
      marca: brand,
      modello: field('name') ?? field('type_numberOfModel'),
      descrizione: truncate(field('description'), 3_000),
      pericolo: truncate(field('danger'), 5_000),
      destinatari: field('type'),
      paese_notificante: field('notifyingCountry'),
      paese_di_origine: field('countryOfOrigin'),
    },
    expected: {
      tipo_rischio: [...new Set(riskTypes.map(mapRisk))],
      misura_adottata: [...new Set(measures.map(mapMeasure))],
      official_risk_type: riskTypes,
      official_level: field('level'),
      official_measures: measures,
    },
  };
}

// params.maxReports: quanti report settimanali leggere al massimo per riempire il limite.
export async function fetchRecords({ limit, query, params }) {
  const reports = parseReports(await fetchText(SAFETY_GATE_REPORTS)).slice(0, params.maxReports ?? 4);
  const sourceRequest = [SAFETY_GATE_REPORTS];
  const records = [];

  for (const report of reports) {
    const xml = await fetchText(report.url);
    sourceRequest.push(report.url);
    for (const block of xml.match(/<notifications\b[\s\S]*?<\/notifications>/g) ?? []) {
      const record = normalizeAlert(block, report);
      const { categoria, prodotto, marca, descrizione, pericolo } = record.state;
      if (!matchesQuery([categoria, prodotto, marca, descrizione, pericolo].join(' '), query)) continue;
      records.push(record);
      if (records.length >= limit) break;
    }
    if (records.length >= limit) break;
  }

  return { sourceRequest, records };
}
