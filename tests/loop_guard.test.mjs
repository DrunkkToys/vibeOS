import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  ToolLoopGuard,
  normalizeCommandSignature,
  isPollCommand,
  isInspectionCommand,
  LOOP_WARN_THRESHOLD,
  LOOP_BLOCK_THRESHOLD,
  EDIT_FAILURE_WARN_THRESHOLD,
} from "../src/lib/loop-guard.js"

describe("loop-guard: signature normalization", () => {
  it("collapses leading self-poll sleep prefixes to one signature", () => {
    const a = normalizeCommandSignature("sleep 600 && gh pr view 348 --json statusCheckRollup")
    const b = normalizeCommandSignature("sleep 120 && gh pr view 348 --json statusCheckRollup")
    const c = normalizeCommandSignature("gh pr view 348 --json statusCheckRollup")
    assert.equal(a, b)
    assert.equal(b, c)
  })

  it("collapses whitespace and lowercases", () => {
    assert.equal(normalizeCommandSignature("  GH   pr   view 348 "), "gh pr view 348")
  })
})

describe("loop-guard: poll detection", () => {
  it("flags sleep->command self-polls", () => {
    assert.ok(isPollCommand("sleep 600 && gh pr view 348"))
    assert.ok(isPollCommand("sleep 90; npm run build"))
  })
  it("flags gh CI-status polls", () => {
    assert.ok(isPollCommand("gh pr view 348 --json statusCheckRollup"))
    assert.ok(isPollCommand("gh run list -L 1 --json databaseId"))
    assert.ok(isPollCommand("gh run watch 123"))
  })
  it("does not flag ordinary commands", () => {
    assert.ok(!isPollCommand("npm run build"))
    assert.ok(!isPollCommand("git commit -m x"))
    assert.ok(!isPollCommand("gh pr create"))
  })
})

describe("loop-guard: inspection commands", () => {
  it("treats read-only shell inspection as safe to repeat", () => {
    assert.ok(isInspectionCommand("sed -n '1,40p' src/lib/state.ts"))
    assert.ok(isInspectionCommand("rg -n loop src/lib"))
    assert.ok(isInspectionCommand("git status --short"))
    assert.ok(!isInspectionCommand("npm run build"))
    assert.ok(!isInspectionCommand("git commit -m x"))
  })
})

describe("loop-guard: escalation (the PR-348 loop)", () => {
  it("warns then hard-blocks a sleep+poll loop", () => {
    const g = new ToolLoopGuard()
    const cmds = [
      "sleep 600 && gh pr view 348 --json statusCheckRollup",
      "sleep 120 && gh pr view 348 --json statusCheckRollup",
      "sleep 60 && gh pr view 348 --json statusCheckRollup",
      "sleep 300 && gh pr view 348 --json statusCheckRollup",
      "sleep 180 && gh pr view 348 --json statusCheckRollup",
    ]
    const levels = cmds.map((c) => g.observe(c).level)
    // 1,2: none — 3: warn — 4: warn — 5: block
    assert.equal(levels[LOOP_WARN_THRESHOLD - 1], "warn")
    assert.equal(levels[LOOP_BLOCK_THRESHOLD - 1], "block")
    const last = g.observe(cmds[0])
    assert.equal(last.level, "block")
    assert.equal(last.kind, "poll")
    assert.ok(last.directive.includes("STOP"))
  })

  it("hard-blocks the same command repeated even when not a poll", () => {
    const g = new ToolLoopGuard()
    let v
    for (let i = 0; i < LOOP_BLOCK_THRESHOLD; i++) v = g.observe("npm run build 2>&1 | tail -3")
    assert.equal(v.level, "block")
    assert.equal(v.kind, "repeat")
  })

  it("does not block varied, non-poll commands", () => {
    const g = new ToolLoopGuard()
    const varied = ["ls", "git status", "cat package.json", "npm run lint", "node x.mjs", "grep foo bar"]
    for (const c of varied) {
      assert.equal(g.observe(c).level, "none")
    }
  })

  it("does not block repeated inspection commands", () => {
    const g = new ToolLoopGuard()
    let v
    for (let i = 0; i < LOOP_BLOCK_THRESHOLD + 1; i++) {
      v = g.observe("sed -n '1,80p' src/lib/state.ts")
    }
    assert.equal(v.level, "none")
    assert.equal(v.kind, null)
  })

  it("forgets old repeats once they fall out of the window", () => {
    const g = new ToolLoopGuard(4)
    g.observe("gh pr view 348")
    g.observe("gh pr view 348")
    // push 4 unrelated NON-poll commands to evict the poll history
    g.observe("ls a"); g.observe("ls b"); g.observe("ls c"); g.observe("ls d")
    const v = g.observe("gh pr view 348")
    assert.equal(v.level, "none")
  })
})

// Regression: repeated edit/write FAILURES on the same file burn a full model
// turn each retry, exactly like a bash poll loop -- but edit/write aren't in
// SOFT_QUOTA and retries often carry different args each time (a re-guessed
// oldString), so the exact-repeat bash signature match can't catch it. Live-
// reproduced: OpenCode Desktop retried a failing `edit` 8+ times in a row
// before eventually re-reading the file and succeeding.
describe("loop-guard: edit/write failure tracking", () => {
  it("does not warn before the threshold is reached", () => {
    const g = new ToolLoopGuard()
    let v
    for (let i = 0; i < EDIT_FAILURE_WARN_THRESHOLD - 1; i++) {
      v = g.observeEditFailure("edit:/repo/src/foo.ts")
    }
    assert.equal(v.shouldWarn, false)
  })

  it("warns once consecutive failures on the same file reach the threshold", () => {
    const g = new ToolLoopGuard()
    let v
    for (let i = 0; i < EDIT_FAILURE_WARN_THRESHOLD; i++) {
      v = g.observeEditFailure("edit:/repo/src/foo.ts")
    }
    assert.equal(v.shouldWarn, true)
    assert.equal(v.count, EDIT_FAILURE_WARN_THRESHOLD)
  })

  it("tracks failure counts independently per file", () => {
    const g = new ToolLoopGuard()
    g.observeEditFailure("edit:/repo/src/foo.ts")
    g.observeEditFailure("edit:/repo/src/foo.ts")
    const other = g.observeEditFailure("edit:/repo/src/bar.ts")
    assert.equal(other.count, 1)
    assert.equal(other.shouldWarn, false)
  })

  it("clearEditFailure resets the counter after a successful edit", () => {
    const g = new ToolLoopGuard()
    g.observeEditFailure("edit:/repo/src/foo.ts")
    g.observeEditFailure("edit:/repo/src/foo.ts")
    g.clearEditFailure("edit:/repo/src/foo.ts")
    const v = g.observeEditFailure("edit:/repo/src/foo.ts")
    assert.equal(v.count, 1)
  })
})
