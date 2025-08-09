// server/server.js
// Full dynamic server: pulls RSS feeds, fetches full pages, summarizes, classifies, caches.

const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');              // v2.x (compatible with Node 18+ here)
const bodyParser = require('body-parser');
const cors = require('cors');
const RSSParser = require('rss-parser');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const pLimit = require('p-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Config via env ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const REFRESH_MINUTES = parseInt(process.env.REFRESH_MINUTES || '60', 10);
const MAX_ITEMS = parseInt(process.env.MAX_ITEMS || '25', 10);
const SUMMARIZE = (process.env.SUMMARIZE || 'true').toLowerCase() === 'true';

// --- Feeds (tweak as you like) ---
const FEEDS = [
  'https://huggingface.co/blog/feed.xml',
  'https://openai.com/blog/rss.xml',
  'https://wandb.ai/site/blog/rss.xml',
  'https://lilianweng.github.io/index.xml',
  'https://arxiv.org/rss/cs.LG',
  'https://arxiv.org/rss/cs.CL'
];

// --- Middleware ---
app.use(cors());
app.use(bodyParser.json());

// --- In-memory cache ---
let cache = { updatedAt: 0, items: [] };

// --- Helpers ---
const parser = new RSSParser();
const limiter = pLimit(3); // avoid hammering sites

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
    const r = await fetch(url, { timeout: 15000 });
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

async function summarizeRich(title, url, fulltext) {
  if (!OPENAI_API_KEY || !SUMMARIZE) return '';
  const messages = [
    { role: 'system', content: 'You are a precise, no-fluff summarizer for a senior product design & research leader.' },
    { role: 'user', content:
`Summarize the article in rich form. Output markdown with:

**Key Points (3–5 bullets)**
**Why it matters (2 bullets)**
**What to do next (2 bullets)**
**Notable terms (short glossary)**

Title: ${title}
URL: ${url}
Content (truncated below):
${(fulltext || '').slice(0, 6000)}
` }
  ];
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, messages, temperature: 0.2, max_tokens: 700 })
    });
    if (!resp.ok) {
      const t = await resp.text();
      console.warn('OpenAI summarize error:', t);
      return '';
    }
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content?.trim() || '';
  } catch (e) {
    console.warn('OpenAI summarize exception:', e.message);
    return '';
  }
}

async function fetchFeeds() {
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
      console.warn('Feed error:', url, e.message);
    }
  }

  collected.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  const trimmed = collected.filter(x => x.url).slice(0, MAX_ITEMS);

  const enriched = await Promise.all(
    trimmed.map(item => limiter(async () => {
      const full = await fetchReadable(item.url);
      const rich = await summarizeRich(item.title, item.url, full || item.snippet);
      const track = classifyTrack(item.title, rich || full || item.snippet);
      return {
        id: Buffer.from(item.url).toString('base64').slice(0, 24),
        title: item.title,
        track,
        level: 'Foundations',              // could be improved later
        type: 'Article',
        summary: rich || item.snippet || 'New article',
        content: `${item.source} • ${item.publishedAt || ''}`,
        url: item.url
      };
    }))
  );

  cache = { updatedAt: Date.now(), items: enriched };
  console.log(`Feeds refreshed: ${enriched.length} items`);
}

// Kick off once on boot, then on interval
(async () => {
  try { await fetchFeeds(); } catch (e) { console.warn('Initial fetch failed:', e.message); }
  setInterval(fetchFeeds, REFRESH_MINUTES * 60 * 1000);
})();

// --- API routes ---

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

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, messages, temperature: 0.2, max_tokens: 800 })
    });

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

// --- Static client (built by Vite) ---
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Client not built. Run `npm run build`.'));
}

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
