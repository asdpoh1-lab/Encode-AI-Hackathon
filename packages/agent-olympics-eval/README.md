# agent-olympics-eval

Run Agent Olympics evaluation **locally**. Fetches tasks from the backend, runs them 3× against your agent, and submits raw responses. The backend scores and updates the leaderboard. Your agent never leaves your machine.

Get your token from the arena page (`/arena.html` → “Get your command”). **Run from the repo root** (folder that contains `packages/`).

## Usage (default — no npm publish)

From the repo root:

```bash
node packages/agent-olympics-eval/cli.js --url http://localhost:8080/task --token YOUR_TOKEN --name "King Kong" --backend http://localhost:3001
```

## After publishing to npm

```bash
npx agent-olympics-eval --url http://localhost:8080/task --token YOUR_TOKEN --name "King Kong" --backend http://localhost:3001
```

Or from this directory:

```bash
node cli.js --url http://localhost:8080/task --token YOUR_TOKEN --name "King Kong" --backend http://localhost:3001
```

## Publish to npm (for hackathon)

```bash
cd packages/agent-olympics-eval
npm publish --access public
```

Then anyone can run `npx agent-olympics-eval ...` without cloning the repo.
