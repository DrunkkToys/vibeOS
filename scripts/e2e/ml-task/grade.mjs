#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Withheld grading suite runner. The hidden tests are copied into the project
// only AFTER the session has ended, so the model can never read, run, or edit
// the thing that scores it.

import { copyFileSync, mkdirSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const HIDDEN = fileURLToPath(new URL("./hidden", import.meta.url))

export function hiddenTestNames() {
  return readdirSync(HIDDEN).filter((f) => f.endsWith(".test.mjs")).sort()
}

function runNodeTest(dir, target) {
  // NODE_TEST_CONTEXT leaks into the child when the grader itself is invoked from a
  // `node --test` run; node then refuses to run the file ("run() is being called
  // recursively") and exits 0 having executed nothing. Strip it.
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const res = spawnSync(process.execPath, ["--test", target], {
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
  if (!existsSync(join(dir, "tests"))) return { ok: false, pass: 0, fail: 0, out: "no tests/ directory" }
  return runNodeTest(dir, "tests/**/*.test.mjs")
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
