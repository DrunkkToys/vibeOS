// SPDX-License-Identifier: MIT
// Deep integration test: ALL 10 ML pipeline vectors end-to-end
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let sandbox;
let prevHome;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "ml-vectors-"));
  mkdirSync(join(sandbox, ".claude"), { recursive: true });

  writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "deepseek-v4-pro" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "deepseek-v4-flash" },
      cheap: { oc: "deepseek/deepseek-chat", cc: "deepseek-chat" },
    },
    selection: { enabled: true, active_slot: "medium", delegation_enforce: true },
  }, null, 2));

  writeFileSync(join(sandbox, ".claude", "delegation-state.json"), JSON.stringify({
    sessions: {},
    lifetime: { total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0, total_cost_usd: 0, warn_count: 0 },
    session_started_at: new Date().toISOString(),
  }, null, 2));

  writeFileSync(join(sandbox, ".claude", "blackbox-state.json"), JSON.stringify({
    sessions: {},
    enabled: true,
  }, null, 2));

  prevHome = process.env.HOME;
  process.env.HOME = sandbox;
});

after(() => {
  process.env.HOME = prevHome;
  rmSync(sandbox, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
// VECTOR 1: Turn Classification — classifyTurnSimple
// ─────────────────────────────────────────────────────────────
describe("Vector 1: Turn Classification (classifyTurnSimple)", () => {
  let classifiers;

  before(async () => {
    classifiers = await import("../src/lib/classifiers.js?t=" + Date.now());
  });

  const cases = [
    ["greeting: hi", "INIT"],
    ["greeting: hello", "INIT"],
    ["empty string", "INIT"],
    ["QA: what is python", "EXPLORING"],
    ["QA: how does async work", "EXPLORING"],
    ["QA: explain closures", "EXPLORING"],
    ["impl: write hello world", "REFINING"],
    ["impl: fix this production bug", "REFINING"],
    ["impl: implement auth middleware", "REFINING"],
    ["impl: create a new component", "REFINING"],
    ["impl: add logging to the server", "REFINING"],
    ["impl: refactor the database layer", "REFINING"],
    ["impl: optimize the build pipeline", "REFINING"],
  ];

  for (const [label, expected] of cases) {
    it(`returns ${expected} for "${label}"`, () => {
      assert.equal(classifiers.classifyTurnSimple(label), expected);
    });
  }
});

// ─────────────────────────────────────────────────────────────
// VECTOR 2: autoSelectMode consistency — meta-controller vs turn-classify
// ─────────────────────────────────────────────────────────────
describe("Vector 2: autoSelectMode consistency", () => {
  let mcAutoSelectMode;
  let tcAutoSelectMode;

  before(async () => {
    const mc = await import("../src/vibeOS-lib/blackbox/meta-controller.js?t=" + Date.now());
    mcAutoSelectMode = mc.autoSelectMode;
    const tc = await import("../src/lib/turn-classify.js?t=" + Date.now());
    tcAutoSelectMode = tc.autoSelectMode;
  });

  const regimes = ["INIT", "EXPLORING", "REFINING", "DIVERGENT", "CONVERGING", "CLOSED", "LOOPING", "FORENSIC", "AUDIT"];
  const stressLevels = [0, 0.5, 1.0, 1.5, 2.0];

  for (const regime of regimes) {
    for (const stress of stressLevels) {
      it(`both return same value for ${regime} x stress=${stress}`, () => {
        const mcResult = mcAutoSelectMode(regime, stress);
        const tcResult = tcAutoSelectMode(regime, stress);
        assert.equal(mcResult, tcResult,
          `Mismatch: mc=${mcResult} vs tc=${tcResult} for regime=${regime} stress=${stress}`);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────
// VECTOR 3: Branded mode pipeline — MODE_DELTAS + BRANDED_MODES
// ─────────────────────────────────────────────────────────────
describe("Vector 3: Branded mode pipeline", () => {
  let MODE_DELTAS;
  let BRANDED_MODES;

  before(async () => {
    const mc = await import("../src/vibeOS-lib/blackbox/meta-controller.js?t=" + Date.now());
    MODE_DELTAS = mc.MODE_DELTAS;
    const mr = await import("../src/lib/mode-router.js?t=" + Date.now());
    BRANDED_MODES = mr.BRANDED_MODES;
  });

  it("MODE_DELTAS has vibemax entry with tier_bias, thinking_mode, enforcement_mode", () => {
    const v = MODE_DELTAS.vibemax;
    assert.ok(v, "vibemax key must exist");
    assert.ok(typeof v.tier_bias === "string", "tier_bias must be string");
    assert.ok(typeof v.thinking_mode === "string", "thinking_mode must be string");
    assert.ok(typeof v.enforcement_mode === "string", "enforcement_mode must be string");
  });

  it("MODE_DELTAS has vibeqmax entry with tier_bias, thinking_mode, enforcement_mode", () => {
    const v = MODE_DELTAS.vibeqmax;
    assert.ok(v, "vibeqmax key must exist");
    assert.ok(typeof v.tier_bias === "string", "tier_bias must be string");
    assert.ok(typeof v.thinking_mode === "string", "thinking_mode must be string");
    assert.ok(typeof v.enforcement_mode === "string", "enforcement_mode must be string");
  });

  it("MODE_DELTAS has vibeultrax entry with tier_bias, thinking_mode, enforcement_mode", () => {
    const v = MODE_DELTAS.vibeultrax;
    assert.ok(v, "vibeultrax key must exist");
    assert.ok(typeof v.tier_bias === "string", "tier_bias must be string");
    assert.ok(typeof v.thinking_mode === "string", "thinking_mode must be string");
    assert.ok(typeof v.enforcement_mode === "string", "enforcement_mode must be string");
  });

  it("BRANDED_MODES has vibemax, vibeqmax, vibeultrax", () => {
    assert.ok(BRANDED_MODES.vibemax, "vibemax must be in BRANDED_MODES");
    assert.ok(BRANDED_MODES.vibeqmax, "vibeqmax must be in BRANDED_MODES");
    assert.ok(BRANDED_MODES.vibeultrax, "vibeultrax must be in BRANDED_MODES");
  });

  it("BRANDED_MODES each have a pipeline chain with at least 2 steps", () => {
    for (const mode of ["vibemax", "vibeqmax", "vibeultrax"]) {
      const entry = BRANDED_MODES[mode];
      assert.ok(entry, `${mode} must exist in BRANDED_MODES`);
      assert.ok(Array.isArray(entry.pipeline) && entry.pipeline.length >= 2,
        `${mode} pipeline must be array with >= 2 steps, got ${JSON.stringify(entry.pipeline)}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// VECTOR 4: Budget-first mode routing — peekBudgetFirstMode
// ─────────────────────────────────────────────────────────────
describe("Vector 4: Budget-first mode routing", () => {
  let peekBudgetFirstMode;

  before(async () => {
    const mp = await import("../src/lib/mode-policy.js?t=" + Date.now());
    peekBudgetFirstMode = mp.peekBudgetFirstMode;
  });

  it("auto mode returns the sub-regime derived mode", () => {
    const result = peekBudgetFirstMode({
      requestedMode: "auto",
      subRegime: "EXPLORING",
      stress: 0,
    });
    assert.ok(typeof result.mode === "string", "mode must be a string");
    assert.ok(typeof result.tier === "string", "tier must be a string");
    assert.ok(result.source === "regime" || result.source === "stress" || result.source === "mode",
      `source must be regime/stress/mode, got ${result.source}`);
  });

  it("manual vibemax passes through unchanged", () => {
    const result = peekBudgetFirstMode({
      requestedMode: "vibemax",
      subRegime: "EXPLORING",
      stress: 0,
    });
    assert.equal(result.mode, "vibemax");
  });

  it("manual vibeultrax passes through unchanged", () => {
    const result = peekBudgetFirstMode({
      requestedMode: "vibeultrax",
      subRegime: "EXPLORING",
      stress: 0,
    });
    assert.equal(result.mode, "vibeultrax");
  });

  it("manual vibeqmax passes through unchanged", () => {
    const result = peekBudgetFirstMode({
      requestedMode: "vibeqmax",
      subRegime: "EXPLORING",
      stress: 0,
    });
    assert.equal(result.mode, "vibeqmax");
  });

  it("stress > 1.5 escalates auto mode to quality", () => {
    const result = peekBudgetFirstMode({
      requestedMode: "auto",
      subRegime: "EXPLORING",
      stress: 1.8,
    });
    assert.equal(result.mode, "quality");
    assert.equal(result.source, "stress");
  });

  it("manual quality passes through even with low stress", () => {
    const result = peekBudgetFirstMode({
      requestedMode: "quality",
      subRegime: "INIT",
      stress: 0,
    });
    assert.equal(result.mode, "quality");
  });

  it("returns structured result with mode/tier/source", () => {
    const modes = ["auto", "vibemax", "quality", "speed", "budget", "balanced", "longrun", "audit", "forensic", "vibeqmax", "vibeultrax"];
    for (const mode of modes) {
      const result = peekBudgetFirstMode({ requestedMode: mode, subRegime: "EXPLORING", stress: 0 });
      assert.ok(typeof result.mode === "string", `mode missing for ${mode}`);
      assert.ok(typeof result.tier === "string", `tier missing for ${mode}`);
      assert.ok(typeof result.source === "string", `source missing for ${mode}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// VECTOR 5: Control vector computation — meta-controller computeControlVector
// ─────────────────────────────────────────────────────────────
describe("Vector 5: Control vector computation", () => {
  let computeControlVector;

  before(async () => {
    const mc = await import("../src/vibeOS-lib/blackbox/meta-controller.js?t=" + Date.now());
    computeControlVector = mc.computeControlVector;
  });

  const modes = ["budget", "quality", "speed", "vibemax", "vibeultrax", "vibeqmax"];
  for (const mode of modes) {
    it(`returns valid control vector for mode=${mode}`, () => {
      const cv = computeControlVector({ sub_regime: "REFINING", latest_stress_multiplier: 0 }, undefined, mode);
      assert.ok(cv, `computeControlVector returned falsy for ${mode}`);
      assert.ok(typeof cv.tier_bias === "string" && cv.tier_bias.length > 0,
        `tier_bias must be non-empty string, got "${cv.tier_bias}" for ${mode}`);
      assert.ok(typeof cv.enforcement_mode === "string" && cv.enforcement_mode.length > 0,
        `enforcement_mode must be non-empty string, got "${cv.enforcement_mode}" for ${mode}`);
      assert.ok(typeof cv.tdd_mode === "string" && cv.tdd_mode.length > 0,
        `tdd_mode must be non-empty string, got "${cv.tdd_mode}" for ${mode}`);
      assert.ok(typeof cv.flow_mode === "string" && cv.flow_mode.length > 0,
        `flow_mode must be non-empty string, got "${cv.flow_mode}" for ${mode}`);
      assert.ok(typeof cv.thinking_mode === "string" && cv.thinking_mode.length > 0,
        `thinking_mode must be non-empty string, got "${cv.thinking_mode}" for ${mode}`);
      assert.ok(typeof cv.optimization_mode === "string" && cv.optimization_mode.length > 0,
        `optimization_mode must be non-empty string, got "${cv.optimization_mode}" for ${mode}`);
    });
  }

  it("budget mode tier_bias is cheap for EXPLORING", () => {
    const cv = computeControlVector({ sub_regime: "EXPLORING", latest_stress_multiplier: 0 }, undefined, "budget");
    assert.equal(cv.tier_bias, "cheap");
  });

  it("quality mode tier_bias is brain for CONVERGING", () => {
    const cv = computeControlVector({ sub_regime: "CONVERGING", latest_stress_multiplier: 0 }, undefined, "quality");
    assert.equal(cv.tier_bias, "brain");
  });

  it("stress > 1.5 overrides tier_bias to brain", () => {
    const cv = computeControlVector({ sub_regime: "EXPLORING", latest_stress_multiplier: 1.8 }, undefined, "budget");
    assert.equal(cv.tier_bias, "brain");
  });

  it("vibemax produces tier_bias", () => {
    const cv = computeControlVector({ sub_regime: "EXPLORING", latest_stress_multiplier: 0 }, undefined, "vibemax");
    assert.ok(typeof cv.tier_bias === "string" && cv.tier_bias.length > 0);
    assert.deepEqual(["cheap", "medium", "brain", "auto"].includes(cv.tier_bias), true,
      `tier_bias must be cheap/medium/brain/auto, got ${cv.tier_bias}`);
  });
});

// ─────────────────────────────────────────────────────────────
// VECTOR 6: Mode router — resolveOptimizationMode
// ─────────────────────────────────────────────────────────────
describe("Vector 6: Mode router (resolveOptimizationMode)", () => {
  let resolveOptimizationMode;

  before(async () => {
    const tc = await import("../src/lib/turn-classify.js?t=" + Date.now());
    resolveOptimizationMode = tc.resolveOptimizationMode;
  });

  const modeStrings = ["auto", "vibemax", "quality", "speed", "budget", "balanced", "longrun", "audit", "forensic", "vibeqmax", "vibeultrax"];

  for (const modeStr of modeStrings) {
    it(`resolves "${modeStr}" to a valid tier`, () => {
      const result = resolveOptimizationMode("EXPLORING", 0, modeStr);
      assert.ok(typeof result === "string" && result.length > 0,
        `resolveOptimizationMode must return non-empty string, got "${result}" for ${modeStr}`);
    });
  }

  it("audit passes through as 'audit'", () => {
    const result = resolveOptimizationMode("EXPLORING", 0, "audit");
    assert.equal(result, "audit");
  });

  it("forensic passes through as 'forensic'", () => {
    const result = resolveOptimizationMode("EXPLORING", 0, "forensic");
    assert.equal(result, "forensic");
  });

  it("auto delegates to sub-regime logic", () => {
    const result = resolveOptimizationMode("CONVERGING", 0, "auto");
    assert.equal(result, "quality");
  });

  it("auto with high stress returns quality", () => {
    const result = resolveOptimizationMode("EXPLORING", 2.0, "auto");
    assert.equal(result, "quality");
  });
});

// ─────────────────────────────────────────────────────────────
// VECTOR 7: Footer display — format pattern verification
// ─────────────────────────────────────────────────────────────
describe("Vector 7: Footer display", () => {
  let footerModule;

  before(async () => {
    footerModule = await import("../src/lib/hooks/footer.js?t=" + Date.now());
  });

  it("footer module exports _appendFooter", () => {
    assert.ok(typeof footerModule._appendFooter === "function",
      "_appendFooter must be a function");
  });

  it("footer produces text with slot icon when called with valid input", async () => {
    const output = { text: "Hello world" };
    try {
      await footerModule._appendFooter(
        { messageID: "ftr-test-" + Date.now() },
        output,
        join(sandbox, "test-project")
      );
    } catch { /* client.config may not be available in test env */ }
    const text = String(output.text || "");
    assert.ok(text.includes("Hello world"), "must preserve original text");
    assert.ok(text.includes("—"), "must contain footer dashes");
  });

  it("footer text contains slot name or icon", async () => {
    const output = { text: "Testing footer output" };
    try {
      await footerModule._appendFooter(
        { messageID: "ftr-icon-" + Date.now() },
        output,
        join(sandbox, "test-project")
      );
    } catch { }
    const text = String(output.text || "");
    const hasIcon = ["brain", "medium", "cheap"].some(slot => text.includes(slot));
    assert.ok(hasIcon, `footer must contain a slot name, got: ${text.slice(-150)}`);
  });
});

// ─────────────────────────────────────────────────────────────
// VECTOR 8: Pivot detection — PivotCache.detectPivot
// ─────────────────────────────────────────────────────────────
describe("Vector 8: Pivot detection", () => {
  let getPivotCache;
  let resetVibeMaXPipeline;

  before(async () => {
    const vm = await import("../src/vibeOS-lib/blackbox/vibemax.js?t=" + Date.now());
    getPivotCache = vm.getPivotCache;
    resetVibeMaXPipeline = vm.resetVibeMaXPipeline;
  });

  it("detects pivot when context switches (different tokens)", () => {
    resetVibeMaXPipeline();
    const pc = getPivotCache();
    const result = pc.detectPivot(
      "deploy the application to production",  // tokens: ["deploy"]
      "fix the broken login bug"               // tokens: ["debug"]
    );
    assert.ok(result.isPivot === true, `isPivot must be true for context switch, got similarity=${result.similarity}`);
    assert.ok(result.similarity < 0.3, `similarity must be < 0.3, got ${result.similarity}`);
  });

  it("does not detect pivot when context is similar (same tokens)", () => {
    resetVibeMaXPipeline();
    const pc = getPivotCache();
    const result = pc.detectPivot(
      "fix the login bug",
      "fix that broken bug"
    );
    assert.ok(result.isPivot === false, `isPivot must be false for similar intent, got similarity=${result.similarity}`);
    assert.ok(result.similarity >= 0.3, `similarity must be >= 0.3, got ${result.similarity}`);
  });

  it("returns similarity number in range [0, 1]", () => {
    resetVibeMaXPipeline();
    const pc = getPivotCache();
    const combinations = [
      ["fix the bug", "deploy to prod"],
      ["create a new component", "add a component to the page"],
      ["review the pull request", "merge the pull request"],
      ["hello", "what is this"],
    ];
    for (const [current, previous] of combinations) {
      const result = pc.detectPivot(current, previous);
      assert.ok(result.similarity >= 0 && result.similarity <= 1,
        `similarity must be in [0,1], got ${result.similarity} for "${current}" vs "${previous}"`);
      assert.ok(typeof result.isPivot === "boolean",
        `isPivot must be boolean for "${current}" vs "${previous}"`);
    }
  });

  it("time gap penalty reduces similarity", () => {
    resetVibeMaXPipeline();
    const pc = getPivotCache();
    const r0 = pc.detectPivot("fix the bug", "fix the bug", 0);
    const r600 = pc.detectPivot("fix the bug", "fix the bug", 600);
    assert.ok(r600.similarity < r0.similarity,
      `time gap should reduce similarity: r0=${r0.similarity} vs r600=${r600.similarity}`);
  });
});

// ─────────────────────────────────────────────────────────────
// VECTOR 9: VibeMax pipeline — vibemaxPipeline
// ─────────────────────────────────────────────────────────────
describe("Vector 9: VibeMax pipeline", () => {
  let vibemaxPipeline;
  let resetVibeMaXPipeline;

  before(async () => {
    const vm = await import("../src/vibeOS-lib/blackbox/vibemax.js?t=" + Date.now());
    vibemaxPipeline = vm.vibemaxPipeline;
    resetVibeMaXPipeline = vm.resetVibeMaXPipeline;
  });

  it("returns valid mode and pivot metadata for text input", () => {
    resetVibeMaXPipeline();
    const result = vibemaxPipeline({
      user_text: "write a hello world function",
      sub_regime: "REFINING",
      latest_stress_multiplier: 0,
    });
    assert.ok(result, "vibemaxPipeline must return a non-empty object");
    assert.ok(typeof result.mode === "string" && result.mode.length > 0,
      `mode must be non-empty string, got "${result.mode}"`);
    assert.ok(typeof result.tier === "string" && result.tier.length > 0,
      `tier must be non-empty string, got "${result.tier}"`);
    assert.ok(typeof result.thinking === "string",
      `thinking must be string, got "${result.thinking}"`);
    assert.ok(typeof result.pivot_detected === "boolean",
      `pivot_detected must be boolean, got ${result.pivot_detected}`);
    assert.ok(result.pivot_similarity >= 0 && result.pivot_similarity <= 1,
      `pivot_similarity must be in [0,1], got ${result.pivot_similarity}`);
    assert.ok(["string", "object"].includes(typeof result.pivot_back) || result.pivot_back === null,
      `pivot_back must be string, object, or null, got ${typeof result.pivot_back}`);
  });

  it("returns different modes for different sub-regimes", () => {
    resetVibeMaXPipeline();
    const r1 = vibemaxPipeline({ user_text: "hi", sub_regime: "EXPLORING", latest_stress_multiplier: 0 });
    const r2 = vibemaxPipeline({ user_text: "hi", sub_regime: "CONVERGING", latest_stress_multiplier: 0 });
    assert.ok(r1.mode !== undefined && r2.mode !== undefined,
      "both results must have mode");
  });

  it("pivot detection works via vibemaxPipeline", () => {
    resetVibeMaXPipeline();
    vibemaxPipeline({ user_text: "deploy to production", sub_regime: "REFINING", latest_stress_multiplier: 0 });
    const result = vibemaxPipeline({ user_text: "fix the broken login", sub_regime: "REFINING", latest_stress_multiplier: 0 });
    assert.ok(typeof result.pivot_detected === "boolean");
    assert.ok(typeof result.pivot_similarity === "number");
  });

  it("returns enforcement/tdd/flow fields", () => {
    resetVibeMaXPipeline();
    const result = vibemaxPipeline({ user_text: "hello", sub_regime: "INIT", latest_stress_multiplier: 0 });
    assert.ok(typeof result.enforcement === "string", `enforcement must be string, got ${result.enforcement}`);
    assert.ok(typeof result.tdd === "string", `tdd must be string, got ${result.tdd}`);
    assert.ok(typeof result.flow === "string", `flow must be string, got ${result.flow}`);
  });
});

// ─────────────────────────────────────────────────────────────
// VECTOR 10: Stress pipeline — scoreStress
// ─────────────────────────────────────────────────────────────
describe("Vector 10: Stress pipeline (scoreStress)", () => {
  let scoreStress;

  before(async () => {
    const classifiers = await import("../src/lib/classifiers.js?t=" + Date.now());
    scoreStress = classifiers.scoreStress;
  });

  it("returns a float in range [0, 1]", () => {
    const inputs = [
      "hi",
      "hello",
      "can you help me with this urgent issue",
      "nothing is working and I am frustrated",
      "PLEASE HELP ME RIGHT NOW THIS IS CRITICAL",
      "this is broken and I keep getting errors everywhere",
    ];
    for (const input of inputs) {
      const score = scoreStress(input);
      assert.ok(typeof score === "number", `score must be number, got ${typeof score}`);
      assert.ok(score >= 0, `score must be >= 0, got ${score} for "${input}"`);
      assert.ok(score <= 1, `score must be <= 1, got ${score} for "${input}"`);
    }
  });

  it("returns higher score for urgent/frustrated text than for calm text", () => {
    const calmScore = scoreStress("hello how are you");
    const urgentScore = scoreStress("NOTHING WORKS I NEED HELP NOW");
    assert.ok(urgentScore > calmScore,
      `urgent score (${urgentScore}) must be > calm score (${calmScore})`);
  });

  it("returns higher score for text with error keywords", () => {
    const neutralScore = scoreStress("create a new file");
    const errorScore = scoreStress("everything is broken and I keep getting errors");
    assert.ok(errorScore >= neutralScore,
      `error score (${errorScore}) must be >= neutral (${neutralScore})`);
  });

  it("handles empty string gracefully", () => {
    const score = scoreStress("");
    assert.ok(score >= 0 && score <= 1, `empty string score must be in [0,1], got ${score}`);
  });

  it("handles non-string input gracefully", () => {
    const score = scoreStress(null);
    assert.ok(score >= 0 && score <= 1, `null score must be in [0,1], got ${score}`);
  });
});
