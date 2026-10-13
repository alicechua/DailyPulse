import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { AI_PATTERN, prepareCandidates, selectSections, trendPool } from './lib/curate.mjs';
import { createLLM, generateText, synthesizeSpeech } from './lib/llm.mjs';
import { fetchAllSources, sourceLabel } from './lib/sources.mjs';
import { buildDigest, sendAudio, sendMessage } from './lib/telegram.mjs';
import { aggregateEntities, detectEmerging, extractEntities, loadHistory, recordDay, recordShown, saveHistory } from './lib/trends.mjs';
import { compact, escapeHtml, isoDate, loadDotEnv, truncate } from './lib/util.mjs';

// Usage: node scripts/daily-briefing.mjs [--dry-run] [--no-audio]
//   --dry-run   Don't send to Telegram (also DRY_RUN=true). Outputs are always written to out/.
//   --no-audio  Skip text-to-speech.

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out');

// ------------------------------------------------------------------
// BRIEFING PROMPT
// ------------------------------------------------------------------

const CONTEXT_SECTIONS = [
  ['models', 'TRENDING MODELS (Hugging Face)'],
  ['repos', 'RISING REPOS (GitHub, created this week)'],
  ['research', 'TOP PAPERS (Hugging Face Daily Papers, by community upvotes)'],
  ['discussion', 'AI ON HACKER NEWS'],
  ['ai_news', 'FROM AI LABS, NEWS SITES & NEWSLETTERS'],
  ['tech', 'TECH & INDUSTRY'],
];

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
  return `- [${sourceLabel(item.source)}] ${item.title}${stats ? ` (${stats})` : ''}${description}`;
}

function describeEntity(entity, warmingUp) {
  const status = warmingUp ? '' : entity.isNew ? `, new (first seen ${entity.firstSeen})` : ', spiking vs. its recent baseline';
  const sources = [...entity.sources].map(sourceLabel).join(', ');
  const refs = entity.items.slice(0, 4).map(item => {
    const stats = itemStats(item);
    return `    · [${sourceLabel(item.source)}] ${item.title}${stats ? ` (${stats})` : ''}`;
  });
  return `- ${entity.name} (${entity.type})${status}: ${entity.mentions} mentions across ${sources}${entity.gist ? `. Gist: ${entity.gist}` : ''}\n${refs.join('\n')}`;
}

function briefingPrompt({ dateStr, sections, emerging, warmingUp }) {
  const blocks = [];
  const add = (title, lines) => { if (lines.length) blocks.push(`## ${title}\n${lines.join('\n')}`); };
  add('WORLD NEWS', sections.world.map(describeItem));
  add(warmingUp
    ? 'HOT ACROSS SOURCES (AI names showing up in several independent sources today)'
    : 'EMERGING IN AI (new or spiking names, confirmed by several independent sources)',
  emerging.map(e => describeEntity(e, warmingUp)));
  for (const [category, title] of CONTEXT_SECTIONS) add(title, sections[category].map(describeItem));

  const emergingStep = emerging.length
    ? `${warmingUp ? 'Hot across sources' : 'Emerging in AI'}: for each name, explain what it is and why people are paying attention. Use web search to find out what it is when the material is thin. This is the most important part of the briefing.`
    : 'Nothing qualified as emerging today, so skip that part.';

  return `You are the host of "Daily Pulse", a personal morning audio briefing for a student who follows world news and, above all, wants to keep up with what's new and trending in AI: models, methods and applications.
It is ${dateStr}.

Today's material, grouped by section (engagement numbers show how much attention each item is getting):

${blocks.join('\n\n')}

Write the spoken script for today's briefing:
1. Open with exactly: "Good morning, today is ${dateStr}. Here is your Daily Pulse."
2. World: the 3 or 4 most important stories, one or two sentences each.
3. ${emergingStep}
4. Trending in AI: the most notable models, repos and Hacker News discussions — what they do and why they matter. Group related items (for example a model and the repos built on it) instead of listing them one by one.
5. Research: 2 or 3 papers, one sentence each on the main idea.
6. Labs, tech and industry: the 2 to 4 most significant announcements.
7. Close with one short sentence.

Rules:
- The text is read verbatim by a text-to-speech engine: plain spoken sentences only. No markdown, headings, lists, emojis, URLs or stage directions.
- Say names the way a person would: "Qwen 3.8" rather than "unsloth/Qwen3.8-27B-GGUF"; drop repo owners unless the owner is the point.
- Be factual. Only state what the material or your search results support, and never invent numbers.
- Leave out weak items rather than padding. Skip any part that has no material.
- Length: 550 to 650 words (about 4 minutes).`;
}

