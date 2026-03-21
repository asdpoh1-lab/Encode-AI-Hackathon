const crypto = require('crypto');
const { seedTasks } = require('./seedTasks');
const { scoreRun } = require('./scoreRun');
const { parseTaskIdsJson } = require('./taskIdsJson');

function isBenchmarkAgent(row) {
  return row && (row.is_benchmark === 1 || row.is_benchmark === true);
}

function getTasksForHeat(db, heatId) {
  seedTasks(db);
  const heat = db.prepare('SELECT * FROM heats WHERE id = ?').get(heatId);
  if (!heat || heat.status !== 'LIVE') {
    const err = new Error('Tasks are only available when the heat is LIVE. Use the correct heat_id from /heat/status.');
    err.code = 'NOT_LIVE';
    throw err;
  }
  const ids = parseTaskIdsJson(heat.task_ids);
  if (ids.length === 0) {
    return [];
  }
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, prompt, context, expected_type, expected_value, tier FROM tasks WHERE id IN (${placeholders})`
    )
    .all(...ids);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId[id]).filter(Boolean);
}

function submitResult(db, agentName, results, heatId) {
  const id = 'agent_' + crypto.randomBytes(8).toString('hex');
  db.prepare(
    'INSERT INTO agents (id, name, webhook_url, is_benchmark) VALUES (?, ?, ?, 0)'
  ).run(id, agentName, '');
  const insertRun = db.prepare(`
    INSERT INTO runs (agent_id, task_id, run_index, response_text, latency_ms, score, heat_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getTask = db.prepare(
    'SELECT id, prompt, context, expected_type, expected_value FROM tasks WHERE id = ?'
  );
  for (const r of results) {
    const taskId = r.task_id && String(r.task_id);
    const runIndex = typeof r.run_index === 'number' ? r.run_index : 1;
    const latencyMs = typeof r.latency_ms === 'number' ? r.latency_ms : null;
    const responseText = r.response_text != null ? String(r.response_text) : null;
    const task = getTask.get(taskId);
    let score = 0;
    if (task && responseText != null) {
      let body;
      try {
        body = JSON.parse(responseText);
      } catch {
        body = { response: responseText };
      }
      score = scoreRun(task, { ok: true, body });
    }
    insertRun.run(id, taskId, runIndex, responseText, latencyMs, score, heatId, new Date().toISOString());
  }
  return { id, name: agentName };
}

function getLeaderboard(db, evaluatingMap, heatId) {
  const evaluating = evaluatingMap && typeof evaluatingMap.has === 'function' ? evaluatingMap : new Set();

  let runs;
  if (heatId) {
    runs = db
      .prepare(
        `SELECT r.agent_id, r.task_id, r.run_index, r.score, r.latency_ms
         FROM runs r WHERE r.heat_id = ?`
      )
      .all(heatId);
  } else {
    runs = db
      .prepare(
        `SELECT r.agent_id, r.task_id, r.run_index, r.score, r.latency_ms
         FROM runs r WHERE r.heat_id IS NULL`
      )
      .all();
  }

  const agentIds = [...new Set(runs.map((r) => r.agent_id))];
  const byAgent = {};

  for (const aid of agentIds) {
    const a = db.prepare('SELECT id, name, webhook_url, created_at, is_benchmark FROM agents WHERE id = ?').get(aid);
    if (!a) continue;
    byAgent[a.id] = {
      id: a.id,
      name: a.name,
      is_benchmark: isBenchmarkAgent(a) ? 1 : 0,
      score: null,
      speed: null,
      variance: null,
      varianceNum: null,
      runs: [],
      evaluating: evaluating.has(a.id),
    };
  }

  for (const r of runs) {
    if (!byAgent[r.agent_id]) continue;
    byAgent[r.agent_id].runs.push({
      task_id: r.task_id,
      run_index: r.run_index,
      score: r.score,
      latency_ms: r.latency_ms,
    });
  }

  const leaderboard = Object.values(byAgent).map((a) => {
    const runsList = a.runs;
    if (a.evaluating && runsList.length === 0) {
      return {
        ...a,
        score: '…',
        score_numeric: null,
        speed: '…',
        variance: '…',
        varianceNum: null,
      };
    }
    if (runsList.length === 0) {
      return {
        ...a,
        score: '—',
        score_numeric: null,
        speed: '—',
        variance: '—',
        varianceNum: null,
      };
    }
    const scores = runsList.map((x) => x.score);
    const latencies = runsList.filter((x) => x.latency_ms != null).map((x) => x.latency_ms);
    const meanScore = scores.reduce((s, n) => s + n, 0) / scores.length;
    const variance =
      scores.length > 1
        ? Math.sqrt(scores.reduce((s, n) => s + (n - meanScore) ** 2, 0) / (scores.length - 1))
        : 0;
    const avgLatency =
      latencies.length > 0 ? latencies.reduce((s, n) => s + n, 0) / latencies.length : null;
    const row = {
      id: a.id,
      name: a.name,
      is_benchmark: a.is_benchmark,
      score: a.evaluating ? '…' : Math.round(meanScore),
      /** Mean score when `score` is numeric; otherwise null (for APIs / analytics). */
      score_numeric:
        a.evaluating || runsList.length === 0 ? null : Math.round(meanScore),
      speed: a.evaluating ? '…' : avgLatency != null ? (avgLatency / 1000).toFixed(1) + 's' : '—',
      variance: a.evaluating ? '…' : '±' + Math.round(variance),
      evaluating: a.evaluating,
    };
    row.varianceNum = a.evaluating ? null : variance;
    return row;
  });

  leaderboard.sort((a, b) => {
    const sa = typeof a.score === 'number' ? a.score : -1;
    const sb = typeof b.score === 'number' ? b.score : -1;
    return sb - sa;
  });

  return { leaderboard };
}

/** Winner among non-benchmark agents: highest mean score, then lowest score variance. */
function computeWinnerAgentId(db, heatId) {
  const data = getLeaderboard(db, null, heatId);
  const humans = data.leaderboard.filter(
    (a) => !isBenchmarkAgent({ is_benchmark: a.is_benchmark }) && typeof a.score === 'number'
  );
  if (humans.length === 0) return null;
  humans.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const va = typeof a.varianceNum === 'number' ? a.varianceNum : 999;
    const vb = typeof b.varianceNum === 'number' ? b.varianceNum : 999;
    return va - vb;
  });
  return humans[0].id;
}

