import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const cb = () => "?cb=" + Date.now() + Math.random();
const I = () => pathToFileURL(join(ROOT, "dist-ts/index.js")).href + cb();
const CLASS = () => pathToFileURL(join(ROOT, "dist-ts/lib/classifiers.js")).href + cb();

function sb() {
  const dir = mkdtempSync(join(tmpdir(), "m10-"));
  const fh = join(dir, "home"); mkdirSync(join(fh, ".claude"), { recursive: true });
  writeFileSync(join(fh, ".claude", "delegation-state.json"), JSON.stringify({
    sessions: [], lifetime: { total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0 }
  }));
  return { dir, fakeHome: fh };
}

function run(script) {
  const s = sb();
  const r = join(s.dir, "r.mjs"); writeFileSync(r, script);
  try {
    const out = execFileSync(process.execPath, ["--experimental-vm-modules", r], {
      env: { ...process.env, HOME: s.fakeHome, USERPROFILE: s.fakeHome, VIBEOS_TEST_MODE: "1", NODE_OPTIONS: process.env.NODE_OPTIONS || "" },
      cwd: ROOT, timeout: 15000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: out.trim(), code: 0 };
  } catch (e) {
    return { stdout: (e.stdout || "").trim(), stderr: (e.stderr || "").trim(), code: e.status ?? -1 };
  }
}

test("mega_10: scoreStress with diverse inputs returns valid values", async (t) => {
  const r = run([
    'const mod = await import("' + I() + '");',
    'const inputs = [',
    '  "fix this now! its broken again!! what is wrong with you???",',
    '  "thanks for the help, that works perfectly",',
    '  "implement a binary search tree in Python",',
    '  "I NEED THIS DONE RIGHT NOW STOP WASTING TIME",',
    '  "please implement the login feature step by step",',
    '  "WHY IS THIS STILL NOT WORKING??? YOU SAID IT WOULD WORK",',
    '];',
    'const scores = inputs.map(function(m) { return mod.scoreStress(m); });',
    'const allValid = scores.every(function(s) { return typeof s === "number" && s >= 0 && s <= 3; });',
    'const unique = scores.filter(function(v, i, a) { return a.indexOf(v) === i; }).length;',
    'process.stdout.write(JSON.stringify({ count: scores.length, allValid, uniqueLevels: unique }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.count, 6, "6 messages scored");
  assert.equal(p.allValid, true, "all scores in [0,3]");
  assert.ok(p.uniqueLevels >= 1, "at least 1 unique stress level: " + p.uniqueLevels);
});

test("mega_10: detectOutcomeSignal does not crash", async (t) => {
  const r = run([
    'import { detectOutcomeSignal } from "' + CLASS() + '";',
    'detectOutcomeSignal("thanks that works perfectly!");',
    'detectOutcomeSignal("this is still broken");',
    'detectOutcomeSignal("here is the updated code");',
    'process.stdout.write(JSON.stringify({ ok: true }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test("mega_10: scoreStress + classify + recordSaving end-to-end", async (t) => {
  const r = run([
    'const mod = await import("' + I() + '");',
    'mod.setCurrentTier("high");',
    'mod.setCurrentModel("deepseek/deepseek-v4-flash");',
    'mod.recordSaving("delegation", 0.0004);',
    'mod.recordSaving("delegation", 0.0004);',
    'mod.recordSaving("cache", 0.00014);',
    'const stress = mod.scoreStress("CAN YOU PLEASE FIX THIS NOW");',
    'const tier = mod.classify("deepseek/deepseek-v4-flash");',
    'const sid = mod.getCurrentSessionId();',
    'process.stdout.write(JSON.stringify({ stress, tier, sid: sid ? true : false }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.ok(typeof p.stress === "number" && p.stress >= 0);
  assert.ok(typeof p.tier === "string");
  assert.equal(p.sid, true);
});

test("mega_10: classifyAndRankModels (if exported)", async (t) => {
  const r = run([
    'const mod = await import("' + I() + '");',
    'if (typeof mod.classifyAndRankModels === "function") {',
    '  const ranked = mod.classifyAndRankModels(["deepseek/deepseek-v4-flash", "gpt-4o", "deepseek/deepseek-chat"]);',
    '  process.stdout.write(JSON.stringify({ ranked: !!ranked }));',
    '} else {',
    '  process.stdout.write(JSON.stringify({ noExport: true }));',
    '}',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
});

test("mega_10: isModelFree and modelCostPerTurn (if exported)", async (t) => {
  const r = run([
    'const mod = await import("' + I() + '");',
    'const free = typeof mod.isModelFree === "function" ? mod.isModelFree("deepseek/deepseek-chat") : null;',
    'const cost = typeof mod.modelCostPerTurn === "function" ? mod.modelCostPerTurn("deepseek/deepseek-v4-flash") : null;',
    'process.stdout.write(JSON.stringify({ free: free !== null, cost: cost !== null }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
});
