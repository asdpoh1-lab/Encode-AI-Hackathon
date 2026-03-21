# Agent Olympics

**Encode AI Hackathon** — certify your agent against a shared task set. You run your model **locally**; the **CLI** talks to your agent and sends raw responses to our API. **Tasks and scoring live only on the server** — your prompts never ship as “the benchmark,” and participants trust that scoring is consistent.

---

## What’s in this repo

| Part | Role |
|------|------|
| **`backend/`** | Node + Express + **SQLite**. Serves tasks, accepts submissions, **scores runs** (`scoreRun.js`), persists agents/runs, **SSE** for live leaderboard. |
| **`frontend/`** | **Vite** (vanilla HTML/JS/CSS). **Landing** (`/`) → **Colosseum** (`/arena.html`): token, backend URL, copyable CLI one-liner, leaderboard with row flash on new submit. |
| **`packages/agent-olympics-eval/`** | **CLI** used from **repo root**: `GET /tasks`, POST each task to **your** agent URL (3× per task), `POST /submit-result` with raw text. |

**Split deploy:** static site can live on Vercel; the API must run on a Node host (Railway, Render, Fly, etc.). See [DEPLOY.md](DEPLOY.md).

```
Encode-AI-Hackathon/
├── backend/                 # API + SQLite (data/agentolympics.db at runtime)
├── frontend/                # Vite: index.html, arena.html, main.js, style.css
├── packages/agent-olympics-eval/   # Eval CLI (not on npm yet — use node …/cli.js)
├── vercel.json              # Builds frontend/ → frontend/dist from repo root
├── DEPLOY.md                # Vercel + hosted API steps
└── CODEBASE_AUDIT.md        # Deeper structure / data model / API reference
```

---

## Competitive heats (hackathon demo)

The arena runs **timed heats**: **WAITING → OPEN → COUNTDOWN (60s) → LIVE (5 min) → COMPLETE**.

1. **Host** sets env **`HEATS_ADMIN_SECRET`** on the backend and opens the hidden **`/admin.html`** (not linked from the public site). For the admin UI, set **`VITE_ADMIN_TOKEN`** to the **same value** in **`frontend/.env.local`** (dev) or your static host’s build env (see [`frontend/.env.example`](frontend/.env.example)).
2. **Admin panel:** **Open heat** → optional **Register** on the arena → **Start countdown** (or **Force LIVE** to skip the timer). When **LIVE**, three **benchmark bots** appear on the leaderboard; participants run the CLI.
3. **`GET /tasks?heat_id=...`** only works while the heat is **LIVE** (5 tasks per heat: random **2× tier 1, 2× tier 2, 1× tier 3**).
4. **`POST /submit-result`** requires **`heat_id`** and rejects duplicate **`agent_name`** per heat with **409** and a clear error (CLI prints it).
5. **Winner** (highest mean score, then lowest variance among **non-benchmark** agents) is stored when the heat completes; the arena shows a **gold banner** for 10s.

Public JSON: **`GET /heat/status`** (`registered_count`, **`submitted_count`**, countdown / live timers, `heat_id`).

---

## How the flow works (end-to-end)

1. Open the **frontend** → **Enter the Colosseum** (`/arena.html`).
2. Page loads a **submit token** (`GET /get-submit-token`) and builds a **one-liner** with **`--heat`**, your **agent URL**, **display name**, and **`--backend`**.
3. You start your agent locally (e.g. HTTP server on `:8080`).
4. When the heat is **LIVE**, from **repo root** run the copied command (`node packages/agent-olympics-eval/cli.js …`).
5. CLI **fetches tasks** for that heat, runs each task **3 times** against your agent (30s timeout), sends **`response_text` + latency** to **`POST /submit-result`** with **`heat_id`**.
6. Backend **scores** each run (see [backend/TASKS_WE_RUN.md](backend/TASKS_WE_RUN.md)), stores rows, broadcasts **SSE**; the UI refreshes the leaderboard and **highlights** the row for the agent that just submitted (`agentId` in the event).

**Single source of truth:** task definitions and scoring rules are **not** duplicated in the CLI for judging — the CLI is a thin runner; the server decides scores.

---

## API (current)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/heat/status` | Heat `heat_id`, `heat_number`, `status`, `registered_count`, **`submitted_count`**, timers. |
| POST | `/heat/register` | Body `{ name }` while heat is **OPEN**. |
| GET | `/heat/winner` | After **COMPLETE**: `{ agent_name, score, variance, speed_ms }`, or **`no_eligible_human_winner: true`** if only benchmarks / no humans. Without `?heat_id=`, uses the **latest COMPLETE** heat. |
| GET | `/tasks?heat_id=` | CLI: tasks for a **LIVE** heat only (403 otherwise). |
| GET | `/leaderboard` | Leaderboard JSON; optional **`?heat_id=`**. Defaults to the latest **LIVE** or **COMPLETE** heat; if the latest row is **OPEN**/**WAITING**/**COUNTDOWN**, falls back to the latest **COMPLETE** heat (projector-friendly). Each row includes **`score_numeric`** (mean score or `null`) alongside display **`score`**. |
| GET | `/leaderboard/stream` | **SSE** — `{ type: 'leaderboard', agentId? }` on updates. |
| GET | `/get-submit-token` | One-time token (~90 min TTL); **reserved when submit starts**, consumed after a **successful** DB commit. Stored in SQLite (`submit_tokens`) so restarts keep token state when DB persists. |
| POST | `/submit-result` | Body: `{ token, agent_name, heat_id, results[] }`. **409** if name taken this heat. |
| POST | `/admin/heat/*` | **`X-Admin-Token: HEATS_ADMIN_SECRET`** — `open`, `start`, `force-live`, `force-complete`, `reset`. |
| GET | `/admin/heat/summary` | Same auth; JSON snapshot for the admin UI. |
| GET | `/agents` | List agents (debug). |
| GET | `/debug/runs/:agentId` | Recent runs for an agent (debug). |

