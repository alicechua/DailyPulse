import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateJson } from './llm.mjs';
import { sourceLabel } from './sources.mjs';
import { DAY_MS, daysAgo, isoDate, truncate } from './util.mjs';

// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------

const HISTORY_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/trend-history.json');

const NEW_WITHIN_DAYS = 2;    // "new" = first seen today or in the previous 2 days
const BASELINE_DAYS = 14;     // window for the "spiking" comparison
const KEEP_DAYS = 30;         // per-entity daily counts kept this long
const FORGET_AFTER_DAYS = 90; // entities unseen this long are dropped
const KEEP_SHOWN_DAYS = 21;   // links already sent are suppressed this long
const WARMUP_RUNS = 3;        // runs of history needed before "new" means anything
const MAX_EMERGING = 5;

// ------------------------------------------------------------------
// ENTITY EXTRACTION (LLM)
// ------------------------------------------------------------------

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          ai: { type: 'boolean' },
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: { type: 'string', enum: ['model', 'method', 'product', 'library', 'dataset', 'company'] },
                gist: { type: 'string' },
              },
              required: ['name', 'type', 'gist'],
            },
          },
        },
        required: ['id', 'ai', 'entities'],
      },
    },
  },
  required: ['items'],
};

function extractionPrompt(items) {
  const lines = items.map(item =>
    `[${item.id}] (${sourceLabel(item.source)}) ${item.title}${item.description ? ` — ${truncate(item.description, 220)}` : ''}`);

  return `You are tagging today's tech and AI items so a script can detect emerging AI trends.

For EVERY item below, return its id and:
- ai: true if the item is about AI/ML (models, research, AI tools, AI companies, AI policy), else false.
- entities: the specific, named AI things the item is about or built on. Types:
  model (e.g. "Qwen3.8", "Jev"), method (a named technique, e.g. "speculative decoding", "GRPO"),
  product (an app or tool, e.g. "Claude Code"), library (e.g. "vLLM"), dataset (incl. benchmarks),
  company (only when the company itself is the news, e.g. a new startup or a funding round).

Rules:
- Canonical names: drop owner prefixes, parameter counts, quantization and file-format suffixes, but keep the version.
  "unsloth/Qwen3.8-27B-GGUF" -> "Qwen3.8"; "Qwen-Image-2.1-Uncensored" -> "Qwen-Image-2.1". Spell the same thing the same way across items.
- A fine-tune, quantization, port or integration counts as a mention of what it is built on (a repo "jev-chat" -> "Jev").
- Skip generic concepts (AI, LLM, agents, chatbot, transformer, open source) and big tech companies mentioned only in passing.
- gist: at most 12 words on what the entity is, based only on the item. Use "" if unclear.
- At most 4 entities per item. Non-AI items get ai=false and no entities.

Items:
${lines.join('\n')}`;
}

/**
 * Tags items with an AI flag and the entities they mention.
 * Returns Map(id -> { ai, entities: [{ name, type, gist }] }).
 */
export async function extractEntities(ai, items) {
  const result = await generateJson(ai, extractionPrompt(items), EXTRACTION_SCHEMA, { label: 'Trend analysis' });
  return new Map((result.items ?? []).map(tag => [tag.id, tag]));
}

// ------------------------------------------------------------------
// AGGREGATION
// ------------------------------------------------------------------

/** Same thing, different spelling: "Qwen 3.8" / "qwen3.8" / "Qwen-3.8" -> "qwen3.8" */
const entityKey = (name) => name.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}.]/gu, '').replace(/\.+$/, '');

/** Rough attention score of one item, comparable across sources. */
function engagement(item) {
  const m = item.metrics;
  if (!m) return 0.5; // news/blog post
  return (m.points ?? 0) / 100 + (m.starsPerDay ?? 0) / 300 + (m.trending ?? 0) / 300 + (m.upvotes ?? 0) / 50;
}

const mostCommon = (values) => {
  const counts = new Map();
  for (const v of values.filter(Boolean)) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? '';
};

/** Groups today's tagged items by entity. */
export function aggregateEntities(items, tags) {
  const groups = new Map();
  for (const item of items) {
    const tag = tags.get(item.id);
    if (!tag?.ai) continue;
    const seenInItem = new Set();
    for (const entity of tag.entities ?? []) {
      const key = entityKey(entity.name ?? '');
      if (!key || seenInItem.has(key)) continue;
      seenInItem.add(key);
      const group = groups.get(key) ?? { key, names: [], types: [], gists: [], sources: new Set(), items: [], engagement: 0 };
      group.names.push(entity.name.trim());
      group.types.push(entity.type);
      group.gists.push(entity.gist?.trim());
      group.sources.add(item.source);
      group.items.push(item);
      group.engagement += engagement(item);
      groups.set(key, group);
    }
  }

  for (const group of groups.values()) {
    group.name = mostCommon(group.names.filter(n => n !== n.toLowerCase())) || mostCommon(group.names); // "Jev" over "jev"
    group.type = mostCommon(group.types);
    group.gist = mostCommon(group.gists);
    group.mentions = group.items.length;
    group.items.sort((a, b) => engagement(b) - engagement(a));
  }
  return groups;
}

