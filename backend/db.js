const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = process.env.DB_PATH || path.join(dataDir, 'agentolympics.db');
const ACTIVE_HEAT_STATUSES = ['WAITING', 'OPEN', 'COUNTDOWN', 'LIVE'];
const VALID_HEAT_STATUSES = [...ACTIVE_HEAT_STATUSES, 'COMPLETE'];

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function runsTableHasHeatIdFk(db) {
  try {
    const list = db.prepare('PRAGMA foreign_key_list(runs)').all();
    return list.some((fk) => fk.table === 'heats' && fk.from === 'heat_id');
  } catch {
    return false;
  }
}

function quoteList(list) {
  return list.map((x) => `'${x}'`).join(', ');
}

/** Enforce runs.heat_id → heats(id); null out orphans so migration always succeeds. */
function migrateRunsHeatForeignKey(db) {
  if (runsTableHasHeatIdFk(db)) return;
  const t = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='heats'")
    .get();
  if (!t) return;

  db.pragma('foreign_keys = OFF');
  try {
    db.prepare(
      `UPDATE runs SET heat_id = NULL
       WHERE heat_id IS NOT NULL AND heat_id NOT IN (SELECT id FROM heats)`
    ).run();
    db.exec(`
      CREATE TABLE runs__fk_migration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        run_index INTEGER NOT NULL,
        response_text TEXT,
        latency_ms INTEGER,
        score INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        heat_id TEXT,
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (heat_id) REFERENCES heats(id)
      );
    `);
    db.exec(`
      INSERT INTO runs__fk_migration (id, agent_id, task_id, run_index, response_text, latency_ms, score, created_at, heat_id)
      SELECT id, agent_id, task_id, run_index, response_text, latency_ms, score, created_at, heat_id FROM runs;
    `);
    const maxRow = db.prepare('SELECT MAX(id) AS m FROM runs__fk_migration').get();
    const maxId = maxRow && maxRow.m != null ? maxRow.m : 0;
    db.exec('DROP TABLE runs');
    db.exec('ALTER TABLE runs__fk_migration RENAME TO runs');
    db.exec('CREATE INDEX IF NOT EXISTS idx_runs_heat ON runs(heat_id)');
    if (maxId > 0) {
      const seqTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'")
        .get();
      if (seqTable) {
        db.prepare(`INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('runs', ?)`).run(maxId);
      }
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function normalizeHeatRowsForGuards(db) {
  const validList = quoteList(VALID_HEAT_STATUSES);
  db.prepare(
    `UPDATE heats
     SET status = 'COMPLETE', completed_at = COALESCE(completed_at, datetime('now'))
     WHERE status NOT IN (${validList})`
  ).run();

  const activeList = quoteList(ACTIVE_HEAT_STATUSES);
  const activeRows = db
    .prepare(
      `SELECT id FROM heats
       WHERE status IN (${activeList})
       ORDER BY heat_number DESC, created_at DESC`
    )
    .all();
  if (activeRows.length <= 1) return;

  const idsToClose = activeRows.slice(1).map((r) => r.id);
  const placeholders = idsToClose.map(() => '?').join(', ');
  db.prepare(
    `UPDATE heats
     SET status = 'COMPLETE', completed_at = COALESCE(completed_at, datetime('now'))
     WHERE id IN (${placeholders})`
  ).run(...idsToClose);
}

function installHeatGuardTriggers(db) {
  const validList = quoteList(VALID_HEAT_STATUSES);
  const activeList = quoteList(ACTIVE_HEAT_STATUSES);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_heats_status_insert_guard
    BEFORE INSERT ON heats
    WHEN NEW.status NOT IN (${validList})
    BEGIN
      SELECT RAISE(ABORT, 'INVALID_HEAT_STATUS');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_heats_status_update_guard
    BEFORE UPDATE OF status ON heats
    WHEN NEW.status NOT IN (${validList})
    BEGIN
      SELECT RAISE(ABORT, 'INVALID_HEAT_STATUS');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_heats_single_active_insert
    BEFORE INSERT ON heats
    WHEN NEW.status IN (${activeList})
      AND EXISTS (SELECT 1 FROM heats WHERE status IN (${activeList}))
    BEGIN
      SELECT RAISE(ABORT, 'ONLY_ONE_ACTIVE_HEAT');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_heats_single_active_update
    BEFORE UPDATE OF status ON heats
    WHEN NEW.status IN (${activeList})
      AND EXISTS (SELECT 1 FROM heats WHERE id <> NEW.id AND status IN (${activeList}))
    BEGIN
      SELECT RAISE(ABORT, 'ONLY_ONE_ACTIVE_HEAT');
    END;
  `);
}

function migrate(db) {
  const agentsCols = columnNames(db, 'agents');
  if (!agentsCols.includes('is_benchmark')) {
    db.exec('ALTER TABLE agents ADD COLUMN is_benchmark INTEGER NOT NULL DEFAULT 0');
  }

  const tasksCols = columnNames(db, 'tasks');
  if (!tasksCols.includes('tier')) {
    db.exec('ALTER TABLE tasks ADD COLUMN tier INTEGER NOT NULL DEFAULT 1');
  }

  const runsCols = columnNames(db, 'runs');
  if (!runsCols.includes('heat_id')) {
    db.exec('ALTER TABLE runs ADD COLUMN heat_id TEXT');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS heats (
      id TEXT PRIMARY KEY,
      heat_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      task_ids TEXT,
      countdown_ends_at TEXT,
      live_started_at TEXT,
      live_ends_at TEXT,
      completed_at TEXT,
      winner_agent_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS heat_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      heat_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (heat_id) REFERENCES heats(id)
    );

    CREATE INDEX IF NOT EXISTS idx_runs_heat ON runs(heat_id);
    CREATE INDEX IF NOT EXISTS idx_reg_heat ON heat_registrations(heat_id);

    CREATE TABLE IF NOT EXISTS heat_name_claims (
      heat_id TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (heat_id, normalized_name),
      FOREIGN KEY (heat_id) REFERENCES heats(id)
    );

    CREATE TABLE IF NOT EXISTS submit_tokens (
      token TEXT PRIMARY KEY,
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      reserved INTEGER NOT NULL DEFAULT 0,
      used INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_submit_tokens_expires ON submit_tokens(expires_at_ms);
  `);

  migrateRunsHeatForeignKey(db);
  normalizeHeatRowsForGuards(db);
  installHeatGuardTriggers(db);
}

function initDb() {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  /** Enforce FOREIGN KEY constraints (SQLite default is off). */
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      webhook_url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      context TEXT,
      expected_type TEXT NOT NULL,
      expected_value TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      run_index INTEGER NOT NULL,
      response_text TEXT,
      latency_ms INTEGER,
      score INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
  `);

  migrate(db);

  return db;
}

module.exports = { initDb };
