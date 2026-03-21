const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { initDb } = require('./db');
const { getTasks, getLeaderboard, submitResult } = require('./routes');

const app = express();
app.use(cors());
app.use(express.json());

const db = initDb();
app.set('db', db);

let leaderboardListeners = [];

const submitTokens = new Map();
/** Hackathon / demo: long TTL so tokens don’t expire mid-demo. Still one-time use. */
const TOKEN_TTL_MS = 90 * 60 * 1000;

function createSubmitToken() {
  const token = crypto.randomBytes(16).toString('hex');
  submitTokens.set(token, { createdAt: Date.now(), used: false });
  return token;
}

function consumeSubmitToken(token) {
  const rec = submitTokens.get(token);
  if (!rec) return false;
  if (rec.used) return false;
  if (Date.now() - rec.createdAt > TOKEN_TTL_MS) return false;
  rec.used = true;
  return true;
}

function broadcast(data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  const chunk = 'data: ' + payload + '\n\n';
  leaderboardListeners.forEach((res) => {
    try {
      res.write(chunk);
      if (res.flush) res.flush();
      else if (res.socket && !res.socket.destroyed) res.socket.setNoDelay(true);
    } catch (_) {}
  });
  leaderboardListeners = leaderboardListeners.filter((res) => !res.writableEnded);
}

function broadcastLeaderboardUpdate(agentId) {
  const payload = { type: 'leaderboard' };
  if (agentId) payload.agentId = agentId;
  broadcast(payload);
}

app.get('/leaderboard/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  if (res.socket && !res.socket.destroyed) res.socket.setNoDelay(true);
  leaderboardListeners.push(res);
  req.on('close', () => {
    leaderboardListeners = leaderboardListeners.filter((r) => r !== res);
  });
});

app.get('/tasks', (req, res) => {
  try {
    const tasks = getTasks(db);
    res.json(tasks);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

app.get('/leaderboard', (req, res) => {
  try {
    const data = getLeaderboard(db, new Map());
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Leaderboard failed' });
  }
});

app.get('/agents', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, name, webhook_url, created_at FROM agents ORDER BY created_at DESC').all();
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

app.get('/debug/runs/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    const runs = db.prepare(`
      SELECT task_id, run_index, score, latency_ms, response_text, created_at
      FROM runs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 30
    `).all(agentId);
    const out = runs.map((r) => ({
      task_id: r.task_id,
      run_index: r.run_index,
      score: r.score,
      latency_ms: r.latency_ms,
      response_preview: r.response_text ? r.response_text.slice(0, 300) : null,
      created_at: r.created_at,
    }));
    res.json({ agentId, count: out.length, runs: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

app.get('/get-submit-token', (req, res) => {
  try {
    const token = createSubmitToken();
    res.json({ token, expiresIn: Math.floor(TOKEN_TTL_MS / 1000) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

app.post('/submit-result', (req, res) => {
  try {
    const { token, agent_name, results } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token is required' });
    }
    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'results array is required' });
    }
    if (!consumeSubmitToken(token)) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    const name = agent_name && typeof agent_name === 'string' ? agent_name : 'Unnamed Agent';
    const agent = submitResult(db, name, results);
    broadcastLeaderboardUpdate(agent.id);
    res.status(201).json(agent);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Submit failed' });
  }
});

/** Local default 3001; PaaS sets PORT. Listen on 0.0.0.0 so Railway/Render/Fly can reach the process. */
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Agent Olympics API listening on http://${HOST}:${PORT}`);
});