// ------------------------------------------------------------------
// HISTORY
// ------------------------------------------------------------------

export function loadHistory() {
  try {
    const history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    return { runs: [], entities: {}, shown: {}, ...history };
  } catch {
    return { version: 1, runs: [], entities: {}, shown: {} };
  }
}

/** One entity per line keeps the daily commits readable as diffs. */
export function saveHistory(history) {
  const entityLines = Object.keys(history.entities).sort()
    .map(key => `    ${JSON.stringify(key)}: ${JSON.stringify(history.entities[key])}`);
  const shownLines = Object.keys(history.shown).sort()
    .map(link => `    ${JSON.stringify(link)}: ${JSON.stringify(history.shown[link])}`);

  const json = [
    '{',
    `  "version": 1,`,
    `  "updated": ${JSON.stringify(new Date().toISOString())},`,
    `  "runs": ${JSON.stringify(history.runs)},`,
    `  "entities": {${entityLines.length ? `\n${entityLines.join(',\n')}\n  ` : ''}},`,
    `  "shown": {${shownLines.length ? `\n${shownLines.join(',\n')}\n  ` : ''}}`,
    '}',
  ].join('\n');

  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, `${json}\n`);
}

/**
 * Finds entities that are new or spiking AND have independent confirmation
 * (2+ sources, or 4+ mentions). Must run before `recordDay` for the same date.
 */
export function detectEmerging(history, groups, today) {
  const priorRuns = history.runs.filter(d => d < today);
  const warmingUp = priorRuns.length < WARMUP_RUNS;
  const baselineStart = isoDate(daysAgo(BASELINE_DAYS, new Date(today)));
  const baselineRuns = priorRuns.filter(d => d >= baselineStart).length;

  const emerging = [];
  for (const group of groups.values()) {
    if (group.sources.size < 2 && group.mentions < 4) continue;

    const past = history.entities[group.key];
    const firstSeen = past && past.first < today ? past.first : today;
    const isNew = (Date.parse(today) - Date.parse(firstSeen)) / DAY_MS <= NEW_WITHIN_DAYS;

    const priorMentions = Object.entries(past?.days ?? {})
      .filter(([d]) => d < today && d >= baselineStart)
      .reduce((sum, [, [mentions]]) => sum + mentions, 0);
    const baseline = baselineRuns ? priorMentions / baselineRuns : 0;
    const spiking = !isNew && group.mentions >= Math.max(3, 2 * baseline);

    if (!isNew && !spiking) continue;
    emerging.push({
      ...group,
      firstSeen,
      isNew,
      spiking,
      score: 2 * group.sources.size + Math.log2(1 + group.mentions) + Math.log2(1 + group.engagement) + (isNew ? 1 : 0),
    });
  }

  emerging.sort((a, b) => b.score - a.score);
  return { warmingUp, emerging: emerging.slice(0, MAX_EMERGING) };
}

/** Records today's entity counts. Idempotent: re-running on the same day replaces that day's data. */
export function recordDay(history, groups, today) {
  for (const [key, entity] of Object.entries(history.entities)) {
    delete entity.days[today];
    if (entity.first === today) delete history.entities[key];
  }

  for (const group of groups.values()) {
    const entity = history.entities[group.key] ??= { name: group.name, type: group.type, first: today, days: {} };
    entity.name = group.name;
    entity.type = group.type;
    if (group.gist) entity.gist = group.gist;
    entity.last = today;
    entity.days[today] = [group.mentions, group.sources.size];
  }

  // Prune old data
  const keepFrom = isoDate(daysAgo(KEEP_DAYS, new Date(today)));
  const forgetBefore = isoDate(daysAgo(FORGET_AFTER_DAYS, new Date(today)));
  for (const [key, entity] of Object.entries(history.entities)) {
    for (const d of Object.keys(entity.days)) if (d < keepFrom) delete entity.days[d];
    entity.last = Object.keys(entity.days).sort().pop() ?? entity.last;
    if (!entity.last || entity.last < forgetBefore) delete history.entities[key];
  }

  history.runs = [...new Set([...history.runs, today])].sort().slice(-KEEP_DAYS);
}

/** Remembers which links were sent, so tomorrow's briefing doesn't repeat them. */
export function recordShown(history, links, today) {
  for (const link of links) history.shown[link] ??= today;
  const keepFrom = isoDate(daysAgo(KEEP_SHOWN_DAYS, new Date(today)));
  for (const [link, date] of Object.entries(history.shown)) if (date < keepFrom) delete history.shown[link];
}
