function extractResponse(body) {
  if (!body || typeof body !== 'object') return body;
  const keys = ['response', 'content', 'output', 'text', 'result', 'message', 'answer'];
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== null) return body[k];
  }
  if (Array.isArray(body.content) && body.content[0]?.text) return body.content[0].text;
  if (Array.isArray(body.choices) && body.choices[0]?.message?.content) return body.choices[0].message.content;
  return body;
}

function scoreRun(task, runResult) {
  if (!runResult.ok) return 0;
  const body = runResult.body || {};
  const response = extractResponse(body);
  const text =
    typeof response === 'string' ? response : JSON.stringify(response || '');

  switch (task.expected_type) {
    case 'exact': {
      const expected = (task.expected_value || '').trim().toLowerCase();
      const got = text.trim().toLowerCase();
      return (got === expected) ? 100 : 0;
    }
    case 'contains': {
      const expected = (task.expected_value || '').trim();
      return text.includes(expected) ? 100 : 0;
    }
    case 'json_keys': {
      try {
        const obj = typeof response === 'object' ? response : JSON.parse(text);
        const keys = (task.expected_value || '').split(',').map((k) => k.trim());
        const hasAll = keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
        return hasAll ? 100 : 0;
      } catch {
        return 0;
      }
    }
    case 'code_add': {
      try {
        const fnStr = typeof response === 'string' ? response : (response?.response ?? response?.code ?? '');
        if (typeof fnStr !== 'string') return 0;
        const fn = new Function('a', 'b', `return (${fnStr})(a, b);`);
        if (fn(2, 3) === 5 && fn(-1, 1) === 0) return 100;
        return 0;
      } catch {
        return 0;
      }
    }
    default:
      return 0;
  }
}

module.exports = { scoreRun };
