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
const S = () => pathToFileURL(join(ROOT, "src/lib/state.js")).href + cb();

function sb() {
  const dir = mkdtempSync(join(tmpdir(), "m04-"));
  const fh = join(dir, "home"); mkdirSync(join(fh, ".claude"), { recursive: true });
  writeFileSync(join(fh, ".claude", "delegation-state.json"), JSON.stringify({
    sessions: [], lifetime: { total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0 }
  }));
  return { dir, fakeHome: fh };
}

function spawnN(n, scriptStr) {
  const s = sb();
  const workers = [];
  for (let i = 0; i < n; i++) {
    const r = join(s.dir, "w" + i + ".mjs"); writeFileSync(r, scriptStr);
    workers.push(r);
  }
  const results = workers.map((r, idx) => {
    try {
      const out = execFileSync(process.execPath, ["--experimental-vm-modules", r], {
        env: { ...process.env, HOME: s.fakeHome, USERPROFILE: s.fakeHome, VIBEOS_TEST_MODE: "1", NODE_OPTIONS: process.env.NODE_OPTIONS || "" },
        cwd: ROOT, timeout: 30000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });
      return { idx, stdout: out.trim(), code: 0, stderr: "" };
    } catch (e) {
      return { idx, stdout: (e.stdout || "").trim(), stderr: (e.stderr || "").trim(), code: e.status ?? -1 };
    }
  });
  return { results, sb: s };
}

test("mega_04: 4 workers calling recordSaving and setCurrentTier", async (t) => {
  const wScript = [
    'const mod = await import("' + I() + '");',
    'for (let r = 0; r < 15; r++) {',
    '  mod.setCurrentTier(["high","medium","cheap"][r % 3]);',
    '  mod.setCurrentModel("model-" + r);',
    '  mod.recordSaving("delegation", 0.0004);',
    '}',
    'process.stdout.write(JSON.stringify({ ok: true }));',
  ].join("\n");
  const { results } = spawnN(4, wScript);
  for (const rr of results) {
    assert.equal(rr.code, 0, "worker " + rr.idx + " should not crash: " + rr.stderr);
    assert.equal(JSON.parse(rr.stdout).ok, true);
  }
});

test("mega_04: 3 workers calling state.js recordDelegation concurrently", async (t) => {
  const wScript = [
    'import { recordDelegation } from "' + S() + '";',
    'for (let i = 0; i < 20; i++) {',
    '  recordDelegation("write", { filePath: "/tmp/t" + i + ".js" }, "high", "ds/dsv4", 0.0004, []);',
    '}',
    'process.stdout.write(JSON.stringify({ ok: true }));',
  ].join("\n");
  const { results } = spawnN(3, wScript);
  for (const rr of results) {
    assert.equal(rr.code, 0, "worker " + rr.idx + " should not crash: " + rr.stderr);
    assert.equal(JSON.parse(rr.stdout).ok, true);
  }
});
