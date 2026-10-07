// Strumenti condivisi dagli adattatori delle fonti.

const REQUEST_TIMEOUT_MS = 25_000;

function publicDataUserAgent() {
  if (typeof process !== 'undefined' && process?.env?.PUBLIC_DATA_USER_AGENT) {
    return process.env.PUBLIC_DATA_USER_AGENT;
  }
  return 'AI-MAX-Jev-Lab/0.1 public-data-research';
}

export function truncate(value, length = 5_000) {
  const text = String(value ?? '').trim();
  return text.length <= length ? text : `${text.slice(0, length)}…`;
}

export function firstNonEmpty(items, fallback = '') {
  for (const item of items ?? []) {
    const value = typeof item === 'string' ? item : item?.Name ?? item?.Option;
    if (String(value ?? '').trim()) return String(value).trim();
  }
  return fallback;
}

export async function fetchJson(url, { allowNotFound = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': publicDataUserAgent(),
      },
    });
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) throw new Error(`Fonte pubblica non disponibile: HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJsonPost(url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': publicDataUserAgent(),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = truncate(await response.text(), 500);
      throw new Error(`Fonte pubblica non disponibile: HTTP ${response.status}${detail ? ` · ${detail}` : ''}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/xml, text/xml;q=0.9, */*;q=0.1',
        'User-Agent': publicDataUserAgent(),
      },
    });
    if (!response.ok) throw new Error(`Fonte pubblica non disponibile: HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function mixedSample(primary, secondary, limit, secondaryShare) {
  let secondaryCount = Math.min(secondary.length, Math.round(limit * secondaryShare));
  const primaryCount = Math.min(primary.length, limit - secondaryCount);
  secondaryCount = Math.min(secondary.length, limit - primaryCount);
  return shuffle([
    ...shuffle(primary).slice(0, primaryCount),
    ...shuffle(secondary).slice(0, secondaryCount),
  ]);
}

export function matchesQuery(text, query) {
  return !query || String(text ?? '').toLowerCase().includes(query.toLowerCase());
}

export function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function isoDateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
