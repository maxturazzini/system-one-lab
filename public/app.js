import { compareWithExpected, summarizeBatch } from '/lib/metrics.mjs';
import { summarizeRuns } from '/lib/summary.mjs';
import { normalizeEvaluationRequest } from '/lib/validation.mjs';
import { createSemifEngine } from '/semif-client.js';

const dom = {
  providerStatus: document.querySelector('#providerStatus'),
  datasetSelect: document.querySelector('#datasetSelect'),
  datasetMeta: document.querySelector('#datasetMeta'),
  datasetQuery: document.querySelector('#datasetQuery'),
  datasetQueryLabel: document.querySelector('#datasetQueryLabel'),
  datasetLimit: document.querySelector('#datasetLimit'),
  loadDataset: document.querySelector('#loadDataset'),
  datasetMessage: document.querySelector('#datasetMessage'),
  recordList: document.querySelector('#recordList'),
  runBatch: document.querySelector('#runBatch'),
  runSemifBatch: document.querySelector('#runSemifBatch'),
  semifStatus: document.querySelector('#semifStatus'),
  semifModel: document.querySelector('#semifModel'),
  semifLoad: document.querySelector('#semifLoad'),
  semifProgress: document.querySelector('#semifProgress'),
  semifDetail: document.querySelector('#semifDetail'),
  runSemif: document.querySelector('#runSemif'),
  selectedRecord: document.querySelector('#selectedRecord'),
  stateInput: document.querySelector('#stateInput'),
  questionsInput: document.querySelector('#questionsInput'),
  questionsPreview: document.querySelector('#questionsPreview'),
  toggleQuestionsView: document.querySelector('#toggleQuestionsView'),
  formatJson: document.querySelector('#formatJson'),
  repetitions: document.querySelector('#repetitions'),
  runEvaluation: document.querySelector('#runEvaluation'),
  runMessage: document.querySelector('#runMessage'),
  runStats: document.querySelector('#runStats'),
  answerCards: document.querySelector('#answerCards'),
  rawDetails: document.querySelector('#rawDetails'),
  rawOutput: document.querySelector('#rawOutput'),
  downloadResult: document.querySelector('#downloadResult'),
};

const state = {
  datasets: [],
  records: [],
  selectedRecord: null,
  // Ultima valutazione e ultimo batch per motore: si affiancano quando riguardano lo stesso input.
  runs: { jev: null, semif: null },
  batches: { jev: null, semif: null },
  semifBusy: false,
  semifAvailable: false,
  result: null,
};

const ENGINES = ['jev', 'semif'];

const semif = createSemifEngine({ onProgress: renderSemifProgress });

// Oltre questa soglia le opzioni di una domanda si comprimono dietro "Mostra altre".
const VISIBLE_OPTIONS = 5;

