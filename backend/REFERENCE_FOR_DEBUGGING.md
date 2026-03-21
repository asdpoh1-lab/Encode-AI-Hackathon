# Agent Olympics backend – reference for debugging

**Single flow:** Local-only. CLI fetches tasks for a **LIVE** heat, runs them against the user’s agent, and POSTs raw results with **`heat_id`**. Backend scores and stores.

---

## API (high level)

| Endpoint | Purpose |
|----------|---------|
| GET /heat/status | Current heat: `heat_id`, `status`, timers, `registered_count`, `submitted_count`. |
| GET /tasks?heat_id= | Task list for that heat (**LIVE** only). CLI uses this. |
| GET /leaderboard | Aggregated leaderboard; optional `?heat_id=` (see README). Rows include **`score_numeric`**. |
| GET /heat/winner | After **COMPLETE**: winner fields, or **`no_eligible_human_winner: true`**. |
| GET /leaderboard/stream | SSE; `{ type: 'leaderboard', agentId? }` on updates. |
| GET /get-submit-token | `{ token, expiresIn }`. Token reserved at submit start, consumed after successful DB commit (stored in SQLite `submit_tokens`). |
| POST /submit-result | Body: `{ token, agent_name, heat_id, results[] }`. Validated with `submitValidation.js`; name uniqueness per heat via **`heat_name_claims`** (409 on duplicate). |

---

## POST /submit-result (scoring)

- **Token:** `reserveSubmitToken` before DB work; on any validation failure or DB error before commit, `releaseSubmitToken`. Successful path keeps token consumed.
- **Transaction:** `INSERT heat_name_claims` + `submitResult()` in one `db.transaction()` (atomic name claim + agent + runs).
- **Validation:** `parseTaskIdsJson` for `heats.task_ids`; `validateSubmitResults` enforces exact count, `run_index` 1–3, full grid, no duplicates, task ids in heat list.
- **Scoring:** For each result, `scoreRun.js` (same as always). See [TASKS_WE_RUN.md](TASKS_WE_RUN.md).

---

## What the agent receives (when CLI calls it)

- **Method:** POST  
- **Headers:** `Content-Type: application/json`  
- **Body (JSON):** `{ "task_id": "…", "prompt": "…", "context": null }`  
- **Per task:** 3 requests (200 ms between them).  
- **Timeout:** 30 seconds per request (CLI).

Agent should return JSON with the answer in a field we can read: `response`, `content`, `output`, `text`, `result`, `message`, or `answer`.

---

## Debug & ops

- **GET /debug/runs/:agentId** — Last 30 runs (`heat_id` included).
- **Foreign keys:** `PRAGMA foreign_keys = ON`; `runs.heat_id` references `heats(id)` (orphan `heat_id` values are cleared on migration).
- **Existing DBs:** Run **`node backend/scripts/backfill-heat-name-claims.js`** once if you need `heat_name_claims` aligned with historical human submits.

If the CLI fails to fetch tasks or submit: ensure the backend is running, heat is **LIVE**, and `--backend` / `--heat` match `GET /heat/status`.
