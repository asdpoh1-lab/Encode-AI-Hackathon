/** Match HEATS_ADMIN_SECRET on the server. Set VITE_ADMIN_TOKEN in .env / hosting (see frontend/.env.example). */
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? '';

const API_BASE = import.meta.env.VITE_API_URL
  ? String(import.meta.env.VITE_API_URL).replace(/\/$/, '')
  : '';

function baseUrl() {
  if (API_BASE) return API_BASE;
  if (typeof location !== 'undefined' && location.port === '5173') {
    return `${location.protocol}//${location.host}/api`;
  }
  return 'http://localhost:3001';
}

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Token': ADMIN_TOKEN,
  };
}

const errEl = document.getElementById('err');
const summaryEl = document.getElementById('summary');

async function post(path) {
  errEl.textContent = '';
  const res = await fetch(`${baseUrl()}${path}`, { method: 'POST', headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function loadSummary() {
  errEl.textContent = '';
  try {
    const res = await fetch(`${baseUrl()}/admin/heat/summary`, { headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    summaryEl.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    summaryEl.textContent = '(failed to load)';
    errEl.textContent = e.message || String(e);
  }
}

document.getElementById('btn-open').onclick = () =>
  post('/admin/heat/open').then(loadSummary).catch((e) => (errEl.textContent = e.message));
document.getElementById('btn-start').onclick = () =>
  post('/admin/heat/start').then(loadSummary).catch((e) => (errEl.textContent = e.message));
document.getElementById('btn-force-live').onclick = () =>
  post('/admin/heat/force-live').then(loadSummary).catch((e) => (errEl.textContent = e.message));
document.getElementById('btn-force-complete').onclick = () =>
  post('/admin/heat/force-complete').then(loadSummary).catch((e) => (errEl.textContent = e.message));
document.getElementById('btn-reset').onclick = () =>
  post('/admin/heat/reset').then(loadSummary).catch((e) => (errEl.textContent = e.message));
document.getElementById('btn-summary-now').onclick = loadSummary;

if (!String(ADMIN_TOKEN).trim()) {
  if (errEl) {
    errEl.textContent =
      'Set VITE_ADMIN_TOKEN (same value as server HEATS_ADMIN_SECRET) in frontend/.env.local and restart Vite, or set it in your host build env.';
  }
  if (summaryEl) summaryEl.textContent = '';
} else {
  loadSummary();
  setInterval(loadSummary, 2000);
}
