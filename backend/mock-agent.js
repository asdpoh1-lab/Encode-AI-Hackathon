#!/usr/bin/env node
/**
 * Minimal mock agent for testing. POST / returns correct answers for each task.
 * Run: node mock-agent.js   (listens on 8765)
 */
const http = require('http');
const PORT = 8765;

const responses = {
  task_1: { response: 'hello' },
  task_2: { status: 'ok', value: 42 },
  task_3: { response: 'agent' },
  task_4: { response: '(a, b) => a + b' },
  task_5: { response: 'The olympics are great' },
};

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const { task_id } = JSON.parse(body);
      const payload = responses[task_id] || { response: 'unknown' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch {
      res.writeHead(400);
      res.end();
    }
  });
});

server.listen(PORT, () => console.log(`Mock agent on http://localhost:${PORT}`));
