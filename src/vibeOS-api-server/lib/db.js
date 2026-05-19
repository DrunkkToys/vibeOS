import Database from "better-sqlite3"
import { readFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.VIBEOS_API_DB_PATH || join(__dirname, "..", "data", "vibeos-api.db")

let db

export function getDb() {
  if (db) return db

  const dbDir = dirname(DB_PATH)
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true })
  }

  db = new Database(DB_PATH)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")

  db.exec(`
    CREATE TABLE IF NOT EXISTS seats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      seat_id INTEGER NOT NULL,
      label TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked', 'expired')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      expires_at TEXT,
      last_used_at TEXT,
      FOREIGN KEY (seat_id) REFERENCES seats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS blackbox_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      project_id TEXT,
      state_json TEXT NOT NULL DEFAULT '{}',
      outcome TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS blackbox_calibration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL DEFAULT 'global',
      weights_json TEXT NOT NULL DEFAULT '{}',
      samples_used INTEGER NOT NULL DEFAULT 0,
      precision REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id)
    );

    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      request_body TEXT,
      response_size INTEGER,
      latency_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (token_id) REFERENCES api_tokens(id)
    );

    CREATE INDEX IF NOT EXISTS idx_tokens_token ON api_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_tokens_seat ON api_tokens(seat_id);
    CREATE INDEX IF NOT EXISTS idx_tokens_status ON api_tokens(status);
    CREATE INDEX IF NOT EXISTS idx_seats_status ON seats(status);
    CREATE INDEX IF NOT EXISTS idx_blackbox_project ON blackbox_sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_blackbox_updated ON blackbox_sessions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_usage_token ON usage_log(token_id);
    CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_log(created_at);
  `)

  return db
}

export function initDb() {
  getDb()
  return db
}
