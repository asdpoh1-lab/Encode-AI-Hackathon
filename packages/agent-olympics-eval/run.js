const TIMEOUT_MS = 30000;

async function fetchTasks(backendBase) {
  const res = await fetch(`${backendBase}/tasks`);
  if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.statusText}`);
  return res.json();
}

async function postTask(agentUrl, payload) {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latency_ms = Date.now() - start;
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { response: text, metadata: {} };
    }
    return { ok: true, body, latency_ms };
  } catch (err) {
    clearTimeout(timeoutId);
    const latency_ms = Date.now() - start;
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message, latency_ms };
  }
}

async function runEvaluation(agentUrl, backendBase, onProgress) {
  const tasks = await fetchTasks(backendBase);
  const results = [];
  for (let t = 0; t < tasks.length; t++) {
    const task = tasks[t];
    if (onProgress) onProgress(t + 1, 0, tasks.length);
    for (let run = 1; run <= 3; run++) {
      const out = await postTask(agentUrl, {
        task_id: task.id,
        prompt: task.prompt,
        context: task.context || null,
      });
      const response_text = out.ok ? JSON.stringify(out.body) : null;
      results.push({
        task_id: task.id,
        run_index: run,
        response_text,
        latency_ms: out.latency_ms != null ? out.latency_ms : null,
      });
      if (onProgress) onProgress(t + 1, run, tasks.length);
      if (run < 3) await new Promise((r) => setTimeout(r, 200));
    }
  }
  return results;
}

module.exports = { runEvaluation, fetchTasks };
