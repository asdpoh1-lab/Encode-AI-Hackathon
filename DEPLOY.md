# Deploy: public site (Vercel) + public API (not your laptop)

The **UI** can live on Vercel. The **API** (Express + SQLite) cannot run as a long-lived server inside Vercel’s static/serverless model the way this repo is written — you host the API on a small PaaS and point the frontend at it.

## Vercel quick start

**Option A — Recommended: connect the whole repo**

1. Go to [vercel.com](https://vercel.com) → **Add New…** → **Project** → import this GitHub repo.
2. **Do not** set “Root Directory” (leave default so the **repository root** is the Vercel project root).  
   Vercel will read the root [`vercel.json`](vercel.json): install + build run inside `frontend/`, output is `frontend/dist`.
3. Under **Environment Variables** (Production — and Preview if you want previews to work against a real API), add:
   - **`VITE_API_URL`** = your public API base URL, e.g. `https://your-service.up.railway.app` (no trailing slash).
4. **Deploy**. After the first deploy, open the Vercel URL → landing → **Enter the Colosseum**.  
   If `VITE_API_URL` is set, the **Backend URL** field is pre-filled and leaderboard / SSE use that host.

**Option B — Vercel project root = `frontend/`**

1. Import the repo and set **Root Directory** to **`frontend`**.
2. Vercel will auto-detect **Vite** (see [`frontend/vercel.json`](frontend/vercel.json)); output is **`dist`**.
3. Add the same **`VITE_API_URL`** env var, then deploy.

**CLI (optional)**

```bash
cd /path/to/Encode-AI-Hackathon
npx vercel link    # once, link to a project
npx vercel env pull   # optional: sync env to .env.local
npx vercel --prod
```

Set **`VITE_API_URL`** in the Vercel dashboard (or `npx vercel env add VITE_API_URL production`) — Vite inlines it at **build** time, so trigger a **redeploy** after changing it.

**Without a hosted API:** the static site still deploys, but leaderboard / token / CLI against “production” will fail until you deploy the backend (below) and set `VITE_API_URL`.

---

## 1. Deploy the API (Railway example)

1. Create a project on [Railway](https://railway.app) (or Render, Fly.io, etc.).
2. **Root directory:** `backend`
3. **Start command:** `npm start` (runs `node index.js`)
4. **Port:** platform sets `PORT`; the app uses `process.env.PORT` and listens on `0.0.0.0`.
5. Generate a **public HTTPS URL** for the service (e.g. `https://your-service.up.railway.app`).
6. Set **`HEATS_ADMIN_SECRET`** to a long random string. If you use **`/admin.html`** on Vercel, add **`VITE_ADMIN_TOKEN`** with the **same value** in the Vercel project env (see [`frontend/.env.example`](frontend/.env.example)) and redeploy so the admin page can send **`X-Admin-Token`**.

**SQLite:** Data persists for the lifetime of the container/volume. If the platform gives you an ephemeral disk, the DB resets when the instance restarts — fine for a hackathon demo; add a volume later for durability.

**CORS:** The API already uses `cors()` so browsers on your Vercel domain can call it.

## 2. Deploy the frontend (Vercel) — details

Summary of what the two layouts use:

| Vercel root   | Config | Build / output |
|---------------|--------|----------------|
| **Repo root** | Root [`vercel.json`](vercel.json) | `cd frontend && npm install` → `cd frontend && npm run build` → **`frontend/dist`** |
| **`frontend/`** | [`frontend/vercel.json`](frontend/vercel.json) | Vite: **`npm run build`** → **`dist`** |

**Environment variable** (Production + Preview if you want):

| Name                | Value                                      |
|---------------------|--------------------------------------------|
| `VITE_API_URL`      | `https://your-service.up.railway.app`      |
| `VITE_ADMIN_TOKEN`  | Same as backend `HEATS_ADMIN_SECRET` (optional; for `/admin.html` only) |

No trailing slash. Redeploy after changing env vars (Vite bakes `VITE_*` at **build** time).

## 3. What visitors do

1. Open your Vercel URL → landing → **Enter the Colosseum**.
2. **Backend URL** should match your deployed API (pre-filled when `VITE_API_URL` is set).
3. They still run the **CLI on their machine** against **their** local agent; `--backend` must be your **public** API URL so tasks + submit hit the internet, not `localhost:3001` on their laptop.

## 4. Local development (unchanged)

- Do **not** set `VITE_API_URL` locally (or leave empty).
- Run backend on `3001`, frontend with Vite; `/api` proxies to localhost.

See also [README.md](README.md).
