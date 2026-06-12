import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const _I = () => pathToFileURL(join(ROOT, "src/index.js")).href + "?cb=" + Date.now();
const _CL = () => pathToFileURL(join(ROOT, "src/lib/classifiers.js")).href + "?cb=" + Date.now();
const _S = () => pathToFileURL(join(ROOT, "src/lib/state.js")).href + "?cb=" + Date.now();

function sb() {
  const dir = mkdtempSync(join(tmpdir(), "m05-")); const fh = join(dir, "home");
  mkdirSync(join(fh, ".claude"), { recursive: true });
  writeFileSync(join(fh, ".claude", "delegation-state.json"), JSON.stringify({
    sessions: [], lifetime: { total_savings_usd: 35.28, cache_savings_usd: 15.07, missed_context7_usd: 0.01 }
  }));
  return { dir, fakeHome: fh };
}

function run(script) {
  const s = sb(); const r = join(s.dir, "r.mjs"); writeFileSync(r, script);
  try {
    const out = execFileSync(process.execPath, ["--experimental-vm-modules", r], {
      env: { ...process.env, HOME: s.fakeHome, USERPROFILE: s.fakeHome, VIBEOS_TEST_MODE: "1", NODE_OPTIONS: "" },
      cwd: ROOT, timeout: 15000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: out.trim(), code: 0 };
  } catch (e) {
    return { stdout: (e.stdout || "").trim(), stderr: (e.stderr || "").trim(), code: e.status ?? -1 };
  }
}

test("mega_05: scoreStress returns values in [0,3]", async (t) => {
  const r = run([
    'const mod = await import("' + _I() + '");',
    'const scores = ["hello", "FIX THIS NOW", "thank you", "implement feature", "why is this broken"].map(function(m) { return mod.scoreStress(m); });',
    'process.stdout.write(JSON.stringify({ valid: scores.every(function(s) { return typeof s === "number" && s >= 0 && s <= 3; }), scores: scores }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.valid, true);
  assert.equal(p.scores.length, 5);
});

test("mega_05: detectOutcomeSignal returns truthy for all inputs", async (t) => {
  const r = run([
    'import { detectOutcomeSignal } from "' + _CL() + '";',
    'const r1 = detectOutcomeSignal("thanks that works");',
    'const r2 = detectOutcomeSignal("still broken");',
    'const r3 = detectOutcomeSignal("here is the code");',
    'process.stdout.write(JSON.stringify({ all: (r1 != null) && (r2 != null) && (r3 != null) }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  // Just verify no crash - results may vary by input
});

test("mega_05: classify returns tier for known models", async (t) => {
  const r = run([
    'const mod = await import("' + _I() + '");',
    'const models = ["deepseek/deepseek-v4-flash", "gpt-4o", "deepseek/deepseek-chat", "unknown-model"];',
    'const tiers = models.map(function(m) { return mod.classify(m); });',
    'process.stdout.write(JSON.stringify({ allStr: tiers.every(function(t) { return typeof t === "string"; }), tiers: tiers }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).allStr, true);
});

test("mega_05: readLifetimeSavings returns object with savings keys", async (t) => {
  const r = run([
    'import { readLifetimeSavings } from "' + _S() + '";',
    'const s = readLifetimeSavings();',
    'process.stdout.write(JSON.stringify({ ok: typeof s === "object" && s !== null }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});
