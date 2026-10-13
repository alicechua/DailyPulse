import { XMLParser } from 'fast-xml-parser';
import { DAY_MS, daysAgo, fetchJson, fetchText, isoDate, retryWithBackoff, stripHtml, truncate } from './util.mjs';

// ------------------------------------------------------------------
// SOURCE CONFIGURATION
// ------------------------------------------------------------------

const googleNews = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

/**
 * RSS/Atom feeds. Categories: world | tech | ai_news.
 * `weight` ranks sources within a category; `gnews` strips Google News' " - Publisher" title suffix.
 */
export const FEEDS = {
  // World
  bbc_news:       { label: 'BBC', category: 'world', weight: 1.0, url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  ft_home:        { label: 'FT', category: 'world', weight: 0.95, url: 'https://www.ft.com/rss/home' },
  guardian_world: { label: 'Guardian', category: 'world', weight: 0.9, url: 'https://www.theguardian.com/world/rss' },
  al_jazeera:     { label: 'Al Jazeera', category: 'world', weight: 0.85, url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  reuters_world:  { label: 'Reuters', category: 'world', weight: 0.85, gnews: true, url: googleNews('site:reuters.com world when:2d') },

  // Tech & industry
  the_verge:      { label: 'The Verge', category: 'tech', weight: 0.9, url: 'https://www.theverge.com/rss/index.xml' },
  reuters_tech:   { label: 'Reuters', category: 'tech', weight: 0.85, gnews: true, url: googleNews('site:reuters.com technology when:2d') },

  // AI labs
  openai:         { label: 'OpenAI', category: 'ai_news', weight: 0.95, url: 'https://openai.com/news/rss.xml' },
  anthropic:      { label: 'Anthropic', category: 'ai_news', weight: 0.95, gnews: true, url: googleNews('site:anthropic.com when:7d') },
  deepmind:       { label: 'DeepMind', category: 'ai_news', weight: 0.95, url: 'https://deepmind.google/blog/feed/basic' },
  google_ai:      { label: 'Google AI', category: 'ai_news', weight: 0.9, url: 'https://blog.google/technology/ai/rss/' },
  hf_blog:        { label: 'HF Blog', category: 'ai_news', weight: 0.9, url: 'https://huggingface.co/blog/feed.xml' },

  // AI news
  techcrunch_ai:  { label: 'TechCrunch', category: 'ai_news', weight: 0.9, url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  reuters_ai:     { label: 'Reuters', category: 'ai_news', weight: 0.85, gnews: true, url: googleNews('site:reuters.com artificial intelligence OR AI when:2d') },
  ars_ai:         { label: 'Ars Technica', category: 'ai_news', weight: 0.85, url: 'https://arstechnica.com/ai/feed/' },
  mit_tr_ai:      { label: 'MIT Tech Review', category: 'ai_news', weight: 0.85, url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed' },

  // Newsletters & analysts
  simon_willison: { label: 'Simon Willison', category: 'ai_news', weight: 0.9, url: 'https://simonwillison.net/atom/everything/' },
  latent_space:   { label: 'Latent Space', category: 'ai_news', weight: 0.9, url: 'https://www.latent.space/feed' },
  interconnects:  { label: 'Interconnects', category: 'ai_news', weight: 0.9, url: 'https://www.interconnects.ai/feed' },
  import_ai:      { label: 'Import AI', category: 'ai_news', weight: 0.9, url: 'https://importai.substack.com/feed' },
  ahead_of_ai:    { label: 'Ahead of AI', category: 'ai_news', weight: 0.9, url: 'https://magazine.sebastianraschka.com/feed' },
};

/** Display labels for API (non-RSS) sources. */
export const API_SOURCES = {
  hacker_news: { label: 'HN' },
  github:      { label: 'GitHub' },
  hf_papers:   { label: 'HF Papers' },
  hf_models:   { label: 'HF Models' },
};

export const sourceLabel = (source) => FEEDS[source]?.label ?? API_SOURCES[source]?.label ?? source;

// Star-farmed "cracked software" repos flood GitHub's newest-repos listings
const GITHUB_SPAM = /\b(crack(ed|s)?|keygen|activat(or|ion)|serial[- ]key|license[- ]key|free[- ]download|full[- ]version|unlocker|cheats?|aimbot|spoofer|injector|executor|mod[- ]menu|torrent|warez)\b/i;

// ------------------------------------------------------------------
// RSS / ATOM
// ------------------------------------------------------------------

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  htmlEntities: true,
  isArray: (name) => name === 'item' || name === 'entry' || name === 'link',
});

const textOf = (value) => {
  if (value == null) return '';
  if (Array.isArray(value)) return textOf(value[0]);
  if (typeof value === 'object') return String(value['#text'] ?? '');
  return String(value);
};

function pickLink(links = []) {
  // Atom: <link rel="alternate" href="..."/>; RSS: <link>...</link>
  const atom = links.find(l => l?.['@_href'] && (!l['@_rel'] || l['@_rel'] === 'alternate')) ??
    links.find(l => l?.['@_href']);
  return atom ? atom['@_href'] : links.map(textOf).find(Boolean) ?? '';
}

function parseFeed(source, config, xml) {
  const doc = xmlParser.parse(xml);
  const entries = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? doc?.['rdf:RDF']?.item ?? [];

  return entries.map(entry => {
    let title = stripHtml(textOf(entry.title));
    if (config.gnews) title = title.replace(/(^|\s+)-\s+[^-]+$/, '').trim(); // "Title - Publisher"; untitled items become ""
    return {
      source,
      category: config.category,
      title,
      link: pickLink(entry.link) || textOf(entry.guid),
      published: textOf(entry.pubDate ?? entry.published ?? entry.updated ?? entry['dc:date']) || undefined,
      description: truncate(stripHtml(textOf(entry.description ?? entry.summary ?? entry['content:encoded'] ?? entry.content)), 500),
      weight: config.weight,
    };
  }).filter(item => item.title && item.link);
}

async function fetchFeed(source, config) {
  return parseFeed(source, config, await fetchText(config.url));
}

// ------------------------------------------------------------------
// APIS
// ------------------------------------------------------------------

/** Hacker News front-page-level stories from the last 36h (Algolia API, no key needed). */
async function fetchHackerNews() {
  const since = Math.floor((Date.now() - 36 * 60 * 60 * 1000) / 1000);
  const filters = encodeURIComponent(`created_at_i>${since},points>40`);
  const data = await fetchJson(`https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=80&numericFilters=${filters}`);

  return data.hits.filter(hit => hit.title).map(hit => ({
    source: 'hacker_news',
    category: 'discussion',
    title: hit.title,
    link: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    discussion: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    published: hit.created_at,
    description: truncate(stripHtml(hit.story_text || ''), 300),
    metrics: { points: hit.points, comments: hit.num_comments },
  }));
}

/**
 * Fast-rising new GitHub repos. There is no official "trending" API, so we search for
 * repos created recently and sort by stars (this week's top + the last 2 days' risers).
 */
async function fetchGitHubRepos(token) {
  const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const queries = [
    `created:>${isoDate(daysAgo(7))} stars:>100`,
    `created:>${isoDate(daysAgo(2))} stars:>20`,
  ];

  const repos = new Map();
  for (const query of queries) {
    const data = await fetchJson(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=50`,
      { headers },
    );
    for (const repo of data.items) repos.set(repo.full_name, repo);
  }

  return [...repos.values()]
    .filter(repo => !GITHUB_SPAM.test(`${repo.full_name} ${repo.description ?? ''} ${(repo.topics ?? []).join(' ')}`))
    .map(repo => {
      const ageDays = Math.max(1, (Date.now() - new Date(repo.created_at).getTime()) / DAY_MS);
      return {
        source: 'github',
        category: 'repos',
        title: repo.full_name,
        link: repo.html_url,
        published: repo.created_at,
        description: truncate([repo.description, repo.topics?.length ? `topics: ${repo.topics.slice(0, 6).join(', ')}` : '']
          .filter(Boolean).join(' · '), 300),
        metrics: { stars: repo.stargazers_count, starsPerDay: Math.round(repo.stargazers_count / ageDays), language: repo.language },
      };
    });
}

/**
 * Hugging Face Daily Papers (community-upvoted arXiv papers). Papers are grouped by the day
 * they were featured and upvotes accumulate during that day, so look back a few days.
 */
async function fetchHFPapers() {
  const items = [];
  for (let d = 0; d <= 4 && items.length < 40; d++) {
    const papers = await fetchJson(`https://huggingface.co/api/daily_papers?date=${isoDate(daysAgo(d))}&limit=100`);
    for (const { paper, numComments } of papers) {
      items.push({
        source: 'hf_papers',
        category: 'research',
        title: stripHtml(paper.title),
        link: `https://huggingface.co/papers/${paper.id}`,
        published: paper.submittedOnDailyAt ?? paper.publishedAt,
        description: truncate(stripHtml(paper.summary ?? ''), 500),
        metrics: { upvotes: paper.upvotes ?? 0, comments: numComments ?? 0 },
      });
    }
  }
  return items;
}

// Quantized re-uploads, LoRAs and uncensored fine-tunes: useful as trend signal, noise in the digest
const DERIVATIVE_MODEL = /gguf|awq|gptq|exl[23]|mlx|bnb|fp8|int[48]|\d(\.\d)?bpw|quant|uncensored|abliterated|heretic|lora\b/i;

/** Hugging Face models sorted by trending score. */
async function fetchHFTrendingModels() {
  const models = await fetchJson('https://huggingface.co/api/models?sort=trendingScore&limit=50');
  return models.map(model => {
    const tags = model.tags ?? [];
    const baseModels = [...new Set(tags.filter(t => t.startsWith('base_model:')).map(t => t.split(':').pop()))];
    return {
      source: 'hf_models',
      category: 'models',
      title: model.id,
      link: `https://huggingface.co/${model.id}`,
      published: model.createdAt,
      description: [
        model.pipeline_tag,
        baseModels.length ? `based on ${baseModels.join(', ')}` : '',
        tags.filter(t => !t.includes(':')).slice(0, 6).join(', '),
      ].filter(Boolean).join(' · '),
      metrics: { trending: model.trendingScore, likes: model.likes, downloads: model.downloads },
      derivative: DERIVATIVE_MODEL.test(model.id),
    };
  });
}

// ------------------------------------------------------------------
// FETCH EVERYTHING
// ------------------------------------------------------------------

/**
 * Fetches all sources in parallel. A failing source is logged and skipped.
 * Returns { items, health: { [source]: itemCount | 'error message' } }.
 */
export async function fetchAllSources({ githubToken } = {}) {
  const tasks = [
    ...Object.entries(FEEDS).map(([name, config]) => [name, () => fetchFeed(name, config)]),
    ['hacker_news', fetchHackerNews],
    ['github', () => fetchGitHubRepos(githubToken)],
    ['hf_papers', fetchHFPapers],
    ['hf_models', fetchHFTrendingModels],
  ];

  const results = await Promise.allSettled(
    tasks.map(([name, fn]) => retryWithBackoff(fn, { retries: 3, initialDelay: 2000, label: name })),
  );

  const items = [];
  const health = {};
  results.forEach((result, i) => {
    const name = tasks[i][0];
    if (result.status === 'fulfilled') {
      items.push(...result.value);
      health[name] = result.value.length;
      console.log(`   - ${name}: ${result.value.length} items`);
    } else {
      health[name] = result.reason?.message ?? String(result.reason);
      console.warn(`   ! ${name}: ${health[name]}`);
    }
  });

  return { items, health };
}
