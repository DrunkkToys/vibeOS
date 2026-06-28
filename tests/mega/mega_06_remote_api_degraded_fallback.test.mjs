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

function sb() {
  const dir = mkdtempSync(join(tmpdir(), "m06-"));
  const fh = join(dir, "home"); mkdirSync(join(fh, ".claude"), { recursive: true });
  writeFileSync(join(fh, ".claude", "delegation-state.json"), JSON.stringify({
    sessions: [], lifetime: { total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0 }
  }));
  return { dir, fakeHome: fh };
}

function run(script, envOver = {}) {
  const s = sb();
  const r = join(s.dir, "r.mjs"); writeFileSync(r, script);
  try {
    const out = execFileSync(process.execPath, ["--experimental-vm-modules", r], {
      env: { ...process.env, HOME: s.fakeHome, USERPROFILE: s.fakeHome, VIBEOS_TEST_MODE: "1", NODE_OPTIONS: process.env.NODE_OPTIONS || "", ...envOver },
      cwd: ROOT, timeout: 15000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: out.trim(), code: 0 };
  } catch (e) {
    return { stdout: (e.stdout || "").trim(), stderr: (e.stderr || "").trim(), code: e.status ?? -1 };
  }
}

test("mega_06: wrong API token — local functions work", async (t) => {
  const r = run([
    'const mod = await import("' + I() + '");',
    'mod.setCurrentTier("high");',
    'mod.setCurrentModel("deepseek/deepseek-v4-flash");',
    'mod.recordSaving("delegation", 0.0004);',
    'const s = mod.scoreStress("test");',
    'const c = mod.classify("gpt-4o");',
    'process.stdout.write(JSON.stringify({ stress: s, classify: c }));',
  ].join("\n"), { VIBEOS_API_KEY: "invalid-token" });
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.ok(typeof p.stress === "number");
  assert.ok(typeof p.classify === "string");
});

test("mega_06: empty API key — all exports work", async (t) => {
  const r = run([
    'const mod = await import("' + I() + '");',
    'mod.setCurrentTier("medium");',
    'mod.setCurrentModel("gpt-4o");',
    'mod.recordSaving("delegation", 0.0004);',
    'mod.recordSaving("cache", 0.00014);',
    'process.stdout.write(JSON.stringify({ ok: true }));',
  ].join("\n"), { VIBEOS_API_KEY: "" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test("mega_06: bad API URL — functions still work", async (t) => {
  const r = run([
    'const mod = await import("' + I() + '");',
    'mod.setCurrentTier("high");',
    'const s = mod.scoreStress("test message");',
    'const sid = mod.getCurrentSessionId();',
    'process.stdout.write(JSON.stringify({ stress: s, sid: sid ? true : false }));',
  ].join("\n"), { VIBEOS_API_URL: "http://192.0.2.1:9999", VIBEOS_API_KEY: "test" });
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.ok(typeof p.stress === "number");
  assert.equal(p.sid, true);
});
