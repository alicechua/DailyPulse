import { FeedItem, CuratedFeeds } from '../types';

// -------------------------
// Configuration (Ported from Python)
// -------------------------

const GOOGLE_NEWS_BASE = "https://news.google.com/rss/search?q=";
const CORS_PROXY = "https://api.allorigins.win/get?url=";

const googleNewsSearch = (query: string) => 
  `${GOOGLE_NEWS_BASE}${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

const FEEDS: Record<string, string> = {
  "reuters_world_via_google": googleNewsSearch("site:reuters.com world"),
  "reuters_ai_via_google": googleNewsSearch("site:reuters.com artificial intelligence OR AI"),
  "ap_world_via_google": googleNewsSearch("site:apnews.com world"),
  
  "cna_latest": "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml",
  "cna_singapore": "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416",
  "cna_world": "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311",
  
  "st_singapore": "https://www.straitstimes.com/news/singapore/rss.xml",
  "st_world": "https://www.straitstimes.com/news/world/rss.xml",
  
  "BBC News": "https://feeds.bbci.co.uk/news/rss.xml",
  "Al Jazeera (all)": "https://www.aljazeera.com/xml/rss/all.xml",
  "CBC Top Stories": "https://www.cbc.ca/webfeed/rss/rss-topstories",
  "The Guardian World": "https://www.theguardian.com/world/rss",
  
  "Financial Times Home": "https://www.ft.com/rss/home",
  
  "DeepMind Blog": "https://deepmind.google/blog/feed/basic",
  "OpenAI News": "https://openai.com/news/rss.xml",
  
  // arXiv feeds (direct export URLs)
  "arXiv cs.AI": "https://export.arxiv.org/rss/cs.AI",
  "arXiv cs.LG": "https://export.arxiv.org/rss/cs.LG",
  "arXiv cs.CL": "https://export.arxiv.org/rss/cs.CL",
};

const SOURCE_WEIGHT: Record<string, number> = {
  "BBC News": 1.00,
  "CBC Top Stories": 0.95,
  "The Guardian World": 0.90,
  "Al Jazeera (all)": 0.90,
  "reuters_world_via_google": 0.85,
  "reuters_ai_via_google": 0.85,
  "ap_world_via_google": 0.80,
  "cna_latest": 0.90,
  "cna_singapore": 0.92,
  "cna_world": 0.88,
  "st_singapore": 0.90,
  "st_world": 0.88,
  "Financial Times Home": 0.95,
  "DeepMind Blog": 0.95,
  "OpenAI News": 0.95,
  "arXiv cs.AI": 0.85,
  "arXiv cs.LG": 0.85,
  "arXiv cs.CL": 0.85,
};

const AI_KEYWORDS = new Set([
  "ai", "artificial intelligence", "machine learning", "deep learning",
  "llm", "language model", "openai", "deepmind", "anthropic", "meta ai",
  "vision transformer", "transformer", "arxiv", "gpt"
]);

const BUSINESS_KEYWORDS = new Set([
  "market", "stocks", "inflation", "interest rate", "earnings",
  "economy", "gdp", "trade", "finance", "business"
]);

// -------------------------
// Helpers
// -------------------------

// Helper to fetch via CORS proxy
async function fetchWithProxy(url: string): Promise<string> {
  try {
    const response = await fetch(`${CORS_PROXY}${encodeURIComponent(url)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.contents;
  } catch (error) {
    console.warn(`Failed to fetch ${url}`, error);
    return "";
  }
}

// XML Parser
function parseFeedXML(sourceName: string, xmlText: string): FeedItem[] {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  const items: FeedItem[] = [];
  
  // Try RSS items
  const rssItems = xmlDoc.querySelectorAll("item");
  rssItems.forEach(node => {
    const title = node.querySelector("title")?.textContent || "";
    const link = node.querySelector("link")?.textContent || "";
    const pubDate = node.querySelector("pubDate")?.textContent;
    if (title && link) {
      items.push({ source: sourceName, title, link, published: pubDate || undefined });
    }
  });

  // Try Atom entries if RSS failed
  if (items.length === 0) {
    const atomEntries = xmlDoc.querySelectorAll("entry");
    atomEntries.forEach(node => {
      const title = node.querySelector("title")?.textContent || "";
      const linkNode = node.querySelector("link");
      const link = linkNode?.getAttribute("href") || "";
      const updated = node.querySelector("updated")?.textContent;
      if (title && link) {
        items.push({ source: sourceName, title, link, published: updated || undefined });
      }
    });
  }

  return items;
}