/**
 * Winner API resolution. Distinguishes missing heat, incomplete heat, and COMPLETE with no human winner.
 * @returns {{ found: false } | { found: true, complete: false } | { found: true, complete: true, agent_name, score, variance, speed_ms, no_eligible_human_winner?: boolean }}
 */
function getWinnerPayload(db, heatId) {
  const h = db.prepare('SELECT * FROM heats WHERE id = ?').get(heatId);
  if (!h) return { found: false };
  if (h.status !== 'COMPLETE') return { found: true, complete: false };

  const emptyHumanWinner = {
    found: true,
    complete: true,
    no_eligible_human_winner: true,
    agent_name: null,
    score: null,
    variance: null,
    speed_ms: null,
  };

  if (!h.winner_agent_id) {
    return emptyHumanWinner;
  }
  const agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(h.winner_agent_id);
  if (!agent) return emptyHumanWinner;

  const data = getLeaderboard(db, null, heatId);
  const row = data.leaderboard.find((x) => x.id === agent.id);
  if (!row) {
    return {
      found: true,
      complete: true,
      no_eligible_human_winner: false,
      agent_name: agent.name,
      score: null,
      variance: null,
      speed_ms: null,
    };
  }
  const speed_ms =
    row.speed && row.speed !== '—' ? Math.round(parseFloat(row.speed) * 1000) : null;
  return {
    found: true,
    complete: true,
    no_eligible_human_winner: false,
    agent_name: agent.name,
    score: row.score,
    variance: row.variance,
    speed_ms,
  };
}

module.exports = {
  getTasksForHeat,
  getLeaderboard,
  submitResult,
  computeWinnerAgentId,
  getWinnerPayload,
  isBenchmarkAgent,
  parseTaskIdsJson,
};
