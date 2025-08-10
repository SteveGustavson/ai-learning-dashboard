// server/server.js
// Reliable dynamic feeds + arXiv API + fast timeouts + optional AI summaries.
// Also serves /api/resources (local) and /api/chat (OpenAI proxy).

const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // v2.x
const bodyParser = require('body-parser');
const cors = require('cors');
const RSSParser = require('rss-parser');

const app = express();
const PORT = process.env.PORT || 3000;

/* -------------------- ENV + DEFAULTS -------------------- */

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const SUMMARIZE = String(process.env.SUMMARIZE || 'false').toLowerCase() === 'true';

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000); // article/summary fetch
const FEED_TIMEOUT_MS = Number(process.env.FEED_TIMEOUT_MS || 10000);       // per-feed
const MAX_ITEMS_PER_FEED = Number(process.env.MAX_ITEMS_PER_FEED || 8);
const TOTAL_MAX_ITEMS = Number(process.env.TOTAL_MAX_ITEMS || 25);

/* -------------------- FEEDS (UPDATED) -------------------- */
/* Replaced the two 404 feeds with working ones and added fallbacks. */
const BLOG_FEEDS = [
  // BAIR (Berkeley AI)
  'https://bair.berkeley.edu/blog/feed.xml',
  // The Gradient
  'https://thegradient.pub/rss/',
  // Microsoft Research
  'https://www.microsoft.com/en-us/research/feed/',
  // Google AI (category)
  'https://blog.google/technology/ai/rss/',
  // Google Blog (site-wide fallback)
  'https://blog.google/feed/',
  // DeepMind (classic)
  'https://deepmind.com/blog/feed/basic',
  // DeepMind (new domain)
  'https://deepmind.google/blog/rss.xml'
];

// arXiv API (Atom) for cs.CL and cs.LG — faster and more reliable than public RSS endpoints
const ARXIV_FEEDS = [
  'http://export.arxiv.org/api/query?search_query=cat:cs.CL&start=0&max_results=10&sortBy=submittedDate&sortOrder=descending',
  'http://export.arxiv.org/api/query?search_query=cat:cs.LG&start=0&max_results=10&sortBy=submittedDate&sortOrder=descending'
];

/* -------------------- APP MIDDLEWARE -------------------- */
app.use(cors());
app.use(bodyParser.json());

/* -------------------- HELPERS -------------------- */

const parser = new RSSParser({
  timeout: FEED_TIMEOUT_MS
});

function fetchWithTimeout(url, ms) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ai-learning-dashboard/1.0' }
    })
      .then(res => {
        clearTimeout(id);
        resolve(res);
      })
      .catch(err => {
        clearTimeout(id);
        reject(err);
      });
  });
}

async function parseFeed(url) {
  try {
    const res = await fetchWithTimeout(url, FEED_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const parsed = await parser.parseString(xml);
    const items = (parsed.items || []).slice(0, MAX_ITEMS_PER_FEED).map(it => ({
      id: it.guid || it.id || it.link || (it.title || '').slice(0, 80),
      title: it.title || 'Untitled',
      link: it.link || '',
      isoDate: it.isoDate || it.pubDate || '',
      source: parsed.title || url,
      // Trim long descriptions to keep the UI snappy; we’ll optionally summarize later
      summary: (it.contentSnippet || it.content || it.summary || '')
        .toString()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500)
    }));
    return { ok: true, url, items };
  } catch (e) {
    console.error(`Feed error: ${url} ${e.message || e}`);
    return { ok: false, url, items: [] };
  }
}

async function collectFeeds() {
  const urls = [...BLOG_FEEDS, ...ARXIV_FEEDS];
  const results = await Promise.all(urls.map(u => parseFeed(u)));
  const all = results.flatMap(r => r.items);
  all.sort((a, b) => (new Date(b.isoDate || 0)) - (new Date(a.isoDate || 0)));
  return all.slice(0, TOTAL_MAX_ITEMS);
}

// Optional: fetch a tiny HTML preview; many sites block scraping, so this is best-effort only.
// We keep it lightweight (no Readability/JS-DOM) to avoid extra deps.
async function fetchPreview(url) {
  try {
    const res = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    // Return first ~1000 chars for context; client shows the AI summary or this snippet.
    return html.replace(/\s+/g, ' ').slice(0, 1000);
  } catch (e) {
    console.error(`Readable fetch failed: ${url} ${e.message || e}`);
    return '';
  }
}

async function summarizeText(text) {
  if (!SUMMARIZE || !OPENAI_API_KEY) return '';
  const snippet = text.slice(0, 3500);
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: 'Summarize clearly in 3–5 bullets for a senior product/design leader. Include what’s new and why it matters.' },
          { role: 'user', content: snippet }
        ],
        temperature: 0.2,
        max_tokens: 280
      })
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error('OpenAI summarize error:', JSON.stringify(data, null, 2));
      return '';
    }
    return (data.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    console.error('OpenAI summarize error:', e);
    return '';
  }
}

/* -------------------- API: STATIC RESOURCES -------------------- */

app.get('/api/resources', (_req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'resources.json'), 'utf8'));
    res.json({ resources: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read resources' });
  }
});

/* -------------------- API: DYNAMIC NEWS -------------------- */

app.get('/api/news', async (_req, res) => {
  try {
    const items = await collectFeeds();

    // Enrich: tiny HTML preview + optional AI summary
    const enriched = await Promise.all(items.map(async it => {
      const preview = await fetchPreview(it.link);
      const aiSummary = preview ? await summarizeText(preview) : '';
      return {
        id: it.id,
        title: it.title,
        link: it.link,
        source: it.source,
        isoDate: it.isoDate,
        // Prefer AI summary if available; otherwise fall back to feed summary or preview
        summary: aiSummary || it.summary || preview
      };
    }));

    res.json({ items: enriched });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch news', details: e.message || String(e) });
  }
});

/* -------------------- API: CHAT PROXY -------------------- */

app.post('/api/chat', async (req, res) => {
  const { resourceId, message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  // Pull from local resources for now (you can also wire to /api/news if you want).
  let resources = [];
  try {
    resources = JSON.parse(fs.readFileSync(path.join(__dirname, 'resources.json'), 'utf8'));
  } catch (_) {}

  const resource = resources.find(r => r.id === resourceId);
  const rawContext = resource ? (resource.summary || resource.content || resource.title || '') : '';
  const context = rawContext.length > 3000 ? rawContext.slice(0, 3000) + '\n\n[Truncated]' : rawContext;

  const systemPrompt = `You are an expert tutor for a senior product design and user research leader.
Use the provided resource context if present; be concise and actionable.`;

  const messages = [{ role: 'system', content: systemPrompt }];
  if (context) messages.push({ role: 'system', content: `RESOURCE:\n${context}` });
  messages.push({ role: 'user', content: message });

  if (!OPENAI_API_KEY) {
    return res.status(200).json({
      reply: { role: 'assistant', content: '(No OPENAI_API_KEY set on server; add it in Render → Environment.)' }
    });
  }

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        max_tokens: 800,
        temperature: 0.2
      })
    });

    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!resp.ok || !data) {
      return res.status(500).json({ error: 'OpenAI API error', details: text.slice(0, 2000) });
    }
    const reply = data.choices?.[0]?.message || { role: 'assistant', content: '' };
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: 'Chat proxy failed', details: err.message });
  }
});

/* -------------------- STATIC CLIENT -------------------- */

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Client not built. Run `npm run build`.'));
}

/* -------------------- START -------------------- */

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
