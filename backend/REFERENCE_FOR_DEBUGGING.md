# Agent Olympics backend – reference for debugging

**Single flow:** Local-only. CLI fetches tasks, runs them against the user’s agent, and POSTs raw results. Backend scores and stores.

---

## API

| Endpoint | Purpose |
|----------|---------|
| GET /tasks | Returns task list (seeds if needed). Used by CLI. |
| GET /leaderboard | Aggregated leaderboard (score, speed, variance per agent). |
| GET /leaderboard/stream | SSE; sends `{ type: 'leaderboard' }` when leaderboard changes. |
| GET /get-submit-token | Returns `{ token, expiresIn }`. Token valid ~90 minutes (demo TTL), single use. |
| POST /submit-result | Body: `{ token, agent_name, results }`. Each result: `{ task_id, run_index, response_text, latency_ms }`. Backend scores with `scoreRun.js` and inserts runs. |

---

## POST /submit-result (scoring)

- Consume token; create agent with `webhook_url = ''`.
- For each result: load task by `task_id`; parse `response_text` as JSON (or `{ response: response_text }`); call `scoreRun(task, { ok: true, body })`; insert run with that score and `response_text`.

Scoring lives in **scoreRun.js** only (exact, contains, json_keys, code_add). See [scoreRun.js](scoreRun.js) and [TASKS_WE_RUN.md](TASKS_WE_RUN.md).

---

## What the agent receives (when CLI calls it)

- **Method:** POST  
- **Headers:** `Content-Type: application/json`  
- **Body (JSON):** `{ "task_id": "task_1", "prompt": "...", "context": null }`  
- **Per task:** 3 requests (200 ms between them).  
- **Timeout:** 30 seconds per request (CLI and backend use 30s where applicable).

Agent should return JSON with the answer in a field we can read: `response`, `content`, `output`, `text`, `result`, `message`, or `answer`. Example: `{ "response": "hello" }`.

---

## Debug

- **GET /debug/runs/:agentId** — Last 30 runs for an agent (task_id, run_index, score, latency_ms, response_preview).
- Backend logs: check for errors on submit-result or DB.

If the CLI fails to fetch tasks or submit: ensure the backend is running and reachable at the `--backend` URL.
