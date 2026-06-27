import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const _S = () => pathToFileURL(join(ROOT, "src/lib/state.js")).href + "?cb=" + Date.now();
const _C = () => pathToFileURL(join(ROOT, "src/lib/constants.js")).href + "?cb=" + Date.now();
const _I = () => pathToFileURL(join(ROOT, "src/index.js")).href + "?cb=" + Date.now();

function sb(files) {
  const dir = mkdtempSync(join(tmpdir(), "m03-")); const fh = join(dir, "home");
  mkdirSync(join(fh, ".claude"), { recursive: true });
  if (files) for (const [k, v] of Object.entries(files)) writeFileSync(join(fh, ".claude", k), v);
  return { dir, fakeHome: fh };
}

function run(script, files) {
  const s = sb(files); const r = join(s.dir, "r.mjs"); writeFileSync(r, script);
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

test("mega_03: safeJsonParse parses valid, returns null for empty/invalid", async (t) => {
  const r = run([
    'import { safeJsonParse } from "' + _S() + '";',
    'const v = safeJsonParse("{\\"a\\":1}"); ',
    'const e = safeJsonParse(""); ',
    'const n = safeJsonParse("not json"); ',
    'process.stdout.write(JSON.stringify({ valid: v && v.a === 1, emptyNull: e === null, invalidNull: n === null }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.valid, true);
  assert.equal(p.emptyNull, true);
  assert.equal(p.invalidNull, true);
});

test("mega_03: runStartupMaintenanceOnce with corrupt state", async (t) => {
  const r = run([
    'import { runStartupMaintenanceOnce } from "' + _S() + '";',
    'runStartupMaintenanceOnce();',
    'process.stdout.write(JSON.stringify({ ok: true }));',
  ].join("\n"), {
    "delegation-state.json": "corrupt {{",
    "model-tiers.json": "null"
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test("mega_03: constants export correct values", async (t) => {
  const r = run([
    'import { SAVE_EST, WARN_ON_DIRECT, FREE, COMPRESS_THRESHOLD } from "' + _C() + '";',
    'process.stdout.write(JSON.stringify({ w: SAVE_EST.WRITE_EDIT, warned: [...WARN_ON_DIRECT], hasTrinity: FREE.has("trinity"), ct: COMPRESS_THRESHOLD }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.ok(p.w > 0);
  assert.ok(p.warned.includes("write"));
  assert.equal(p.hasTrinity, true);
  assert.equal(p.ct, 2000);
});

test("mega_03: setCurrentSessionId roundtrip", async (t) => {
  const r = run([
    'const mod = await import("' + _I() + '");',
    'mod.setCurrentSessionId("m03-test-session");',
    'const sid = mod.getCurrentSessionId();',
    'process.stdout.write(JSON.stringify({ sid }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).sid, "m03-test-session");
});
