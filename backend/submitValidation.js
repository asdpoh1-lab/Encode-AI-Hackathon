/**
 * Validate CLI submit payload: exactly one result per (task_id, run_index) for run_index 1..3.
 * @param {string[]} allowedTaskIds - order preserved
 * @param {object[]} results
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validateSubmitResults(allowedTaskIds, results) {
  if (!Array.isArray(allowedTaskIds) || allowedTaskIds.length === 0) {
    return { ok: false, error: 'Heat has no task list' };
  }
  const expectedLen = allowedTaskIds.length * 3;
  if (!Array.isArray(results) || results.length !== expectedLen) {
    return {
      ok: false,
      error: `Expected ${expectedLen} results (${allowedTaskIds.length} tasks × 3 runs), got ${results?.length ?? 0}`,
    };
  }

  const allowedSet = new Set(allowedTaskIds);
  const seen = new Set();

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r || typeof r !== 'object') {
      return { ok: false, error: `results[${i}] must be an object` };
    }
    const taskId = r.task_id != null ? String(r.task_id).trim() : '';
    if (!taskId) {
      return { ok: false, error: `results[${i}] missing task_id` };
    }
    if (!allowedSet.has(taskId)) {
      return { ok: false, error: `Invalid task_id for this heat: ${taskId}` };
    }
    const runIndex = r.run_index;
    if (typeof runIndex !== 'number' || !Number.isInteger(runIndex) || runIndex < 1 || runIndex > 3) {
      return { ok: false, error: `results[${i}] must have run_index 1, 2, or 3` };
    }
    const key = `${taskId}:${runIndex}`;
    if (seen.has(key)) {
      return { ok: false, error: `Duplicate result for ${taskId} run ${runIndex}` };
    }
    seen.add(key);
  }

  for (const tid of allowedTaskIds) {
    for (let run = 1; run <= 3; run++) {
      if (!seen.has(`${tid}:${run}`)) {
        return { ok: false, error: `Missing result for task ${tid} run ${run}` };
      }
    }
  }

  return { ok: true };
}

function normalizeAgentNameForClaim(name) {
  return String(name || '').trim().toLowerCase();
}

module.exports = { validateSubmitResults, normalizeAgentNameForClaim };
