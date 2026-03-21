#!/usr/bin/env node

const { runEvaluation, fetchHeatStatus } = require('./run');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    url: null,
    token: null,
    name: 'Unnamed Agent',
    backend: 'http://localhost:3001',
    heat: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) out.url = args[++i];
    else if (args[i] === '--token' && args[i + 1]) out.token = args[++i];
    else if (args[i] === '--name' && args[i + 1]) out.name = args[++i];
    else if (args[i] === '--backend' && args[i + 1]) out.backend = args[++i].replace(/\/$/, '');
    else if (args[i] === '--heat' && args[i + 1]) out.heat = args[++i];
  }
  return out;
}

async function main() {
  const { url, token, name, backend, heat } = parseArgs();
  if (!url || !token) {
    console.error(
      'Usage: node packages/agent-olympics-eval/cli.js --url <AGENT_URL> --token <TOKEN> --heat <HEAT_ID> --name "Agent Name" [--backend http://localhost:3001]'
    );
    process.exit(1);
  }
  if (!heat) {
    console.error('Missing required --heat <HEAT_ID> (copy from the arena page or GET /heat/status).');
    process.exit(1);
  }

  const agentUrl = url.startsWith('http') ? url : `http://${url}`;
  const base = backend.replace(/\/$/, '');

  console.log('Heat:', heat);
  console.log('Fetching tasks from', base, '…');
  console.log('Running evaluation against', agentUrl, '…');
  let results;
  try {
    results = await runEvaluation(agentUrl, base, heat, (task, run, total) => {
      console.log(`  Task ${task}/${total} (run ${run}/3)`);
    });
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  const statusNow = await fetchHeatStatus(base);
  if (statusNow.status !== 'LIVE' || statusNow.heat_id !== heat) {
    console.error(
      'Heat is no longer LIVE (or heat_id changed) before submit. Results were not sent — wait for the next LIVE heat and run again with a fresh token from the arena.'
    );
    process.exit(1);
  }

  console.log('Submitting to', base, '…');
  const res = await fetch(`${base}/submit-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, agent_name: name, results, heat_id: heat }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409) {
    console.error('Submit failed:', data.error || 'Conflict');
    process.exit(1);
  }
  if (!res.ok) {
    console.error('Submit failed:', data.error || res.statusText);
    process.exit(1);
  }
  console.log('Submitted. Your agent is on the leaderboard:', data.name);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
