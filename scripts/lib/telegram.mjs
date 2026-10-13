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

function itemLine(item) {
  const blurb = (item.category === 'repos' || item.category === 'models') && item.description
    ? ` — ${escapeHtml(truncate(item.description.split(' · topics:')[0], 90))}`
    : '';
  return `• ${link(item.link, truncate(item.title, 110))} · ${itemMeta(item)}${blurb}`;
}

const SECTION_TITLES = {
  models: '🤗 Trending models',
  repos: '⭐ Rising repos',
  research: '📄 Top papers',
  discussion: '💬 On Hacker News',
  ai_news: '🧪 Labs & newsletters',
  world: '🌍 World',
  tech: '💻 Tech',
};

/** Builds the link digest sent after the audio. Deterministic: links come straight from the sources. */
export function buildDigest({ dateStr, emerging, warmingUp, sections, health, notes = [] }) {
  const parts = [`<b>📰 Daily Pulse · ${escapeHtml(dateStr)}</b>`];
  if (notes.length) parts.push(notes.map(n => `⚠️ <i>${escapeHtml(n)}</i>`).join('\n'));

  if (emerging.length) {
    const title = warmingUp ? '🔥 Hot across sources <i>(trend history warming up)</i>' : '🔥 Emerging in AI';
    const lines = emerging.map(e => {
      const badge = e.isNew ? 'new' : 'spiking';
      const sources = [...e.sources].map(sourceLabel).join(', ');
      const refs = e.items.slice(0, 2).map(item => `   ↳ ${link(item.link, truncate(item.title, 80))}`);
      return [
        `• <b>${escapeHtml(e.name)}</b> <i>(${escapeHtml(e.type)}${warmingUp ? '' : `, ${badge}`})</i>${e.gist ? ` — ${escapeHtml(e.gist)}` : ''}`,
        `   ${e.mentions} mentions · ${escapeHtml(sources)}`,
        ...refs,
      ].join('\n');
    });
    parts.push(`<b>${title}</b>\n${lines.join('\n')}`);
  }

  for (const [category, title] of Object.entries(SECTION_TITLES)) {
    const items = sections[category] ?? [];
    if (items.length) parts.push(`<b>${title}</b>\n${items.map(itemLine).join('\n')}`);
  }

  const failed = Object.entries(health).filter(([, v]) => typeof v !== 'number').map(([k]) => k);
  const total = Object.keys(health).length;
  parts.push(`<i>Sources: ${total - failed.length}/${total} OK${failed.length ? ` · failed: ${escapeHtml(failed.join(', '))}` : ''}</i>`);

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

export async function sendAudio(botToken, chatId, wavBuffer, { title, caption, filename }) {
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  form.append('title', title);
  form.append('performer', 'Daily Pulse');
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
