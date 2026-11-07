import { generateJson } from './llm.mjs';
import { sourceLabel } from './sources.mjs';
import { compact, truncate } from './util.mjs';

// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------

/**
 * Only big news is reported: a story needs at least this importance (1-10, see rankingPrompt) for its section,
 * otherwise it is left out of both the audio and the digest. Raise a section's bar to hear less from it.
 */
export const MIN_IMPORTANCE = {
  world:      7,
  emerging:   7,
  models:     7,
  repos:      7,
  discussion: 7,
  research:   7,
  ai_news:    7,
  tech:       7,
};

/** A quiet day still gets a briefing: the most important stories are reported even when below their bar. */
const MIN_STORIES = 3;

/** Of the stories reported, the audio covers the top ones in a few sentences each and name-drops the next. */
const HEADLINES = 5;
const MENTIONS = 6;

/** Sections, in the order the briefing walks through them. */
const SECTION_LABELS = {
  world:      'World news',
  emerging:   'Emerging in AI',
  models:     'Trending model (Hugging Face)',
  repos:      'Rising repo (GitHub, created this week)',
  discussion: 'AI on Hacker News',
  research:   'Paper (Hugging Face Daily Papers)',
  ai_news:    'AI labs, news & newsletters',
  tech:       'Tech & industry',
};
const SPEAKING_ORDER = Object.keys(SECTION_LABELS);

/** Used when the LLM ranking is unavailable: section priority, minus the story's position within its section. */
const SECTION_PRIORITY = { emerging: 8, world: 7, models: 6, discussion: 6, ai_news: 6, repos: 5, research: 5, tech: 4 };

// ------------------------------------------------------------------
// STORIES
// ------------------------------------------------------------------

function itemStats(item) {
  const m = item.metrics ?? {};
  return {
    discussion: `${m.points} points, ${m.comments} comments`,
    repos: `${compact(m.stars)} stars, +${compact(m.starsPerDay)}/day`,
    models: `trending score ${m.trending}, ${compact(m.likes)} likes`,
    research: `${m.upvotes} upvotes`,
  }[item.category];
}

function describeItem(item) {
  const stats = itemStats(item);
  const description = item.description ? `\n  ${truncate(item.description, item.category === 'research' ? 400 : 250)}` : '';
  return `[${sourceLabel(item.source)}] ${item.title}${stats ? ` (${stats})` : ''}${description}`;
}

function describeTrend(entity, warmingUp) {
  const status = warmingUp ? '' : entity.isNew ? `, new (first seen ${entity.firstSeen})` : ', spiking vs. its recent baseline';
  const sources = [...entity.sources].map(sourceLabel).join(', ');
  const refs = entity.items.slice(0, 4).map(item => {
    const stats = itemStats(item);
    return `    · [${sourceLabel(item.source)}] ${item.title}${stats ? ` (${stats})` : ''}`;
  });
  return `${entity.name} (${entity.type})${status}: ${entity.mentions} mentions across ${sources}${entity.gist ? `. Gist: ${entity.gist}` : ''}\n${refs.join('\n')}`;
}

/**
 * Everything in today's digest as one list of stories: emerging trends, then each section's items (best first).
 * Each story has a `key` (its id for the LLM), a `section`, its `position` in that section, the `trend` or `item`,
 * and `label` + `text` describing it for prompts.
 */
export function collectStories({ emerging, warmingUp, sections }) {
  const stories = emerging.map((trend, position) => ({
    key: `T${position + 1}`,
    section: 'emerging',
    position,
    trend,
    label: warmingUp ? 'Hot across AI sources' : SECTION_LABELS.emerging,
    text: describeTrend(trend, warmingUp),
  }));
  for (const [section, items] of Object.entries(sections)) {
    items.forEach((item, position) => stories.push({
      key: String(item.id),
      section,
      position,
      item,
      label: SECTION_LABELS[section],
      text: describeItem(item),
    }));
  }
  return stories;
}

// ------------------------------------------------------------------
// RANKING (LLM)
// ------------------------------------------------------------------

const RANKING_SCHEMA = {
  type: 'object',
  properties: {
    stories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          importance: { type: 'integer' },
          repeats: { type: 'string' },
        },
        required: ['id', 'importance', 'repeats'],
      },
    },
  },
  required: ['stories'],
};

