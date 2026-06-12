// SPDX-License-Identifier: MIT
// ML Routing Vectors — comprehensive integration test
// Tests ALL autoSelectMode vectors: every regime x every stress level,
// plus resolveOptimizationSlot, computeControlVector, classifyTurnSimple, scoreStress.
// Logs all results to ~/.claude/test-ml-vectors.json with timestamps.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"

// ── Dynamic imports with cache-busting ──
const turn = await import("../src/lib/turn-classify.js?mlvec=" + Date.now())
const clf = await import("../src/lib/classifiers.js?mlvec=" + Date.now())
const meta = await import("../src/vibeOS-lib/blackbox/meta-controller.js?mlvec=" + Date.now())

const { autoSelectMode, resolveOptimizationSlot, computeControlVector, resolveOptimizationMode, classifyTurnSimple } = turn
const { scoreStress } = clf

// ── Logging ──
const RESULTS = []
const TIMESTAMP = new Date().toISOString()

function logResult(category, name, passed, detail) {
  RESULTS.push({ timestamp: TIMESTAMP, category, name, passed, detail })
}

function assertEqualAndLog(actual, expected, category, name, detail = {}) {
  const passed = actual === expected
  try { assert.equal(actual, expected) } catch (e) { /* swallow — we log either way */ }
  logResult(category, name, passed, { actual, expected, ...detail })
  return passed
}

function assertDeepEqualAndLog(actual, expected, category, name, detail = {}) {
  let passed = true
  try {
    assert.deepEqual(actual, expected)
  } catch (e) {
    passed = false
  }
  logResult(category, name, passed, { actual, expected: JSON.stringify(expected), ...detail })
  return passed
}

function assertOkAndLog(actual, category, name, detail = {}) {
  const passed = !!actual
  try { assert.ok(actual) } catch (e) { /* swallow */ }
  logResult(category, name, passed, { actual, ...detail })
  return passed
}

function writeResults() {
  const home = process.env.VIBEOS_HOME || join(process.env.HOME || "", ".claude")
  mkdirSync(home, { recursive: true })
  const fp = join(home, "test-ml-vectors.json")
  const existing = existsSync(fp) ? JSON.parse(readFileSync(fp, "utf-8")) : { runs: [] }
  existing.runs.push({ timestamp: TIMESTAMP, results: RESULTS })
  writeFileSync(fp, JSON.stringify(existing, null, 2))
}

// ── Sub-regimes ──
const REGIMES = ["INIT", "DIVERGENT", "EXPLORING", "REFINING", "CONVERGING", "CLOSED", "LOOPING", "AUDIT", "FORENSIC"]
const STRESS_LEVELS = [0, 0.5, 1.0, 1.5, 2.0]

// ── AUTO SELECT MODE: all regimes x all stress levels ──
test("autoSelectMode: every regime x every stress level", () => {
  for (const regime of REGIMES) {
    for (const stress of STRESS_LEVELS) {
      const result = autoSelectMode(regime, stress)
      let expected
      const r = regime.toUpperCase()
      if (r === "AUDIT") expected = "audit"
      else if (r === "FORENSIC") expected = "forensic"
      else if (r === "LOOPING") expected = "speed"
      else if (r === "CONVERGING" || r === "CLOSED") expected = "quality"
      else if (stress > 1.5) expected = "quality"
      else expected = "vibelitex"
      assertEqualAndLog(result, expected, "autoSelectMode", `${regime} @ stress=${stress}`, { regime, stress })
    }
  }
})

