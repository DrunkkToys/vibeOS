// SPDX-License-Identifier: MIT
//
// The plugin's own failures, read from the channel it writes them to.
//
// The console guard in flow-enforcer.ts swallows vibeOS-internal stderr so it
// never reaches the user's terminal, and persists it as a `footer-error` row in
// $VIBEOS_HOME/session-events/<sid>.jsonl instead. That was the whole of the
// error reporting: nothing read those rows, so run20 scored a trial that had
// logged 106 of them exactly as if it had logged none.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export function readInternalErrors(home) {
  const dir = join(home || "", "session-events")
  const byMessage = {}
  let count = 0
  if (!existsSync(dir)) return { count, messages: [], byMessage }
  let files = []
  try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")) } catch { return { count, messages: [], byMessage } }
  for (const file of files) {
    let text = ""
    try { text = readFileSync(join(dir, file), "utf8") } catch { continue }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      let row
      // A run killed mid-append leaves a partial final line. Dropping the whole
      // file for it would report a crashed trial as a clean one.
      try { row = JSON.parse(line) } catch { continue }
      if (row?.kind !== "footer-error") continue
      count++
      const message = String(row.message || "unknown").slice(0, 200)
      byMessage[message] = (byMessage[message] || 0) + 1
    }
  }
  const messages = Object.entries(byMessage).sort((a, b) => b[1] - a[1]).map(([m]) => m)
  return { count, messages, byMessage }
}
