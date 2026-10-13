import process from 'node:process';

export const DAY_MS = 24 * 60 * 60 * 1000;

const USER_AGENT = 'DailyPulse/2.0 (+https://github.com/alicechua/DailyPulse)';

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** YYYY-MM-DD (UTC) */
export const isoDate = (date = new Date()) => date.toISOString().slice(0, 10);

export const daysAgo = (n, from = new Date()) => new Date(from.getTime() - n * DAY_MS);

export function hoursSince(dateLike) {
  const t = new Date(dateLike).getTime();
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / (60 * 60 * 1000);
}

/**
 * Retries an async operation with exponential backoff on transient errors
 * (429, 5xx, "overloaded", network resets). Anything else is thrown immediately.
 */
export async function retryWithBackoff(operation, { retries = 5, initialDelay = 5000, label = 'Request' } = {}) {
  let delay = initialDelay;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const status = error.status || error?.response?.status;
      const transient = status === 429 || status >= 500 ||
        /overloaded|unavailable|ECONNRESET|ETIMEDOUT|fetch failed|aborted/i.test(error.message || '');
      if (!transient || attempt >= retries) throw error;
      console.warn(`⚠️  ${label} failed (${status || error.message}). Retrying in ${delay / 1000}s... (Attempt ${attempt}/${retries})`);
      await sleep(delay);
      delay *= 2;
    }
  }
}

export async function fetchText(url, { headers = {}, timeoutMs = 20000 } = {}) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) {
    const error = new Error(`HTTP ${resp.status}`);
    error.status = resp.status;
    throw error;
  }
  return resp.text();
}

export async function fetchJson(url, options) {
  return JSON.parse(await fetchText(url, options));
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(text = '') {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Removes HTML tags/entities and collapses whitespace. */
export function stripHtml(text = '') {
  return decodeEntities(String(text).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Escapes text for Telegram's HTML parse mode (also safe inside href="..."). */
export const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Compact number: 1234 -> 1.2k */
export function compact(n) {
  if (n == null) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

/** Loads a local .env file if present (local runs only; GitHub Actions uses secrets). */
export function loadDotEnv() {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file: rely on the environment
  }
}