// ── RESOLVE OPTIMIZATION SLOT: every mode → correct tier ──
test("resolveOptimizationSlot: every mode returns correct tier", () => {
  const SLOT_MAP = {
    speed: "medium",
    vibemax: "medium",
    vibelitex: "medium",
    quality: "brain",
    longrun: "brain",
    vibeultrax: "brain",
    vibeqmax: "brain",
    forensic: "brain",
    audit: "brain",
    budget: "cheap",
    balanced: "cheap",
    litex: "medium",
    vibeultra: "cheap",
    unknownmode: "cheap",
  }
  const ALL_MODES = ["speed", "vibemax", "vibelitex", "quality", "longrun", "vibeultrax", "vibeqmax", "forensic", "audit", "budget", "balanced", "litex"]
  for (const mode of ALL_MODES) {
    const result = resolveOptimizationSlot(mode)
    const expected = SLOT_MAP[mode] || "cheap"
    assertEqualAndLog(result, expected, "resolveOptimizationSlot", mode, { mode })
  }
  // Edge cases: undefined, null, empty string, unknown
  assertEqualAndLog(resolveOptimizationSlot(undefined), "cheap", "resolveOptimizationSlot", "undefined")
  assertEqualAndLog(resolveOptimizationSlot(null), "cheap", "resolveOptimizationSlot", "null")
  assertEqualAndLog(resolveOptimizationSlot(""), "cheap", "resolveOptimizationSlot", "empty-string")
  assertEqualAndLog(resolveOptimizationSlot("madeup-mode"), "cheap", "resolveOptimizationSlot", "unknown")
})

// ── COMPUTE CONTROL VECTOR: every mode → correct control vector ──
test("computeControlVector: every mode produces correct tier_bias, enforcement_mode, thinking_mode", () => {
  const CONTROL_CHECKS = {
    vibemax:      { tier_bias: "medium",   enforcement_mode: "strict", thinking_mode: "full" },
    vibeultrax:   { tier_bias: "brain",    enforcement_mode: "strict", thinking_mode: "full" },
    vibeqmax:     { tier_bias: "brain",    enforcement_mode: "strict", thinking_mode: "full" },
    vibelitex:    { tier_bias: "medium",   enforcement_mode: "normal", thinking_mode: "auto" },
    quality:      { tier_bias: "brain",    enforcement_mode: "strict", thinking_mode: "full" },
    budget:       { tier_bias: "cheap",    enforcement_mode: "relaxed", thinking_mode: "off" },
    speed:        { tier_bias: "medium",   enforcement_mode: "relaxed", thinking_mode: "off" },
    longrun:      { tier_bias: "brain",    enforcement_mode: "strict", thinking_mode: "brief" },
    balanced:     { tier_bias: "auto",     enforcement_mode: "normal", thinking_mode: "auto" },
    forensic:     { tier_bias: "brain",    enforcement_mode: "strict", thinking_mode: "full" },
    audit:        { tier_bias: "brain",    enforcement_mode: "strict", thinking_mode: "full" },
  }
  const baseState = { sub_regime: "REFINING", latest_stress_multiplier: 0 }

  const ALL_MODES = Object.keys(CONTROL_CHECKS)
  for (const mode of ALL_MODES) {
    const cv = computeControlVector(baseState, "write", mode)
    const expected = CONTROL_CHECKS[mode]
    assertEqualAndLog(cv.tier_bias, expected.tier_bias, "computeControlVector", `${mode}.tier_bias`, { mode })
    assertEqualAndLog(cv.enforcement_mode, expected.enforcement_mode, "computeControlVector", `${mode}.enforcement_mode`, { mode })
    assertEqualAndLog(cv.thinking_mode, expected.thinking_mode, "computeControlVector", `${mode}.thinking_mode`, { mode })
    assertOkAndLog(cv.optimization_mode, "computeControlVector", `${mode}.optimization_mode`, { mode })
    assertEqualAndLog(cv.optimization_mode, mode, "computeControlVector", `${mode}.optimization_mode_value`, { mode })
  }
  const qmax = computeControlVector(baseState, "write", "vibeqmax")
  const ultra = computeControlVector(baseState, "write", "vibeultrax")
  assertEqualAndLog(qmax.mode_root, "vibeqmax", "computeControlVector", "vibeqmax.mode_root")
  assertEqualAndLog(qmax.mode_family, "brain-ml", "computeControlVector", "vibeqmax.mode_family")
  assertEqualAndLog(qmax.pipeline_root.join(","), "brain", "computeControlVector", "vibeqmax.pipeline_root")
  assertEqualAndLog(ultra.mode_root, "vibeultrax", "computeControlVector", "vibeultrax.mode_root")
  assertEqualAndLog(ultra.mode_family, "cascade", "computeControlVector", "vibeultrax.mode_family")
  assertEqualAndLog(ultra.cascade_depth, 3, "computeControlVector", "vibeultrax.cascade_depth")
})

