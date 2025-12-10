
import { GoogleGenAI } from "@google/genai";
import fs from 'fs';
import path from 'path';
import { Buffer } from 'node:buffer';
import process from 'node:process';

// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------

const GOOGLE_NEWS_BASE = "https://news.google.com/rss/search?q=";

// Note: No CORS proxy needed for Node.js
const FEEDS = {
  "reuters_world": `${GOOGLE_NEWS_BASE}site:reuters.com+world&hl=en-US&gl=US&ceid=US:en`,
  "reuters_ai": `${GOOGLE_NEWS_BASE}site:reuters.com+artificial+intelligence+OR+AI&hl=en-US&gl=US&ceid=US:en`,
  "reuters_tech": `${GOOGLE_NEWS_BASE}site:reuters.com+technology&hl=en-US&gl=US&ceid=US:en`,
  "bbc_news": "https://feeds.bbci.co.uk/news/rss.xml",
  "al_jazeera": "https://www.aljazeera.com/xml/rss/all.xml",
  "guardian_world": "https://www.theguardian.com/world/rss",
  "ft_home": "https://www.ft.com/rss/home",
  "the_verge": "https://www.theverge.com/rss/index.xml",
  "openai_news": "https://openai.com/news/rss.xml",
  "deepmind": "https://deepmind.google/blog/feed/basic",
  "arxiv_ai": "https://export.arxiv.org/rss/cs.AI",
};

const SOURCE_WEIGHT = {
  "bbc_news": 1.0,
  "ft_home": 0.95,
  "deepmind": 0.95,
  "openai_news": 0.95,
  "arxiv_ai": 0.9,
  "guardian_world": 0.9,
  "the_verge": 0.9,
  "reuters_world": 0.85,
  "reuters_ai": 0.85,
  "reuters_tech": 0.85,
  "al_jazeera": 0.85,
};

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------

/**
 * Simple Regex-based XML Parser for RSS (Node.js doesn't have DOMParser)
 */
