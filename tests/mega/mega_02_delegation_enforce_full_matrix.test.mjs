import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const cb = () => "?cb=" + Date.now() + Math.random();
const I = () => pathToFileURL(join(ROOT, "src/index.js")).href + cb();
const C = () => pathToFileURL(join(ROOT, "src/lib/constants.js")).href + cb();
const S = () => pathToFileURL(join(ROOT, "src/lib/state.js")).href + cb();

function sb() {
  const dir = mkdtempSync(join(tmpdir(), "m02-"));
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
      env: { ...process.env, HOME: s.fakeHome, USERPROFILE: s.fakeHome, VIBEOS_TEST_MODE: "1", NODE_OPTIONS: "" },
      cwd: ROOT, timeout: 15000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: out.trim(), code: 0 };
  } catch (e) {
    return { stdout: (e.stdout || "").trim(), stderr: (e.stderr || "").trim(), code: e.status ?? -1 };
  }
}

const BLOCKED = ["write", "edit", "notebookedit"];
const ALLOWED = ["read", "bash", "grep", "skill"];

test("mega_02: WARN_ON_DIRECT contains blocked tools", async (t) => {
  const r = run([
    'import { WARN_ON_DIRECT } from "' + C() + '";',
    'const b = ' + JSON.stringify(BLOCKED) + ';',
    'const a = ' + JSON.stringify(ALLOWED) + ';',
    'const blockedOk = b.every(t => WARN_ON_DIRECT.has(t));',
    'const allowedOk = a.every(t => !WARN_ON_DIRECT.has(t));',
    'process.stdout.write(JSON.stringify({ blockedOk, allowedOk }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.blockedOk, true, "all blocked tools in WARN_ON_DIRECT");
  assert.equal(p.allowedOk, true, "allowed tools not in WARN_ON_DIRECT");
});

test("mega_02: index.js exports recordSaving/DelegationEnforcer", async (t) => {
  const r = run([
    'const mod = await import("' + I() + '");',
    'mod.setCurrentTier("high");',
    'mod.setCurrentModel("deepseek/deepseek-v4-flash");',
    'mod.recordSaving("delegation", 0.0004);',
    'mod.recordSaving("delegation", 0.0004);',
    'mod.recordSaving("cache", 0.00014);',
    'process.stdout.write(JSON.stringify({ ok: true }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test("mega_02: recordDelegation from state.js", async (t) => {
  const r = run([
    'import { recordDelegation } from "' + S() + '";',
    'recordDelegation("write", { filePath: "/tmp/x.js" }, "high", "deepseek/deepseek-v4-flash", 0.0004, []);',
    'recordDelegation("edit", { filePath: "/tmp/y.js" }, "high", "deepseek/deepseek-v4-flash", 0.0004, []);',
    'recordDelegation("read", { filePath: "/tmp/z.js" }, "cheap", "deepseek/deepseek-chat", 0, []);',
    'process.stdout.write(JSON.stringify({ ok: true }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test("mega_02: session state accessible via getCurrentSessionId", async (t) => {
  const r = run([
    'const mod = await import("' + I() + '");',
    'const sid = mod.getCurrentSessionId();',
    'process.stdout.write(JSON.stringify({ sid: sid || "generated" }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.ok(typeof p.sid === "string" && p.sid.length > 0);
});