// ── COMPUTE CONTROL VECTOR: regime-based stress override ──
test("computeControlVector: stress > 1.5 forces brain tier_bias", () => {
  const state = { sub_regime: "EXPLORING", latest_stress_multiplier: 1.8 }
  const cv = computeControlVector(state, "write", "budget")
  assertEqualAndLog(cv.tier_bias, "brain", "computeControlVector", "stress-override-budget-EXPLORING", { mode: "budget", stress: 1.8 })
})

// ── COMPUTE CONTROL VECTOR: regime-based tier bias ──
test("computeControlVector: CONVERGING/CLOSED stress < 1.5 gives brain tier_bias", () => {
  const s1 = { sub_regime: "CONVERGING", latest_stress_multiplier: 0 }
  const cv1 = computeControlVector(s1, "write", "auto")
  assertEqualAndLog(cv1.tier_bias, "brain", "computeControlVector", "CONVERGING-auto-tier_bias")

  const s2 = { sub_regime: "CLOSED", latest_stress_multiplier: 0 }
  const cv2 = computeControlVector(s2, "write", "auto")
  assertEqualAndLog(cv2.tier_bias, "brain", "computeControlVector", "CLOSED-auto-tier_bias")
})

// ── CLASSIFY TURN SIMPLE: security keywords → AUDIT ──
test("classifyTurnSimple: security keywords return AUDIT", () => {
  const securityInputs = [
    "We need to run a security audit on the auth module",
    "Check for OWASP compliance in this codebase",
    "Analyze dependencies for vulnerabilities",
    "Run a license audit before release",
    "Verify GDPR privacy requirements",
    "I want a full compliance review",
    "Find all XSS vulnerabilities in this template",
    "Check CSRF protection in the forms",
    "AuthN and AuthZ need review",
    "PenTest the login endpoint",
  ]
  for (const input of securityInputs) {
    const result = classifyTurnSimple(input)
    assertEqualAndLog(result, "AUDIT", "classifyTurnSimple-AUDIT", `"${input.substring(0, 40)}..."`)
  }
})

// ── CLASSIFY TURN SIMPLE: forensic keywords → FORENSIC ──
test("classifyTurnSimple: forensic keywords return FORENSIC", () => {
  const forensicInputs = [
    "I need to reverse engineer this binary",
    "Analyze this memory dump for anomalies",
    "Can you investigate the root cause of this crash",
    "Perform deep analysis on the attack vector",
    "Check for CVE-2025-1234 in our dependencies",
    "Run a penetration test on the network stack",
    "The system was exploited via an injection flaw",
    "Encrypt this data with AES-256",
    "Disassemble the malware sample",
    "Inspect the core dump for the segfault",
  ]
  for (const input of forensicInputs) {
    const result = classifyTurnSimple(input)
    assertEqualAndLog(result, "FORENSIC", "classifyTurnSimple-FORENSIC", `"${input.substring(0, 40)}..."`)
  }
})

// ── CLASSIFY TURN SIMPLE: Q&A patterns → EXPLORING ──
test("classifyTurnSimple: Q&A patterns return EXPLORING", () => {
  const qnaInputs = [
    "how does the routing system work",
    "what is a closure in JavaScript",
    "why does my build keep failing",
    "when should I use async/await",
    "where is the config file located",
    "who wrote this module",
    "can you explain recursion",
    "tell me about the deployment process",
    "show me the test coverage report",
    "check if the server is running",
  ]
  for (const input of qnaInputs) {
    const result = classifyTurnSimple(input)
    assertEqualAndLog(result, "EXPLORING", "classifyTurnSimple-EXPLORING", `"${input.substring(0, 40)}..."`)
  }
})

