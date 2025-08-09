// server/server.js
// Dynamic server: pulls RSS feeds, fetches full pages, summarizes (if quota allows), classifies, caches.

const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch'); // v2.x
const bodyParser = require('body-parser');
const cors = require('cors');
const RSSParser = require('rss-parser');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Env & safe defaults =====
function toInt(v, dflt) {
  const n = parseInt(String(v || '').trim(), 10);
  return Number.isFinite(n) ? n : dflt;
}

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-4o').trim();
const REFRESH_MINUTES_RAW = process.env.REFRESH_MINUTES;
const REFRESH_MINUTES = toInt(REFRESH_MINUTES_RAW, 60); // default 60 minutes
const MAX_ITEMS = toInt(process.env.MAX_ITEMS, 25);
let SUMMARIZE = ((process.env.SUMMARIZE || 'true').trim().toLowerCase() === 'true');

// Guard the refresh interval (min 5 min, max 24h)
const REFRESH_MS = Math.min(Math.max(REFRESH_MINUTES * 60 * 1000, 5 * 60 * 1000), 24 * 60 * 60 * 1000);

// ===== Feeds (reliable sources only) =====
// Removed W&B (malformed RSS) and kept stable ones; you can add back later.
const FEEDS = [
  'https://huggingface.co/blog/feed.xml',
  'https://ai.googleblog.com/atom.xml',
  'https://deepmind.google/discover/blog/feed.xml',
  'https://openai.com/blog/rss.xml',
  'https://arxiv.org/rss/cs.LG',
  'https://arxiv.org/rss/cs.CL'
];

// ===== Middleware =====
app.use(cors());
app.use(bodyParser.json());

// ===== In-memory cache =====
let cache = { updatedAt: 0, items: [] };

// ===== Helpers =====

// RSS parser with UA + timeouts
const parser = new RSSParser({
  timeout: 15000,
  requestOptions: {
    headers: {
      'User-Agent': 'AILearningDashboard/1.0 (+https://example.com)'
    }
  }
});

// Small, dependency-free concurrency helper
async function mapWithConcurrency(arr, concurrency, fn) {
  const results = new Array(arr.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= arr.length) break;
      results[idx] = await fn(arr[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), arr.length) }, worker);
  await Promise.all(workers);
  return results;
}

function classifyTrack(textA, textB = '') {
  const t = `${textA} ${textB}`.toLowerCase();
  if (/(mlops|ai ops|observability|monitoring|deployment|retrieval|vector)/.test(t)) return 'AI Ops';
  if (/(fine[- ]?tuning|sft|rlhf|rlaif|reward|policy|ppo|dpo)/.test(t)) return 'SFT/RL';
  if (/(eval|benchmark|truthfulqa|mmlu|helm|metrics)/.test(t)) return 'Evals';
  if (/(experiment|a\/b|bandit|bayesian|hypothesis)/.test(t)) return 'Experiments';
  return 'AI Ops';
}

async function fetchReadable(url) {
  try {
    const controller = new fetch.AbortController();
    const to = setTimeout(() => controller.abort(), 15000);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AILearningDashboard/1.0 (+https://example.com)' }
    });
    clearTimeout(to);
    const html = await r.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const text = (article?.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+\n/g, '\n')
      .trim();
    return text.slice(0, 12000); // keep it reasonable
  } catch (e) {
    console.warn('Readable fetch failed:', url, e.message);
    return '';
  }
}

// Will be flipped off for this refresh cycle if quota is exceeded
let summarizeDisabledForCycle = false;

async function summarizeRich(title, url, fulltext) {
  if (!OPENAI_API_KEY || !SUMMARIZE || summarizeDisabledForCycle) return '';
  const messages = [
    { role: 'system', content: 'You are a precise, no-fluff summarizer for a senior product design & research leader.' },
    {
      role: 'user',
      content: `Summarize the article in rich form. Output markdown with:

**Key Points (3–5 bullets)**
**Why it matters (2 bullets)**
**What to do next (2 bullets)**
**Notable terms (short glossary)**

Title: ${title}
URL: ${url}
Content (truncated below):
${(fulltext || '').slice(0, 6000)}`
    }
  ];
  try {
    const controller = new fetch.AbortController();
    const to = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, messages, temperature: 0.2, max_tokens: 700 })
    });
    clearTimeout(to);

    const t = await resp.text();
    if (!resp.ok) {
      // If we hit quota, disable summarization so we still serve content
      if (t.includes('"insufficient_quota"') || t.toLowerCase().includes('quota')) {
        console.warn('OpenAI quota exceeded. Disabling summarization this cycle.');
        summarizeDisabledForCycle = true;
      } else {
        console.warn('OpenAI summarize error:', t);
      }
      return '';
    }
    const data = JSON.parse(t);
    return data?.choices?.[0]?.message?.content?.trim() || '';
  } catch (e) {
    console.warn('OpenAI summarize exception:', e.message);
    return '';
  }
}

