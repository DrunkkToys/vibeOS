// SPDX-License-Identifier: MIT
// CONTRACT: a plugin arm may not be pinned to a model on the command line.
//
// The rig built every invocation as `opencode run ... -m <MODEL>` for all arms.
// An explicit CLI pin outranks the plugin's chat.params override, so the plugin
// computed a route, wrote it to its own cascade-audit, and OpenCode ran the pinned
// model regardless.
//
// Measured against what actually executed -- opencode.db `message` rows, not the
// plugin's audit:
//
//   run20 vibeultrax   mimo-v2.5-free  40 msgs   (brain, the pinned model)
//   run20 raw          mimo-v2.5-free  36 msgs
//   run19 vibeultrax   mimo-v2.5-free  25 msgs
//
// muse-spark (cheap) and ling-flash (medium) never ran one message of real work,
// while `evidence.ranModels` listed both, because that field is built from the
// plugin's intent. Twenty A/B runs compared a cascade to a baseline without ever
// routing, and five separate "make routing reach the model" commits were graded
// against the audit that reports the intent rather than the execution.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { ARM_DEFS, cliModelArgs, entryModel } from "../scripts/e2e/ml-task/score.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const RIG = readFileSync(join(ROOT, "scripts", "e2e", "ml-impact.mjs"), "utf-8")

const TIERS = { cheap: "p/cheap-m", medium: "p/medium-m", brain: "p/brain-m" }

test("no plugin arm carries a CLI model pin", () => {
  for (const [name, def] of Object.entries(ARM_DEFS)) {
    if (!def.plugin) continue
    assert.deepEqual(cliModelArgs(def, "p/brain-m"), [], `${name} must not be pinned; the route would never reach the model`)
  }
})

// raw is the baseline precisely because it is fixed to the brain model.
test("the raw arm keeps its pin", () => {
  assert.deepEqual(cliModelArgs(ARM_DEFS.raw, "p/brain-m"), ["-m", "p/brain-m"])
})

test("a plugin arm starts from its own entry tier, not the baseline model", () => {
  assert.equal(entryModel(ARM_DEFS.vibeultrax, TIERS, "p/brain-m"), TIERS.cheap, "vibeultrax enters at cheap")
  assert.equal(entryModel(ARM_DEFS.vibeqmax, TIERS, "p/brain-m"), TIERS.brain, "vibeqmax's envelope is brain-only")
  assert.equal(entryModel(ARM_DEFS.raw, TIERS, "p/brain-m"), "p/brain-m", "raw is the pinned baseline")
})

// An entry tier missing from the trinity must not silently fall back to nothing.
test("an unknown entry tier falls back to the baseline model", () => {
  assert.equal(entryModel({ plugin: true, entry: "nope" }, TIERS, "p/brain-m"), "p/brain-m")
})

// The source guard: the literal pin must be gone, not merely unused.
test("the rig source no longer hardcodes the pin into the argv", () => {
  assert.ok(!/"--auto",\s*"-m",\s*MODEL/.test(RIG), 'ml-impact.mjs still builds argv with a literal "-m", MODEL')
  assert.ok(/cliModelArgs\(def, MODEL\)/.test(RIG), "ml-impact.mjs must build the pin through cliModelArgs")
  assert.ok(/config\.model = entryModel\(def, TIERS, MODEL\)/.test(RIG), "a plugin arm must be seeded with its entry tier in config")
})
