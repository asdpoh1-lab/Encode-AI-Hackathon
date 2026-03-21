const express = require('express');
const router = express.Router();

router.post('/qwen-query', async (req, res) => {
  const { prompt } = req.body;
  const key = process.env.HF_API_KEY || '';

  if (!key) return res.status(500).json({ error: 'HF_API_KEY not set in .env' });
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  try {
    const t0 = Date.now();
    const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'Qwen/Qwen2.5-72B-Instruct',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
        provider: { order: ['sambanova'] },
      }),
      signal: AbortSignal.timeout(60000),
    });

    const json = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: json?.error?.message || JSON.stringify(json) });
    }

    const text = json?.choices?.[0]?.message?.content ?? '';
    res.json({ text, latency: Date.now() - t0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;