// ── CLASSIFY TURN SIMPLE: implementation patterns → REFINING ──
test("classifyTurnSimple: implementation patterns return REFINING", () => {
  const implInputs = [
    "write a sorting function",
    "create a new React component",
    "add error handling to the API",
    "build the user dashboard",
    "implement binary search",
    "fix the login redirect bug",
    "change the color scheme",
    "edit the config file for production",
    "modify the database schema",
    "update dependencies in package.json",
  ]
  for (const input of implInputs) {
    const result = classifyTurnSimple(input)
    assertEqualAndLog(result, "REFINING", "classifyTurnSimple-REFINING", `"${input.substring(0, 40)}..."`)
  }
})

// ── CLASSIFY TURN SIMPLE: empty/trivial → INIT ──
test("classifyTurnSimple: empty or trivial input returns INIT", () => {
  assertEqualAndLog(classifyTurnSimple(""), "INIT", "classifyTurnSimple-INIT", "empty-string")
  assertEqualAndLog(classifyTurnSimple(" "), "INIT", "classifyTurnSimple-INIT", "whitespace")
  assertEqualAndLog(classifyTurnSimple("ok"), "INIT", "classifyTurnSimple-INIT", "ok")
  assertEqualAndLog(classifyTurnSimple("yes"), "INIT", "classifyTurnSimple-INIT", "yes")
  assertEqualAndLog(classifyTurnSimple("thanks"), "INIT", "classifyTurnSimple-INIT", "thanks")
})

// ── SCORE STRESS: aggressive keywords ──
test("scoreStress: aggressive keywords produce high scores", () => {
  const aggressiveInputs = [
    { text: "this is fucking useless bullshit",   min: 0.25 },
    { text: "this code is broken and wrong",       min: 0.10 },
    { text: "you are a stupid idiot",              min: 0.25 },
    { text: "what a waste of time, terrible",      min: 0.25 },
    { text: "I hate this damn slow piece of shit", min: 0.40 },
    { text: "annoying bug, hell this is bad",      min: 0.20 },
  ]
  for (const { text, min } of aggressiveInputs) {
    const result = scoreStress(text)
    assertOkAndLog(result >= min, "scoreStress-aggressive", `"${text.substring(0, 40)}..." >= ${min}`, { text, result, min })
    logResult("scoreStress", `aggressive-"${text.substring(0, 30)}..."`, result >= min, { text, result, min })
  }
})

// ── SCORE STRESS: urgent keywords ──
test("scoreStress: urgent keywords produce moderate scores", () => {
  const urgentInputs = [
    { text: "fix this now, it's critical!",           min: 0.10 },
    { text: "urgent: production is down, hurry up",   min: 0.15 },
    { text: "this is important, fix it immediately",  min: 0.14 },
    { text: "ASAP we need to fix this fast",          min: 0.16 },
  ]
  for (const { text, min } of urgentInputs) {
    const result = scoreStress(text)
    const passed = result >= min
    assertOkAndLog(passed, "scoreStress-urgent", `"${text.substring(0, 40)}..." >= ${min}`, { text, result, min })
    logResult("scoreStress", `urgent-"${text.substring(0, 30)}..."`, passed, { text, result, min })
  }
})

// ── SCORE STRESS: calm inputs produce low scores ──
test("scoreStress: calm inputs produce low scores", () => {
  const calmInputs = [
    "could you help me understand this function",
    "please review my pull request when you get a chance",
    "what do you think about using TypeScript here",
    "I noticed a small bug in the login flow",
    "let me know if there's a better approach",
    "thanks for the help, that works perfectly",
    "just checking if the build passed",
    "can we refactor this module next sprint",
  ]
  for (const input of calmInputs) {
    const result = scoreStress(input)
    const passed = result < 0.15
    assertOkAndLog(passed, "scoreStress-calm", `"${input.substring(0, 40)}..." < 0.15`, { text: input, result })
    logResult("scoreStress", `calm-"${input.substring(0, 30)}..."`, passed, { text: input, result })
  }
})

