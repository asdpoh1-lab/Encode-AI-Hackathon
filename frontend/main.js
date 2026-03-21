/** Vercel / prod: set VITE_API_URL to your public API (https://…, no trailing slash). Local dev: omit → uses /api proxy to localhost:3001 */
const API = import.meta.env.VITE_API_URL || (typeof location !== 'undefined' ? '/api' : 'http://localhost:3001');

function apiUrl(path) {
  const p = path.replace(/^\//, '');
  if (API.startsWith('http')) return `${API.replace(/\/$/, '')}/${p}`;
  return `${API.replace(/\/$/, '')}/${p}`;
}

(function applyDeployedBackendDefault() {
  const raw = import.meta.env.VITE_API_URL;
  const el = document.getElementById('backend-url');
  if (!el || raw == null || String(raw).trim() === '') return;
  el.value = String(raw).trim().replace(/\/$/, '');
})();

let lastHeatStatus = null;
let prevHeatStatusName = null;
let heatPollTimer = null;
let currentHeatId = null;
let heatPollErrorCount = 0;
let leaderboardRefreshFailCount = 0;
const IS_DEV = import.meta.env.DEV;

function renderCards(leaderboard) {
  const el = document.getElementById('cards');
  const list = leaderboard?.leaderboard || [];
  if (list.length === 0) {
    el.innerHTML = '<p class="empty">No agents yet. When the heat is LIVE, run your CLI command to appear here.</p>';
    return;
  }
  el.innerHTML = list
    .map(
      (a) => `
    <div class="card${a.is_benchmark ? ' card-benchmark' : ''}" data-id="${escapeHtml(a.id)}">
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
  const res = await fetch(apiUrl('/leaderboard'));
  if (!res.ok) throw new Error('Failed to load leaderboard');
  const data = await res.json();
  renderCards(data);
  return data;
}

function formatMMSS(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateHeatUI(st) {
  const panel = document.getElementById('heat-panel');
  if (!panel || !st) return;

  currentHeatId = st.heat_id;
  lastHeatStatus = st;

  const title = document.getElementById('heat-title');
  const badge = document.getElementById('heat-badge');
  const cd = document.getElementById('heat-countdown');
  const reg = document.getElementById('heat-registered');
  const sub = document.getElementById('heat-submitted');
  const hint = document.getElementById('heat-hint');
  const regWrap = document.getElementById('heat-register-wrap');

  if (title) title.textContent = st.heat_number ? `Heat ${st.heat_number}` : 'Heat';
  if (badge) {
    badge.textContent = st.status;
    badge.className = 'heat-badge heat-status-' + String(st.status).toLowerCase();
  }

  if (cd) {
    if (st.status === 'COUNTDOWN' && st.countdown_seconds != null) {
      cd.style.display = 'block';
      cd.textContent = formatMMSS(st.countdown_seconds);
    } else if (st.status === 'LIVE' && st.live_seconds_remaining != null) {
      cd.style.display = 'block';
      cd.textContent = 'Live · ' + formatMMSS(st.live_seconds_remaining) + ' left';
    } else {
      cd.style.display = 'none';
    }
  }

  if (reg) {
    reg.textContent =
      st.status === 'OPEN' || st.status === 'COUNTDOWN' || st.status === 'LIVE'
        ? `${st.registered_count} agent(s) registered`
        : '';
  }
  if (sub) {
    if (st.registered_count > 0) {
      sub.textContent = `${st.submitted_count} of ${st.registered_count} submitted`;
    } else {
      sub.textContent =
        st.submitted_count > 0 ? `${st.submitted_count} submitted` : '';
    }
  }

  if (hint) {
    if (st.status === 'OPEN') {
      hint.textContent = 'Waiting for host to start the heat.';
    } else if (st.status === 'COUNTDOWN') {
      hint.textContent = 'Get ready — run your CLI when the heat goes LIVE.';
    } else if (st.status === 'LIVE') {
      hint.textContent = 'Tasks firing — submit your results now (run your copied command).';
    } else if (st.status === 'COMPLETE') {
      hint.textContent = '';
    } else {
      hint.textContent = 'Waiting for the host to open registration.';
    }
  }

  if (regWrap) {
    regWrap.style.display = st.status === 'OPEN' ? 'block' : 'none';
  }

  updateOneliner();

  if (prevHeatStatusName !== 'COMPLETE' && st.status === 'COMPLETE' && st.heat_id) {
    showWinnerBanner(st.heat_id);
  }
  prevHeatStatusName = st.status;
}

async function pollHeatStatus() {
  try {
    const res = await fetch(apiUrl('/heat/status'));
    if (!res.ok) {
      heatPollErrorCount += 1;
      if (heatPollErrorCount === 1 || heatPollErrorCount % 10 === 0) {
        setStatus(`Heat status error (${res.status}). Retrying…`);
      }
      return;
    }
    heatPollErrorCount = 0;
    const st = await res.json();
    updateHeatUI(st);
  } catch {
    heatPollErrorCount += 1;
    if (heatPollErrorCount === 1 || heatPollErrorCount % 10 === 0) {
      setStatus('Cannot reach API for heat status. Retrying…');
    }
  }
}

function startHeatPolling() {
  if (heatPollTimer) clearInterval(heatPollTimer);
  heatPollTimer = setInterval(pollHeatStatus, 1000);
  pollHeatStatus();
}

async function showWinnerBanner(heatId) {
  const banner = document.getElementById('heat-winner-banner');
  if (!banner) return;
  try {
    const res = await fetch(apiUrl(`/heat/winner?heat_id=${encodeURIComponent(heatId)}`));
    const w = await res.json();
    if (!res.ok) {
      banner.style.display = 'none';
      if (IS_DEV) console.warn('[arena] heat/winner HTTP', res.status, w);
      return;
    }
    const hn = lastHeatStatus?.heat_number || '';
    if (w.no_eligible_human_winner) {
      banner.innerHTML = `
      <div class="heat-winner-inner">
        <div class="heat-winner-title">Heat ${escapeHtml(String(hn))} complete</div>
        <div class="heat-winner-stats">No eligible human winner (benchmarks only or no submissions).</div>
      </div>
    `;
      banner.style.display = 'block';
      setTimeout(() => {
        banner.style.display = 'none';
        banner.innerHTML = '';
      }, 10000);
      return;
    }
    if (!w.agent_name) {
      banner.style.display = 'none';
      return;
    }
    banner.innerHTML = `
      <div class="heat-winner-inner">
        <div class="heat-winner-title">🏅 ${escapeHtml(w.agent_name)} wins Heat ${hn}</div>
        <div class="heat-winner-stats">Score: ${escapeHtml(String(w.score))} · Variance: ${escapeHtml(String(w.variance))} · Speed: ${w.speed_ms != null ? (w.speed_ms / 1000).toFixed(1) + 's' : '—'}</div>
      </div>
    `;
    banner.style.display = 'block';
    setTimeout(() => {
      banner.style.display = 'none';
      banner.innerHTML = '';
    }, 10000);
  } catch (err) {
    banner.style.display = 'none';
    if (IS_DEV) console.warn('[arena] showWinnerBanner', err);
  }
}

function connectSSE() {
  const url = apiUrl('/leaderboard/stream');
  try {
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'leaderboard') {
          fetchLeaderboard()
            .then(() => {
              leaderboardRefreshFailCount = 0;
              if (d.agentId) flashCard(d.agentId);
            })
            .catch((err) => {
              leaderboardRefreshFailCount += 1;
              if (leaderboardRefreshFailCount <= 3 || leaderboardRefreshFailCount % 20 === 0) {
                console.warn('[arena] leaderboard refresh after SSE failed:', err && err.message ? err.message : err);
                setStatus('Leaderboard refresh failed. Retrying on next update…');
              }
            });
        }
      } catch {
        fetchLeaderboard().catch((err) => {
          leaderboardRefreshFailCount += 1;
          if (leaderboardRefreshFailCount <= 3 || leaderboardRefreshFailCount % 20 === 0) {
            console.warn('[arena] leaderboard refresh (parse fallback) failed:', err && err.message ? err.message : err);
          }
        });
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

let token = null;

function getBackendUrl() {
  const el = document.getElementById('backend-url');
  return el && el.value.trim() ? el.value.trim().replace(/\/$/, '') : 'http://localhost:3001';
}

async function loadToken() {
  const status = document.getElementById('token-status');
  const wrap = document.getElementById('oneliner-wrap');
  const copyBtn = document.getElementById('copy-btn');
  if (status) status.textContent = 'Loading token…';
  try {
    const res = await fetch(apiUrl('/get-submit-token'));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    token = data.token;
    const mins = data.expiresIn != null ? Math.round(data.expiresIn / 60) : 90;
    if (status) {
      status.textContent = `Token ready (valid ~${mins} min, one use). Run the command when the heat is LIVE.`;
    }
    updateOneliner();
    if (wrap) wrap.style.display = 'block';
    if (copyBtn) copyBtn.style.display = 'inline-block';
  } catch (e) {
    const backend = getBackendUrl();
    if (status) {
      status.textContent =
        'Could not load token. Is the backend running? For local dev: cd backend && npm start';
    }
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
  const heat = currentHeatId || 'YOUR_HEAT_ID';
  const cmd = `node packages/agent-olympics-eval/cli.js --url ${agentUrl} --token ${token} --heat ${heat} --name "${nameEscaped}" --backend ${backend}`;
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
    const showCopied = () => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy command';
      }, 2000);
    };
    navigator.clipboard.writeText(cmd).then(showCopied).catch(() => {
      try {
        const ta = document.createElement('textarea');
        ta.value = cmd;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showCopied();
      } catch {
        copyBtn.textContent = 'Select & copy manually';
        setTimeout(() => {
          copyBtn.textContent = 'Copy command';
        }, 2500);
      }
    });
  });
}

const registerBtn = document.getElementById('register-btn');
if (registerBtn) {
  registerBtn.addEventListener('click', async () => {
    const input = document.getElementById('register-name');
    const msg = document.getElementById('register-message');
    const name = input && input.value.trim();
    if (!name) {
      if (msg) msg.textContent = 'Enter a name';
      return;
    }
    try {
      const res = await fetch(apiUrl('/heat/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      if (msg) {
        msg.textContent = 'Registered!';
        msg.className = 'register-message success';
      }
      pollHeatStatus();
    } catch (e) {
      if (msg) {
        msg.textContent = e.message || 'Error';
        msg.className = 'register-message error';
      }
    }
  });
}

(async () => {
  setStatus('Loading…');
  const heatPanel = document.getElementById('heat-panel');
  try {
    if (heatPanel) startHeatPolling();
    await fetchLeaderboard();
    setStatus('Live');
    connectSSE();
    loadToken();
  } catch (e) {
    const hint =
      API === '/api'
        ? 'Start the backend on port 3001: cd backend && npm start (then refresh)'
        : 'Is the backend running on ' + API + '?';
    setStatus('Cannot reach API. ' + hint);
  }
})();
