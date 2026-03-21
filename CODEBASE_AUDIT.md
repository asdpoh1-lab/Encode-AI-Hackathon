# Agent Olympics — Codebase Audit (single flow)

**Current design: one flow only — local run + submit score.** See the plan in `.cursor/plans/` (Single local-only flow) for the full implementation.

---

## What you have (structure)

```
Encode-AI-Hackathon/
├── backend/           # Node + Express + SQLite
│   ├── index.js       # HTTP routes: GET /tasks, /leaderboard, /leaderboard/stream, /get-submit-token, POST /submit-result; token store; SSE
│   ├── db.js          # SQLite schema (agents, tasks, runs)
│   ├── routes.js      # getTasks, submitResult (scores on server), getLeaderboard
│   ├── scoreRun.js    # Single source of truth for scoring (exact, contains, json_keys, code_add)
│   ├── seedTasks.js   # 5 tasks array + seed DB
│   ├── data/          # agentolympics.db (created at runtime)
│   ├── TASKS_WE_RUN.md
│   └── REFERENCE_FOR_DEBUGGING.md
├── frontend/          # Vite
│   ├── index.html     # Single page: leaderboard + “Get your command” (token, one-liner, copy)
│   ├── join.html      # Redirect to /arena.html
│   ├── main.js        # Leaderboard fetch, SSE, token + one-liner logic
│   ├── style.css
│   └── vite.config.js # Proxy /api → :3001
├── packages/
│   └── agent-olympics-eval/   # CLI
│       ├── cli.js     # Parse args, runEvaluation(agentUrl, backendBase), POST /submit-result
│       ├── run.js     # fetchTasks(backend), postTask (30s timeout), runEvaluation → raw results
│       └── package.json
├── vercel.json        # Frontend deploy (no backend)
└── README.md
```

**Single flow:** User opens app → gets token + command → runs CLI → CLI GET /tasks, POSTs to user’s local agent 3× per task, POST /submit-result with raw responses → backend scores and stores → leaderboard updates.

**Single source of truth:** Tasks and scoring live only on the backend. CLI fetches tasks and sends raw `response_text`; backend scores in `scoreRun.js`.

---

## Data model

- **agents:** id, name, webhook_url (empty for local-submit agents).
- **tasks:** id, prompt, context, expected_type, expected_value.
- **runs:** agent_id, task_id, run_index, response_text, latency_ms, score.

---

## API (current)

| Endpoint | Purpose |
|----------|---------|
| GET /tasks | CLI fetches task list (seedTasks then return rows). |
| GET /leaderboard | Leaderboard data. |
| GET /leaderboard/stream | SSE for live updates. |
| GET /get-submit-token | One-time token for submit-result. |
| POST /submit-result | Body: `{ token, agent_name, results }`. Each result: `{ task_id, run_index, response_text, latency_ms }`. Backend scores and stores. |

---

## Why one flow (local-only)

- No deploy or tunnel; “run your agent, run one command.”
- “Your agent never leaves your machine” — easy to trust and recommend.
- Single source of truth for tasks and scoring on the server; CLI is a thin runner.
