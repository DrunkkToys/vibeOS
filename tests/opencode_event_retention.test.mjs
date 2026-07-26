import assert from "node:assert/strict"
import test from "node:test"
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = process.cwd()
const RETAINER = join(ROOT, "scripts", "opencode-event-retention.mjs")

function sql(db, statement) {
  const result = spawnSync("sqlite3", [db, statement], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

test("event retention compacts idle replay snapshots without changing chat records", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibeos-event-retention-"))
  const db = join(dir, "opencode.db")
  const log = join(dir, "opencode.log")
  try {
    sql(db, `CREATE TABLE session (id TEXT PRIMARY KEY, time_updated INTEGER NOT NULL); CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL); CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE message (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE part (id TEXT PRIMARY KEY, data TEXT NOT NULL);`)
    const old = Date.now() - 2 * 60 * 60 * 1000
    sql(db, `INSERT INTO session VALUES ('idle', ${old}); INSERT INTO session VALUES ('expired', ${Date.now() - 72 * 60 * 60 * 1000}); INSERT INTO session VALUES ('recent', ${Date.now()}); INSERT INTO event_sequence VALUES ('idle', 5); INSERT INTO event_sequence VALUES ('expired', 0); INSERT INTO event_sequence VALUES ('recent', 0); INSERT INTO message VALUES ('m1','preserve'); INSERT INTO part VALUES ('p1','preserve'); INSERT INTO event VALUES ('a','idle',0,'session.created.1','{}'),('b','idle',1,'message.updated.1','{"info":{"id":"m1","v":1}}'),('c','idle',2,'message.updated.1','{"info":{"id":"m1","v":2}}'),('d','idle',3,'message.part.updated.1','{"part":{"id":"p1","v":1}}'),('e','idle',4,'message.part.updated.1','{"part":{"id":"p1","v":2}}'),('f','idle',5,'message.removed.1','{}'),('old','expired',0,'message.part.updated.1','{"part":{"id":"gone"}}'),('g','recent',0,'message.part.updated.1','{"part":{"id":"keep"}}');`)
    writeFileSync(log, "x".repeat(6 * 1024 * 1024))
    const result = spawnSync(process.execPath, [RETAINER], { encoding: "utf8", env: { ...process.env, OPENCODE_RETENTION_DB: db, OPENCODE_RETENTION_LOG: log, OPENCODE_RETENTION_ALLOW_RUNNING: "1", OPENCODE_RETENTION_COMPACT_IDLE_MINUTES: "60", OPENCODE_RETENTION_RETENTION_HOURS: "48" } })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(sql(db, "SELECT COUNT(*) FROM event WHERE aggregate_id='idle'"), "4")
    assert.equal(sql(db, "SELECT json_extract(data,'$.part.v') FROM event WHERE id='e'"), "2")
    assert.equal(sql(db, "SELECT group_concat(seq) FROM event WHERE aggregate_id='idle' ORDER BY seq"), "0,1,2,3")
    assert.equal(sql(db, "SELECT data FROM message WHERE id='m1'"), "preserve")
    assert.equal(sql(db, "SELECT data FROM part WHERE id='p1'"), "preserve")
    assert.equal(sql(db, "SELECT COUNT(*) FROM event WHERE aggregate_id='recent'"), "1")
    assert.equal(sql(db, "SELECT COUNT(*) FROM event WHERE aggregate_id='expired'"), "0")
    assert.equal(sql(db, "SELECT COUNT(*) FROM event_sequence WHERE aggregate_id='expired'"), "0")
    assert.ok(existsSync(`${db}.vibeos-backup`), "a pre-compaction backup is written")
    assert.ok(statSync(log).size <= 4 * 1024 * 1024, "log is capped")
    assert.equal(sql(db, "PRAGMA integrity_check"), "ok")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
