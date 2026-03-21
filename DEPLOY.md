# Deploy: public site (Vercel) + public API (not your laptop)

The **UI** can live on Vercel. The **API** (Express + SQLite) cannot run as a long-lived server inside Vercel’s static/serverless model the way this repo is written — you host the API on a small PaaS and point the frontend at it.

## 1. Deploy the API (Railway example)

1. Create a project on [Railway](https://railway.app) (or Render, Fly.io, etc.).
2. **Root directory:** `backend`
3. **Start command:** `npm start` (runs `node index.js`)
4. **Port:** platform sets `PORT`; the app uses `process.env.PORT` and listens on `0.0.0.0`.
5. Generate a **public HTTPS URL** for the service (e.g. `https://your-service.up.railway.app`).

**SQLite:** Data persists for the lifetime of the container/volume. If the platform gives you an ephemeral disk, the DB resets when the instance restarts — fine for a hackathon demo; add a volume later for durability.

**CORS:** The API already uses `cors()` so browsers on your Vercel domain can call it.

## 2. Deploy the frontend (Vercel)

1. Import the repo in Vercel.
2. **Root Directory:** `frontend`
3. **Framework:** Other (static + Vite build). Build: `npm run build`, Output: `dist` (matches [vercel.json](vercel.json) if you deploy from repo root — if Root Directory is `frontend`, set build/output in the Vercel UI to match [frontend/package.json](frontend/package.json) scripts).

If Vercel project root is **repo root** (using root `vercel.json`):

- `buildCommand`: `cd frontend && npm install && npm run build`
- `outputDirectory`: `frontend/dist`

If Vercel root is **`frontend/`**, use:

- Build: `npm run build`
- Output: `dist`

4. **Environment variable** (Production + Preview if you want):

   | Name           | Value                                      |
   |----------------|--------------------------------------------|
   | `VITE_API_URL` | `https://your-service.up.railway.app`      |

   No trailing slash.

5. Redeploy after setting env vars (Vite bakes `VITE_*` in at **build** time).

## 3. What visitors do

1. Open your Vercel URL → landing → **Enter the Colosseum**.
2. **Backend URL** should match your deployed API (pre-filled when `VITE_API_URL` is set).
3. They still run the **CLI on their machine** against **their** local agent; `--backend` must be your **public** API URL so tasks + submit hit the internet, not `localhost:3001` on their laptop.

## 4. Local development (unchanged)

- Do **not** set `VITE_API_URL` locally (or leave empty).
- Run backend on `3001`, frontend with Vite; `/api` proxies to localhost.

See also [README.md](README.md).