function rankingPrompt(stories) {
  return `You are the editor of "Daily Pulse", a short morning audio briefing for a student who follows world news and, above all, wants to keep up with what's new and trending in AI: models, methods and applications.

The listener only has time for big news, so most of these stories will be left out. Rate how important each story below is for this listener today, from 1 to 10:
- 9-10: major news people will be talking about all day (a frontier model release, a war, election or disaster, a landmark ruling or deal).
- 7-8: big news for this listener: a notable model or product release, a major research result, a significant policy or business move, a trend picked up by several sources.
- 5-6: worth knowing, but nothing is lost by skipping it today.
- 3-4: niche or incremental.
- 1-2: minor, promotional, or a repeat of another story in the list.

Be strict: on most days only a handful of stories deserve 7 or more. Judge real-world significance and novelty; engagement numbers are a hint, not the answer. When several stories cover the same event or finding (including a discussion thread or a trend that bundles it), rate only the most informative one on its merits. Each of the others gets 1-2 and \`repeats\` set to that story's id: hearing it again adds nothing. Only mark a repeat when it is about that very event or finding; other news about the same company or topic is rated on its own merits.

For EVERY story, return its id (the text in brackets, e.g. "12" or "T1"), its importance, and repeats (an id, or "" when it doesn't repeat another story).

Stories:
${stories.map(story => `[${story.key}] ${story.label} · ${story.text}`).join('\n')}`;
}

const storyKey = (id) => String(id ?? '').replace(/[[\]\s]/g, '');

/**
 * Asks the LLM how important each story is.
 * Returns Map(key -> { importance: 1-10, repeats: key of the story it repeats, or '' }).
 */
export async function rankStories(ai, stories) {
  const result = await generateJson(ai, rankingPrompt(stories), RANKING_SCHEMA, { label: 'Importance ranking' });
  const ranking = new Map((result.stories ?? []).map(({ id, importance, repeats }) => [storyKey(id), {
    importance: Math.min(10, Math.max(1, Math.round(importance))),
    repeats: storyKey(repeats),
  }]));
  if (!ranking.size) throw new Error('no stories were ranked');
  return ranking;
}

// ------------------------------------------------------------------
// BRIEFING PLAN
// ------------------------------------------------------------------

const inSpeakingOrder = (stories) => // stable: keeps importance order within a section
  [...stories].sort((a, b) => SPEAKING_ORDER.indexOf(a.section) - SPEAKING_ORDER.indexOf(b.section));

/**
 * Splits the stories by importance (`ranking` from rankStories; empty falls back to section order):
 * - `headlines` get a few sentences each in the audio
 * - `mentions` are only name-dropped, so the listener can find them in the digest
 * - `rest` clear their section's bar but don't fit in the audio: digest-only, most important first
 * - `skipped` are below their section's bar and left out
 * Headlines and mentions are in speaking order. `ranked` is every story, most important first, with its `tier`.
 * A story that repeats another is listed in that one's `related`, so its link stays in the digest.
 */
export function planBriefing(stories, ranking = new Map()) {
  const fallback = (story) => SECTION_PRIORITY[story.section] - story.position;
  const ranked = stories
    .map(story => ({ ...story, importance: ranking.get(story.key)?.importance ?? 0, related: [] }))
    .sort((a, b) => b.importance - a.importance || fallback(b) - fallback(a));

  // A repeat is never reported itself; its link goes with the story it repeats instead
  // (e.g. a trend kept over the article it bundles still links to the article)
  const byKey = new Map(ranked.map(story => [story.key, story]));
  const repeats = new Set();
  for (const story of ranked) {
    const original = byKey.get(ranking.get(story.key)?.repeats);
    if (!original || original === story) continue;
    repeats.add(story);
    if (story.item) original.related.push(story.item);
  }

  // Without a ranking (the LLM call failed) there is nothing to judge "big" by, so nothing is skipped
  const isBig = (story) => !ranking.size || story.importance >= MIN_IMPORTANCE[story.section];
  const reported = ranked
    .filter(story => !repeats.has(story))
    .filter((story, i) => i < MIN_STORIES || isBig(story));
  const headlines = reported.slice(0, HEADLINES);
  const mentions = reported.slice(HEADLINES, HEADLINES + MENTIONS);
  const rest = reported.slice(HEADLINES + MENTIONS);
  const skipped = ranked.filter(story => !reported.includes(story));

  for (const story of headlines) story.tier = 'headline';
  for (const story of mentions) story.tier = 'mention';
  for (const story of rest) story.tier = 'digest';
  for (const story of skipped) story.tier = 'skipped';
  return { headlines: inSpeakingOrder(headlines), mentions: inSpeakingOrder(mentions), rest, skipped, ranked };
}
