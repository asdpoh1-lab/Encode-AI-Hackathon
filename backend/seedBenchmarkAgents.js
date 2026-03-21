/**
 * Three fixed benchmark agents + synthetic runs per heat so the board is never empty.
 */

const BENCHMARKS = [
  {
    id: 'benchmark_baseline',
    name: 'Baseline Bot',
    targetMean: 40,
    targetLatencyMs: 300,
    scoreSpread: 3,
  },
  {
    id: 'benchmark_chaos',
    name: 'Chaos Agent',
    targetMean: 75,
    targetLatencyMs: 100,
    scoreSpread: 18,
  },
  {
    id: 'benchmark_steady',
    name: 'Steady Eddie',
    targetMean: 65,
    targetLatencyMs: 2500,
    scoreSpread: 2,
  },
];

function ensureBenchmarkAgents(db) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO agents (id, name, webhook_url, is_benchmark) VALUES (?, ?, ?, 1)'
  );
  for (const b of BENCHMARKS) {
    insert.run(b.id, b.name, '');
  }
}

/**
 * For each benchmark and each task id, insert 3 runs with scores/latencies tuned to targets.
 */
function seedBenchmarkRunsForHeat(db, heatId, taskIds) {
  if (!heatId || !taskIds || taskIds.length === 0) return;
  ensureBenchmarkAgents(db);

  const deleteExisting = db.prepare(
    'DELETE FROM runs WHERE heat_id = ? AND agent_id IN (?, ?, ?)'
  );
  deleteExisting.run(heatId, BENCHMARKS[0].id, BENCHMARKS[1].id, BENCHMARKS[2].id);

  const insertRun = db.prepare(`
    INSERT INTO runs (agent_id, task_id, run_index, response_text, latency_ms, score, heat_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const b of BENCHMARKS) {
    let runIdx = 0;
    for (const taskId of taskIds) {
      for (let i = 1; i <= 3; i++) {
        runIdx += 1;
        const phase = (runIdx % 3) - 1;
        const score = Math.max(
          0,
          Math.min(100, Math.round(b.targetMean + phase * b.scoreSpread))
        );
        const jitter = (runIdx % 5) * 8 - 16;
        const latency = Math.max(50, b.targetLatencyMs + jitter);
        const body = JSON.stringify({ response: `benchmark_${b.id}_${taskId}_${i}`, metadata: {} });
        insertRun.run(b.id, taskId, i, body, latency, score, heatId);
      }
    }
  }
}

module.exports = { seedBenchmarkRunsForHeat, ensureBenchmarkAgents, BENCHMARKS };
