const crypto = require('crypto');
const { seedBenchmarkRunsForHeat } = require('./seedBenchmarkAgents');
const { parseTaskIdsJson } = require('./taskIdsJson');
const { computeWinnerAgentId, getWinnerPayload } = require('./routes');

const COUNTDOWN_MS = 60 * 1000;
const LIVE_MS = 5 * 60 * 1000;
/** Must match 2+2+1 tier picks in selectRandomTaskIds */
const MIN_HEAT_TASKS = 5;

function nowIso() {
  return new Date().toISOString();
}

function parseIso(s) {
  return s ? new Date(s).getTime() : 0;
}

function getLatestHeat(db) {
  return db.prepare('SELECT * FROM heats ORDER BY heat_number DESC LIMIT 1').get();
}

function insertHeat(db, { heat_number, status, task_ids }) {
  const id = 'heat_' + crypto.randomBytes(8).toString('hex');
  db.prepare(
    `INSERT INTO heats (id, heat_number, status, task_ids, countdown_ends_at, live_started_at, live_ends_at, completed_at, winner_agent_id)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)`
  ).run(id, heat_number, status, task_ids != null ? JSON.stringify(task_ids) : null);
  return db.prepare('SELECT * FROM heats WHERE id = ?').get(id);
}

function updateHeat(db, id, fields) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const vals = keys.map((k) => fields[k]);
  db.prepare(`UPDATE heats SET ${sets} WHERE id = ?`).run(...vals, id);
}

function selectRandomTaskIds(db) {
  const t1 = db.prepare('SELECT id FROM tasks WHERE tier = 1 ORDER BY RANDOM() LIMIT 2').all();
  const t2 = db.prepare('SELECT id FROM tasks WHERE tier = 2 ORDER BY RANDOM() LIMIT 2').all();
  const t3 = db.prepare('SELECT id FROM tasks WHERE tier = 3 ORDER BY RANDOM() LIMIT 1').all();
  const ids = [...t1, ...t2, ...t3].map((r) => r.id);
  return ids;
}

function ensureHeatRow(db) {
  let h = getLatestHeat(db);
  if (!h) {
    h = insertHeat(db, { heat_number: 1, status: 'WAITING', task_ids: null });
  }
  return h;
}

function completeHeat(db, heatId, broadcastLeaderboardUpdate) {
  const winnerId = computeWinnerAgentId(db, heatId);
  updateHeat(db, heatId, {
    status: 'COMPLETE',
    completed_at: nowIso(),
    winner_agent_id: winnerId,
  });
  if (typeof broadcastLeaderboardUpdate === 'function') broadcastLeaderboardUpdate();
}

function registeredCount(db, heatId) {
  return db
    .prepare('SELECT COUNT(*) AS c FROM heat_registrations WHERE heat_id = ?')
    .get(heatId).c;
}

