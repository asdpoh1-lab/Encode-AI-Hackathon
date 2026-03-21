const crypto = require('crypto');
const { seedTasks } = require('./seedTasks');
const { scoreRun } = require('./scoreRun');

function getTasks(db) {
  seedTasks(db);
  return db.prepare(
    'SELECT id, prompt, context, expected_type, expected_value FROM tasks ORDER BY id'
  ).all();
}

function submitResult(db, agentName, results) {
  const id = 'agent_' + crypto.randomBytes(8).toString('hex');
  db.prepare(
    'INSERT INTO agents (id, name, webhook_url) VALUES (?, ?, ?)'
  ).run(id, agentName, '');
  const insertRun = db.prepare(`
    INSERT INTO runs (agent_id, task_id, run_index, response_text, latency_ms, score)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const getTask = db.prepare(
    'SELECT id, prompt, context, expected_type, expected_value FROM tasks WHERE id = ?'
  );
  for (const r of results) {
    const taskId = r.task_id && String(r.task_id);
    const runIndex = typeof r.run_index === 'number' ? r.run_index : 1;
    const latencyMs = typeof r.latency_ms === 'number' ? r.latency_ms : null;
    const responseText = r.response_text != null ? String(r.response_text) : null;
    if (!taskId) continue;
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
    insertRun.run(id, taskId, runIndex, responseText, latencyMs, score);
  }
  return { id, name: agentName };
}

function getLeaderboard(db, evaluatingMap) {
  const evaluating = evaluatingMap && typeof evaluatingMap.has === 'function' ? evaluatingMap : new Set();
  const runs = db.prepare(`
    SELECT agent_id, task_id, run_index, score, latency_ms
    FROM runs
  `).all();

  const agents = db.prepare('SELECT id, name, webhook_url, created_at FROM agents').all();
  const byAgent = {};

  for (const a of agents) {
    byAgent[a.id] = {
      id: a.id,
      name: a.name,
      score: null,
      speed: null,
      variance: null,
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
      return { ...a, score: '…', speed: '…', variance: '…' };
    }
    if (runsList.length === 0) {
      return { ...a, score: '—', speed: '—', variance: '—' };
    }
    const scores = runsList.map((x) => x.score);
    const latencies = runsList.filter((x) => x.latency_ms != null).map((x) => x.latency_ms);
    const meanScore = scores.reduce((s, n) => s + n, 0) / scores.length;
    const variance = scores.length > 1
      ? Math.sqrt(
          scores.reduce((s, n) => s + (n - meanScore) ** 2, 0) / (scores.length - 1)
        )
      : 0;
    const avgLatency =
      latencies.length > 0
        ? latencies.reduce((s, n) => s + n, 0) / latencies.length
        : null;
    return {
      id: a.id,
      name: a.name,
      score: a.evaluating ? '…' : Math.round(meanScore),
      speed: a.evaluating ? '…' : (avgLatency != null ? (avgLatency / 1000).toFixed(1) + 's' : '—'),
      variance: a.evaluating ? '…' : ('±' + Math.round(variance)),
    };
  });

  leaderboard.sort((a, b) => {
    const sa = typeof a.score === 'number' ? a.score : -1;
    const sb = typeof b.score === 'number' ? b.score : -1;
    return sb - sa;
  });

  return { leaderboard };
}

module.exports = { getTasks, getLeaderboard, submitResult };
