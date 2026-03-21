/**
 * HTTP helper used by `evaluator.js` only — not part of the Express API surface in `index.js`.
 */
const WEBHOOK_TIMEOUT_MS = 30000;

function postTask(webhookUrl, payload) {
  return new Promise((resolve) => {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then((res) => {
        clearTimeout(timeoutId);
        const latency_ms = Date.now() - start;
        return res.text().then((text) => {
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            body = { response: text, metadata: {} };
          }
          resolve({ ok: true, body, latency_ms });
        });
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        const latency_ms = Date.now() - start;
        resolve({
          ok: false,
          error: err.name === 'AbortError' ? 'timeout' : err.message,
          latency_ms,
        });
      });
  });
}

async function runTaskThreeTimes(webhookUrl, task, delayMs = 200) {
  const results = [];
  for (let i = 0; i < 3; i++) {
    const out = await postTask(webhookUrl, {
      task_id: task.id,
      prompt: task.prompt,
      context: task.context || null,
    });
    results.push(out);
    if (i < 2 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  return results;
}

module.exports = { postTask, runTaskThreeTimes, WEBHOOK_TIMEOUT_MS };
