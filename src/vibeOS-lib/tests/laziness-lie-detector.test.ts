import test from "node:test"
import assert from "node:assert/strict"

const laziness = await import("../laziness-detector.js?test=" + Date.now())
const lies = await import("../lie-detector.js?test=" + Date.now())

const LONG_TEXT = "The quick brown fox jumps over the lazy dog. ".repeat(5)

test("laziness: short output on complex task", () => {
  const result = laziness.detectLaziness({ assistantText: "ok" })
  assert.equal(result.shortOutput, true)
  assert.equal(result.penalty, 5)
})

test("laziness: normal length output", () => {
  const result = laziness.detectLaziness({ assistantText: LONG_TEXT })
  assert.equal(result.shortOutput, false)
  assert.equal(result.penalty, 0)
})

test("laziness: TODO placeholders", () => {
  const result = laziness.detectLaziness({ assistantText: LONG_TEXT + "\n// TODO: implement this later" })
  assert.equal(result.shortOutput, false)
  assert.equal(result.todoPlaceholders, true)
  assert.equal(result.penalty, 15)
})

test("laziness: FIXME placeholder", () => {
  const result = laziness.detectLaziness({ assistantText: LONG_TEXT + "\nFIXME: this needs proper error handling" })
  assert.equal(result.shortOutput, false)
  assert.equal(result.todoPlaceholders, true)
  assert.equal(result.penalty, 15)
})

test("laziness: skipped delegation on brain tier", () => {
  const result = laziness.detectLaziness({ assistantText: LONG_TEXT, writeEditCount: 3, isBrainTier: true })
  assert.equal(result.shortOutput, false)
  assert.equal(result.skippedDelegation, true)
  assert.equal(result.penalty, 5)
})

test("laziness: no skip on non-brain tier", () => {
  const result = laziness.detectLaziness({ assistantText: LONG_TEXT, writeEditCount: 3, isBrainTier: false })
  assert.equal(result.shortOutput, false)
  assert.equal(result.skippedDelegation, false)
  assert.equal(result.penalty, 0)
})

test("laziness: all signals stack", () => {
  const result = laziness.detectLaziness({ assistantText: "TODO: fix", writeEditCount: 2, isBrainTier: true })
  assert.equal(result.shortOutput, true)
  assert.equal(result.todoPlaceholders, true)
  assert.equal(result.skippedDelegation, true)
  assert.equal(result.penalty, 25)
})

test("lie: claim-vs-outcome mismatch detected", () => {
  const result = lies.detectLies({
    assistantText: "I fixed the bug and the tests pass.",
    userText: "It still doesn't work, getting the same error",
  })
  assert.equal(result.claimVsOutcomeMismatch, true)
  assert.equal(result.detected, true)
})

test("lie: no mismatch when user is positive", () => {
  const result = lies.detectLies({
    assistantText: "I fixed the bug and the tests pass.",
    userText: "Thanks, that works perfectly!",
  })
  assert.equal(result.claimVsOutcomeMismatch, false)
})

test("lie: self-contradiction detected", () => {
  const result = lies.detectLies({
    assistantText: "The feature doesn't work in the current build.",
    prevAssistantTexts: ["The feature works great after my fix."],
  })
  assert.equal(result.selfContradiction, true)
  assert.equal(result.detected, true)
})

test("lie: no contradiction without claims", () => {
  const result = lies.detectLies({
    assistantText: "Here's what I found in the codebase...",
    userText: "It still doesn't work",
  })
  assert.equal(result.claimVsOutcomeMismatch, false)
  assert.equal(result.detected, false)
})