async function fetchFeeds() {
  console.log('Refreshing feeds…');
  summarizeDisabledForCycle = false; // reset for this run

  const collected = [];
  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      for (const it of (feed.items || [])) {
        collected.push({
          title: it.title || '(untitled)',
          url: it.link || it.guid || '',
          source: feed.title || url,
          publishedAt: it.isoDate || it.pubDate || '',
          snippet: it.contentSnippet || it.summary || it.content || ''
        });
      }
    } catch (e) {
      console.warn('Feed error:', url, e.message || e);
    }
  }

  // Sort newest first and trim
  collected.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  const trimmed = collected.filter(x => x.url).slice(0, MAX_ITEMS);

  // Enrich with readability + (optional) summary
  const enriched = await mapWithConcurrency(trimmed, 2, async (item) => {
    const full = await fetchReadable(item.url);
    const rich = await summarizeRich(item.title, item.url, full || item.snippet);
    const track = classifyTrack(item.title, rich || full || item.snippet);
    const summaryFallback = rich || (full ? full.slice(0, 800) + '…' : item.snippet || 'New article');
    return {
      id: Buffer.from(item.url).toString('base64').slice(0, 24),
      title: item.title,
      track,
      level: 'Foundations',
      type: 'Article',
      summary: summaryFallback,
      content: `${item.source} • ${item.publishedAt || ''}`,
      url: item.url
    };
  });

  cache = { updatedAt: Date.now(), items: enriched };
  console.log(`Feeds refreshed: ${enriched.length} items`);
}

// Kick off once on boot, then on interval (guarded)
(async () => {
  try { await fetchFeeds(); } catch (e) { console.warn('Initial fetch failed:', e.message); }
  const interval = Number.isFinite(REFRESH_MS) ? REFRESH_MS : 60 * 60 * 1000; // 60 min fallback
  setInterval(fetchFeeds, interval);
})();

// ===== API routes =====

// Live resources (allow ?refresh=1 to force)
app.get('/api/resources', async (req, res) => {
  try {
    if (req.query.refresh === '1') {
      await fetchFeeds();
    }
    res.json({ updatedAt: cache.updatedAt, resources: cache.items });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read resources', details: e.message });
  }
});

// Chat proxy with better error details
app.post('/api/chat', async (req, res) => {
  const { resourceId, message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const resource = cache.items.find(r => r.id === resourceId);
  const context = resource
    ? `TITLE: ${resource.title}\nURL: ${resource.url}\nSUMMARY:\n${resource.summary}\nTRACK: ${resource.track}`
    : '';

  const systemPrompt = `You are an expert tutor for a senior product design and user research leader.
Use the resource context if provided; be concise and actionable.`;

  const messages = [{ role: 'system', content: systemPrompt }];
  if (context) messages.push({ role: 'system', content: `RESOURCE:\n${context}` });
  messages.push({ role: 'user', content: message });

  try {
    if (!OPENAI_API_KEY) {
      return res.json({ reply: { role: 'assistant', content: 'Add OPENAI_API_KEY in your Render Environment to enable chat.' } });
    }

    const controller = new fetch.AbortController();
    const to = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, messages, temperature: 0.2, max_tokens: 800 })
    });
    clearTimeout(to);

    const text = await resp.text(); // capture raw for better error details
    if (!resp.ok) {
      return res.status(500).json({ error: 'OpenAI API error', details: text.slice(0, 2000) });
    }
    const data = JSON.parse(text);
    const reply = data?.choices?.[0]?.message || { role: 'assistant', content: '' };
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: 'Chat proxy failed', details: err.message });
  }
});

// ===== Static client (built by Vite) =====
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Client not built. Run `npm run build`.'));
}

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
