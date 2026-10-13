import { hoursSince } from './util.mjs';

// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------

/** Items per section in the briefing and digest. */
export const QUOTAS = { world: 6, models: 5, repos: 5, research: 5, discussion: 6, ai_news: 6, tech: 4 };

/** How many candidates per category are sent to trend analysis. */
const TREND_POOL = { discussion: 50, repos: 50, models: 50, research: 30, ai_news: 40, tech: 20 };

/** Max age (hours) for news-style items; API sources are already time-bounded. */
const MAX_AGE_HOURS = { world: 36, tech: 48, ai_news: 96 };

/** Max items from one feed within a news section, so a single busy feed can't crowd out the rest. */
const MAX_PER_SOURCE = 2;
const NEWS_CATEGORIES = new Set(Object.keys(MAX_AGE_HOURS));

/** Word-boundary match, so "said", "Ukraine" and "Taiwan" don't count as AI. Fallback when Gemini tagging fails. */
export const AI_PATTERN = /\b(ai|a\.i\.|llms?|gpt[\w.-]*|genai|agents?|agentic|chatbots?|copilot|machine learning|deep learning|neural|transformers?|diffusion|inference|fine-?tun\w*|embeddings?|multimodal|reasoning|benchmarks?|openai|anthropic|claude|gemini|deepmind|mistral|llama|qwen|deepseek|hugging ?face|nvidia|gpus?|models?|rag|mcp|vlm|tts|asr)\b/i;

// ------------------------------------------------------------------
// SCORING
// ------------------------------------------------------------------

const log10p = (n) => Math.log10(1 + Math.max(0, n ?? 0));

function score(item) {
  const m = item.metrics ?? {};
  switch (item.category) {
    case 'discussion': return log10p(m.points) + 0.3 * log10p(m.comments);
    case 'repos':      return log10p(m.starsPerDay);
    case 'models':     return log10p(m.trending);
    case 'research':   return log10p(m.upvotes);
    default: {
      // News feeds: source weight + recency bonus (as in v1) + small AI bonus for tech stories
      const hours = hoursSince(item.published);
      const recency = Number.isFinite(hours) && hours > 0 ? 0.25 * Math.exp(-hours / 36) : 0;
      const aiBonus = item.category === 'tech' && AI_PATTERN.test(item.title) ? 0.05 : 0;
      return (item.weight ?? 0.75) + recency + aiBonus;
    }
  }
}

const normalizeTitle = (title) => title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// ------------------------------------------------------------------
// CURATION
// ------------------------------------------------------------------

/**
 * Filters stale items, deduplicates, scores and groups by category (best first).
 * Assigns each item a numeric `id` used by trend analysis.
 */
export function prepareCandidates(items) {
  const seen = new Set();
  const byCategory = {};
  let nextId = 1;

  const fresh = items
    .filter(item => {
      const maxAge = MAX_AGE_HOURS[item.category];
      return !maxAge || hoursSince(item.published) <= maxAge;
    })
    .map(item => ({ ...item, score: score(item) }))
    .sort((a, b) => b.score - a.score);

  for (const item of fresh) {
    const key = normalizeTitle(item.title) || item.link;
    if (seen.has(key) || seen.has(item.link)) continue;
    seen.add(key);
    seen.add(item.link);
    item.id = nextId++;
    (byCategory[item.category] ??= []).push(item);
  }
  return byCategory;
}

/** The subset of candidates worth tagging for AI entities (everything except world news). */
export function trendPool(candidates) {
  return Object.entries(TREND_POOL).flatMap(([category, n]) => (candidates[category] ?? []).slice(0, n));
}

/**
 * Picks the final items per section.
 * - `isAI(item)` filters HN stories and GitHub repos down to AI-related ones
 * - `excludeLinks` are already covered elsewhere (e.g. in the Emerging section)
 * - `shown` (link -> date) suppresses items already sent on a previous day
 */
export function selectSections(candidates, { isAI, excludeLinks = new Set(), shown = {}, today }) {
  const sections = {};
  for (const [category, quota] of Object.entries(QUOTAS)) {
    const perSource = {};
    sections[category] = [];
    for (const item of candidates[category] ?? []) {
      if (sections[category].length >= quota) break;
      if (excludeLinks.has(item.link)) continue;
      if (shown[item.link] && shown[item.link] < today) continue;
      if ((category === 'discussion' || category === 'repos') && !isAI(item)) continue;
      if (category === 'models' && item.derivative) continue;
      if (NEWS_CATEGORIES.has(category) && (perSource[item.source] ?? 0) >= MAX_PER_SOURCE) continue;
      perSource[item.source] = (perSource[item.source] ?? 0) + 1;
      sections[category].push(item);
    }
  }
  return sections;
}
