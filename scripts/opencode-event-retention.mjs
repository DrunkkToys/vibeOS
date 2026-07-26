#!/usr/bin/env node
// Compact OpenCode's non-authoritative replay journal only while it is idle.
// Messages and parts are deliberately never modified: they are the chat source
// of truth; `event` is an append-only stream used to replay UI updates.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"

const home = homedir()
const db = process.env.OPENCODE_RETENTION_DB || join(home, ".local", "share", "opencode", "opencode.db")
const log = process.env.OPENCODE_RETENTION_LOG || join(dirname(db), "log", "opencode.log")
const compactMinutes = positiveInt(process.env.OPENCODE_RETENTION_COMPACT_IDLE_MINUTES, 60)
const retentionHours = positiveInt(process.env.OPENCODE_RETENTION_RETENTION_HOURS, 48)
const maxLogBytes = positiveInt(process.env.OPENCODE_RETENTION_MAX_LOG_BYTES, 4 * 1024 * 1024)
const allowRunning = process.env.OPENCODE_RETENTION_ALLOW_RUNNING === "1"

function positiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}
function exec(command, args, input) {
  return spawnSync(command, args, { input, encoding: "utf8", timeout: 30000 })
}
function running() {
  return exec("pgrep", ["-x", "OpenCode"]).status === 0
}
function inUse() {
  // A closed desktop can leave a WAL behind; only an open file descriptor is
  // unsafe. This also covers `opencode` CLI processes.
  return exec("lsof", [db]).status === 0
}
function sqlite(statement) {
  const result = exec("sqlite3", [db, statement])
  if (result.status !== 0) throw new Error(result.stderr || "sqlite3 failed")
  return result.stdout.trim()
}
function compactJournal() {
  const now = Date.now()
  const compactBefore = now - compactMinutes * 60_000
  const pruneBefore = now - retentionHours * 3_600_000
  // Keep the newest full snapshot for each mutable event. The database's
  // message/part rows remain untouched, and immutable/remove events remain in
  // order. Sequences are rebuilt contiguously for replay consumers.
  const sql = `
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
BEGIN IMMEDIATE;
CREATE TEMP TABLE compact_session(id TEXT PRIMARY KEY);
INSERT INTO compact_session SELECT id FROM session WHERE time_updated < ${compactBefore};
CREATE TEMP TABLE keep_event(id TEXT PRIMARY KEY);
INSERT INTO keep_event
SELECT id FROM (
  SELECT e.id, row_number() OVER (PARTITION BY e.aggregate_id, json_extract(e.data, '$.part.id') ORDER BY e.seq DESC) AS rn
  FROM event e JOIN compact_session s ON s.id=e.aggregate_id
  WHERE e.type='message.part.updated.1'
) WHERE rn=1;
INSERT INTO keep_event
SELECT id FROM (
  SELECT e.id, row_number() OVER (PARTITION BY e.aggregate_id, json_extract(e.data, '$.info.id') ORDER BY e.seq DESC) AS rn
  FROM event e JOIN compact_session s ON s.id=e.aggregate_id
  WHERE e.type='message.updated.1'
) WHERE rn=1;
INSERT INTO keep_event
SELECT id FROM (
  SELECT e.id, row_number() OVER (PARTITION BY e.aggregate_id ORDER BY e.seq DESC) AS rn
  FROM event e JOIN compact_session s ON s.id=e.aggregate_id
  WHERE e.type='session.updated.1'
) WHERE rn=1;
DELETE FROM event
WHERE aggregate_id IN (SELECT id FROM compact_session)
  AND type IN ('message.part.updated.1','message.updated.1','session.updated.1')
  AND id NOT IN (SELECT id FROM keep_event);
DELETE FROM event WHERE aggregate_id IN (SELECT id FROM session WHERE time_updated < ${pruneBefore});
DELETE FROM event_sequence WHERE aggregate_id IN (SELECT id FROM session WHERE time_updated < ${pruneBefore});
CREATE TEMP TABLE renumber(id TEXT PRIMARY KEY, seq INTEGER NOT NULL);
INSERT INTO renumber
SELECT id, row_number() OVER (PARTITION BY aggregate_id ORDER BY seq)-1
FROM event WHERE aggregate_id IN (SELECT id FROM compact_session);
UPDATE event SET seq=(SELECT seq FROM renumber WHERE id=event.id) WHERE id IN (SELECT id FROM renumber);
UPDATE event_sequence SET seq=(SELECT max(seq) FROM event WHERE aggregate_id=event_sequence.aggregate_id)
WHERE aggregate_id IN (SELECT id FROM compact_session) AND EXISTS (SELECT 1 FROM event WHERE aggregate_id=event_sequence.aggregate_id);
COMMIT;
PRAGMA wal_checkpoint(PASSIVE);
`
  sqlite(sql)
}
function rotateLog() {
  if (!existsSync(log) || statSync(log).size <= maxLogBytes) return
  const content = readFileSync(log)
  const retained = content.subarray(Math.max(0, content.length - maxLogBytes))
  const tmp = `${log}.retaining-${process.pid}`
  writeFileSync(tmp, retained)
  renameSync(tmp, log)
}
function backup() {
  const target = `${db}.vibeos-backup`
  copyFileSync(db, target)
  return target
}

if (!existsSync(db)) process.exit(0)
if (!allowRunning && (running() || inUse())) {
  process.stdout.write("opencode-retention: skipped; OpenCode database is in use\n")
  process.exit(0)
}
try {
  mkdirSync(dirname(db), { recursive: true })
  const backupPath = backup()
  compactJournal()
  if (sqlite("PRAGMA integrity_check") !== "ok") throw new Error("integrity_check failed; backup retained at " + backupPath)
  rotateLog()
  process.stdout.write(`opencode-retention: compacted journal; backup=${backupPath}\n`)
} catch (error) {
  process.stderr.write(`opencode-retention: ${error.message}\n`)
  process.exit(1)
}
