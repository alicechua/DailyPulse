import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { AI_PATTERN, prepareCandidates, selectSections, trendPool } from './lib/curate.mjs';
import { createLLM, generateText, synthesizeSpeech } from './lib/llm.mjs';
import { collectStories, planBriefing, rankStories } from './lib/rank.mjs';
import { fetchAllSources, sourceLabel } from './lib/sources.mjs';
import { buildDigest, sendAudio, sendMessage } from './lib/telegram.mjs';
import { aggregateEntities, detectEmerging, extractEntities, loadHistory, recordDay, recordShown, saveHistory } from './lib/trends.mjs';
import { escapeHtml, isoDate, loadDotEnv, wavDuration } from './lib/util.mjs';

// Usage: node scripts/daily-briefing.mjs [--dry-run] [--no-audio]
//   --dry-run   Don't send to Telegram (also DRY_RUN=true). Outputs are always written to out/.
//   --no-audio  Skip text-to-speech.

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out');

// ------------------------------------------------------------------
// LENGTH
// ------------------------------------------------------------------

const MAX_AUDIO_SECONDS = 150; // 2:30
// The voices read about 135 words a minute: 280 words is ~2:05, which leaves room for a slower read.
// The real length is measured after synthesis, and the script is cut again if it still runs over.
const TARGET_WORDS = 280;
const MAX_WORDS = 310; // shorten before synthesis above this

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

