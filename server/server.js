// server/server.js
const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const cors = require('cors');
const RSSParser = require('rss-parser');

const app = express();
const PORT = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// ----- CONFIG: tweak these if you want -----
const FEEDS = [
  // Add/remove sources freely
  'https://huggingface.co/blog/feed.xml',
  'https://openai.com/blog/rss.xml',
  'https://wandb.ai/site/blog/rss.xml',
  'https://lilianweng.github.io/index.xml',
  'https://arxiv.org/rss/cs.LG',
  'https://arxiv.org/rss/cs.CL'
];

const REFRESH_MINUTES = parseInt(process.env.REFRESH_MINUTES || '60', 10);
const MAX_ITEMS = parseInt(process.env.MAX_ITEMS || '25', 10);
const SUMMARIZE = (process.env.SUMMARIZE || 'true').toLowerCase() === 'true'; // set false to skip OpenAI cost
// ------------------------------------------

app.use(cors());
app.use(bodyParser.json());

// In-memory cache
let cache = {
  updatedAt: 0,
  items: []
};

const parser = new RSSParser();

// Simple keyword router to your tracks
function classifyTrack(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  if (/(mlops|ai ops|observability|monitoring|deployment|retrieval|vector)/.test(text)) return 'AI Ops';
  if (/(fine[- ]?tuning|sft|rlhf|rlaif|reward|policy|ppo|dpo)/.test(text)) return 'SFT/RL';
  if (/(eval|benchmark|truthfulqa|mmlu|helm|metrics)/.test(text)) return 'Evals';
  if (/(experiment|a\/b|bandit|bayesian|hypothesis)/.test(text)) return 'Experiments';
  return 'AI Ops'; // default bucket
}

async function openaiSummarize(title, link, content) {
  if (!OPENAI_API_KEY) return '';
  const prompt = [
    { role: 'system', content: 'Summarize the article for a senior product design & research leader. Output 2 crisp bullets (≤35 words each). Avoid hype. Mention why it matters for product/UX.' },
    { role: 'user', content: `Title: ${title}\nURL: ${link}\nContent preview:\n${content?.slice(0, 1500) || ''}` }
  ];

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, messages: prompt, temperature: 0.2, max_tokens: 220 })
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
  const unified = [];
  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      for (const it of feed.items || []) {
        const title = it.title || '(untitled)';
        const link = it.link || it.guid || '';
        const pub = it.isoDate || it.pubDate || '';
        const description = it.contentSnippet || it.summary || it.content || '';
        unified.push({
          id: Buffer.from(link || title).toString('base64').slice(0, 24),
          title,
          url: link,
          source: feed.title || url,
          publishedAt: pub,
          rawSummary: description
        });
      }
    } catch (e) {
      console.warn('Feed error:', url, e.message);
    }
  }

  // Sort newest first and trim
  unified.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  const trimmed = unified.slice(0, MAX_ITEMS);

  // Summarize + map to app schema
  const results = [];
  for (const item of trimmed) {
    const sum = SUMMARIZE ? await openaiSummarize(item.title, item.url, item.rawSummary) : '';
    const track = classifyTrack(item.title, sum || item.rawSummary);
    results.push({
      id: item.id,
      title: item.title,
      track,
      level: 'Foundations', // you can get fancy later
      type: 'Article',
      summary: sum || item.rawSummary || 'New article',
      content: `${item.source} • ${item.publishedAt || ''}`,
      url: item.url
    });
  }

  cache = { updatedAt: Date.now(), items: results };
}

// First fetch on boot, then on an interval
(async () => {
  await fetchFeeds();
  setInterval(fetchFeeds, REFRESH_MINUTES * 60 * 1000);
})();

// API: resources from cache
app.get('/api/resources', async (req, res) => {
  // Optional: allow manual refresh via query ?refresh=1
  if (req.query.refresh === '1') {
    await fetchFeeds();
  }
  res.json({ updatedAt: cache.updatedAt, resources: cache.items });
});

// Chat proxy (unchanged except reading resource URL/content from the client)
app.post('/api/chat', async (req, res) => {
  const { resourceId, message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const resource = cache.items.find(r => r.id === resourceId);
  const context = resource
    ? `TITLE: ${resource.title}\nURL: ${resource.url}\nSUMMARY: ${resource.summary}\nTRACK: ${resource.track}`
    : '';

  const systemPrompt = `You are an expert tutor for a senior product design and user research leader. Use the resource context if provided; be concise and actionable.`;

  const messages = [{ role: 'system', content: systemPrompt }];
  if (context) messages.push({ role: 'system', content: `RESOURCE:\n${context}` });
  messages.push({ role: 'user', content: message });

  try {
    if (!OPENAI_API_KEY) {
      return res.json({ reply: { role: 'assistant', content: 'Add OPENAI_API_KEY to enable chat.' } });
    }
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, messages, max_tokens: 800, temperature: 0.2 })
    });
    if (!resp.ok) {
      const txt = await resp.text();
      return res.status(500).json({ error: 'OpenAI API error', details: txt });
    }
    const data = await resp.json();
    const reply = data.choices?.[0]?.message || { role: 'assistant', content: '' };
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: 'Chat proxy failed', details: err.message });
  }
});

// Serve static client (if built)
const fs = require('fs');
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else {
  app.get('/', (req, res) => res.send('Client not built. Run `npm run build`.'));
}

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
