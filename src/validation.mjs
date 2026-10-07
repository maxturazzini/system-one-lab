const LIMITS = {
  maxStateChars: 120_000,
  maxQuestions: 32,
  maxInstructionChars: 2_000,
  maxRepetitions: 5,
};

function assert(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
}

function serializedLength(value) {
  if (typeof value === 'string') return value.length;
  return JSON.stringify(value).length;
}

function validateBooleanCriteria(criteria, id) {
  if (criteria === undefined) return;
  assert(criteria && typeof criteria === 'object' && !Array.isArray(criteria), `${id}: criteria deve essere un oggetto.`);
  assert(typeof criteria.true === 'string', `${id}: criteria.true deve essere una stringa.`);
  assert(typeof criteria.false === 'string', `${id}: criteria.false deve essere una stringa.`);
}

function validateChoiceCriteria(criteria, id) {
  assert(criteria && typeof criteria === 'object' && !Array.isArray(criteria), `${id}: Choice richiede criteria come oggetto.`);
  const entries = Object.entries(criteria);
  assert(entries.length >= 2 && entries.length <= 255, `${id}: Choice richiede da 2 a 255 opzioni.`);
  for (const [key, description] of entries) {
    assert(key.length > 0 && typeof description === 'string' && description.length > 0, `${id}: ogni opzione deve avere chiave e descrizione.`);
  }
}

function validateScoreCriteria(criteria, id) {
  assert(Array.isArray(criteria), `${id}: Score richiede criteria come array.`);
  assert(criteria.length >= 2 && criteria.length <= 10, `${id}: Score richiede da 2 a 10 livelli.`);
  assert(criteria.every(item => typeof item === 'string' && item.length > 0), `${id}: ogni livello deve essere una stringa.`);
}

export function normalizeEvaluationRequest(payload) {
  assert(payload && typeof payload === 'object', 'Body JSON mancante.');
  const { state, questions } = payload;
  const repetitions = Number(payload.repetitions ?? 1);

  assert(state !== undefined && state !== null, 'state è obbligatorio.');
  assert(['string', 'object'].includes(typeof state), 'state deve essere testo, oggetto o array JSON.');
  assert(serializedLength(state) <= LIMITS.maxStateChars, `state supera ${LIMITS.maxStateChars} caratteri.`);
  assert(questions && typeof questions === 'object' && !Array.isArray(questions), 'questions deve essere un oggetto.');

  const entries = Object.entries(questions);
  assert(entries.length >= 1 && entries.length <= LIMITS.maxQuestions, `Sono ammesse da 1 a ${LIMITS.maxQuestions} domande.`);
  assert(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= LIMITS.maxRepetitions, `repetitions deve essere fra 1 e ${LIMITS.maxRepetitions}.`);

  for (const [id, question] of entries) {
    assert(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(id), `ID domanda non valido: ${id}`);
    assert(question && typeof question === 'object', `${id}: domanda non valida.`);
    assert(['boolean', 'choice', 'score'].includes(question.type), `${id}: type deve essere boolean, choice o score.`);
    assert(typeof question.instructions === 'string' && question.instructions.length > 0, `${id}: instructions è obbligatorio.`);
    assert(question.instructions.length <= LIMITS.maxInstructionChars, `${id}: instructions è troppo lungo.`);

    if (question.type === 'boolean') validateBooleanCriteria(question.criteria, id);
    if (question.type === 'choice') validateChoiceCriteria(question.criteria, id);
    if (question.type === 'score') validateScoreCriteria(question.criteria, id);
  }

  return { state, questions, repetitions };
}

export function parseStateInput(raw) {
  const text = String(raw ?? '').trim();
  assert(text.length > 0, 'Inserite uno state.');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export { LIMITS };
