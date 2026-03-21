const rawApiUrl = import.meta.env.VITE_API_URL;
const API_BASE = rawApiUrl && String(rawApiUrl).trim()
  ? String(rawApiUrl).trim().replace(/\/$/, '')
  : '';

function baseUrl() {
  if (API_BASE) return API_BASE;
  if (typeof location !== 'undefined' && location.port === '5173') {
    return `${location.protocol}//${location.host}/api`;
  }
  return 'http://localhost:3001';
}

function getToken() {
  return localStorage.getItem('admin_token') || '';
}

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Token': getToken(),
  };
}

const errEl = document.getElementById('err');
const summaryEl = document.getElementById('summary');
const loginOverlay = document.getElementById('login-overlay');
const loginBtn = document.getElementById('login-btn');
const loginInput = document.getElementById('login-password');
const loginErr = document.getElementById('login-err');
const adminContent = document.getElementById('admin-content');
const logoutBtn = document.getElementById('logout-btn');

function showAdmin() {
  loginOverlay.style.display = 'none';
  adminContent.style.display = 'block';
  loadSummary();
  setInterval(loadSummary, 2000);
}

function showLogin(msg) {
  loginOverlay.style.display = 'flex';
  adminContent.style.display = 'none';
  if (msg && loginErr) loginErr.textContent = msg;
}

async function tryLogin(password) {
  localStorage.setItem('admin_token', password);
  try {
    const res = await fetch(`${baseUrl()}/admin/heat/summary`, { headers: headers() });
    if (!res.ok) {
      localStorage.removeItem('admin_token');
      return false;
    }
    return true;
  } catch {
    localStorage.removeItem('admin_token');
    return false;
  }
}

loginBtn.addEventListener('click', async () => {
  const pw = loginInput.value.trim();
  if (!pw) { loginErr.textContent = 'Enter the admin password'; return; }
  loginBtn.disabled = true;
  loginBtn.textContent = 'Checking...';
  loginErr.textContent = '';
  const ok = await tryLogin(pw);
  loginBtn.disabled = false;
  loginBtn.textContent = 'Login';
  if (ok) {
    showAdmin();
  } else {
    loginErr.textContent = 'Wrong password or backend unreachable';
  }
});

loginInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click();
});

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('admin_token');
  showLogin('');
  loginInput.value = '';
});

async function post(path) {
  errEl.textContent = '';
  const res = await fetch(`${baseUrl()}${path}`, { method: 'POST', headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem('admin_token');
    showLogin('Session expired — please log in again');
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function loadSummary() {
  errEl.textContent = '';
  try {
    const res = await fetch(`${baseUrl()}/admin/heat/summary`, { headers: headers() });
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('admin_token');
      showLogin('Session expired — please log in again');
      return;
    }
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

// Auto-login if token exists in localStorage
if (getToken()) {
  tryLogin(getToken()).then((ok) => {
    if (ok) showAdmin();
    else showLogin('Saved token expired — please log in again');
  });
} else {
  showLogin('');
}