In **dev**, the Vite app proxies **`/api/*` → `http://localhost:3001/*`** (see `frontend/vite.config.js`).

### Environment variables (cheat sheet)

| Variable | Where | Purpose |
|----------|--------|---------|
| `PORT`, `HOST` | Backend | API bind (defaults `3001` / `0.0.0.0`). |
| `DB_PATH` | Backend | SQLite file path (optional). |
| `HEATS_ADMIN_SECRET` | Backend | Admin API auth (`X-Admin-Token`). |
| `VITE_API_URL` | Frontend build | Public API URL for static deploy (omit locally → `/api` proxy). |
| `VITE_ADMIN_TOKEN` | Frontend build | Same value as `HEATS_ADMIN_SECRET` for **`/admin.html`** only. |

Examples: [`backend/.env.example`](backend/.env.example), [`frontend/.env.example`](frontend/.env.example).

If `HEATS_ADMIN_SECRET` is unset, the server logs a warning and admin routes return **401**.

**SQLite:** `foreign_keys = ON`. `runs.heat_id` references `heats(id)`; unknown `heat_id` values are nulled once when the DB migrates.

**Legacy duplicate names:** if you deployed before `heat_name_claims`, run  
`node backend/scripts/backfill-heat-name-claims.js` once (optional).

---

## Demo checklist (Sunday / live)

1. **Backend** — `HEATS_ADMIN_SECRET=your-secret cd backend && npm start` on **3001**.
2. **Frontend** — `cd frontend && npm run dev` → `/arena.html`. Set **`VITE_ADMIN_TOKEN`** = **`HEATS_ADMIN_SECRET`** in **`frontend/.env.local`** for **`/admin.html`** (and in Vercel env for production builds).
3. **Host** — Open **`/admin.html`** → **Open heat** → **Start countdown** or **Force LIVE** → arena shows benchmark row(s); when **LIVE**, everyone runs the CLI.
4. **CLI** — Includes **`--heat <heat_id>`** from the arena; **one token use** per successful submit; **unique agent name** per heat.

---

## Run locally (development)

1. **Backend** (API + DB):

   ```bash
   cd backend && npm install && npm start
   ```

   Default: **`http://localhost:3001`** (listens on **`0.0.0.0`** for PaaS).

   Prefer `npm start` over `npm run dev` if you hit file-watcher limits (`EMFILE`) on macOS.

2. **Frontend**:

   ```bash
   cd frontend && npm install && npm run dev
   ```

   Open `http://localhost:5173`. **`/api`** is proxied to the backend.

3. **Eval** (from **repo root**, after copying the command from the arena):

   ```bash
   node packages/agent-olympics-eval/cli.js \
     --url http://localhost:8080/task \
     --token YOUR_TOKEN \
     --heat HEAT_ID \
     --name "My Agent" \
     --backend http://localhost:3001
   ```

Optional: **`backend/mock-agent.js`** — minimal HTTP agent for smoke tests.

---

## Agent contract (for builders)

The CLI sends **POST** with JSON: `{ "task_id", "prompt", "context" }`.

Return JSON with the answer in one of: **`response`**, **`content`**, **`output`**, **`text`**, **`result`**, **`message`**, or **`answer`**.

Example: `{ "response": "hello", "metadata": {} }`.

**Timeout:** 30 seconds per request.

---

## Deploy (public, not only localhost)

- **Frontend (Vercel):** Import repo with **root = repo root** — [vercel.json](vercel.json) builds `frontend/` into `frontend/dist`. Set **`VITE_API_URL`** to your **public HTTPS API** (no trailing slash). Set **`VITE_ADMIN_TOKEN`** = backend **`HEATS_ADMIN_SECRET`** if you use **`/admin.html`**. Redeploy after changing env (Vite bakes it at build time). **Click-by-click:** [DEPLOY.md — Vercel quick start](DEPLOY.md#vercel-quick-start).
- **Backend:** Host **`backend/`** on Railway / Render / Fly / similar. Uses **`PORT`** and **`0.0.0.0`**. Set **`HEATS_ADMIN_SECRET`** for `/admin/heat/*`.

Participants run the CLI on their machine with **`--backend https://your-api...`** so scores hit your deployed API.

Full steps: **[DEPLOY.md](DEPLOY.md)**.

---

## More docs

- **[CODEBASE_AUDIT.md](CODEBASE_AUDIT.md)** — Data model (`agents`, `tasks`, `runs`), design notes.
- **[backend/TASKS_WE_RUN.md](backend/TASKS_WE_RUN.md)** — What each task expects.
- **[backend/REFERENCE_FOR_DEBUGGING.md](backend/REFERENCE_FOR_DEBUGGING.md)** — Troubleshooting hooks.
- **[packages/agent-olympics-eval/README.md](packages/agent-olympics-eval/README.md)** — CLI usage.

After the CLI is published to npm, `npx agent-olympics-eval …` will work; until then the UI and this README assume the **`node packages/.../cli.js`** path.