/** Belt and braces: TTS reads everything verbatim, so strip any markdown that slipped through. */
const toSpeech = (text) => text
  .replace(/^#+\s*/gm, '')
  .replace(/\*\*?|__|`/g, '')
  .replace(/^\s*[-•]\s+/gm, '')
  .replace(/https?:\/\/\S+/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

// ------------------------------------------------------------------
// MAIN LOGIC
// ------------------------------------------------------------------

function writeOutputs(files) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true }); // don't leave a stale file from a previous run
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    if (content != null) fs.writeFileSync(path.join(OUT_DIR, name), content);
  }
}

async function main() {
  loadDotEnv();
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run') || ['1', 'true'].includes(String(process.env.DRY_RUN).toLowerCase());
  const withAudio = !args.has('--no-audio');

  const { TELEGRAM_BOT_TOKEN: botToken, TELEGRAM_CHAT_ID: chatId, GITHUB_TOKEN: githubToken } = process.env;
  const llm = createLLM();
  const missing = [...llm.missing, ...Object.entries({ TELEGRAM_BOT_TOKEN: botToken, TELEGRAM_CHAT_ID: chatId })
    .filter(([, value]) => !value)
    .map(([name]) => name)];
  if (missing.length && !dryRun) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log(`🚀 Starting Daily Pulse${dryRun ? ' (dry run: nothing will be sent)' : ''}...`);
  if (!llm.client) console.warn(`⚠️  No ${llm.missing.join(', ')}: skipping trend analysis, briefing and audio (digest only).`);
  else console.log(`   Models (${llm.name}): ${llm.models}`);

  const ai = llm.client ? llm : null;
  const now = new Date();
  const today = isoDate(now);
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const history = loadHistory();
  let historyChanged = false;
  const problems = []; // Non-fatal failures: we still deliver what we can, then exit non-zero so GitHub emails you

  // 1. Fetch sources
  console.log('📡 Fetching sources...');
  const { items, health } = await fetchAllSources({ githubToken });
  if (!items.length) throw new Error('Every source failed to fetch');

  // 2. Rank & curate
  console.log('🧠 Ranking & curating...');
  const candidates = prepareCandidates(items);

  // 3. Detect trends
  let tags = new Map();
  let groups = new Map();
  let emerging = [];
  let warmingUp = false;
  if (ai) {
    console.log('📈 Detecting trends...');
    try {
      const pool = trendPool(candidates);
      tags = await extractEntities(ai, pool);
      groups = aggregateEntities(pool, tags);
      ({ emerging, warmingUp } = detectEmerging(history, groups, today));
      recordDay(history, groups, today);
      historyChanged = true;
      console.log(`   Tagged ${tags.size}/${pool.length} items: ${groups.size} entities, ${emerging.length} emerging${warmingUp ? ' (history warming up)' : ''}`);
      for (const e of emerging) console.log(`   🔥 ${e.name} (${e.type}): ${e.mentions} mentions across ${[...e.sources].map(sourceLabel).join(', ')}`);
    } catch (error) {
      problems.push(`Trend analysis failed: ${error.message}`);
      console.error(`   ! ${problems.at(-1)}`);
    }
  }

  const isAI = (item) => tags.get(item.id)?.ai ?? AI_PATTERN.test(`${item.title} ${item.description}`);
  const excludeLinks = new Set(emerging.flatMap(e => e.items.slice(0, 2).map(item => item.link)));
  const sections = selectSections(candidates, { isAI, excludeLinks, shown: history.shown, today });

  // 4. Write the briefing script
  let prompt = null;
  let script = null;
  if (ai) {
    console.log('✍️  Writing briefing...');
    prompt = briefingPrompt({ dateStr, sections, emerging, warmingUp });
    try {
      script = toSpeech(await generateText(ai, prompt, { search: true, label: 'Briefing' }));
      console.log(`   ${script.split(/\s+/).length} words`);
    } catch (error) {
      problems.push(`Briefing generation failed: ${error.message}`);
      console.error(`   ! ${problems.at(-1)}`);
    }
  }

  // 5. Synthesize audio
  let audio = null;
  if (script && withAudio) {
    console.log('🗣️  Synthesizing audio...');
    try {
      audio = await synthesizeSpeech(ai, script);
      console.log(`   ${(audio.length / 1e6).toFixed(1)} MB`);
    } catch (error) {
      problems.push(`Text-to-speech failed: ${error.message}`);
      console.error(`   ! ${problems.at(-1)}`);
    }
  }

  // 6. Build the link digest
  const digest = buildDigest({ dateStr, emerging, warmingUp, sections, health, notes: problems });
  writeOutputs({
    'context.md': prompt,
    'briefing.txt': script,
    'briefing.wav': audio,
    'digest.html': digest,
    'trends.json': JSON.stringify({
      warmingUp,
      emerging: emerging.map(({ items: refs, sources, names, types, gists, ...e }) => ({ ...e, sources: [...sources], items: refs.map(i => i.link) })),
      entities: [...groups.values()].sort((a, b) => b.mentions - a.mentions)
        .map(g => ({ name: g.name, type: g.type, mentions: g.mentions, sources: [...g.sources], gist: g.gist })),
    }, null, 2),
  });
  console.log(`   Outputs written to ${path.relative(process.cwd(), OUT_DIR) || OUT_DIR}/`);

  // 7. Send to Telegram
  if (!dryRun) {
    console.log('✈️  Sending to Telegram...');
    try {
      if (audio) {
        await sendAudio(botToken, chatId, audio, {
          title: `Daily Pulse - ${dateStr}`,
          caption: `Daily Pulse (${dateStr})`,
          filename: `daily-pulse-${today}.wav`,
        });
      } else if (script) {
        await sendMessage(botToken, chatId, `<b>🎙️ Today's briefing (audio unavailable)</b>\n\n${escapeHtml(script)}`);
      }
    } catch (error) {
      problems.push(`Sending audio failed: ${error.message}`);
      console.error(`   ! ${problems.at(-1)}`);
    }
    await sendMessage(botToken, chatId, digest);

    const sentLinks = [...excludeLinks, ...Object.values(sections).flat().map(item => item.link)];
    recordShown(history, sentLinks, today);
    historyChanged = true;
  }

  if (historyChanged) saveHistory(history);

  if (problems.length) {
    console.error(`❌ Finished with ${problems.length} problem(s):\n${problems.map(p => `   - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(dryRun ? '✅ Dry run complete.' : '✅ Briefing sent successfully!');
}

main().catch(err => {
  console.error('❌ Fatal Error:', err);
  process.exit(1);
});
