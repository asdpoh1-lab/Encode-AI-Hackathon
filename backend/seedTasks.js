const tasks = [
  {
    id: 'task_1',
    prompt: 'Return the string "hello" exactly.',
    context: null,
    expected_type: 'exact',
    expected_value: 'hello',
  },
  {
    id: 'task_2',
    prompt: 'Return a JSON object with exactly two keys: "status" and "value". Set status to "ok" and value to 42.',
    context: null,
    expected_type: 'json_keys',
    expected_value: 'status,value',
  },
  {
    id: 'task_3',
    prompt: 'Reply with only the word "agent".',
    context: null,
    expected_type: 'exact',
    expected_value: 'agent',
  },
  {
    id: 'task_4',
    prompt: 'You must return a function that takes two numbers a and b and returns their sum. Return only the function expression, e.g. (a, b) => a + b',
    context: 'We will call your function with (2,3) and (-1,1) and expect 5 and 0.',
    expected_type: 'code_add',
    expected_value: null,
  },
  {
    id: 'task_5',
    prompt: 'Return a string that contains the substring "olympics".',
    context: null,
    expected_type: 'contains',
    expected_value: 'olympics',
  },
];

function seedTasks(db) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO tasks (id, prompt, context, expected_type, expected_value)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const t of tasks) {
    stmt.run(t.id, t.prompt, t.context || null, t.expected_type, t.expected_value || null);
  }
}

module.exports = { seedTasks, tasks };
