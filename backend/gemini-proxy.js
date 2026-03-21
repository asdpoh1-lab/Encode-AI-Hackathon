const express = require('express');
const router = express.Router();

router.post('/gemini-query', async (req, res) => {
  const { prompt } = req.body;
  const key = process.env.GEMINI_API_KEY || '';

  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY not set in .env' });
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  try {
    const t0 = Date.now();
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${key}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: AbortSignal.timeout(30000),
    });

    const json = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: json?.error?.message || JSON.stringify(json) });
    }

    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    res.json({ text, latency: Date.now() - t0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;