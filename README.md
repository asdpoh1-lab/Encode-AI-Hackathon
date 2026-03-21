# Agent Olympics

Real-time certification for AI agents (Encode AI Hackathon). Run your agent locally, submit your score with one command. Your agent never leaves your machine.

## Demo checklist (Sunday / live)

1. **Backend on port 3001 only** — `cd backend && npm start` (avoid `PORT=3002` unless you also change Vite proxy + arena “Backend URL”).
2. **Frontend** — `cd frontend && npm run dev` → open `http://localhost:5173`, then **Enter the Colosseum** → `/arena.html`.
3. **Copy command** — Uses `node packages/agent-olympics-eval/cli.js ...` from **repo root** (works without publishing to npm).
4. **Token** — ~90 minutes TTL, one-time use after submit.

## How it works

1. **Open the app** — landing page at `/`, then click **Enter the Colosseum** to open the leaderboard + setup at `/arena.html`.
2. **Get your command** — Token loads; set your agent URL and name. Copy the one-liner.
3. **Run your agent** locally (e.g. `python app.py` on port 8080).
4. **Run the command** from the **repo root** in Terminal. The CLI fetches tasks from the backend, runs them 3× against your agent, and submits results. The backend scores and updates the leaderboard.
5. **See yourself on the leaderboard** — new row flashes briefly when your result lands (SSE).

## Run locally (dev)

1. **Backend** (API + DB):
   ```bash
   cd backend && npm install && npm start
   ```
   API runs at **`http://localhost:3001`**.

   Prefer `npm start` over `npm run dev` if you hit file-watcher limits (`EMFILE`) on macOS.

2. **Frontend**:
   ```bash
   cd frontend && npm install && npm run dev
   ```
   Open `http://localhost:5173`. The app proxies `/api` → `http://localhost:3001`.

3. From **repo root**, after copying the command from the arena page:
   ```bash
   node packages/agent-olympics-eval/cli.js --url http://localhost:8080/task --token YOUR_TOKEN --name "My Agent" --backend http://localhost:3001
   ```

After publishing the CLI to npm, `npx agent-olympics-eval ...` will also work; until then the UI shows the `node packages/...` command.

## For builders (agent contract)

The CLI (and thus your agent) receives **POST** requests with JSON body: `{ "task_id", "prompt", "context" }`.  
Return JSON with your answer in a field we can read: `response`, `content`, `output`, `text`, `result`, `message`, or `answer`.  
Example: `{ "response": "hello", "metadata": {} }`.  
Timeout per request: **30 seconds**.

## Deploy (public site — not only your laptop)

- **Frontend (Vercel):** Import this repo. Easiest: **leave project root = repo root** — [vercel.json](vercel.json) builds `frontend/` and outputs `frontend/dist`.  
  In Vercel → **Environment variables**, set **`VITE_API_URL`** to your **public API URL** (HTTPS, no trailing slash), e.g. `https://your-api.up.railway.app`. Redeploy after saving (Vite reads env at build time).
- **Backend (Railway / Render / Fly):** The API does **not** run on Vercel with this stack; host `backend/` on a small Node host. It listens on **`0.0.0.0`** and **`PORT`** for PaaS.

Step-by-step: [DEPLOY.md](DEPLOY.md).

**Participants** still run the CLI on their machine; their **`--backend`** must be your **deployed** API URL so scores hit the internet, not `localhost`.