function formatDuration(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------
// BRIEFING PROMPT
// ------------------------------------------------------------------

function briefingPrompt({ dateStr, plan }) {
  // About 45 words per top story and a few per mention, so a quiet day makes a short briefing
  const words = Math.min(TARGET_WORDS, 30 + 45 * plan.headlines.length + 6 * plan.mentions.length);
  const headlines = plan.headlines.map((story, i) => `${i + 1}. ${story.label} · ${story.text}`);
  const mentions = plan.mentions.map(story => `- ${story.label} · ${story.text}`);
  const trendNote = plan.headlines.some(story => story.trend)
    ? ' For a name that is trending across sources, say what it is and why people are paying attention; use web search when the material is thin.'
    : '';

  const steps = [
    `Open with exactly: "Good morning, today is ${dateStr}. Here is your Daily Pulse."`,
    `Cover the top stories in the order given, in about 40 words each: what happened and why it matters.${trendNote} Merge stories that are about the same thing.`,
    mentions.length && 'Name-drop the quick mentions in one or two sentences, so the listener knows they are in the digest: a short spoken name or a few words each, no explanations (for example "Also in today\'s digest: ...").',
    'Close with one short sentence.',
  ].filter(Boolean);

  return `You are the host of "Daily Pulse", a personal morning audio briefing for a student who follows world news and, above all, wants to keep up with what's new and trending in AI: models, methods and applications.
It is ${dateStr}.

Today's stories have been ranked by importance and only the big news made the cut. The listener wants a short briefing, so the top stories get airtime and the next few are just name-dropped; all of them, with links, are in the text digest sent with the audio. Engagement numbers show how much attention each item is getting.

## TOP STORIES (in speaking order)
${headlines.join('\n')}
${mentions.length ? `\n## QUICK MENTIONS\n${mentions.join('\n')}\n` : ''}
Write the spoken script for today's briefing:
${steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

Rules:
- The text is read verbatim by a text-to-speech engine: plain spoken sentences only. No markdown, headings, lists, emojis, URLs or stage directions.
- Say names the way a person would: "Qwen 3.8" rather than "unsloth/Qwen3.8-27B-GGUF"; drop repo owners unless the owner is the point.
- Be factual. Only state what the material or your search results support, and never invent numbers.
- Only cover the stories listed above.
- Length: about ${words} words, never more: cut detail rather than going over. Don't pad a quiet day.`;
}

function shortenPrompt(script, maxWords) {
  return `This spoken news briefing is ${wordCount(script)} words long and has to be at most ${maxWords}. Shorten it: keep the opening sentence word for word and the order of the stories, and cut detail from the later, lesser stories first. It is read verbatim by a text-to-speech engine, so plain spoken sentences only. Reply with the shortened script and nothing else.

${script}`;
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
  const stories = collectStories({ emerging, warmingUp, sections });

  // 4. Rank by importance: the top stories get airtime, the next are name-dropped, the rest are digest-only
  let ranking = new Map();
  if (ai) {
    console.log('⚖️  Ranking stories by importance...');
    try {
      ranking = await rankStories(ai, stories);
    } catch (error) {
      problems.push(`Importance ranking failed, so the briefing follows section order: ${error.message}`);
      console.error(`   ! ${problems.at(-1)}`);
    }
  }
  const plan = planBriefing(stories, ranking);

  // 5. Write the briefing script
  let prompt = null;
  let script = null;
  if (ai) {
    console.log('✍️  Writing briefing...');
    console.log(`   Covering ${plan.headlines.length} stories, name-dropping ${plan.mentions.length}, ${plan.rest.length} more in the digest, ${plan.skipped.length} below the bar`);
    prompt = briefingPrompt({ dateStr, plan });
    try {
      script = toSpeech(await generateText(ai, prompt, { search: true, label: 'Briefing' }));
      if (wordCount(script) > MAX_WORDS) {
        console.log(`   ${wordCount(script)} words: too long, shortening...`);
        script = toSpeech(await generateText(ai, shortenPrompt(script, TARGET_WORDS), { label: 'Shortening briefing' }));
      }
      console.log(`   ${wordCount(script)} words`);
    } catch (error) {
      problems.push(`Briefing generation failed: ${error.message}`);
      console.error(`   ! ${problems.at(-1)}`);
    }
  }

  // 6. Synthesize audio
  let audio = null;
  let seconds = NaN;
  if (script && withAudio) {
    console.log('🗣️  Synthesizing audio...');
    try {
      audio = await synthesizeSpeech(ai, script);
      seconds = wavDuration(audio);
      if (seconds > MAX_AUDIO_SECONDS) {
        // The voice read slower than expected: cut the script to fit its measured pace and synthesize again
        const maxWords = Math.floor(wordCount(script) * (MAX_AUDIO_SECONDS / seconds) * 0.9);
        console.log(`   ${formatDuration(seconds)} is over the ${formatDuration(MAX_AUDIO_SECONDS)} limit: shortening to ${maxWords} words...`);
        const shorter = toSpeech(await generateText(ai, shortenPrompt(script, maxWords), { label: 'Shortening briefing' }));
        audio = await synthesizeSpeech(ai, shorter);
        script = shorter;
        seconds = wavDuration(audio);
        if (seconds > MAX_AUDIO_SECONDS) console.warn(`   ⚠️  Still ${formatDuration(seconds)} after shortening; sending it anyway.`);
      }
      console.log(`   ${formatDuration(seconds)}, ${(audio.length / 1e6).toFixed(1)} MB`);
    } catch (error) {
      problems.push(`Text-to-speech failed: ${error.message}`);
      console.error(`   ! ${problems.at(-1)}`);
    }
  }

  // 7. Build the link digest (it opens with what the briefing covered, when there is one)
  const digest = buildDigest({ dateStr, warmingUp, stories, plan: script ? plan : null, health, notes: problems });
  writeOutputs({
    'context.md': prompt,
    'briefing.txt': script,
    'briefing.wav': audio,
    'digest.html': digest,
    'ranking.json': ai && JSON.stringify(plan.ranked.map(story => ({
      importance: story.importance,
      tier: story.tier,
      section: story.section,
      title: story.trend?.name ?? story.item.title,
    })), null, 2),
    'trends.json': JSON.stringify({
      warmingUp,
      emerging: emerging.map(({ items: refs, sources, names, types, gists, ...e }) => ({ ...e, sources: [...sources], items: refs.map(i => i.link) })),
      entities: [...groups.values()].sort((a, b) => b.mentions - a.mentions)
        .map(g => ({ name: g.name, type: g.type, mentions: g.mentions, sources: [...g.sources], gist: g.gist })),
    }, null, 2),
  });
  console.log(`   Outputs written to ${path.relative(process.cwd(), OUT_DIR) || OUT_DIR}/`);

  // 8. Send to Telegram
  if (!dryRun) {
    console.log('✈️  Sending to Telegram...');
    try {
      if (audio) {
        await sendAudio(botToken, chatId, audio, {
          title: `Daily Pulse - ${dateStr}`,
          caption: `Daily Pulse (${dateStr})`,
          filename: `daily-pulse-${today}.wav`,
          duration: seconds,
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