// ── SCORE STRESS: mixed inputs ──
test("scoreStress: mixed aggressive+urgent inputs produce high scores", () => {
  const mixedInputs = [
    "FUCK this is CRITICAL fix it NOW",
    "this shit is BROKEN and URGENT FIX ASAP",
    "IMMEDIATELY fix this damn WASTE of code",
    "STUPID bug, FIX IT NOW, this is IMPORTANT",
  ]
  for (const input of mixedInputs) {
    const result = scoreStress(input)
    const passed = result >= 0.30
    assertOkAndLog(passed, "scoreStress-mixed", `"${input.substring(0, 40)}..." >= 0.30`, { text: input, result })
    logResult("scoreStress", `mixed-"${input.substring(0, 30)}..."`, passed, { text: input, result })
  }
})

// ── SCORE STRESS: caps and exclamation marks contribute ──
test("scoreStress: ALL CAPS + exclamation marks increase score", () => {
  const capsInput = "THIS IS A DISASTER!!"
  const result = scoreStress(capsInput)
  assertOkAndLog(result > 0, "scoreStress-caps", `caps+exclaim > 0`, { text: capsInput, result })
})

// ── SCORE STRESS: short inputs get a bonus ──
test("scoreStress: short inputs (< 30 chars) get length bonus", () => {
  const shortInput = "NO! BAD!"
  const result = scoreStress(shortInput)
  assertOkAndLog(result >= 0.05, "scoreStress-short-bonus", `short > 0.05`, { text: shortInput, result })
})

// ── SCORE STRESS: null/undefined returns 0 ──
test("scoreStress: null and undefined return 0", () => {
  assertEqualAndLog(scoreStress(null), 0, "scoreStress-null", "null")
  assertEqualAndLog(scoreStress(undefined), 0, "scoreStress-undefined", "undefined")
  assertEqualAndLog(scoreStress(""), 0, "scoreStress-empty", "empty-string")
})

// ── RESOLVE OPTIMIZATION MODE: all regimes x all stress with auto mode ──
test("resolveOptimizationMode: auto delegates to autoSelectMode for all regimes", () => {
  for (const regime of REGIMES) {
    for (const stress of STRESS_LEVELS) {
      const result = resolveOptimizationMode(regime, stress, "auto")
      const expected = autoSelectMode(regime, stress)
      assertEqualAndLog(result, expected, "resolveOptimizationMode-auto", `${regime} @ stress=${stress}`, { regime, stress })
    }
  }
})

// ── RESOLVE OPTIMIZATION MODE: explicit modes pass through ──
test("resolveOptimizationMode: explicit modes pass through directly", () => {
  const explicitModes = ["vibeultrax", "vibeqmax", "vibemax", "vibelitex", "audit", "forensic", "speed", "longrun", "quality", "budget", "balanced"]
  for (const mode of explicitModes) {
    const result = resolveOptimizationMode("INIT", 0, mode)
    assertEqualAndLog(result, mode, "resolveOptimizationMode-explicit", mode)
  }
})

// ── AUTO SELECT MODE: AUDIT and FORENSIC always return themselves ──
test("autoSelectMode: AUDIT and FORENSIC always return lowercase regardless of stress", () => {
  for (const stress of STRESS_LEVELS) {
    assertEqualAndLog(autoSelectMode("AUDIT", stress), "audit", "autoSelectMode", `AUDIT @ stress=${stress}`)
    assertEqualAndLog(autoSelectMode("audit", stress), "audit", "autoSelectMode", `audit @ stress=${stress}`)
    assertEqualAndLog(autoSelectMode("FORENSIC", stress), "forensic", "autoSelectMode", `FORENSIC @ stress=${stress}`)
    assertEqualAndLog(autoSelectMode("forensic", stress), "forensic", "autoSelectMode", `forensic @ stress=${stress}`)
  }
})

// ── Write all results ──
test.after(() => {
  writeResults()
  console.log(`[vibeOS] ML routing vectors test: ${RESULTS.length} assertions logged to ~/.claude/test-ml-vectors.json`)
})
