import { sourceLabel } from './sources.mjs';
import { compact, escapeHtml, truncate } from './util.mjs';

const MESSAGE_LIMIT = 4000; // Telegram's limit is 4096 characters

// ------------------------------------------------------------------
// DIGEST (Telegram HTML)
// ------------------------------------------------------------------

const link = (href, text) => `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;

function itemMeta(item) {
  const m = item.metrics ?? {};
  switch (item.category) {
    case 'discussion': return `${m.points} pts · ${link(item.discussion, `${m.comments} comments`)}`;
    case 'repos':      return `★${compact(m.stars)} (+${compact(m.starsPerDay)}/day)${m.language ? ` · ${escapeHtml(m.language)}` : ''}`;
    case 'models':     return `🔥${compact(m.trending)} · ♥${compact(m.likes)}`;
    case 'research':   return `▲${m.upvotes}`;
    default:           return escapeHtml(sourceLabel(item.source));
  }
}

const refLine = (item) => `   ↳ ${link(item.link, truncate(item.title, 80))}`;

/** `related` are stories that repeat this one (see planBriefing), linked underneath. */
function itemLine(item, bullet = '•', related = []) {
  const blurb = (item.category === 'repos' || item.category === 'models') && item.description
    ? ` — ${escapeHtml(truncate(item.description.split(' · topics:')[0], 90))}`
    : '';
  return [`${bullet} ${link(item.link, truncate(item.title, 110))} · ${itemMeta(item)}${blurb}`, ...related.slice(0, 2).map(refLine)].join('\n');
}

function trendLine(entity, warmingUp, bullet = '•', related = []) {
  const badge = entity.isNew ? 'new' : 'spiking';
  const sources = [...entity.sources].map(sourceLabel).join(', ');
  // Stories folded into the trend come first: they are usually why it made the briefing
  const refs = [...related, ...entity.items]
    .filter((item, i, all) => all.findIndex(other => other.link === item.link) === i)
    .slice(0, related.length ? 3 : 2)
    .map(refLine);
  return [
    `${bullet} <b>${escapeHtml(entity.name)}</b> <i>(${escapeHtml(entity.type)}${warmingUp ? '' : `, ${badge}`})</i>${entity.gist ? ` — ${escapeHtml(entity.gist)}` : ''}`,
    `   ${entity.mentions} mentions · ${escapeHtml(sources)}`,
    ...refs,
  ].join('\n');
}

/** Digest sections, in display order: [emoji, title]. */
const SECTIONS = {
  emerging: ['🔥', 'Emerging in AI'],
  models: ['🤗', 'Trending models'],
  repos: ['⭐', 'Rising repos'],
  research: ['📄', 'Top papers'],
  discussion: ['💬', 'On Hacker News'],
  ai_news: ['🧪', 'Labs & newsletters'],
  world: ['🌍', 'World'],
  tech: ['💻', 'Tech'],
};

/**
 * Builds the link digest sent after the audio. Deterministic: links come straight from the sources.
 * With a briefing `plan` (from planBriefing), it opens with the stories the audio covered and the ones it
 * name-dropped, in speaking order; the other big stories follow by section, most important first, and stories
 * below their section's bar are left out.
 */
export function buildDigest({ dateStr, warmingUp, stories, plan, health, notes = [] }) {
  const parts = [`<b>📰 Daily Pulse · ${escapeHtml(dateStr)}</b>`];
  if (notes.length) parts.push(notes.map(n => `⚠️ <i>${escapeHtml(n)}</i>`).join('\n'));

  const line = (story, bullet) => (story.trend
    ? trendLine(story.trend, warmingUp, bullet, story.related)
    : itemLine(story.item, bullet, story.related));
  const withEmoji = (story) => line(story, SECTIONS[story.section][0]);
  if (plan) {
    parts.push(`<b>🎧 In today's briefing</b>\n${plan.headlines.map(withEmoji).join('\n')}`);
    if (plan.mentions.length) parts.push(`<b>🔹 Also mentioned</b>\n${plan.mentions.map(withEmoji).join('\n')}`);
  }

  const rest = plan?.rest ?? stories;
  for (const [section, [emoji, title]] of Object.entries(SECTIONS)) {
    const lines = rest.filter(story => story.section === section).map(story => line(story));
    if (!lines.length) continue;
    const heading = section === 'emerging' && warmingUp ? 'Hot across sources <i>(trend history warming up)</i>' : title;
    parts.push(`<b>${emoji} ${heading}</b>\n${lines.join('\n')}`);
  }

  const failed = Object.entries(health).filter(([, v]) => typeof v !== 'number').map(([k]) => k);
  const total = Object.keys(health).length;
  const skipped = plan?.skipped.length ? ` · ${plan.skipped.length} smaller stories left out` : '';
  parts.push(`<i>Sources: ${total - failed.length}/${total} OK${failed.length ? ` · failed: ${escapeHtml(failed.join(', '))}` : ''}${skipped}</i>`);

  return parts.join('\n\n');
}

/** Splits on section (then line) boundaries so HTML tags are never cut in half. */
function splitMessage(html, limit = MESSAGE_LIMIT) {
  const chunks = [];
  let current = '';
  const push = (block, sep) => {
    if (current && current.length + sep.length + block.length > limit) {
      chunks.push(current);
      current = '';
    }
    current = current ? current + sep + block : block;
  };
  for (const section of html.split('\n\n')) {
    if (section.length <= limit) push(section, '\n\n');
    else for (const line of section.split('\n')) push(line, '\n');
  }
  if (current) chunks.push(current);
  return chunks;
}

// ------------------------------------------------------------------
// BOT API
// ------------------------------------------------------------------

async function callTelegram(botToken, method, body) {
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    ...(body instanceof FormData ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!resp.ok) throw new Error(`Telegram ${method} error: ${await resp.text()}`);
}

export async function sendAudio(botToken, chatId, wavBuffer, { title, caption, filename, duration }) {
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  form.append('title', title);
  form.append('performer', 'Daily Pulse');
  if (duration) form.append('duration', String(Math.round(duration)));
  form.append('audio', new Blob([wavBuffer], { type: 'audio/wav' }), filename);
  await callTelegram(botToken, 'sendAudio', form);
}

export async function sendMessage(botToken, chatId, html) {
  for (const text of splitMessage(html)) {
    await callTelegram(botToken, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }
}
