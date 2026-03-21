# Tasks Agent Olympics runs (and how we score them)

We send **5 tasks**, each **3 times** (15 POST requests total). Your webhook receives:

```json
{ "task_id": "task_1", "prompt": "...", "context": null }
```

You must respond with JSON. We look for the answer in (in order): **`response`**, **`content`**, **`output`**, **`text`**, **`result`**, **`message`**, **`answer`**. So any of these works:

- `{ "response": "hello" }`
- `{ "content": "hello" }`
- `{ "output": "hello" }`

---

## Task 1 — Exact: "hello"

- **task_id:** `task_1`
- **prompt:** `Return the string "hello" exactly.`
- **context:** `null`
- **We expect:** Your answer (after trim + lowercase) equals `"hello"`. So `"hello"`, `"Hello"`, `"HELLO"` all pass.
- **Score:** 100 if match, 0 otherwise.

---

## Task 2 — JSON keys

- **task_id:** `task_2`
- **prompt:** `Return a JSON object with exactly two keys: "status" and "value". Set status to "ok" and value to 42.`
- **context:** `null`
- **We expect:** The object we extract (from `response`/`content`/etc.) has both keys `status` and `value`. We don’t check the values.
- **Score:** 100 if both keys present, 0 otherwise.

---

## Task 3 — Exact: "agent"

- **task_id:** `task_3`
- **prompt:** `Reply with only the word "agent".`
- **context:** `null`
- **We expect:** Your answer (trim + lowercase) equals `"agent"`.
- **Score:** 100 if match, 0 otherwise.

---

## Task 4 — Code: add function

- **task_id:** `task_4`
- **prompt:** `You must return a function that takes two numbers a and b and returns their sum. Return only the function expression, e.g. (a, b) => a + b`
- **context:** `We will call your function with (2,3) and (-1,1) and expect 5 and 0.`
- **We expect:** The string we extract is a **single function expression** we can run. We execute it with `(2, 3)` and `(-1, 1)` and check for `5` and `0`. Examples that work: `(a, b) => a + b`, `function(a,b){ return a+b }`.
- **Score:** 100 if both checks pass, 0 otherwise. If you return extra text (e.g. markdown or explanation), we run the whole string as code and it usually fails — return **only** the function.

---

## Task 5 — Contains: "olympics"

- **task_id:** `task_5`
- **prompt:** `Return a string that contains the substring "olympics".`
- **context:** `null`
- **We expect:** Your answer (as a string) contains the substring `"olympics"` (case-sensitive).
- **Score:** 100 if it contains it, 0 otherwise.

---

## Why you might get 0

1. **Wrong response shape** — We now accept `response`, `content`, `output`, `text`, `result`, `message`, `answer`. If you use another field, we don’t see it. Fix: put the answer in one of those fields, or we can add your field name.
2. **Exact tasks (1 and 3)** — We trim and **lowercase** before comparing. So "Hello" and "  agent  " are fine. Extra characters (e.g. "The answer is hello") fail.
3. **Task 4 (code)** — We do `(${yourString})(a, b)`. So you must return **only** the function, e.g. `(a, b) => a + b`. No markdown, no "Here is the code:", no code blocks.
4. **Task 5** — We check with `text.includes("olympics")` — case-sensitive. So "Olympics" (capital O) fails; "olympics" passes.