function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 1000) / 10}%` : 'n/d';
}

function formatNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits).replace(/\.00$/, '') : 'n/d';
}

function humanize(id) {
  const text = String(id).replace(/[_-]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatValue(value) {
  if (Array.isArray(value)) return value.map(formatValue).join(' o ');
  if (value === true) return 'sì';
  if (value === false) return 'no';
  return String(value);
}

function setMessage(node, message, isError = false) {
  node.textContent = message;
  node.classList.toggle('error', isError);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function loadHealth() {
  try {
    const health = await api('/api/health');
    if (health.provider.configured) {
      const privacy = health.provider.privacyLabel || `ZDR ${health.provider.zeroDataRetention ? 'ON' : 'OFF'}`;
      dom.providerStatus.textContent = `${health.provider.label} · ${privacy}`;
      dom.providerStatus.className = 'status-chip ok';
    } else {
      dom.providerStatus.textContent = 'API key mancante';
      dom.providerStatus.className = 'status-chip error';
    }
  } catch (error) {
    dom.providerStatus.textContent = `Server non disponibile: ${error.message}`;
    dom.providerStatus.className = 'status-chip error';
  }
}

async function loadCatalog() {
  const payload = await api('/api/datasets');
  state.datasets = payload.datasets;
  dom.datasetSelect.replaceChildren();
  for (const dataset of state.datasets) {
    const option = create('option', '', dataset.name);
    option.value = dataset.id;
    dom.datasetSelect.append(option);
  }
  renderDatasetMeta();
}

function activeDataset() {
  return state.datasets.find(item => item.id === dom.datasetSelect.value);
}

function renderDatasetMeta() {
  const dataset = activeDataset();
  if (!dataset) return;
  dom.datasetMeta.replaceChildren();

  const business = create('p');
  const businessLabel = create('strong', '', 'Domanda business: ');
  business.append(businessLabel, document.createTextNode(dataset.businessQuestion));

  const details = create('p');
  details.append(document.createTextNode(`${dataset.freshness}. ${dataset.license}. `));
  if (dataset.sourceUrl) {
    const link = create('a', '', 'Fonte ufficiale');
    link.href = dataset.sourceUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    details.append(link);
  }

  const warning = create('p');
  warning.append(create('strong', '', 'Limite: '), document.createTextNode(dataset.warning));
  dom.datasetMeta.append(business, details, warning);

  dom.datasetQueryLabel.textContent = dataset.queryLabel;
  dom.datasetQuery.placeholder = dataset.queryPlaceholder;
  state.records = [];
  state.selectedRecord = null;
  dom.recordList.replaceChildren();
  setMessage(dom.datasetMessage, '');
  updateSemifButtons();
}

async function fetchPublicRecords() {
  dom.loadDataset.disabled = true;
  dom.runBatch.disabled = true;
  setMessage(dom.datasetMessage, 'Carico la fonte ufficiale…');
  dom.recordList.replaceChildren();
  try {
    const payload = await api('/api/datasets/fetch', {
      method: 'POST',
      body: JSON.stringify({
        datasetId: dom.datasetSelect.value,
        limit: Number(dom.datasetLimit.value),
        query: dom.datasetQuery.value.trim(),
      }),
    });
    state.records = payload.records;
    renderRecords();
    const available = payload.totalAvailable && payload.totalAvailable > payload.records.length
      ? ` su ${payload.totalAvailable} disponibili`
      : '';
    setMessage(dom.datasetMessage, `${payload.records.length} record caricati${available} · ${new Date(payload.fetchedAt).toLocaleString('it-IT')}`);
  } catch (error) {
    setMessage(dom.datasetMessage, error.message, true);
  } finally {
    dom.loadDataset.disabled = false;
  }
}

function renderRecords() {
  dom.recordList.replaceChildren();
  for (const record of state.records) {
    const button = create('button', 'record-button');
    button.type = 'button';
    button.dataset.id = record.id;
    button.append(create('strong', '', record.title), create('span', '', record.summary || 'Nessuna anteprima'));
    button.addEventListener('click', () => selectRecord(record));
    dom.recordList.append(button);
  }
  dom.runBatch.disabled = state.records.length === 0;
  const batchCount = Math.min(state.records.length, activeDataset()?.maxBatch ?? state.records.length);
  dom.runBatch.textContent = state.records.length
    ? `Valuta batch con Jev (${batchCount}${batchCount < state.records.length ? ` di ${state.records.length}` : ''} chiamate)`
    : 'Valuta batch con Jev';
  dom.runSemifBatch.textContent = state.records.length
    ? `Batch con SemIf in locale (${state.records.length} record, gratis)`
    : 'Batch con SemIf in locale';
  updateSemifButtons();
}

function selectRecord(record) {
  state.selectedRecord = record;
  for (const button of dom.recordList.querySelectorAll('.record-button')) {
    button.classList.toggle('active', button.dataset.id === record.id);
  }

  dom.selectedRecord.className = 'selected-record';
  dom.selectedRecord.replaceChildren();
  dom.selectedRecord.append(create('strong', '', record.title));
  // I record scritti a mano (adattatore local) possono non avere una fonte da aprire.
  if (record.sourceUrl) {
    const link = create('a', '', 'apri la fonte');
    link.href = record.sourceUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    dom.selectedRecord.append(document.createTextNode(' · '), link);
  }

  dom.stateInput.value = JSON.stringify(record.state, null, 2);
  dom.questionsInput.value = JSON.stringify(record.questions, null, 2);
  dom.stateInput.scrollTop = 0;
  dom.questionsInput.scrollTop = 0;
  renderQuestionsPreview();
  setMessage(dom.runMessage, 'Etichette ufficiali caricate per il confronto, ma escluse dallo state inviato a Jev.');
}

function questionTypeLabel(question) {
  if (question.type === 'choice') return `Scelta · ${Object.keys(question.criteria ?? {}).length} opzioni`;
  if (question.type === 'score') return `Punteggio 0-${Math.max(1, (question.criteria?.length ?? 2) - 1)}`;
  if (question.type === 'boolean') return 'Sì / No';
  return String(question.type ?? 'tipo mancante');
}

function questionOptions(question) {
  if (question.type === 'choice') return Object.entries(question.criteria ?? {});
  if (question.type === 'score') return (question.criteria ?? []).map((description, level) => [String(level), description]);
  if (question.type === 'boolean' && question.criteria) return [['sì', question.criteria.true], ['no', question.criteria.false]];
  return [];
}

function hasReference(questionId) {
  const expected = state.selectedRecord?.expected?.[questionId];
  return expected !== undefined && expected !== null && !(Array.isArray(expected) && !expected.length);
}

function optionList(options) {
  const list = create('ul', 'option-list');
  for (const [key, description] of options) {
    const row = create('li', 'option-row');
    row.append(create('span', 'option-key', key), create('span', 'option-desc', description ?? ''));
    list.append(row);
  }
  return list;
}

function renderQuestionPreview(id, question) {
  const card = create('article', 'question-card');
  const header = create('header');
  header.append(create('h3', '', humanize(id)), create('span', 'type-tag', questionTypeLabel(question)));
  if (state.selectedRecord) {
    const measured = hasReference(id);
    const tag = create('span', `ref-tag ${measured ? 'measured' : 'judgment'}`, measured ? 'Con riferimento ufficiale' : 'Senza riferimento');
    tag.title = measured
      ? 'La risposta di Jev viene confrontata con l’etichetta ufficiale del record.'
      : 'Nessuna etichetta ufficiale: la risposta va letta come un giudizio.';
    header.append(tag);
  }
  card.append(header, create('code', 'question-id', id));
  if (question.instructions) card.append(create('p', 'question-instructions', question.instructions));

  const options = questionOptions(question);
  // Se resterebbe nascosta una sola opzione, tanto vale mostrarle tutte.
  const visibleCount = options.length > VISIBLE_OPTIONS + 1 ? VISIBLE_OPTIONS : options.length;
  if (visibleCount) card.append(optionList(options.slice(0, visibleCount)));
  if (visibleCount < options.length) {
    const more = create('details', 'more-options');
    more.append(create('summary', '', `Mostra altre ${options.length - visibleCount} opzioni`), optionList(options.slice(visibleCount)));
    card.append(more);
  }
  return card;
}

function renderQuestionsPreview() {
  dom.questionsPreview.replaceChildren();
  dom.questionsPreview.className = 'questions-preview empty';
  const raw = dom.questionsInput.value.trim();
  if (!raw) {
    dom.questionsPreview.textContent = 'Scegliete un record per vedere le domande, oppure scrivetele nella vista JSON.';
    return;
  }
  let questions;
  try {
    questions = parseQuestions(raw);
  } catch (error) {
    dom.questionsPreview.textContent = `${error.message} Correggetelo nella vista JSON.`;
    return;
  }
  dom.questionsPreview.className = 'questions-preview';
  for (const [id, question] of Object.entries(questions)) {
    dom.questionsPreview.append(renderQuestionPreview(id, question && typeof question === 'object' ? question : {}));
  }
}

function setQuestionsView(view) {
  const readable = view === 'readable';
  if (readable) renderQuestionsPreview();
  dom.questionsPreview.classList.toggle('hidden', !readable);
  dom.questionsInput.classList.toggle('hidden', readable);
  dom.formatJson.classList.toggle('hidden', readable);
  dom.toggleQuestionsView.textContent = readable ? 'Modifica JSON' : 'Vista leggibile';
  dom.toggleQuestionsView.dataset.view = view;
}

function parseState(raw) {
  const value = raw.trim();
  if (!value) throw new Error('Inserite uno state o selezionate un record.');
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseQuestions(raw) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error('Questions deve essere un oggetto JSON valido.');
  }
}

function currentInputs() {
  const evaluationState = parseState(dom.stateInput.value);
  const questions = parseQuestions(dom.questionsInput.value);
  return { evaluationState, questions, key: JSON.stringify([evaluationState, questions]) };
}

function sourceRecordInfo() {
  return state.selectedRecord ? {
    id: state.selectedRecord.id,
    title: state.selectedRecord.title,
    sourceUrl: state.selectedRecord.sourceUrl,
    expected: state.selectedRecord.expected,
  } : null;
}

function semifLabel(model = semif.model) {
  return model ? `SemIf · ${model.name}` : 'SemIf';
}

async function runEvaluation() {
  dom.runEvaluation.disabled = true;
  setMessage(dom.runMessage, 'Jev sta valutando lo state…');
  try {
    const { evaluationState, questions, key } = currentInputs();
    const result = await api('/api/evaluate', {
      method: 'POST',
      body: JSON.stringify({
        state: evaluationState,
        questions,
        repetitions: Number(dom.repetitions.value),
      }),
    });
    const inputTokens = result.runs.reduce((sum, run) => sum + Number(run.usage?.inputTokens ?? 0), 0);
    state.runs.jev = {
      engine: 'jev',
      label: 'Jev',
      key,
      questions,
      summary: result.summary,
      skipped: {},
      stats: [
        ['Latenza media', `${formatNumber(result.summary.latencyMs.average, 1)} ms`],
        ['Min / max', `${formatNumber(result.summary.latencyMs.min, 1)} / ${formatNumber(result.summary.latencyMs.max, 1)} ms`],
        ['Input token', inputTokens ? inputTokens.toLocaleString('it-IT') : 'n/d'],
        ['Privacy', result.privacyMode || (result.zeroDataRetentionRequested ? 'ZDR richiesto' : 'Policy standard')],
      ],
      raw: result,
    };
    showEvaluation(key);
    const { runCount } = result.summary;
    setMessage(dom.runMessage, `Jev: ${runCount} ${runCount > 1 ? 'valutazioni completate' : 'valutazione completata'}.`);
  } catch (error) {
    setMessage(dom.runMessage, error.message, true);
  } finally {
    dom.runEvaluation.disabled = false;
  }
}

async function runSemifEvaluation() {
  const model = semif.model;
  if (!model) return;
  state.semifBusy = true;
  updateSemifButtons();
  setMessage(dom.runMessage, `${semifLabel(model)} sta valutando lo state su questo computer…`);
  try {
    const { evaluationState, questions, key } = currentInputs();
    normalizeEvaluationRequest({ state: evaluationState, questions });
    const run = await semif.evaluate({ state: evaluationState, questions, recordId: state.selectedRecord?.id });
    const answered = Object.fromEntries(Object.entries(questions).filter(([id]) => run.answers[id]));
    state.runs.semif = {
      engine: 'semif',
      label: semifLabel(model),
      key,
      questions,
      summary: summarizeRuns([run], answered),
      skipped: run.skipped,
      stats: [
        ['Tempo totale', `${formatNumber(run.durationMs, 1)} ms`],
        ['Passaggi del modello', `${Object.keys(answered).length}, uno per domanda`],
        ['Input token', run.usage.inputTokens ? run.usage.inputTokens.toLocaleString('it-IT') : 'n/d'],
        ['Privacy', 'Su questo computer, nessun invio'],
      ],
      raw: { engine: 'semif', model: model.name, ...run },
    };
    showEvaluation(key);
    const skippedCount = Object.keys(run.skipped).length;
    const skippedText = skippedCount ? `, ${skippedCount} ${skippedCount > 1 ? 'domande saltate' : 'domanda saltata'}` : '';
    setMessage(dom.runMessage, `${semifLabel(model)}: valutazione completata${skippedText}.`);
  } catch (error) {
    setMessage(dom.runMessage, error.message, true);
  } finally {
    state.semifBusy = false;
    updateSemifButtons();
  }
}

function showEvaluation(key) {
  const runs = ENGINES.map(engine => state.runs[engine]).filter(run => run?.key === key);
  state.result = {
    sourceRecord: sourceRecordInfo(),
    evaluations: Object.fromEntries(runs.map(run => [run.engine, run.raw])),
  };
  renderEvaluation(runs);
  dom.downloadResult.classList.remove('hidden');
}

function batchKey() {
  return state.records.map(record => record.id).join('|');
}

async function runBatchEvaluation() {
  if (!state.records.length) return;
  const batchRecords = state.records.slice(0, activeDataset()?.maxBatch ?? state.records.length);
  const key = batchKey();
  dom.runBatch.disabled = true;
  dom.loadDataset.disabled = true;
  setMessage(dom.datasetMessage, `Jev valuta ${batchRecords.length} record in sequenza…`);
  try {
    const result = await api('/api/evaluate-batch', {
      method: 'POST',
      body: JSON.stringify({
        cases: batchRecords.map(record => ({
          id: record.id,
          title: record.title,
          sourceUrl: record.sourceUrl,
          state: record.state,
          questions: record.questions,
          expected: record.expected,
        })),
      }),
    });
    state.batches.jev = { engine: 'jev', label: 'Jev', key, result };
    showBatch();
    setMessage(dom.datasetMessage, `Batch Jev completato: ${result.summary.caseCount} record.`);
  } catch (error) {
    setMessage(dom.datasetMessage, error.message, true);
  } finally {
    dom.runBatch.disabled = false;
    dom.loadDataset.disabled = false;
  }
}

// SemIf è gratuito e locale: valuta tutti i record caricati, senza il limite del batch Jev.
async function runSemifBatch() {
  const model = semif.model;
  if (!model || !state.records.length) return;
  const records = [...state.records];
  const key = batchKey();
  const cases = [];
  let checkpoint = null;
  state.semifBusy = true;
  updateSemifButtons();
  dom.loadDataset.disabled = true;
  try {
    for (const [index, record] of records.entries()) {
      setMessage(dom.datasetMessage, `${semifLabel(model)}: record ${index + 1} di ${records.length}…`);
      const run = await semif.evaluate({ state: record.state, questions: record.questions, recordId: record.id });
      cases.push({
        id: record.id,
        title: record.title,
        sourceUrl: record.sourceUrl,
        durationMs: run.durationMs,
        answers: run.answers,
        skipped: run.skipped,
        comparisons: compareWithExpected(run.answers, record.expected),
      });
      checkpoint = run.checkpoint ?? checkpoint;
    }
    state.batches.semif = {
      engine: 'semif',
      label: semifLabel(model),
      key,
      result: {
        engine: 'semif',
        model: model.name,
        checkpoint,
        privacyMode: 'Su questo computer, nessun invio',
        summary: summarizeBatch(cases),
        cases,
      },
    };
    showBatch();
    setMessage(dom.datasetMessage, `Batch SemIf completato: ${cases.length} record, nessun dato uscito dal computer.`);
  } catch (error) {
    setMessage(dom.datasetMessage, error.message, true);
  } finally {
    state.semifBusy = false;
    dom.loadDataset.disabled = false;
    updateSemifButtons();
  }
}

function showBatch() {
  const key = batchKey();
  const batches = ENGINES.map(engine => state.batches[engine]).filter(batch => batch?.key === key);
  state.result = {
    datasetId: dom.datasetSelect.value,
    batches: Object.fromEntries(batches.map(batch => [batch.engine, batch.result])),
  };
  renderBatchResults(batches);
  dom.downloadResult.classList.remove('hidden');
}

function addStat(label, value) {
  const card = create('div', 'stat');
  card.append(create('span', '', label), create('strong', '', value));
  dom.runStats.append(card);
}

function topKey(probabilities = {}) {
  return Object.entries(probabilities).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] ?? null;
}

function probabilityRows(probabilities) {
  const fragment = document.createDocumentFragment();
  for (const [label, rawValue] of Object.entries(probabilities ?? {}).sort((a, b) => Number(b[1]) - Number(a[1]))) {
    const value = Math.max(0, Math.min(1, Number(rawValue) || 0));
    const row = create('div', 'prob-row');
    const labelNode = create('span', 'prob-label', label);
    const track = create('progress', 'prob-track');
    track.max = 1;
    track.value = value;
    row.append(labelNode, track, create('span', 'prob-value', formatPercent(value)));
    fragment.append(row);
  }
  return fragment;
}

function matchesExpected(predicted, expected) {
  if (Array.isArray(expected)) return expected.some(value => String(value) === String(predicted));
  return String(predicted) === String(expected);
}

function renderExpected(target, questionId, predicted) {
  const expected = state.selectedRecord?.expected?.[questionId];
  if (expected === undefined || expected === null) return;
  if (Array.isArray(expected) && !expected.length) return;
  const match = matchesExpected(predicted, expected);
  const box = create('div', `expected-box ${match ? 'match' : 'mismatch'}`);
  box.append(
    create('strong', '', match ? 'Corrisponde al riferimento' : 'Differisce dal riferimento'),
    document.createElement('br'),
    document.createTextNode(`Etichetta normalizzata: ${formatValue(expected)}`),
  );
  target.append(box);
}

function appendMeaning(target, description) {
  if (description) target.append(create('p', 'answer-meaning', description));
}

function renderAnswer(target, questionId, question, summary, runCount) {
  if (summary.type === 'boolean') {
    const probability = summary.averageProbability === null || summary.averageProbability === undefined
      ? Number.NaN
      : Number(summary.averageProbability);
    if (!Number.isFinite(probability)) {
      target.append(create('p', 'headline-answer', 'n/d'));
      return;
    }
    // Entrambi i motori restituiscono P(sì): il titolo mostra la risposta più probabile e la sua probabilità.
    const answer = probability >= 0.5;
    target.append(create('p', 'headline-answer', `${answer ? 'Sì' : 'No'} · ${formatPercent(answer ? probability : 1 - probability)}`));
    appendMeaning(target, question.criteria?.[String(answer)]);
    target.append(probabilityRows({ sì: probability, no: 1 - probability }));
    renderExpected(target, questionId, answer);
    return;
  }

  if (summary.type === 'choice') {
    const predicted = topKey(summary.averageProbabilities);
    const selectedText = runCount > 1
      ? Object.entries(summary.selected ?? {}).map(([key, count]) => `${key} ${count}/${runCount}`).join(' · ')
      : '';
    target.append(create('p', 'headline-answer', predicted || 'n/d'));
    appendMeaning(target, question.criteria?.[predicted]);
    if (selectedText) target.append(create('p', 'message', `Scelte: ${selectedText}`));
    target.append(probabilityRows(summary.averageProbabilities));
    renderExpected(target, questionId, predicted);
    return;
  }

  if (summary.type === 'score') {
    // Il punteggio è la media pesata dei livelli: la descrizione mostrata è quella del livello più probabile.
    const levels = question.criteria?.length;
    const likeliestLevel = topKey(summary.averageProbabilities);
    target.append(create('p', 'headline-answer', `${formatNumber(summary.averageScore, 2)}${levels ? ` su ${levels - 1}` : ''}`));
    const levelDescription = likeliestLevel === null ? null : question.criteria?.[Number(likeliestLevel)];
    if (levelDescription) appendMeaning(target, `Livello più probabile: ${likeliestLevel} · ${levelDescription}`);
    target.append(probabilityRows(summary.averageProbabilities));
    return;
  }

  target.append(create('p', '', 'Formato non riconosciuto.'));
}

function renderQuestionCard(questionId, question, runs) {
  const card = create('article', 'answer-card');
  const header = create('header');
  header.append(create('h3', '', humanize(questionId)), create('span', 'type-tag', questionTypeLabel(question)));
  card.append(header);
  if (question.instructions) card.append(create('p', 'question-instructions', question.instructions));

  const columns = create('div', 'engine-columns');
  for (const run of runs) {
    const column = create('section', `engine-column ${run.engine}`);
    column.append(create('p', 'engine-label', run.label));
    const summary = run.summary.questions[questionId];
    if (run.skipped?.[questionId]) column.append(create('p', 'message', run.skipped[questionId]));
    else if (!summary) column.append(create('p', 'message', 'Nessuna risposta per questa domanda.'));
    else renderAnswer(column, questionId, question, summary, run.summary.runCount);
    columns.append(column);
  }
  card.append(columns);
  return card;
}

function renderEvaluation(runs) {
  dom.runStats.replaceChildren();
  for (const run of runs) {
    for (const [label, value] of run.stats) addStat(`${run.label} · ${label}`, value);
  }

  dom.answerCards.className = `answer-grid${runs.length > 1 ? ' compare' : ''}`;
  dom.answerCards.replaceChildren();
  for (const [questionId, question] of Object.entries(runs.at(-1).questions)) {
    dom.answerCards.append(renderQuestionCard(questionId, question && typeof question === 'object' ? question : {}, runs));
  }

  dom.rawOutput.textContent = JSON.stringify(state.result, null, 2);
  dom.rawDetails.classList.remove('hidden');
}

function renderAccuracyTable(batches) {
  const card = create('article', 'answer-card wide');
  const header = create('header');
  header.append(create('h3', '', 'Accuratezza per domanda'), create('span', 'type-tag', 'solo domande con riferimento'));
  card.append(header);

  const questionIds = [...new Set(batches.flatMap(batch => Object.keys(batch.result.summary.perQuestion ?? {})))];
  if (!questionIds.length) {
    card.append(create('p', 'message', 'Nessuna domanda con etichetta ufficiale in questo batch.'));
    return card;
  }
  const table = create('table', 'accuracy-table');
  const headRow = create('tr');
  headRow.append(create('th', '', 'Domanda'), ...batches.map(batch => create('th', '', batch.label)));
  const head = create('thead');
  head.append(headRow);
  const body = create('tbody');
  for (const questionId of questionIds) {
    const row = create('tr');
    row.append(create('td', '', humanize(questionId)));
    for (const batch of batches) {
      const bucket = batch.result.summary.perQuestion?.[questionId];
      row.append(create('td', '', bucket ? `${formatPercent(bucket.accuracy)} · ${bucket.correct}/${bucket.total}` : 'n/d'));
    }
    body.append(row);
  }
  table.append(head, body);
  card.append(table);
  if (new Set(batches.map(batch => batch.result.summary.caseCount)).size > 1) {
    card.append(create('p', 'message', 'I due motori hanno valutato un numero diverso di record: Jev si ferma al limite del batch, SemIf li valuta tutti. Per un confronto alla pari guardate i record valutati da entrambi.'));
  }
  return card;
}

function renderBatchResults(batches) {
  dom.runStats.replaceChildren();
  for (const { label, result } of batches) {
    const { summary } = result;
    addStat(`${label} · record`, String(summary.caseCount));
    addStat(`${label} · accuratezza`, summary.accuracy === null ? 'n/d' : `${formatPercent(summary.accuracy)} (${summary.correctJudgments}/${summary.comparableJudgments})`);
    addStat(`${label} · latenza media`, `${formatNumber(summary.averageLatencyMs, 1)} ms`);
  }

  dom.answerCards.className = 'answer-grid';
  dom.answerCards.replaceChildren();
  dom.answerCards.append(renderAccuracyTable(batches));

  for (const record of state.records) {
    const evaluated = batches
      .map(batch => ({ batch, item: batch.result.cases.find(item => item.id === record.id) }))
      .filter(entry => entry.item);
    if (!evaluated.length) continue;

    const card = create('article', 'answer-card');
    const header = create('header');
    header.append(create('h3', '', record.title));
    card.append(header);
    for (const { batch, item } of evaluated) {
      const block = create('section', `engine-column ${batch.engine}`);
      block.append(create('p', 'engine-label', `${batch.label} · ${formatNumber(item.durationMs, 1)} ms`));
      if (!item.comparisons.length) block.append(create('p', 'message', 'Nessuna etichetta confrontabile per questo record.'));
      for (const comparison of item.comparisons) {
        const box = create('div', `expected-box ${comparison.match ? 'match' : 'mismatch'}`);
        const confidence = comparison.confidence === undefined ? '' : ` (${formatPercent(comparison.confidence)})`;
        box.append(
          create('strong', '', `${humanize(comparison.questionId)}: ${comparison.match ? 'match' : 'mismatch'}`),
          document.createElement('br'),
          document.createTextNode(`Risposta: ${formatValue(comparison.predicted)}${confidence} · riferimento: ${formatValue(comparison.expected)}`),
        );
        block.append(box);
      }
      card.append(block);
    }
    dom.answerCards.append(card);
  }

  dom.rawOutput.textContent = JSON.stringify(state.result, null, 2);
  dom.rawDetails.classList.remove('hidden');
}

function setSemifStatus(text, kind) {
  dom.semifStatus.textContent = text;
  dom.semifStatus.className = `status-chip ${kind}`;
}

function updateSemifButtons() {
  const ready = Boolean(semif.model) && !state.semifBusy;
  dom.runSemif.disabled = !ready;
  dom.runSemifBatch.disabled = !ready || !state.records.length;
  dom.runSemif.textContent = semif.model ? `Chiedi a SemIf · ${semif.model.name}` : 'Chiedi a SemIf';
}

function syncSemifLoadButton() {
  const selected = semif.models[dom.semifModel.value];
  const loaded = semif.model?.id === dom.semifModel.value;
  dom.semifLoad.textContent = loaded ? 'Modello pronto' : selected ? `Carica ${selected.name}` : 'Carica modello';
  dom.semifLoad.disabled = loaded || state.semifBusy || !state.semifAvailable || !selected;
}

function formatBytes(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2).replace('.', ',')} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function renderSemifProgress(event) {
  if (event.phase === 'loading') {
    dom.semifProgress.removeAttribute('value');
    setMessage(dom.semifDetail, 'Pesi pronti. SemIf carica il modello e verifica il tokenizer…');
    return;
  }
  if (!event.total) return;
  dom.semifProgress.value = event.loaded / event.total;
  setMessage(dom.semifDetail, `Download da Hugging Face: ${Math.round((event.loaded / event.total) * 100)}% di ${formatBytes(event.total)}.`);
}

async function loadSemifModel() {
  const modelId = dom.semifModel.value;
  const model = semif.models[modelId];
  state.semifBusy = true;
  dom.semifModel.disabled = true;
  syncSemifLoadButton();
  updateSemifButtons();
  dom.semifProgress.classList.remove('hidden');
  dom.semifProgress.value = 0;
  setSemifStatus(`Carico ${model.name}…`, 'pending');
  setMessage(dom.semifDetail, `Primo caricamento: ${model.size} da Hugging Face, poi il file resta nella cache locale del lab.`);
  try {
    const result = await semif.load(modelId);
    setSemifStatus(`${model.name} pronto`, 'ok');
    setMessage(dom.semifDetail, result.loadMs
      ? `Caricato in ${formatNumber(result.loadMs / 1000, 1)} s. Le domande restano su questo computer.`
      : 'Modello già caricato.');
  } catch (error) {
    setSemifStatus('Caricamento non riuscito', 'error');
    setMessage(dom.semifDetail, error.message, true);
  } finally {
    state.semifBusy = false;
    dom.semifModel.disabled = false;
    dom.semifProgress.classList.add('hidden');
    syncSemifLoadButton();
    updateSemifButtons();
  }
}

function semifUnavailableMessage(status) {
  if (!status.reachable) return `${status.error} Avviate il lab con npm start dopo aver installato SemIf.`;
  return `Il sidecar gira, ma SemIf non è installato nel suo Python: ${status.importError}`;
}

async function initSemif() {
  let status;
  try {
    status = await semif.refresh();
  } catch (error) {
    status = { reachable: false, error: error.message };
  }
  dom.semifModel.replaceChildren();
  for (const [id, model] of Object.entries(semif.models)) {
    const option = create('option', '', `${model.name} · ${model.size}`);
    option.value = id;
    dom.semifModel.append(option);
  }
  dom.semifModel.value = semif.model?.id ?? status.defaultModel ?? '';
  state.semifAvailable = Boolean(status.reachable && status.installed);
  if (!state.semifAvailable) {
    setSemifStatus('SemIf non disponibile', 'error');
    setMessage(dom.semifDetail, semifUnavailableMessage(status), true);
  } else if (semif.model) {
    setSemifStatus(`${semif.model.name} pronto`, 'ok');
    setMessage(dom.semifDetail, 'Modello già in memoria nel sidecar. Le domande restano su questo computer.');
  } else {
    setSemifStatus('SemIf pronto', 'ok');
    setMessage(dom.semifDetail, `Sidecar attivo, lettura ${status.mode === 'serial' ? 'con lo state riusato fra le domande' : 'diretta, una per domanda'}. Il modello si scarica solo quando premete Carica.`);
  }
  syncSemifLoadButton();
  updateSemifButtons();
}

function downloadResult() {
  if (!state.result) return;
  const blob = new Blob([`${JSON.stringify(state.result, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `jev-result-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatQuestions() {
  try {
    dom.questionsInput.value = JSON.stringify(JSON.parse(dom.questionsInput.value), null, 2);
    setMessage(dom.runMessage, 'Questions JSON formattato.');
  } catch {
    setMessage(dom.runMessage, 'Questions non è JSON valido.', true);
  }
}

dom.datasetSelect.addEventListener('change', renderDatasetMeta);
dom.loadDataset.addEventListener('click', fetchPublicRecords);
dom.runBatch.addEventListener('click', runBatchEvaluation);
dom.runEvaluation.addEventListener('click', runEvaluation);
dom.runSemif.addEventListener('click', runSemifEvaluation);
dom.runSemifBatch.addEventListener('click', runSemifBatch);
dom.semifLoad.addEventListener('click', loadSemifModel);
dom.semifModel.addEventListener('change', syncSemifLoadButton);
dom.formatJson.addEventListener('click', formatQuestions);
dom.toggleQuestionsView.addEventListener('click', () => {
  setQuestionsView(dom.toggleQuestionsView.dataset.view === 'readable' ? 'json' : 'readable');
});
dom.downloadResult.addEventListener('click', downloadResult);

setQuestionsView('readable');

await Promise.all([loadHealth(), loadCatalog(), initSemif()]);
