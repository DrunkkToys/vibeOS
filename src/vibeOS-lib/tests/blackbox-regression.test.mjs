import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function makeSandbox(name) {
  const home = mkdtempSync(join(tmpdir(), `vibeos-${name}-`))
  mkdirSync(join(home, ".claude"), { recursive: true })
  mkdirSync(join(home, ".config/opencode"), { recursive: true })
  return home
}

test("blackbox regression: legacy stub session hydrates real tracker and leaves INIT after update", async () => {
  const home = makeSandbox("blackbox-regression")
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const turn = await import(`../../lib/turn-classify.js?blackbox-regression=${Date.now()}`)
  const sid = turn.getOC_SID()

  writeFileSync(join(home, ".claude/blackbox-state.json"), JSON.stringify({
    enabled: true,
    sessions: {
      [sid]: {
        history: [
          {
            text: "legacy session payload",
            currentRegime: "INIT",
          },
        ],
        currentRegime: "INIT",
      },
    },
  }, null, 2) + "\n")

  const tracker = turn.getBlackboxTracker()
  const before = tracker.snapshot()
  assert.equal(before.sub_regime, "INIT")

  const after = tracker.update("How do I fix this regression and what should I change?")
  assert.notEqual(after.sub_regime, "INIT")
  assert.equal(tracker.snapshot().sub_regime, after.sub_regime)
  assert.ok(typeof after.loop_intervention_level === "string")
  assert.ok(typeof after.pivot_detected === "boolean")
})

test("blackbox regression: pivot detection detects text-only topic shifts without embeddings", async () => {
  const { ResolutionTracker } = await import("../blackbox/index.js?t=" + Date.now())

  const tracker = new ResolutionTracker("pivot-regression", 10)
  const embeddingA = [1, 0, 0, 0]
  const embeddingB = [0, 1, 0, 0]

  tracker.update(
    "Please keep the current approach and write the next step carefully.",
    ResolutionTracker.extractFeatures("Please keep the current approach and write the next step carefully."),
    "act",
    1.1,
    50,
    embeddingA,
  )
  tracker.update(
    "Please keep the current approach and write the next step carefully but with more detail and extra explanation.",
    ResolutionTracker.extractFeatures("Please keep the current approach and write the next step carefully but with more detail and extra explanation."),
    "act",
    1.1,
    50,
    embeddingA,
  )

  const textPivot = tracker.update(
    "Switch to auth jwt express now and change the implementation path entirely.",
    ResolutionTracker.extractFeatures("Switch to auth jwt express now and change the implementation path entirely."),
    "change",
    1.1,
    50,
    null,
  )

  assert.equal(textPivot.pivot_detected, true, "text-only topic shifts should now trigger pivot detection via Jaccard similarity")

  tracker.reset()
  tracker.update(
    "Please keep the current approach and write the next step carefully.",
    ResolutionTracker.extractFeatures("Please keep the current approach and write the next step carefully."),
    "act",
    1.1,
    50,
    embeddingA,
  )
  tracker.update(
    "Please keep the current approach and write the next step carefully but with more detail and extra explanation.",
    ResolutionTracker.extractFeatures("Please keep the current approach and write the next step carefully but with more detail and extra explanation."),
    "act",
    1.1,
    50,
    embeddingA,
  )
  tracker.update(
    "Please keep the current approach and write the next step carefully yet again with a tighter scope.",
    ResolutionTracker.extractFeatures("Please keep the current approach and write the next step carefully yet again with a tighter scope."),
    "act",
    1.1,
    50,
    embeddingA,
  )

  const realPivot = tracker.update(
    "Switch to auth jwt express now and change the implementation path entirely.",
    ResolutionTracker.extractFeatures("Switch to auth jwt express now and change the implementation path entirely."),
    "change",
    1.1,
    50,
    embeddingB,
  )

  assert.equal(realPivot.pivot_detected, true, "embedding-backed topic change should still detect pivot")
})

test("blackbox regression: repeated identical prompts trigger early loop prevention", async () => {
  const { ResolutionTracker } = await import("../blackbox/index.js?t=" + Date.now())

  const tracker = new ResolutionTracker("repeat-loop-regression", 10)
  const text = "Please stop repeating the same answer path and give a fresh option."
  const features = ResolutionTracker.extractFeatures(text)

  const first = tracker.update(text, features, "act", 1.0, 50, null)
  assert.equal(first.is_looping, false)

  const second = tracker.update(text, features, "act", 1.0, 50, null)
  assert.equal(second.is_looping, true)
  assert.equal(second.repeat_streak, 2)
  assert.equal(second.loop_intervention_level, "assertive")

  const third = tracker.update(text, features, "act", 1.0, 50, null)
  assert.equal(third.is_looping, true)
  assert.equal(third.repeat_streak, 3)
  assert.equal(third.loop_intervention_level, "escalated")
})
