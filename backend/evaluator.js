/**
 * Legacy server-side evaluator (webhook → tasks → scored runs).
 * Not mounted by `index.js`; the hackathon flow uses the CLI + `POST /submit-result` instead.
 * Kept as reference or for future “evaluate registered webhook” features.
 */
const { runTaskThreeTimes } = require('./dispatcher');
const { scoreRun } = require('./scoreRun');
const { seedTasks } = require('./seedTasks');

async function runEvaluation(db, agentId, onComplete, onProgress) {
  const agent = db.prepare('SELECT id, name, webhook_url FROM agents WHERE id = ?').get(agentId);
  if (!agent) throw new Error('Agent not found');
  seedTasks(db);
  const taskRows = db.prepare('SELECT id, prompt, context, expected_type, expected_value FROM tasks').all();
  const totalTasks = taskRows.length;
  const insertRun = db.prepare(`
    INSERT INTO runs (agent_id, task_id, run_index, response_text, latency_ms, score)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (let t = 0; t < taskRows.length; t++) {
    const task = taskRows[t];
    if (typeof onProgress === 'function') onProgress(t + 1, 0, totalTasks);
    let results;
    try {
      results = await runTaskThreeTimes(agent.webhook_url, task);
    } catch (err) {
      results = [{ ok: false }, { ok: false }, { ok: false }];
    }
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const score = r.ok ? scoreRun(task, r) : 0;
      const responseText = r.ok && r.body ? JSON.stringify(r.body) : null;
      const latencyMs = r.latency_ms != null ? r.latency_ms : null;
      insertRun.run(agentId, task.id, i + 1, responseText, latencyMs, score);
      console.log(
        `[eval] ${agentId} ${task.id} run ${i + 1}: ok=${r.ok} score=${score} latency_ms=${latencyMs}${!r.ok && r.error ? ' error=' + r.error : ''}`
      );
      if (typeof onProgress === 'function') {
        onProgress(t + 1, i + 1, totalTasks);
      }
    }
  }
  if (typeof onComplete === 'function') onComplete();
}

module.exports = { runEvaluation };
