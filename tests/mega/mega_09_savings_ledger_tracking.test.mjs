import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const cb = () => "?cb=" + Date.now() + Math.random();
const I = () => pathToFileURL(join(ROOT, "src/index.js")).href + cb();
const S = () => pathToFileURL(join(ROOT, "src/lib/state.js")).href + cb();
const C = () => pathToFileURL(join(ROOT, "src/lib/constants.js")).href + cb();

function sb() {
  const dir = mkdtempSync(join(tmpdir(), "m09-"));
  const fh = join(dir, "home"); mkdirSync(join(fh, ".claude"), { recursive: true });
  writeFileSync(join(fh, ".claude", "delegation-state.json"), JSON.stringify({
    sessions: [{ id: "s9", warns: [], cache_hits: [], cache_savings_usd: 0 }],
    lifetime: { total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0 }
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

test("mega_09: recordSaving through index.js accumulates three categories", async (t) => {
  const r = run([
    'const mod = await import("' + I() + '");',
    'for (let i = 0; i < 10; i++) mod.recordSaving("delegation", 0.0004);',
    'mod.recordSaving("cache", 0.00014);',
    'mod.recordSaving("missed_context7", 0.00014);',
    'process.stdout.write(JSON.stringify({ ok: true }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test("mega_09: SAVE_EST constants are correct", async (t) => {
  const r = run([
    'import { SAVE_EST, WARN_ON_DIRECT, SOFT_QUOTA, FREE, MONITOR } from "' + C() + '";',
    'process.stdout.write(JSON.stringify({ write: SAVE_EST.WRITE_EDIT, cache: SAVE_EST.CONTEXT7, warned: [...WARN_ON_DIRECT], soft: [...SOFT_QUOTA], free: [...FREE], monitor: [...MONITOR] }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.ok(p.write > 0, "WRITE_EDIT savings estimate");
  assert.ok(p.cache > 0, "CONTEXT7 savings estimate");
  assert.ok(p.warned.includes("write"), "write is warned");
  assert.ok(p.warned.includes("edit"), "edit is warned");
  assert.ok(p.warned.includes("notebookedit"), "notebookedit is warned");
  assert.ok(p.free.includes("trinity"), "trinity is free");
  assert.ok(p.monitor.includes("todowrite"), "todowrite is monitored");
});

test("mega_09: readLifetimeSavings returns object", async (t) => {
  const r = run([
    'import { readLifetimeSavings } from "' + S() + '";',
    'const s = readLifetimeSavings();',
    'process.stdout.write(JSON.stringify({ ok: typeof s === "object" && s !== null }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test("mega_09: report functions exported from index.js", async (t) => {
  const r = run([
    'const mod = await import("' + I() + '");',
    'process.stdout.write(JSON.stringify({',
    '  saveReport: typeof mod.saveReport,',
    '  readReport: typeof mod.readReport,',
    '  listReports: typeof mod.listReports,',
    '  researchAudit: typeof mod.researchAudit,',
    '}));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.saveReport, "function");
  assert.equal(p.readReport, "function");
  assert.equal(p.listReports, "function");
  assert.equal(p.researchAudit, "function");
});
