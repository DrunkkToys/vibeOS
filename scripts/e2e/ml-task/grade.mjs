#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Withheld grading suite runner. The hidden tests are copied into the project
// only AFTER the session has ended, so the model can never read, run, or edit
// the thing that scores it.

import { copyFileSync, mkdirSync, readdirSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

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

// The visible suite the model can see. Used for the no-regression component.
export function gradeVisible(dir) {
  if (!existsSync(join(dir, "tests"))) return { ok: false, pass: 0, fail: 0, ran: false, out: "no tests/ directory" }
  return runNodeTest(dir, collectTests(join(dir, "tests")))
}

// The hidden suite. Copied into <dir>/.grading so relative imports (../src/...)
// resolve exactly as the visible tests do.
export function gradeHidden(dir) {
  const target = join(dir, ".grading")
  mkdirSync(target, { recursive: true })
  const names = hiddenTestNames()
  const per = {}
  for (const name of names) {
    copyFileSync(join(HIDDEN, name), join(target, name))
    per[name] = runNodeTest(dir, join(".grading", name))
  }
  const groups = names.length
  const passedGroups = names.filter((n) => per[n].ok).length
  const totalPass = names.reduce((a, n) => a + per[n].pass, 0)
  const totalFail = names.reduce((a, n) => a + per[n].fail, 0)
  return {
    groups,
    passedGroups,
    groupRate: groups ? passedGroups / groups : 0,
    assertions: totalPass + totalFail,
    assertionsPassed: totalPass,
    assertionRate: totalPass + totalFail ? totalPass / (totalPass + totalFail) : 0,
    per,
  }
}
