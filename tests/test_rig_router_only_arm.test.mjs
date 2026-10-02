// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"

import { ARM_DEFS, cliModelArgs, entryModel, voidReason } from "../scripts/e2e/ml-task/score.mjs"

const TIERS = { cheap: "p/cheap-m", medium: "p/medium-m", brain: "p/brain-m" }
const OK_TURNS = [{ id: "diagnose", status: 0 }]

test("full-plugin arms turn the full plugin on, since router-only is the plugin default", () => {
  for (const name of ["vibeqmax", "vibeultrax", "vibeultrax-novote"]) {
    assert.equal(ARM_DEFS[name].env?.VIBEOS_ROUTER_ONLY, "0", name)
  }
})

test("the router-only arm runs the plugin default on the model under test", () => {
  const def = ARM_DEFS["router-only"]
  assert.ok(def, "router-only arm exists")
  assert.equal(def.plugin, true)
  assert.equal(def.agent, "vibe")
  assert.equal(def.env?.VIBEOS_ROUTER_ONLY, "1")
  assert.equal(entryModel(def, TIERS, "p/model-under-test"), "p/model-under-test")
  assert.deepEqual(cliModelArgs(def, "p/model-under-test"), [])
})

test("a router-only trial is not voided for writing no chat-params audit rows", () => {
  assert.equal(voidReason("router-only", OK_TURNS, { chatParamsRows: 0, internalErrors: 0 }, null), null)
})

test("a router-only trial is still voided when a turn fails", () => {
  assert.match(voidReason("router-only", [{ id: "diagnose", status: 1 }], { chatParamsRows: 0 }, null), /exited 1/)
})
