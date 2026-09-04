#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Withheld grading suite runner. The hidden tests are copied into the project
// only AFTER the session has ended, so the model can never read, run, or edit
// the thing that scores it.

import { copyFileSync, mkdirSync, readdirSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

import { TURN_IDS } from "./prompts.mjs"

const HIDDEN = fileURLToPath(new URL("./hidden", import.meta.url))

export function hiddenTestNames() {
  return readdirSync(HIDDEN).filter((f) => f.endsWith(".test.mjs")).sort()
}

// `node --test` only expands glob patterns from Node 22 on; on Node 20 the pattern
// matches nothing and the run exits 0 having executed no tests. Enumerate the files
// ourselves so the grader behaves identically on every supported Node.
function collectTests(root) {
  const found = []
  const walk = (d) => {
    let entries = []
    try { entries = readdirSync(d) } catch { return }
    for (const name of entries.sort()) {
      const abs = join(d, name)
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) walk(abs)
      else if (/\.(test|spec)\.(mjs|js|cjs)$/.test(name)) found.push(abs)
    }
  }
  walk(root)
  return found
}

function runNodeTest(dir, target) {
  // NODE_TEST_CONTEXT leaks into the child when the grader itself is invoked from a
  // `node --test` run; node then refuses to run the file ("run() is being called
  // recursively") and exits 0 having executed nothing. Strip it.
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const targets = Array.isArray(target) ? target : [target]
  if (!targets.length) return { ok: false, pass: 0, fail: 0, ran: false, out: "no test files found" }
  const res = spawnSync(process.execPath, ["--test", ...targets], {
    cwd: dir, encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024, env,
  })
  const out = (res.stdout || "") + (res.stderr || "")
  const pass = Number((out.match(/^# pass (\d+)$/m) || [])[1] || 0)
  const fail = Number((out.match(/^# fail (\d+)$/m) || [])[1] || 0)
  // A run that executed no assertions is not a pass. Reporting one would let the
  // grader award full marks for a suite that never ran.
  const ok = res.status === 0 && pass + fail > 0
  return { ok, pass, fail, ran: pass + fail > 0, out }
}

// Each hidden group is only reachable once the turn that asks for it has run.
// Turn 1 is diagnosis-only ("Do NOT edit any file"), so nothing is reachable after
// it. Scoring an unreachable group is what froze correctness at 0.4667 across all
// forty trials of runs 12-15: the denominator was always five, whatever was asked.
export const GROUP_ENABLING_TURN = {
  "g1-batcher.test.mjs": "fix-batching",
  "g2-enricher.test.mjs": "fix-rest",
  "g3-flusher.test.mjs": "fix-rest",
  "g4-config.test.mjs": "fix-rest",
  "g5-pivot.test.mjs": "pivot",
}

export function reachableGroups(turnsRun = TURN_IDS.length) {
  return Object.entries(GROUP_ENABLING_TURN)
    .filter(([, turnId]) => {
      const idx = TURN_IDS.indexOf(turnId)
      return idx >= 0 && idx < turnsRun
    })
    .map(([group]) => group)
}

// A group whose file crashed on import reports pass=0 fail=0. Counted as raw
// assertions it disappears from the denominator, so destroying a whole group
// RAISES the score. Each group is scored on its own and a group that never ran
// scores 0, so the denominator is the reachable group count and cannot be shrunk
// by damage — only by not having been asked for in the first place.
export function correctnessFromGroups(per, { reachable } = {}) {
  const names = (reachable || Object.keys(per || {})).filter((n) => n in (per || {}))
  if (!names.length) return 0
  const total = names.reduce((a, n) => {
    const g = per[n] || {}
    const ran = g.ran ?? (g.pass + g.fail > 0)
    if (!ran) return a
    const denom = g.pass + g.fail
    return a + (denom ? g.pass / denom : 0)
  }, 0)
  return total / names.length
}

// The visible suite the model can see. Used for the no-regression component.
export function gradeVisible(dir) {
  if (!existsSync(join(dir, "tests"))) return { ok: false, pass: 0, fail: 0, ran: false, out: "no tests/ directory" }
  return runNodeTest(dir, collectTests(join(dir, "tests")))
}

// The hidden suite. Copied into <dir>/.grading so relative imports (../src/...)
// resolve exactly as the visible tests do.
export function gradeHidden(dir, { turnsRun = TURN_IDS.length } = {}) {
  const target = join(dir, ".grading")
  mkdirSync(target, { recursive: true })
  // Every group is still RUN, so an unreachable group that somehow passes is
  // visible in `per`. It is excluded from the score, not from the record.
  const names = hiddenTestNames()
  const reachable = reachableGroups(turnsRun).filter((n) => names.includes(n))
  const per = {}
  for (const name of names) {
    copyFileSync(join(HIDDEN, name), join(target, name))
    per[name] = runNodeTest(dir, join(".grading", name))
  }
  const groups = reachable.length
  const passedGroups = reachable.filter((n) => per[n].ok).length
  const totalPass = reachable.reduce((a, n) => a + per[n].pass, 0)
  const totalFail = reachable.reduce((a, n) => a + per[n].fail, 0)
  return {
    groups,
    reachable,
    unreachable: names.filter((n) => !reachable.includes(n)),
    passedGroups,
    groupRate: groups ? passedGroups / groups : 0,
    assertions: totalPass + totalFail,
    assertionsPassed: totalPass,
    assertionRate: totalPass + totalFail ? totalPass / (totalPass + totalFail) : 0,
    correctness: correctnessFromGroups(per, { reachable }),
    deadGroups: reachable.filter((n) => !per[n].ran),
    per,
  }
}
