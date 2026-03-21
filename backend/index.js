require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { initDb } = require('./db');
const {
  getTasksForHeat,
  getLeaderboard,
  submitResult,
  getWinnerPayload,
  parseTaskIdsJson,
} = require('./routes');
const hfProxy = require('./hf-proxy');
const geminiProxy = require('./gemini-proxy');
const qwenProxy = require('./qwen-proxy');
const { validateSubmitResults, normalizeAgentNameForClaim } = require('./submitValidation');
const heatStore = require('./heatStore');


const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', hfProxy);
app.use('/api', geminiProxy);
app.use('/api', qwenProxy);

const db = initDb();
app.set('db', db);

app.use((req, res, next) => {
  const fromHeader = req.headers['x-request-id'];
  const reqId =
    typeof fromHeader === 'string' && fromHeader.trim()
      ? fromHeader.trim()
      : crypto.randomUUID();
  req.requestId = reqId;
  res.setHeader('x-request-id', reqId);
  next();
});

let leaderboardListeners = [];
let sseWriteErrorCount = 0;

const TOKEN_TTL_MS = 90 * 60 * 1000;
const insertSubmitToken = db.prepare(
  `INSERT INTO submit_tokens (token, created_at_ms, expires_at_ms, reserved, used)
   VALUES (?, ?, ?, 0, 0)`
);
const reserveSubmitTokenStmt = db.prepare(
  `UPDATE submit_tokens
   SET reserved = 1
   WHERE token = ? AND used = 0 AND reserved = 0 AND expires_at_ms > ?`
);
const releaseSubmitTokenStmt = db.prepare(
  `UPDATE submit_tokens
   SET reserved = 0
   WHERE token = ? AND used = 0 AND reserved = 1`
);
const consumeSubmitTokenStmt = db.prepare(
  `UPDATE submit_tokens
   SET used = 1
   WHERE token = ? AND used = 0 AND reserved = 1`
);
const cleanupSubmitTokensStmt = db.prepare(
  `DELETE FROM submit_tokens WHERE used = 1 OR expires_at_ms <= ?`
);

function createSubmitToken() {
  const token = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  insertSubmitToken.run(token, now, now + TOKEN_TTL_MS);
  cleanupSubmitTokensStmt.run(now);
  return token;
}

/** Mark token consumed only after a successful submit transaction (prevents parallel double-use). */
function reserveSubmitToken(token) {
  const now = Date.now();
  return reserveSubmitTokenStmt.run(token, now).changes === 1;
}

function releaseSubmitToken(token) {
  releaseSubmitTokenStmt.run(token);
}

function consumeSubmitToken(token) {
  return consumeSubmitTokenStmt.run(token).changes === 1;
}

function getLatestCompleteHeat(db) {
  return db
    .prepare(`SELECT * FROM heats WHERE status = 'COMPLETE' ORDER BY heat_number DESC LIMIT 1`)
    .get();
}

