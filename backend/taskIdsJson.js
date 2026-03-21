/**
 * Safe parse for heats.task_ids JSON — never throw raw JSON.parse into request handlers.
 * @returns {string[]} task id strings
 */
function parseTaskIdsJson(raw) {
  if (raw == null || String(raw).trim() === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error('Invalid task_ids JSON in heat record');
    err.code = 'INVALID_TASK_IDS';
    throw err;
  }
  if (!Array.isArray(parsed)) {
    const err = new Error('heat task_ids must be a JSON array');
    err.code = 'INVALID_TASK_IDS';
    throw err;
  }
  const out = [];
  for (const x of parsed) {
    if (x == null) continue;
    const id = String(x).trim();
    if (id) out.push(id);
  }
  return out;
}

module.exports = { parseTaskIdsJson };
