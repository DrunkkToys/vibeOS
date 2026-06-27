import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const _BB = (f) => pathToFileURL(join(ROOT, "src/vibeOS-lib/blackbox", f)).href + "?cb=" + Date.now();

function sb() {
  const dir = mkdtempSync(join(tmpdir(), "m07-")); const fh = join(dir, "home");
  mkdirSync(join(fh, ".claude"), { recursive: true });
  return { dir, fakeHome: fh };
}

function run(script) {
  const s = sb(); const r = join(s.dir, "r.mjs"); writeFileSync(r, script);
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

test("mega_07: ResolutionTracker init, update, snapshot, reset", async (t) => {
  const r = run([
    'import { ResolutionTracker } from "' + _BB("resolution-tracker.js") + '";',
    'const rt = new ResolutionTracker("test-proj");',
    'rt.update("user", "implement login feature");',
    'rt.update("assistant", "here is the code");',
    'const snap = rt.snapshot();',
    'rt.reset();',
    'const snap2 = rt.snapshot();',
    'process.stdout.write(JSON.stringify({ hasSnap: !!snap, hasReset: !!snap2 }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.hasSnap, true);
  assert.equal(p.hasReset, true);
});

test("mega_07: ExposureModel init", async (t) => {
  const r = run([
    'import { ExposureModel } from "' + _BB("exposure-model.js") + '";',
    'const em = new ExposureModel();',
    'process.stdout.write(JSON.stringify({ ok: true }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test("mega_07: taxonomy exports load without crash", async (t) => {
  const r = run([
    'import { classifySituation, getActions, getSituationTypes, recommendAction } from "' + _BB("taxonomy.js") + '";',
    'const types = getSituationTypes();',
    // getActions requires exposure object with total
    'const actions = getActions("work", { total: 10 });',
    'process.stdout.write(JSON.stringify({ typesLen: types.length, actsLen: actions.length }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.ok(p.typesLen > 0, "situation types: " + p.typesLen);
  assert.ok(p.actsLen > 0, "actions: " + p.actsLen);
});

test("mega_07: buildAdvice and computeControlVector", async (t) => {
  const r = run([
    'import { buildAdvice, buildDecisionBlock } from "' + _BB("advice-layer.js") + '";',
    'import { computeControlVector, REGIME_CONTROL_TABLE } from "' + _BB("meta-controller.js") + '";',
    'const adv = buildAdvice({ regime: "EXPLORING", stress: 0.5 });',
    'const cv = computeControlVector({ regime: "REFINING", stress: 1.0 });',
    'process.stdout.write(JSON.stringify({ adv: !!adv, cv: !!cv, table: !!REGIME_CONTROL_TABLE }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.adv, true);
  assert.equal(p.cv, true);
  assert.equal(p.table, true);
});

test("mega_07: PivotCache and vibeMaX work without crash", async (t) => {
  const r = run([
    'import { PivotCache } from "' + _BB("pivot-cache.js") + '";',
    'import { vibemaxSelectMode } from "' + _BB("vibemax.js") + '";',
    'const pc = new PivotCache();',
    'pc.learn("topic1");',
    'pc.learn("topic2");',
    'const mode = vibemaxSelectMode({ stress: 0.5, budget: 0.01 });',
    'process.stdout.write(JSON.stringify({ hasMode: mode && typeof mode.mode === "string" }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).hasMode, true);
});
