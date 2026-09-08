// SPDX-License-Identifier: MIT
//
// The only instrument outside the subject. Every `evidence.*` field in a trial
// record says what the plugin DECIDED -- which slot it picked, which models it
// believes it ran. Six months of green signals were all downstream of that same
// assumption. This reads what OpenCode actually sent, from OpenCode's own
// database, and it can disagree with the plugin.
//
// Never fails a run: a missing database, a missing sqlite3, or a locked read
// returns a record carrying the reason instead of throwing.
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

export function defaultDbPath() {
  return process.env.VIBEOS_OPENCODE_DB ||
    join(process.env.HOME || "", ".local", "share", "opencode", "opencode.db")
}

export function readExecution(sessionId, opts = {}) {
  if (!sessionId) return null
  const db = opts.db || defaultDbPath()
  if (!existsSync(db)) return { source: db, error: "database not found" }
  const sql =
    "select json_extract(data,'$.modelID') as model," +
    " json_extract(data,'$.providerID') as provider," +
    " count(*) as messages," +
    " sum(json_extract(data,'$.tokens.input')) as input," +
    " sum(json_extract(data,'$.tokens.output')) as output," +
    " sum(json_extract(data,'$.tokens.reasoning')) as reasoning," +
    " sum(json_extract(data,'$.tokens.cache.read')) as cacheRead," +
    " sum(json_extract(data,'$.tokens.cache.write')) as cacheWrite" +
    " from message where session_id='" + String(sessionId).replace(/'/g, "''") + "'" +
    " and json_extract(data,'$.role')='assistant'" +
    " group by model, provider order by messages desc;"
  try {
    const out = execFileSync("sqlite3", ["-json", "-readonly", db, sql],
      { encoding: "utf8", timeout: 20000 })
    const rows = out.trim() ? JSON.parse(out) : []
    return {
      source: db,
      models: rows.map((r) => r.model),
      distinctModels: new Set(rows.map((r) => r.model)).size,
      totals: rows.reduce((acc, r) => ({
        messages: acc.messages + (r.messages || 0),
        input: acc.input + (r.input || 0),
        output: acc.output + (r.output || 0),
        cacheRead: acc.cacheRead + (r.cacheRead || 0),
        cacheWrite: acc.cacheWrite + (r.cacheWrite || 0),
      }), { messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
      rows,
    }
  } catch (err) {
    return { source: db, error: String(err?.message || err) }
  }
}