function submittedCount(db, heatId) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT r.agent_id) AS c
       FROM runs r
       JOIN agents a ON a.id = r.agent_id
       WHERE r.heat_id = ? AND (a.is_benchmark IS NULL OR a.is_benchmark = 0)`
    )
    .get(heatId);
  return row ? row.c : 0;
}

/**
 * Advance COUNTDOWN→LIVE and LIVE→COMPLETE based on time (or early submit completion).
 */
function tickHeat(db, broadcastLeaderboardUpdate) {
  let h = getLatestHeat(db);
  if (!h) {
    insertHeat(db, { heat_number: 1, status: 'WAITING', task_ids: null });
    h = getLatestHeat(db);
  }
  const t = Date.now();

  if (h.status === 'COUNTDOWN' && h.countdown_ends_at) {
    if (t >= parseIso(h.countdown_ends_at)) {
      let taskIds;
      try {
        taskIds = parseTaskIdsJson(h.task_ids);
      } catch (e) {
        console.error('[heat] invalid task_ids on heat', h.id, e);
        taskIds = [];
      }
      if (taskIds.length < MIN_HEAT_TASKS) {
        taskIds = selectRandomTaskIds(db);
      }
      if (taskIds.length < MIN_HEAT_TASKS) {
        console.error(
          '[heat] COUNTDOWN ended but cannot go LIVE: need at least',
          MIN_HEAT_TASKS,
          'tiered tasks in DB. Reverting heat',
          h.id,
          'to OPEN.'
        );
        updateHeat(db, h.id, {
          status: 'OPEN',
          countdown_ends_at: null,
          task_ids: null,
        });
        h = db.prepare('SELECT * FROM heats WHERE id = ?').get(h.id);
      } else {
        const liveEnd = new Date(t + LIVE_MS).toISOString();
        updateHeat(db, h.id, {
          status: 'LIVE',
          task_ids: JSON.stringify(taskIds),
          live_started_at: nowIso(),
          live_ends_at: liveEnd,
        });
        h = db.prepare('SELECT * FROM heats WHERE id = ?').get(h.id);
        try {
          seedBenchmarkRunsForHeat(db, h.id, taskIds);
        } catch (e) {
          console.error('[heat] benchmark seed failed', e);
        }
        if (typeof broadcastLeaderboardUpdate === 'function') broadcastLeaderboardUpdate();
      }
    }
  }

  h = db.prepare('SELECT * FROM heats WHERE id = ?').get(h.id);

  if (h.status === 'LIVE' && !h.live_ends_at) {
    updateHeat(db, h.id, {
      live_ends_at: new Date(Date.now() + LIVE_MS).toISOString(),
    });
    h = db.prepare('SELECT * FROM heats WHERE id = ?').get(h.id);
  }

  if (h.status === 'LIVE' && h.live_ends_at) {
    const reg = registeredCount(db, h.id);
    const sub = submittedCount(db, h.id);
    const allSubmitted = reg > 0 && sub >= reg;
    const timeUp = t >= parseIso(h.live_ends_at);
    if (timeUp || allSubmitted) {
      completeHeat(db, h.id, broadcastLeaderboardUpdate);
      h = db.prepare('SELECT * FROM heats WHERE id = ?').get(h.id);
    }
  }

  return h;
}

function effectiveStatus(h) {
  if (!h) return 'WAITING';
  return h.status;
}

function getHeatStatusPayload(db, h) {
  if (!h) {
    return {
      heat_id: null,
      heat_number: 0,
      status: 'WAITING',
      registered_count: 0,
      submitted_count: 0,
      countdown_seconds: null,
      live_seconds_remaining: null,
      task_ids: null,
    };
  }

  const t = Date.now();
  let countdown_seconds = null;
  let live_seconds_remaining = null;

  if (h.status === 'COUNTDOWN' && h.countdown_ends_at) {
    const left = Math.max(0, Math.ceil((parseIso(h.countdown_ends_at) - t) / 1000));
    countdown_seconds = left;
  }
  if (h.status === 'LIVE' && h.live_ends_at) {
    const left = Math.max(0, Math.ceil((parseIso(h.live_ends_at) - t) / 1000));
    live_seconds_remaining = left;
  }

  let task_ids = null;
  try {
    task_ids = h.task_ids ? parseTaskIdsJson(h.task_ids) : null;
  } catch {
    task_ids = null;
  }

  return {
    heat_id: h.id,
    heat_number: h.heat_number,
    status: effectiveStatus(h),
    registered_count: registeredCount(db, h.id),
    submitted_count: submittedCount(db, h.id),
    countdown_seconds,
    live_seconds_remaining,
    task_ids: h.status === 'LIVE' || h.status === 'COMPLETE' ? task_ids : null,
  };
}

function adminOpen(db) {
  let h = getLatestHeat(db);
  if (!h) {
    return insertHeat(db, { heat_number: 1, status: 'OPEN', task_ids: null });
  }
  if (h.status === 'COUNTDOWN' || h.status === 'LIVE') {
    const err = new Error('Cannot open during COUNTDOWN or LIVE');
    err.code = 'INVALID_STATE';
    throw err;
  }
  if (h.status === 'WAITING') {
    updateHeat(db, h.id, { status: 'OPEN' });
    return db.prepare('SELECT * FROM heats WHERE id = ?').get(h.id);
  }
  if (h.status === 'COMPLETE') {
    return insertHeat(db, { heat_number: h.heat_number + 1, status: 'OPEN', task_ids: null });
  }
  if (h.status === 'OPEN') return h;
  updateHeat(db, h.id, { status: 'OPEN' });
  return db.prepare('SELECT * FROM heats WHERE id = ?').get(h.id);
}

function adminStart(db) {
  let h = ensureHeatRow(db);
  if (h.status !== 'OPEN') {
    const err = new Error('Heat must be OPEN to start countdown (use admin open first)');
    err.code = 'INVALID_STATE';
    throw err;
  }
  const taskIds = selectRandomTaskIds(db);
  if (taskIds.length < 5) {
    const err = new Error('Not enough tiered tasks in DB (need 5 for 2+2+1)');
    err.code = 'NO_TASKS';
    throw err;
  }
  const ends = new Date(Date.now() + COUNTDOWN_MS).toISOString();
  updateHeat(db, h.id, {
    status: 'COUNTDOWN',
    task_ids: JSON.stringify(taskIds),
    countdown_ends_at: ends,
  });
  return db.prepare('SELECT * FROM heats WHERE id = ?').get(h.id);
}

function adminForceLive(db, broadcastLeaderboardUpdate) {
  let h = ensureHeatRow(db);
  /** Do not resurrect a COMPLETE heat — start the next heat row (same as admin open after complete). */
  if (h.status === 'COMPLETE') {
    h = insertHeat(db, { heat_number: h.heat_number + 1, status: 'WAITING', task_ids: null });
  }
  let taskIds = [];
  try {
    taskIds = h.task_ids ? parseTaskIdsJson(h.task_ids) : [];
  } catch (e) {
    console.error('[heat] adminForceLive bad task_ids, re-picking', e);
    taskIds = [];
  }
  if (taskIds.length < 5) {
    taskIds = selectRandomTaskIds(db);
  }
  const t = Date.now();
  const liveEnd = new Date(t + LIVE_MS).toISOString();
  updateHeat(db, h.id, {
    status: 'LIVE',
    task_ids: JSON.stringify(taskIds),
    countdown_ends_at: null,
    live_started_at: new Date(t).toISOString(),
    live_ends_at: liveEnd,
    completed_at: null,
    winner_agent_id: null,
  });
  h = db.prepare('SELECT * FROM heats WHERE id = ?').get(h.id);
  try {
    seedBenchmarkRunsForHeat(db, h.id, taskIds);
  } catch (e) {
    console.error('[heat] benchmark seed failed', e);
  }
  if (typeof broadcastLeaderboardUpdate === 'function') broadcastLeaderboardUpdate();
  return h;
}

function adminForceComplete(db, broadcastLeaderboardUpdate) {
  const h = getLatestHeat(db);
  if (!h || h.status !== 'LIVE') {
    const err = new Error('Heat must be LIVE to force complete');
    err.code = 'INVALID_STATE';
    throw err;
  }
  completeHeat(db, h.id, broadcastLeaderboardUpdate);
  return db.prepare('SELECT * FROM heats WHERE id = ?').get(h.id);
}

/**
 * Start a new WAITING heat. Any in-progress latest heat (LIVE or COUNTDOWN) is completed first
 * so it cannot accept further submissions while hidden from /heat/status (no "ghost" LIVE heats).
 */
function adminReset(db, broadcastLeaderboardUpdate) {
  let h = getLatestHeat(db);
  if (h && (h.status === 'LIVE' || h.status === 'COUNTDOWN')) {
    completeHeat(db, h.id, broadcastLeaderboardUpdate);
    h = getLatestHeat(db);
  }
  const nextNum = h ? h.heat_number + 1 : 1;
  return insertHeat(db, { heat_number: nextNum, status: 'WAITING', task_ids: null });
}

function registerName(db, displayName) {
  const h = getLatestHeat(db);
  if (!h || h.status !== 'OPEN') {
    const err = new Error('Registration only allowed when heat is OPEN');
    err.code = 'INVALID_STATE';
    throw err;
  }
  const name = String(displayName || '').trim();
  if (!name) {
    const err = new Error('name is required');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  db.prepare(
    'INSERT INTO heat_registrations (heat_id, display_name) VALUES (?, ?)'
  ).run(h.id, name);
  return h.id;
}

module.exports = {
  tickHeat,
  ensureHeatRow,
  getLatestHeat,
  getHeatStatusPayload,
  adminOpen,
  adminStart,
  adminForceLive,
  adminForceComplete,
  adminReset,
  registerName,
  getWinnerPayload,
  selectRandomTaskIds,
  registeredCount,
  submittedCount,
  completeHeat,
  MIN_HEAT_TASKS,
};
