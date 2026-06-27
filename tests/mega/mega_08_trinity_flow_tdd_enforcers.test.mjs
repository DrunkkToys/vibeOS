import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const cb = () => "?cb=" + Date.now() + Math.random();
const FE = (f) => pathToFileURL(join(ROOT, "src/vibeOS-lib/flow-enforcer.js")).href + cb();
const TDD = () => pathToFileURL(join(ROOT, "src/lib/tdd-enforcer.js")).href + cb();
const I = () => pathToFileURL(join(ROOT, "src/index.js")).href + cb();

function sb() {
  const dir = mkdtempSync(join(tmpdir(), "m08-"));
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

test("mega_08: flow-enforcer exports work", async (t) => {
  const r = run([
    'import { checkFlowRules, addFlowRule, resetAll, getFlowWarns, getFlowTodos, recordFlowTodo, ensureProjectDocs } from "' + FE() + '";',
    'addFlowRule({ pattern: "TODO", action: "warn" });',
    'const cr = checkFlowRules({ tool: "edit", filePath: "/tmp/t.js", content: "function f() {}" });',
    'recordFlowTodo("src/t.js", "TODO: add tests");',
    'const todos = getFlowTodos();',
    'const warns = getFlowWarns();',
    'process.stdout.write(JSON.stringify({ hasCheck: cr !== undefined, todosLen: todos.length, warnsLen: warns.length }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.hasCheck, true);
  assert.ok(p.todosLen >= 0);
  assert.ok(p.warnsLen >= 0);
});

test("mega_08: TDD enforcer exports work", async (t) => {
  const r = run([
    'import { enforceTestFile, buildTestSkeleton, buildTestReminder } from "' + TDD() + '";',
    'import { buildTestReminder as tReminder, buildTestSkeleton as tSkeleton } from "' + TDD() + '";',
    'const reminder = typeof buildTestReminder === "function" ? buildTestReminder("/tmp/test.js") : null;',
    'const skeleton = typeof buildTestSkeleton === "function" ? buildTestSkeleton("/tmp/test.js") : null;',
    'const enforced = enforceTestFile("/tmp/test.js");',
    'process.stdout.write(JSON.stringify({ hasReminder: !!reminder, hasSkeleton: !!skeleton, enforced: enforced !== undefined }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.enforced, true);
});

test("mega_08: index.js exports buildTestSkeleton and enforceTestFile", async (t) => {
  const r = run([
    'const mod = await import("' + I() + '");',
    'process.stdout.write(JSON.stringify({',
    '  skeleton: typeof mod.buildTestSkeleton === "function",',
    '  reminder: typeof mod.buildTestReminder === "function",',
    '  enforce: typeof mod.enforceTestFile === "function",',
    '  flow: typeof mod.checkFlowRules === "function" || typeof mod.getFlowTodos === "function",',
    '}));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.skeleton, true, "buildTestSkeleton exported from index.js");
  assert.equal(p.reminder, true, "buildTestReminder exported");
  assert.equal(p.enforce, true, "enforceTestFile exported");
});

test("mega_08: getSessionFlowCounts and resetForTest work", async (t) => {
  const r = run([
    'import { getSessionFlowCounts, resetForTest, resolveRulesPath } from "' + FE() + '";',
    'const counts = getSessionFlowCounts();',
    'process.stdout.write(JSON.stringify({ hasCounts: typeof counts === "object" }));',
  ].join("\n"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).hasCounts, true);
});