function isSqliteConstraintUnique(err) {
  if (!err) return false;
  const c = err.code;
  if (c === 'SQLITE_CONSTRAINT_UNIQUE' || c === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
  return typeof err.message === 'string' && err.message.includes('UNIQUE');
}

function isHeatInvariantViolation(err) {
  if (!err || typeof err.message !== 'string') return false;
  return (
    err.message.includes('ONLY_ONE_ACTIVE_HEAT') ||
    err.message.includes('INVALID_HEAT_STATUS')
  );
}

function broadcast(data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  const chunk = 'data: ' + payload + '\n\n';
  leaderboardListeners.forEach((res) => {
    try {
      res.write(chunk);
      if (res.flush) res.flush();
      else if (res.socket && !res.socket.destroyed) res.socket.setNoDelay(true);
    } catch (err) {
      sseWriteErrorCount += 1;
      if (sseWriteErrorCount <= 5 || sseWriteErrorCount % 100 === 0) {
        console.warn('[sse] client write failed:', err && err.message ? err.message : err);
      }
    }
  });
  leaderboardListeners = leaderboardListeners.filter((res) => !res.writableEnded);
}

function broadcastLeaderboardUpdate(agentId) {
  const payload = { type: 'leaderboard' };
  if (agentId) payload.agentId = agentId;
  broadcast(payload);
}

function verifyAdmin(req, res, next) {
  const secret = process.env.HEATS_ADMIN_SECRET || '';
  if (!secret || req.headers['x-admin-token'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/healthz', (req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM heats
         WHERE status IN ('WAITING', 'OPEN', 'COUNTDOWN', 'LIVE')`
      )
      .get();
    res.json({
      ok: true,
      request_id: req.requestId,
      active_heat_rows: row ? row.c : 0,
      uptime_s: Math.floor(process.uptime()),
    });
  } catch (e) {
    console.error('[healthz]', e);
    res.status(500).json({ ok: false, request_id: req.requestId });
  }
});

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

app.get('/heat/status', (req, res) => {
  try {
    heatStore.tickHeat(db, () => broadcastLeaderboardUpdate());
    const h = heatStore.getLatestHeat(db);
    const payload = heatStore.getHeatStatusPayload(db, h);
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

app.post('/heat/register', (req, res) => {
  try {
    heatStore.tickHeat(db, () => broadcastLeaderboardUpdate());
    const name = (req.body && req.body.name) || '';
    heatStore.registerName(db, name);
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === 'INVALID_STATE') return res.status(400).json({ error: e.message });
    if (e.code === 'BAD_REQUEST') return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

function jsonWinnerBody(w) {
  const body = {
    agent_name: w.agent_name,
    score: w.score,
    variance: w.variance,
    speed_ms: w.speed_ms,
  };
  if (w.no_eligible_human_winner) body.no_eligible_human_winner = true;
  return body;
}

app.get('/heat/winner', (req, res) => {
  try {
    const heatId = req.query.heat_id;
    if (!heatId) {
      const complete = getLatestCompleteHeat(db);
      if (!complete) return res.status(404).json({ error: 'No completed heat' });
      const w = getWinnerPayload(db, complete.id);
      if (!w.found) return res.status(404).json({ error: 'Heat not found' });
      if (!w.complete) return res.status(404).json({ error: 'Heat not complete yet' });
      return res.json(jsonWinnerBody(w));
    }
    const w = getWinnerPayload(db, heatId);
    if (!w.found) return res.status(404).json({ error: 'Heat not found' });
    if (!w.complete) return res.status(404).json({ error: 'Heat not complete yet' });
    res.json(jsonWinnerBody(w));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

app.post('/admin/heat/open', verifyAdmin, (req, res) => {
  try {
    heatStore.tickHeat(db, () => broadcastLeaderboardUpdate());
    const h = heatStore.adminOpen(db);
    res.json({ ok: true, heat: { id: h.id, heat_number: h.heat_number, status: h.status } });
  } catch (e) {
    if (isHeatInvariantViolation(e)) return res.status(400).json({ error: e.message });
    if (e.code === 'INVALID_STATE') return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

app.post('/admin/heat/start', verifyAdmin, (req, res) => {
  try {
    heatStore.tickHeat(db, () => broadcastLeaderboardUpdate());
    const h = heatStore.adminStart(db);
    res.json({ ok: true, heat: { id: h.id, heat_number: h.heat_number, status: h.status } });
  } catch (e) {
    if (isHeatInvariantViolation(e)) return res.status(400).json({ error: e.message });
    if (e.code === 'INVALID_STATE' || e.code === 'NO_TASKS') {
      return res.status(400).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

app.post('/admin/heat/force-live', verifyAdmin, (req, res) => {
  try {
    heatStore.tickHeat(db, () => broadcastLeaderboardUpdate());
    const h = heatStore.adminForceLive(db, () => broadcastLeaderboardUpdate());
    res.json({ ok: true, heat: { id: h.id, heat_number: h.heat_number, status: h.status } });
  } catch (e) {
    if (isHeatInvariantViolation(e)) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

app.post('/admin/heat/force-complete', verifyAdmin, (req, res) => {
  try {
    heatStore.tickHeat(db, () => broadcastLeaderboardUpdate());
    const h = heatStore.adminForceComplete(db, () => broadcastLeaderboardUpdate());
    res.json({ ok: true, heat: { id: h.id, heat_number: h.heat_number, status: h.status } });
  } catch (e) {
    if (isHeatInvariantViolation(e)) return res.status(400).json({ error: e.message });
    if (e.code === 'INVALID_STATE') return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

app.post('/admin/heat/reset', verifyAdmin, (req, res) => {
  try {
    heatStore.tickHeat(db, () => broadcastLeaderboardUpdate());
    const h = heatStore.adminReset(db, () => broadcastLeaderboardUpdate());
    res.json({ ok: true, heat: { id: h.id, heat_number: h.heat_number, status: h.status } });
  } catch (e) {
    if (isHeatInvariantViolation(e)) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

app.get('/admin/heat/summary', verifyAdmin, (req, res) => {
  try {
    heatStore.tickHeat(db, () => broadcastLeaderboardUpdate());
    const h = heatStore.getLatestHeat(db);
    const st = heatStore.getHeatStatusPayload(db, h);
    let time_remaining_s = null;
    if (st.countdown_seconds != null) time_remaining_s = st.countdown_seconds;
    else if (st.live_seconds_remaining != null) time_remaining_s = st.live_seconds_remaining;

    const leaderboard_snapshot = h
      ? getLeaderboard(db, new Map(), h.id)
      : { leaderboard: [] };

    res.json({
      heat_number: st.heat_number,
      status: st.status,
      registered_count: st.registered_count,
      submitted_count: st.submitted_count,
      time_remaining_s,
      heat_id: st.heat_id,
      leaderboard_snapshot,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

app.get('/tasks', (req, res) => {
  try {
    const heatId = req.query.heat_id;
    if (!heatId) {
      return res.status(400).json({
        error: 'heat_id query parameter is required (from GET /heat/status when heat is LIVE)',
      });
    }
    const tasks = getTasksForHeat(db, heatId);
    res.json(tasks);
  } catch (e) {
    if (e.code === 'NOT_LIVE') {
      return res.status(403).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

app.get('/leaderboard', (req, res) => {
  try {
    heatStore.tickHeat(db, () => broadcastLeaderboardUpdate());
    let heatId = req.query.heat_id;
    if (!heatId) {
      const h = heatStore.getLatestHeat(db);
      if (h && (h.status === 'LIVE' || h.status === 'COMPLETE')) {
        heatId = h.id;
      } else {
        const lastComplete = getLatestCompleteHeat(db);
        if (lastComplete) heatId = lastComplete.id;
      }
    }
    const data = getLeaderboard(db, new Map(), heatId || null);
    data.leaderboard = data.leaderboard.map((row) => {
      const { varianceNum, evaluating, ...pub } = row;
      return pub;
    });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Leaderboard failed' });
  }
});

app.get('/agents', (req, res) => {
  try {
    const rows = db
      .prepare('SELECT id, name, webhook_url, created_at, is_benchmark FROM agents ORDER BY created_at DESC')
      .all();
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/debug/runs/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    const runs = db
      .prepare(
        `
      SELECT task_id, run_index, score, latency_ms, response_text, created_at, heat_id
      FROM runs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 30
    `
      )
      .all(agentId);
    const out = runs.map((r) => ({
      task_id: r.task_id,
      run_index: r.run_index,
      score: r.score,
      latency_ms: r.latency_ms,
      response_preview: r.response_text ? r.response_text.slice(0, 300) : null,
      created_at: r.created_at,
      heat_id: r.heat_id,
    }));
    res.json({ agentId, count: out.length, runs: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/get-submit-token', (req, res) => {
  try {
    const token = createSubmitToken();
    res.json({ token, expiresIn: Math.floor(TOKEN_TTL_MS / 1000) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed' });
  }
});

app.post('/submit-result', (req, res) => {
  const fail = (status, msg) => res.status(status).json({ error: msg });

  try {
    heatStore.tickHeat(db, () => broadcastLeaderboardUpdate());

    const { token, agent_name, results, heat_id } = req.body || {};
    if (!token || typeof token !== 'string') {
      return fail(400, 'token is required');
    }
    if (!Array.isArray(results) || results.length === 0) {
      return fail(400, 'results array is required');
    }
    if (!heat_id || typeof heat_id !== 'string') {
      return fail(400, 'heat_id is required');
    }

    if (!reserveSubmitToken(token)) {
      return fail(400, 'Invalid, expired, or already-used token');
    }

    const releaseAndFail = (status, msg) => {
      releaseSubmitToken(token);
      return fail(status, msg);
    };

    const h = db.prepare('SELECT * FROM heats WHERE id = ?').get(heat_id);
    if (!h || h.status !== 'LIVE') {
      return releaseAndFail(403, 'No active heat — wait for the next heat to open');
    }

    let allowed;
    try {
      allowed = parseTaskIdsJson(h.task_ids);
    } catch (e) {
      if (e.code === 'INVALID_TASK_IDS') {
        return releaseAndFail(500, 'Heat task list is corrupt; contact the host');
      }
      throw e;
    }

    const validation = validateSubmitResults(allowed, results);
    if (!validation.ok) {
      return releaseAndFail(400, validation.error);
    }

    const name =
      agent_name && typeof agent_name === 'string' && agent_name.trim()
        ? agent_name.trim()
        : 'Unnamed Agent';
    const normalized = normalizeAgentNameForClaim(name);
    if (!normalized) {
      return releaseAndFail(400, 'agent_name is required');
    }

    const insertClaim = db.prepare(
      'INSERT INTO heat_name_claims (heat_id, normalized_name) VALUES (?, ?)'
    );

    let agent;
    try {
      const txn = db.transaction(() => {
        insertClaim.run(heat_id, normalized);
        agent = submitResult(db, name, results, heat_id);
        const consumed = consumeSubmitToken(token);
        if (!consumed) {
          const err = new Error('Failed to consume reserved token');
          err.code = 'TOKEN_CONSUME_FAILED';
          throw err;
        }
      });
      txn();
    } catch (err) {
      releaseSubmitToken(token);
      if (isSqliteConstraintUnique(err)) {
        return res.status(409).json({
          error:
            'Agent name already taken this heat. Choose a different name and resubmit.',
        });
      }
      throw err;
    }

    broadcastLeaderboardUpdate(agent.id);
    res.status(201).json(agent);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Submit failed' });
  }
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Agent Olympics API listening on http://${HOST}:${PORT}`);
  if (!process.env.HEATS_ADMIN_SECRET) {
    console.warn(
      '[config] HEATS_ADMIN_SECRET is unset — POST /admin/heat/* and GET /admin/heat/summary will reject all requests until it is set.'
    );
  }
});
