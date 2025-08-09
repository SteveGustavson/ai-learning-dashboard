// server/server.js
// Minimal, reliable feeds + arXiv API + fast-fail timeouts.
// Summarization is optional (env SUMMARIZE=true). Default: off.

const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const cors = require('cors');
const RSSParser = require('rss-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- OpenAI config (summaries off until quota set) ----------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const SUMMARIZE = String(process.env.SUMMARIZE || 'false').toLowerCase() === 'true';

// ---------- Timeouts / limits ----------
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000); // 15s
const FEED_TIMEOUT_MS = Number(process.env.FEED_TIMEOUT_MS || 10000);       // 10s per feed
const MAX_ITEMS_PER_FEED = Number(process.env.MAX_ITEMS_PER_FEED || 8);
const TOTAL_MAX_ITEMS = Number(process.env.TOTAL_MAX_ITEMS || 25);

// ---------- Feeds (reliable set) ----------
const FEEDS = [
  // BAIR (Berkeley AI) blog
  'https://bair.berkeley.edu/blog/feed.xml',
  // The Gradient
  'https://thegradient.pub/rss/',
  // Microsoft Research blog (official RSS)
  'https://www.microsoft.com/en-us/research/feed/',
  // NOTE: We intentionally skip W&B + OpenAI blog feeds for now (flaky/malformed/timeouts)
];

// arXiv API endpoints (Atom feeds that parse well; faster than their public RSS endpoints)
const ARXIV_FEEDS = [
  'http://export.arxiv.org/api/query?search_query=cat:cs.CL&start=0&max_results=10&sortBy=submittedDate&sortOrder=descending',
  'http://export.arxiv.org/api/query?search_query=cat:cs.LG&start=0&max_results=10&sortBy=submittedDate&sortOrder=descending',
];

// ---------- Helpers ----------
app.use(cors());
app.use(bodyParser.json());

// Timeout helper for fetch
function fetchWithTimeout(url, ms) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'ai-learning-dashboard/1.0' } })
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

async function parseFeed(url, parser) {
  try {
    const res = await fetchWithTimeout(url, FEED_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const parsed = await parser.parseString(text);
    const items = (parsed.items || []).slice(0, MAX_ITEMS_PER_FEED).map(it => ({
      id: it.guid || it.id || it.link || (it.title || '').slice(0, 80),
      title: it.title || 'Untitled',
      link: it.link || '',
      isoDate: it.isoDate || it.pubDate || '',
      source: parsed.title || url,
      summary: (it.contentSnippet || it.content || it.summary || '').toString().trim().slice(0, 500),
    }));
    return { ok: true, url, items };
  } catch (e) {
    console.error(`Feed error: ${url} ${e.message || e}`);
    return { ok: false, url, items: [] };
  }
}

async function collectFeeds() {
  const parser = new RSSParser({
    timeout: FEED_TIMEOUT_MS,
  });

  const urls = [...FEEDS, ...ARXIV_FEEDS];
  const results = await Promise.all(urls.map(u => parseFeed(u, parser)));

  // flatten + sort by date desc + cap
  const all = results.flatMap(r => r.items);
  all.sort((a, b) => (new Date(b.isoDate || 0)) - (new Date(a.isoDate || 0)));
  return all.slice(0, TOTAL_MAX_ITEMS);
}

// best-effort HTML fetch (for “readable” previews); many sites block – we keep it optional
async function fetchReadable(url) {
  try {
    const res = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // We don’t run heavy readability parsing on the server to keep it simple & fast;
    // just return the first ~1500 chars of the HTML as a fallback preview.
    const html = await res.text();
    return html.slice(0, 1500);
  } catch (e) {
    console.error(`Readable fetch failed: ${url} ${e.message || e}`);
    return '';
  }
}

async function summarizeText(text) {
  if (!SUMMARIZE || !OPENAI_API_KEY) return ''; // disabled
  const snippet = text.slice(0, 4000);
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
        max_tokens: 300
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

// ---------- API Routes ----------
app.get('/api/resources', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'resources.json'), 'utf8'));
    res.json({ resources: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read resources' });
  }
});

// Pull fresh items across feeds + (optional) quick preview/summaries
app.get('/api/news', async (req, res) => {
  try {
    const items = await collectFeeds();

    // Optionally fetch a tiny HTML preview & summarize
    const enriched = await Promise.all(items.map(async (it) => {
      const preview = await fetchReadable(it.link);
      const summary = preview ? await summarizeText(preview) : '';
      return { ...it, preview, aiSummary: summary };
    }));

    res.json({ items: enriched });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch news', details: e.message || String(e) });
  }
});

// Chat proxy (unchanged from your working version, slight hardening)
app.post('/api/chat', async (req, res) => {
  const { resourceId, message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  let resources = [];
  try {
    resources = JSON.parse(fs.readFileSync(path.join(__dirname, 'resources.json'), 'utf8'));
  } catch (_) {}

  const resource = resources.find(r => r.id === resourceId);
  const rawContext = resource ? (resource.summary || resource.content || resource.title || '') : '';
  const context = rawContext.length > 3000 ? rawContext.slice(0, 3000) + '\n\n[Truncated]' : rawContext;

  const systemPrompt = `You are an expert tutor for a senior product design and user research leader. Use the provided resource (if any) to give clear, actionable answers, examples, and follow-up questions. Be concise.`;

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

// Serve built client
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else {
  app.get('/', (req, res) => res.send('Client not built. Run `npm run build`.'));
}

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
