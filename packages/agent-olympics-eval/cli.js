#!/usr/bin/env node

const { runEvaluation } = require('./run');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { url: null, token: null, name: 'Unnamed Agent', backend: 'http://localhost:3001' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) out.url = args[++i];
    else if (args[i] === '--token' && args[i + 1]) out.token = args[++i];
    else if (args[i] === '--name' && args[i + 1]) out.name = args[++i];
    else if (args[i] === '--backend' && args[i + 1]) out.backend = args[++i].replace(/\/$/, '');
  }
  return out;
}

async function main() {
  const { url, token, name, backend } = parseArgs();
  if (!url || !token) {
    console.error('Usage: npx agent-olympics-eval --url <AGENT_URL> --token <TOKEN> --name "Agent Name" [--backend http://localhost:3001]');
    process.exit(1);
  }

  const agentUrl = url.startsWith('http') ? url : `http://${url}`;
  const base = backend.replace(/\/$/, '');

  console.log('Fetching tasks from', base, '…');
  console.log('Running evaluation against', agentUrl, '…');
  const results = await runEvaluation(agentUrl, base, (task, run, total) => {
    console.log(`  Task ${task}/${total} (run ${run}/3)`);
  });

  console.log('Submitting to', base, '…');
  const res = await fetch(`${base}/submit-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, agent_name: name, results }),
  });
  const data = await res.json().catch(() => ({}));
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