// -------------------------
// Logic from Python Script
// -------------------------

function normalizeTitle(t: string): string {
  const STOP_WORDS = new Set([
    "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with",
    "as", "at", "by", "from", "is", "are", "was", "were", "be", "been"
  ]);
  
  let normalized = t.toLowerCase().trim();
  normalized = normalized.replace(/https?:\/\/\S+/g, ""); // remove urls
  normalized = normalized.replace(/[^a-z0-9\s]/g, " "); // remove punctuation
  
  return normalized
    .split(/\s+/)
    .filter(w => w && !STOP_WORDS.has(w))
    .join(" ");
}

// Jaccard Similarity for fuzzy matching
function calculateSimilarity(s1: string, s2: string): number {
  const set1 = new Set(s1.split(" "));
  const set2 = new Set(s2.split(" "));
  
  if (set1.size === 0 || set2.size === 0) return 0.0;
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

function dedupItems(items: FeedItem[], threshold = 0.5): FeedItem[] {
  const kept: FeedItem[] = [];
  const seenNorm: string[] = [];

  for (const item of items) {
    const n = normalizeTitle(item.title);
    if (!n) {
      kept.push(item);
      continue;
    }

    let isDup = false;
    for (const sn of seenNorm) {
      if (calculateSimilarity(n, sn) >= threshold) {
        isDup = true;
        break;
      }
    }

    if (!isDup) {
      kept.push(item);
      seenNorm.push(n);
    }
  }
  return kept;
}

function guessTopic(item: FeedItem): string {
  const t = item.title.toLowerCase();
  const s = item.source.toLowerCase();

  // Check AI
  if (s.includes("arxiv") || Array.from(AI_KEYWORDS).some(k => t.includes(k))) {
    return "ai";
  }
  
  // Check Business
  if (s.includes("financial times") || Array.from(BUSINESS_KEYWORDS).some(k => t.includes(k))) {
    return "business";
  }

  return "world";
}

function getRecencyBonus(published?: string): number {
  if (!published) return 0.0;
  try {
    const pubDate = new Date(published);
    const now = new Date();
    const hours = Math.max(0, (now.getTime() - pubDate.getTime()) / (1000 * 60 * 60));
    // Decay: 0.25 * exp(-hours / 36)
    return 0.25 * Math.exp(-hours / 36.0);
  } catch {
    return 0.0;
  }
}

function rankScore(item: FeedItem): number {
  const base = SOURCE_WEIGHT[item.source] || 0.75;
  const topic = guessTopic(item);
  
  let topicBoost = 0.0;
  if (topic === "ai") topicBoost = 0.05;
  if (topic === "business") topicBoost = 0.03;
  
  return base + topicBoost + getRecencyBonus(item.published);
}

// -------------------------
// Main Service Function
// -------------------------

export async function fetchAndCurateFeed(): Promise<CuratedFeeds> {
  // 1. Fetch all raw items
  const promises = Object.entries(FEEDS).map(async ([name, url]) => {
    const xml = await fetchWithProxy(url);
    if (!xml) return [];
    return parseFeedXML(name, xml);
  });

  const results = await Promise.all(promises);
  let allItems: FeedItem[] = results.flat();

  // 2. Rank
  allItems = allItems.map(item => ({
    ...item,
    score: rankScore(item),
    topic: guessTopic(item)
  })).sort((a, b) => (b.score || 0) - (a.score || 0));

  // 3. Deduplicate
  const uniqueItems = dedupItems(allItems);

  // 4. Mix / Categorize
  const curated: CuratedFeeds = {
    world: [],
    ai: [],
    business: []
  };

  const MAX_PER_CATEGORY = 5;

  uniqueItems.forEach(item => {
    const t = item.topic || "world";
    if (curated[t] && curated[t].length < MAX_PER_CATEGORY) {
      curated[t].push(item);
    } else if (!curated[t]) {
      // Fallback for unexpected topics
      if (!curated["world"]) curated["world"] = [];
      if (curated["world"].length < MAX_PER_CATEGORY) curated["world"].push(item);
    }
  });

  return curated;
}