// CLINC150: richieste brevi a un assistente, con una classe di richieste fuori perimetro (oos).
// Etichette ricavate: reparto_con_uscita, reparto_senza_uscita, richiesta_bancaria.

import { fetchJson, matchesQuery, mixedSample, truncate } from './common.mjs';

const CLINC_DATA_URL = 'https://raw.githubusercontent.com/clinc/oos-eval/master/data/data_full.json';

// Normalizzazione dichiarata: i 30 intenti dei domini banking e credit_cards in 5 reparti.
// Le chiavi devono coincidere con le opzioni delle domande in questions.json.
const DEPARTMENTS = {
  conti_e_movimenti: ['balance', 'transactions', 'spending_history', 'routing', 'interest_rate', 'order_checks'],
  pagamenti_e_bollette: ['transfer', 'pay_bill', 'bill_balance', 'bill_due'],
  sicurezza_e_blocchi: ['freeze_account', 'account_blocked', 'report_fraud', 'pin_change', 'report_lost_card', 'damaged_card', 'replacement_card_duration'],
  carte_di_credito: ['new_card', 'application_status', 'credit_limit', 'credit_limit_change', 'apr', 'international_fees', 'expiration_date', 'min_payment', 'card_declined'],
  punti_e_merito_creditizio: ['rewards_balance', 'redeem_rewards', 'credit_score', 'improve_credit_score'],
};

const INTENT_TO_DEPARTMENT = Object.fromEntries(
  Object.entries(DEPARTMENTS).flatMap(([department, intents]) => intents.map(intent => [intent, department])),
);

// Il file è statico: lo si scarica una volta per processo e lo si tiene in memoria.
let splits = null;

function loadSplits() {
  splits ??= fetchJson(CLINC_DATA_URL).catch(error => {
    splits = null;
    throw error;
  });
  return splits;
}

function normalizeRequest({ id, text, intent }) {
  const department = INTENT_TO_DEPARTMENT[intent] ?? null;
  return {
    id,
    title: truncate(text, 140),
    summary: 'Chat del servizio clienti di una banca',
    sourceUrl: 'https://github.com/clinc/oos-eval',
    publishedAt: null,
    state: {
      messaggio_cliente: truncate(text, 2_000),
    },
    expected: {
      reparto_con_uscita: department ?? 'fuori_perimetro',
      // Senza l'opzione di uscita, per una richiesta fuori perimetro nessuna risposta è corretta.
      reparto_senza_uscita: department ?? 'nessuna_opzione_valida',
      richiesta_bancaria: Boolean(department),
      official_intent: intent,
    },
  };
}

// params.outOfScopeShare: quota di richieste fuori perimetro nel campione.
export async function fetchRecords({ limit, query, params }) {
  const data = await loadSplits();
  const toRequest = prefix => ([text, intent], index) => ({ id: `clinc-${prefix}-${index}`, text, intent });
  const matching = item => matchesQuery(item.text, query);
  const inScope = (data.test ?? []).map(toRequest('test')).filter(item => INTENT_TO_DEPARTMENT[item.intent] && matching(item));
  const outOfScope = (data.oos_test ?? []).map(toRequest('oos')).filter(matching);

  return {
    sourceRequest: CLINC_DATA_URL,
    totalAvailable: inScope.length + outOfScope.length,
    records: mixedSample(inScope, outOfScope, limit, params.outOfScopeShare ?? 0.4).map(normalizeRequest),
  };
}
