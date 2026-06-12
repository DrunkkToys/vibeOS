import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const _S = () => pathToFileURL(join(ROOT, "src/lib/state.js")).href + "?cb=" + Date.now();
const _I = () => pathToFileURL(join(ROOT, "src/index.js")).href + "?cb=" + Date.now();
const _C = () => pathToFileURL(join(ROOT, "src/lib/constants.js")).href + "?cb=" + Date.now();

function sb() {
  const dir = mkdtempSync(join(tmpdir(), "m01-"));
  const fh = join(dir, "home"); mkdirSync(join(fh, ".claude"), { recursive: true });
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

test("mega_01: state.js and constants.js load without crash", async (t) => {
  const r = run([
    'import * as st from "' + _S() + '";',
    'import * as cn from "' + _C() + '";',
    'const keys = Object.keys(st).sort().join(",");',
    'process.stdout.write(JSON.stringify({ stateKeys: keys.length, constKeys: Object.keys(cn).length }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.ok(p.stateKeys > 10, "state.js has many exports: " + p.stateKeys);
  assert.ok(p.constKeys > 5, "constants.js has many exports: " + p.constKeys);
});

test("mega_01: index.js exports functions", async (t) => {
  const r = run([
    'const mod = await import("' + _I() + '");',
    'process.stdout.write(JSON.stringify({',
    '  hasScore: typeof mod.scoreStress === "function",',
    '  hasClassify: typeof mod.classify === "function",',
    '  hasRecord: typeof mod.recordSaving === "function",',
    '  hasTier: typeof mod.setCurrentTier === "function",',
    '  hasModel: typeof mod.setCurrentModel === "function",',
    '  hasSession: typeof mod.getCurrentSessionId === "function",',
    '  exportCount: Object.keys(mod).length,',
    '}));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.hasScore, true);
  assert.equal(p.hasClassify, true);
  assert.equal(p.hasRecord, true);
  assert.equal(p.hasTier, true);
  assert.equal(p.hasModel, true);
  assert.equal(p.hasSession, true);
  assert.ok(p.exportCount >= 30);
});

test("mega_01: safeJsonParse returns null for empty, parses valid", async (t) => {
  const r = run([
    'import { safeJsonParse } from "' + _S() + '";',
    'const v = safeJsonParse("{\\"a\\":1}");',
    'const e = safeJsonParse("");',
    'process.stdout.write(JSON.stringify({ valid: v && v.a === 1, empty: e === null }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.valid, true, "valid JSON parses");
  assert.equal(p.empty, true, "empty returns null");
});

test("mega_01: scoreStress and classify work", async (t) => {
  const r = run([
    'const mod = await import("' + _I() + '");',
    'const s = mod.scoreStress("test message");',
    'const c = mod.classify("gpt-4o");',
    'process.stdout.write(JSON.stringify({ stress: s, tier: c }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.ok(typeof p.stress === "number" && p.stress >= 0);
  assert.ok(typeof p.tier === "string");
});
