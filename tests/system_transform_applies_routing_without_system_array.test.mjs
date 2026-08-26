// SPDX-License-Identifier: MIT
// Contract: applying the backend control vector to slot state must NOT be gated
// on the shape of the system prompt.
//
// onSystemTransform did `const system = output?.system; if (!Array.isArray(system)) return`
// and only called syncControlSettings() AFTER that guard. Any host turn whose
// output carried no `system` array returned early, so the backend's routing
// decision was silently discarded and the orchestrator's slot never moved.
// Observed live: over a full session the applied model never left the entry slot
// and cascade-audit.jsonl contained zero control-sync rows.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const DIST = (p) => pathToFileURL(join(process.cwd(), "dist-ts", p)).href

function runTransform(outputShape) {
  const home = mkdtempSync(join(tmpdir(), "vib-systransform-"))
  mkdirSync(join(home, ".config/opencode"), { recursive: true })
  mkdirSync(join(home, ".claude"), { recursive: true })
  writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({ default_agent: "vibe" }))
  writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      cheap: { oc: "testprov/lightning-v2" },
      medium: { oc: "testprov/flash-v2" },
      brain: { oc: "testprov/ultra-v2" },
    },
    selection: {
      enabled: true,
      optimization_mode: "vibeultrax",
      active_slot: "cheap",
      entry_slot: "cheap",
      worker_slot: "cheap",
      selected_slot: "cheap",
      axis_overrides: { tier: "brain" },
    },
  }))

  const script = `
    const fs = await import("node:fs");
    const path = await import("node:path");
    const pricing = await import(${JSON.stringify(DIST("lib/pricing.js"))});
    pricing.loadTrinitySlotsFromTiersFile();
    const mod = await import(${JSON.stringify(DIST("lib/hooks/chat-transform.js"))});
    mod.syncControlSettings(
      { optimization_mode: "vibeultrax", selected_slot: "cheap", tier_bias: "cheap" },
      { persistOptimizationMode: true, authoritative: true },
    );
    const tiers = JSON.parse(fs.readFileSync(path.join(process.env.VIBEOS_HOME, "model-tiers.json"), "utf8"));
    console.log(JSON.stringify(tiers.selection));
    process.exit(0);
  `
  const sel = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    timeout: 20000, cwd: process.cwd(), encoding: "utf8",
    env: { ...process.env, VIBEOS_FAST_CI: "1", HOME: home, VIBEOS_HOME: join(home, ".claude"), VIBEOS_OPENCODE_HOME: join(home, ".config/opencode") },
  }).trim())
  return { sel, home }
}

test("syncControlSettings writes a control-sync audit row so the path is observable", () => {
  const { sel, home } = runTransform()
  assert.equal(sel.entry_slot, "brain")
  const audit = readFileSync(join(home, ".claude/cascade-audit/cascade-audit.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l))
  const row = audit.find((r) => r.source === "control-sync")
  assert.ok(row, "a control-sync row must be written on every sync")
  assert.equal(row.axisTierPin, "brain")
  assert.equal(row.entrySlot, "brain")
})

test("the routing-application block does not sit behind the system-array guard", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/hooks/chat-transform.ts"), "utf8")
  const guard = src.indexOf("if (!Array.isArray(system)) return")
  const sync = src.indexOf("const syncResult = syncControlSettings(")
  assert.ok(guard !== -1 && sync !== -1, "both anchors must exist")
  assert.ok(sync < guard, "syncControlSettings must run BEFORE the system-array early return")
})
