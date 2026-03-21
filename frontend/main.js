/** Vercel / prod: set VITE_API_URL to your public API (https://…, no trailing slash). Local dev: omit → uses /api proxy to localhost:3001 */
const API = import.meta.env.VITE_API_URL || (typeof location !== 'undefined' ? '/api' : 'http://localhost:3001');

(function applyDeployedBackendDefault() {
  const raw = import.meta.env.VITE_API_URL;
  const el = document.getElementById('backend-url');
  if (!el || raw == null || String(raw).trim() === '') return;
  el.value = String(raw).trim().replace(/\/$/, '');
})();

function renderCards(leaderboard) {
  const el = document.getElementById('cards');
  const list = leaderboard?.leaderboard || [];
  if (list.length === 0) {
    el.innerHTML = '<p class="empty">No agents yet. Get your command below and run it to appear here.</p>';
    return;
  }
  el.innerHTML = list
    .map(
      (a) => `
    <div class="card" data-id="${escapeHtml(a.id)}">
      <span class="card-name">${escapeHtml(a.name)}</span>
      <span class="card-score">Score: ${a.score}</span>
      <span class="card-speed">Speed: ${a.speed}</span>
      <span class="card-variance">Variance: ${a.variance}</span>
    </div>
  `
    )
    .join('');
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function flashCard(agentId) {
  if (!agentId || typeof agentId !== 'string') return;
  document.querySelectorAll('.card[data-id]').forEach((card) => {
    if (card.getAttribute('data-id') === agentId) {
      card.classList.add('updated');
      setTimeout(() => card.classList.remove('updated'), 2500);
    }
  });
}

function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
}

async function fetchLeaderboard() {
  const res = await fetch(`${API}/leaderboard`);
  if (!res.ok) throw new Error('Failed to load leaderboard');
  const data = await res.json();
  renderCards(data);
  return data;
}

function connectSSE() {
  const url = `${API}/leaderboard/stream`;
  try {
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'leaderboard') {
          fetchLeaderboard()
            .then(() => {
              if (d.agentId) flashCard(d.agentId);
            })
            .catch(() => {});
        }
      } catch {
        fetchLeaderboard().catch(() => {});
      }
    };
    es.onerror = () => {
      es.close();
      setStatus('Reconnecting…');
      setTimeout(connectSSE, 3000);
    };
  } catch {
    setStatus('Live updates unavailable. Refreshing every 5s.');
    setInterval(() => fetchLeaderboard().catch(() => {}), 5000);
  }
}

// Join section: token + one-liner (local CLI — works without npm publish)
let token = null;

function getBackendUrl() {
  const el = document.getElementById('backend-url');
  return (el && el.value.trim()) ? el.value.trim().replace(/\/$/, '') : 'http://localhost:3001';
}

async function loadToken() {
  const status = document.getElementById('token-status');
  const wrap = document.getElementById('oneliner-wrap');
  const copyBtn = document.getElementById('copy-btn');
  const backend = getBackendUrl();
  if (status) status.textContent = 'Loading token from ' + backend + '…';
  try {
    const res = await fetch(backend + '/get-submit-token');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    token = data.token;
    const mins = data.expiresIn != null ? Math.round(data.expiresIn / 60) : 90;
    if (status) status.textContent = `Token ready (valid ~${mins} min, one use). Copy the command below and run it from your repo root.`;
    updateOneliner();
    if (wrap) wrap.style.display = 'block';
    if (copyBtn) copyBtn.style.display = 'inline-block';
  } catch (e) {
    if (status) status.textContent = 'Could not load token. Is the backend running at ' + backend + '? Start it with: cd backend && npm start';
    const retryBtn = document.getElementById('retry-token-btn');
    if (retryBtn) retryBtn.style.display = 'inline-block';
  }
}

function updateOneliner() {
  if (!token) return;
  const backend = getBackendUrl();
  const agentUrlEl = document.getElementById('agent-url');
  const nameEl = document.getElementById('agent-name');
  const agentUrl = (agentUrlEl && agentUrlEl.value.trim()) || 'http://localhost:8080/task';
  const name = (nameEl && nameEl.value.trim()) || 'My Agent';
  const nameEscaped = name.replace(/"/g, '\\"');
  const cmd = `node packages/agent-olympics-eval/cli.js --url ${agentUrl} --token ${token} --name "${nameEscaped}" --backend ${backend}`;
  const onelinerEl = document.getElementById('oneliner');
  if (onelinerEl) onelinerEl.textContent = cmd;
}

const retryBtn = document.getElementById('retry-token-btn');
if (retryBtn) {
  retryBtn.addEventListener('click', () => {
    retryBtn.style.display = 'none';
    loadToken();
  });
}

['backend-url', 'agent-url', 'agent-name'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', updateOneliner);
});

const copyBtn = document.getElementById('copy-btn');
if (copyBtn) {
  copyBtn.addEventListener('click', () => {
    const onelinerEl = document.getElementById('oneliner');
    const cmd = onelinerEl ? onelinerEl.textContent : '';
    navigator.clipboard.writeText(cmd).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy command'; }, 2000);
    });
  });
}

(async () => {
  setStatus('Loading…');
  try {
    await fetchLeaderboard();
    setStatus('Live');
    connectSSE();
    loadToken();
  } catch (e) {
    const hint = API === '/api'
      ? 'Start the backend on port 3001: cd backend && npm start (then refresh)'
      : 'Is the backend running on ' + API + '?';
    setStatus('Cannot reach API. ' + hint);
  }
})();
