// SPDX-License-Identifier: MIT
//
// What the answer-verification gate actually decided, turn by turn.
//
// runQualityGate persists a verdict per turn to
// $VIBEOS_HOME/quality-gate/<sid>.jsonl. The rig created that directory for
// every plugin trial and never opened it, so criterion 2 -- escalations
// correlate with recorded gate verdicts -- could not be evaluated, and neither
// could the simpler question behind it: whether the gate ever failed at all.
// Read after the fact, run21's two vibeultrax trials hold 21 verdicts and every
// one passed.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export function readGateOutcomes(home) {
  const dir = join(home || "", "quality-gate")
  const out = { verdicts: 0, passed: 0, failed: 0, flows: {}, reasons: {}, failedAt: [] }
  if (!existsSync(dir)) return out
  let files = []
  try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")) } catch { return out }
  for (const file of files) {
    let text = ""
    try { text = readFileSync(join(dir, file), "utf8") } catch { continue }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      let row
      try { row = JSON.parse(line) } catch { continue }
      if (!row || typeof row !== "object") continue
      out.verdicts++
      if (row.passed === false) {
        out.failed++
        if (row.ts != null) out.failedAt.push(row.ts)
        for (const reason of row.reasons || []) {
          const key = String(reason).slice(0, 160)
          out.reasons[key] = (out.reasons[key] || 0) + 1
        }
      } else {
        out.passed++
      }
      const flow = String(row.flow || "unknown")
      out.flows[flow] = (out.flows[flow] || 0) + 1
    }
  }
  out.failedAt.sort((a, b) => a - b)
  return out
}
