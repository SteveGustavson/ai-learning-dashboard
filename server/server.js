const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

if (!OPENAI_API_KEY) console.warn('OPENAI_API_KEY not set.');

app.use(cors());
app.use(bodyParser.json());

app.get('/api/resources', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'resources.json'), 'utf8'));
    res.json({ resources: data });
  } catch {
    res.status(500).json({ error: 'Failed to read resources' });
  }
});

app.post('/api/chat', async (req, res) => {
  const { resourceId, message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  let resources = [];
  try {
    resources = JSON.parse(fs.readFileSync(path.join(__dirname, 'resources.json'), 'utf8'));
  } catch {}

  const resource = resources.find(r => r.id === resourceId);
  const context = resource ? (resource.summary || resource.content || '') : '';

  const messages = [
    { role: 'system', content: 'You are an expert tutor for a senior product design and research leader.' },
    { role: 'system', content: `RESOURCE:\n${context}` },
    { role: 'user', content: message }
  ];

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        max_tokens: 800,
        temperature: 0.2
      })
    });

    const data = await resp.json();
    res.json({ reply: data.choices?.[0]?.message || { role: 'assistant', content: '' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