function parseRSS(sourceName, xml) {
  const items = [];
  // Match <item> or <entry> blocks
  const itemRegex = /<(item|entry)>([\s\S]*?)<\/\1>/g;
  
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const content = match[2];
    
    // Extract Title
    const titleMatch = content.match(/<title.*?>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "Untitled";

    // Extract Link
    let link = "";
    const linkMatch = content.match(/<link.*?href=["'](.*?)["'].*?>/i); // Atom style
    const linkMatchRSS = content.match(/<link>(.*?)<\/link>/i); // RSS style
    
    if (linkMatchRSS) {
      link = linkMatchRSS[1].trim();
    } else if (linkMatch) {
      link = linkMatch[1].trim();
    }

    // Extract Date
    const dateMatch = content.match(/<(pubDate|updated)>(.*?)<\/\1>/i);
    const published = dateMatch ? dateMatch[2] : undefined;

    if (title && link) {
      items.push({ source: sourceName, title, link, published });
    }
  }
  return items;
}

function calculateRank(item) {
  const weight = SOURCE_WEIGHT[item.source] || 0.75;
  
  // Recency Bonus
  let recency = 0;
  if (item.published) {
    try {
      const pubDate = new Date(item.published);
      const hours = (new Date().getTime() - pubDate.getTime()) / (1000 * 60 * 60);
      if (!isNaN(hours) && hours > 0) {
        recency = 0.25 * Math.exp(-hours / 36);
      }
    } catch (e) {}
  }
  
  // Topic Bonus
  let topicBonus = 0;
  const t = item.title.toLowerCase();
  
  // AI Keywords
  if (t.includes('ai') || t.includes('gpt') || t.includes('intelligence') || t.includes('llm')) topicBonus = 0.05;
  
  // Business Keywords
  if (t.includes('market') || t.includes('economy')) topicBonus = 0.03;
  
  // Tech Keywords
  if (t.includes('tech') || t.includes('apple') || t.includes('google') || t.includes('microsoft') || t.includes('startup') || t.includes('software')) topicBonus = 0.04;

  return weight + recency + topicBonus;
}

/**
 * Creates a WAV header for PCM data
 */
function createWavBuffer(pcmData, sampleRate = 24000, numChannels = 1) {
  const header = Buffer.alloc(44);
  const totalDataLen = pcmData.length;
  const totalFileSize = totalDataLen + 36;
  const bitDepth = 16;

  header.write('RIFF', 0);
  header.writeUInt32LE(totalFileSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size
  header.writeUInt16LE(1, 20); // AudioFormat (1=PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * (bitDepth / 8), 28); // ByteRate
  header.writeUInt16LE(numChannels * (bitDepth / 8), 32); // BlockAlign
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(totalDataLen, 40);

  return Buffer.concat([header, pcmData]);
}

// ------------------------------------------------------------------
// MAIN LOGIC
// ------------------------------------------------------------------

async function main() {
  console.log("🚀 Starting Daily Pulse (Headless Mode)...");

  const apiKey = process.env.GEMINI_API_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!apiKey || !botToken || !chatId) {
    console.error("❌ Missing required environment variables (GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  // 1. Fetch RSS Feeds
  console.log("📡 Fetching RSS Feeds...");
  let allItems = [];
  
  for (const [name, url] of Object.entries(FEEDS)) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const text = await resp.text();
        const items = parseRSS(name, text);
        allItems.push(...items);
        console.log(`   - Fetched ${items.length} items from ${name}`);
      } else {
        console.warn(`   ! Failed to fetch ${name}: ${resp.status}`);
      }
    } catch (e) {
      console.warn(`   ! Error fetching ${name}: ${e.message}`);
    }
  }

  // 2. Rank & Curate
  console.log("🧠 Ranking & Curating...");
  const ranked = allItems
    .map(item => ({ ...item, score: calculateRank(item) }))
    .sort((a, b) => b.score - a.score);

  // Simple Deduplication by normalized title
  const seen = new Set();
  const curated = [];
  // Slightly increased limit to accommodate 3 topics
  const MAX_STORIES = 18; 
  
  for (const item of ranked) {
    const norm = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!seen.has(norm) && curated.length < MAX_STORIES) {
      seen.add(norm);
      curated.push(item);
    }
  }

  const context = curated.map(i => `- [${i.source}] ${i.title}`).join("\n");
  
  // 3. Generate Briefing Text
  console.log("✍️ Generating Briefing Text...");
  const prompt = `
    You are a professional personal news anchor.
    Here are the top headlines for today from trusted sources:
    ${context}

    Write a concise, engaging morning briefing script.
    You MUST cover these three areas clearly:
    1. Major World News
    2. Artificial Intelligence Updates
    3. Technology Trends

    Do not read out URLs.
    Keep it under 3 minutes of speaking time (approx 400-500 words).
    Start with "Good Morning, here is your daily briefing covering World events, AI, and Tech."
  `;

  const textResp = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    // Note: We use the RSS feeds as primary context, but we enable Search 
    // to fill in details if the headlines are vague.
    config: { tools: [{ googleSearch: {} }] } 
  });
  
  const briefingText = textResp.text;
  console.log("   Briefing Length:", briefingText.length);

  // 4. Generate Audio (TTS)
  console.log("🗣️  Synthesizing Audio...");
  const audioResp = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: briefingText }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
      },
    },
  });

  const base64Audio = audioResp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("No audio generated");

  // Convert Base64 -> Buffer -> WAV
  const pcmBuffer = Buffer.from(base64Audio, 'base64');
  const wavBuffer = createWavBuffer(pcmBuffer);

  // 5. Send to Telegram
  console.log("✈️  Sending to Telegram...");
  
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('caption', `Daily Briefing (World, AI, Tech) - ${new Date().toLocaleDateString()}`);
  formData.append('title', `Daily Briefing`);
  formData.append('performer', 'Gemini AI');
  
  // Blob is available in Node 18+
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  formData.append('audio', blob, `briefing-${new Date().toISOString().split('T')[0]}.wav`);

  const tgResp = await fetch(`https://api.telegram.org/bot${botToken}/sendAudio`, {
    method: 'POST',
    body: formData
  });

  if (!tgResp.ok) {
    const err = await tgResp.text();
    throw new Error(`Telegram API Error: ${err}`);
  }

  console.log("✅ Briefing Sent Successfully!");
}

main().catch(err => {
  console.error("❌ Fatal Error:", err);
  process.exit(1);
});
