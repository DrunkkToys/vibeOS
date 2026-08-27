// SPDX-License-Identifier: MIT
//
// The benchmark and experiment scripts predate the VIBEOS_HOME decoupling and still
// read plugin state from ~/.claude, which is Claude Code's home and has never held
// vibeOS state. They therefore read nothing and report empty runs as valid ones.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SCRIPTS = [
  "scripts/benchmark-runner.mjs",
  "scripts/nightly-experiment.mjs",
  "scripts/benchmark-modes.sh",
  "scripts/calibrate-modes.mjs",
]

const STATE_FILES = ["delegation-state.json", "blackbox-state.json", "model-pricing-cache.json", "model-tiers.json"]

for (const rel of SCRIPTS) {
  test(`${rel} does not read vibeOS state out of ~/.claude`, () => {
    const src = readFileSync(join(ROOT, rel), "utf8")
    for (const f of STATE_FILES) {
      assert.ok(
        !new RegExp(`\\.claude/${f.replace(".", "\\.")}`).test(src),
        `${rel} reads ${f} from ~/.claude; real state lives under VIBEOS_HOME`,
      )
    }
  })

  test(`${rel} resolves its home from VIBEOS_HOME`, () => {
    const src = readFileSync(join(ROOT, rel), "utf8")
    assert.match(src, /VIBEOS_HOME/, `${rel} must honour VIBEOS_HOME`)
  })
}

test("benchmark-runner.mjs does not call require() in an ESM module", () => {
  const src = readFileSync(join(ROOT, "scripts/benchmark-runner.mjs"), "utf8")
  assert.ok(/^import /m.test(src), "guard is only meaningful for an ESM module")
  assert.ok(!/\brequire\(/.test(src), "require() throws in ESM; every call site is a guaranteed failure")
})

// createWorktree's fallback ran `git stash --include-untracked` and `git checkout -- .`
// against REPO_ROOT and then handed the benchmark the live repository to mutate. It was
// unreachable while require() threw; fixing require() would have armed it.
test("benchmark-runner.mjs never stashes or resets the repository under test", () => {
  const src = readFileSync(join(ROOT, "scripts/benchmark-runner.mjs"), "utf8")
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")
  assert.ok(!/git[^`"']*stash/.test(code), "a benchmark must not stash the working tree it runs from")
  assert.ok(!/REPO_ROOT}"\s+checkout/.test(code), "a benchmark must not discard uncommitted changes in REPO_ROOT")
  assert.ok(!/return REPO_ROOT/.test(code), "a benchmark must never hand itself the repository under test")
})

// calibrate-modes.mjs read calibration-data.jsonl from VIBEOS_HOME but wrote
// delegation-state.json, project-states.json and mode-calibration-weights.json to a
// hardcoded ~/.vibeos, so a run under a custom home read one directory and wrote another.
test("calibrate-modes.mjs resolves every state file from the same home", () => {
  const src = readFileSync(join(ROOT, "scripts/calibrate-modes.mjs"), "utf8")
  assert.ok(
    !/["'`]\.vibeos["'`]/.test(src.replace(/VIBEOS_HOME\s*=[^\n]*/, "")),
    "only the VIBEOS_HOME fallback may name .vibeos; every path must derive from VIBEOS_HOME",
  )
})
