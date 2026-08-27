// SPDX-License-Identifier: MIT
// Contract: exactly ONE vibeOS instance may register hooks in a single process.
//
// OpenCode merges the global ~/.opencode/opencode.json with every project-level
// opencode.json, so a stale or hand-added `plugin[]` entry loads a SECOND copy
// of the bundle into the same process. Two module instances mean two footers
// appended per turn, savings counted twice, and duplicate cascade-audit rows —
// silent corruption that looks like real data. The second copy must register
// zero hooks.

import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, copyFileSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

const guard = await import("../src/lib/instance-guard.js")

function fresh() {
  guard.resetInstanceGuardForTest()
  delete process.env.VIBEOS_SINGLE_INSTANCE_GUARD
}

test("the first module URL to claim wins", () => {
  fresh()
  assert.equal(guard.claimInstance("file:///a/vibeOS.js"), true)
  assert.equal(guard.getInstanceOwner(), "file:///a/vibeOS.js")
})

test("a different module URL in the same process is refused", () => {
  fresh()
  assert.equal(guard.claimInstance("file:///a/vibeOS.js"), true)
  assert.equal(guard.claimInstance("file:///b/vibeOS.js"), false)
  assert.equal(guard.claimInstance("file:///c/vibeOS.js"), false)
  // The owner never changes once claimed.
  assert.equal(guard.getInstanceOwner(), "file:///a/vibeOS.js")
})

test("the SAME module URL may re-claim — OpenCode calls the factory per project", () => {
  fresh()
  assert.equal(guard.claimInstance("file:///a/vibeOS.js"), true)
  assert.equal(guard.claimInstance("file:///a/vibeOS.js"), true)
  assert.equal(guard.claimInstance("file:///a/vibeOS.js"), true)
})

test("an empty or missing URL never claims and never blocks", () => {
  fresh()
  assert.equal(guard.claimInstance(""), true)
  assert.equal(guard.claimInstance(null), true)
  assert.equal(guard.getInstanceOwner(), "")
  // A real module can still claim afterwards.
  assert.equal(guard.claimInstance("file:///a/vibeOS.js"), true)
})

test("VIBEOS_SINGLE_INSTANCE_GUARD=off is an escape hatch", () => {
  fresh()
  process.env.VIBEOS_SINGLE_INSTANCE_GUARD = "off"
  assert.equal(guard.claimInstance("file:///a/vibeOS.js"), true)
  assert.equal(guard.claimInstance("file:///b/vibeOS.js"), true)
  delete process.env.VIBEOS_SINGLE_INSTANCE_GUARD
})

test("the guard is shared across separate module instances via globalThis", () => {
  fresh()
  guard.claimInstance("file:///a/vibeOS.js")
  // A second copy of the module sees the same latch.
  assert.equal(globalThis.__vibeOS_instance_owner, "file:///a/vibeOS.js")
})

// The real thing: two physical copies of the built bundle, one process.
test("two copies of the built bundle: only one registers hooks", { timeout: 120000 }, (t) => {
  const bundle = join(ROOT, "dist", "vibeOS.js")
  if (!existsSync(bundle)) return t.skip("dist/vibeOS.js not built")

  const dir = mkdtempSync(join(tmpdir(), "vibeos-dup-"))
  try {
    const a = join(dir, "copyA.js")
    const b = join(dir, "copyB.js")
    copyFileSync(bundle, a)
    copyFileSync(bundle, b)

    const probe = `
      const A = await import(${JSON.stringify("file://" + a)})
      const B = await import(${JSON.stringify("file://" + b)})
      const ha = await A.DelegationEnforcer({ directory: process.cwd() })
      const hb = await B.DelegationEnforcer({ directory: process.cwd() })
      const n = (h) => Object.keys(h || {}).length
      console.log(JSON.stringify({ a: n(ha), b: n(hb) }))
    `
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
      encoding: "utf8",
      timeout: 110000,
      env: {
        ...process.env,
        VIBEOS_HOME: join(dir, "home"),
        VIBEOS_TEST_CONTEXT: "1",
        VIBEOS_MCP_PORT: "0",
      },
    })
    const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop()
    const res = JSON.parse(line)
    assert.ok(res.a > 0, `first copy must register hooks, got ${res.a}`)
    assert.equal(res.b, 0, `second copy must register ZERO hooks, got ${res.b}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── Config side: the same contract enforced before the process ever starts ──

const { normalizeVibeOSPluginRefs } = await import("../scripts/lib/plugin-config.mjs")

const CANON = "/Users/x/.opencode/plugins/vibeOS.js"

test("config: a stale vibeOS ref whose file is gone is dropped", () => {
  // The exact shape that caused this: a setup run inside a temp
  // VIBEOS_OPENCODE_HOME wrote its throwaway path into a persistent project config.
  const out = normalizeVibeOSPluginRefs(
    ["/private/tmp/vibeos-setup-gm9aQA/.opencode/plugins/vibeOS.js"],
    CANON,
  )
  assert.deepEqual(out, [CANON])
})

test("config: never more than one vibeOS ref survives", () => {
  const out = normalizeVibeOSPluginRefs(
    [CANON, CANON, "/tmp/gone/vibeOS.js", "/other/vibeOS.js"],
    CANON,
  )
  assert.deepEqual(out.filter((r) => String(r).includes("vibeOS")), [CANON])
})

test("config: non-vibeOS plugins are left untouched", () => {
  const out = normalizeVibeOSPluginRefs(["some-other-plugin", "@scope/thing"], CANON)
  assert.deepEqual(out, ["some-other-plugin", "@scope/thing", CANON])
})

test("config: the canonical ref is added when the list is empty or absent", () => {
  assert.deepEqual(normalizeVibeOSPluginRefs([], CANON), [CANON])
  assert.deepEqual(normalizeVibeOSPluginRefs(undefined, CANON), [CANON])
  assert.deepEqual(normalizeVibeOSPluginRefs(null, CANON), [CANON])
})

test("cache-busted re-imports of the SAME file are one instance, not two", () => {
  fresh()
  // Tests use `import(mod + "?case=" + Date.now())` for per-case isolation.
  assert.equal(guard.claimInstance("file:///a/index.js?case=1"), true)
  assert.equal(guard.claimInstance("file:///a/index.js?case=2"), true)
  assert.equal(guard.claimInstance("file:///a/index.js#frag"), true)
  assert.equal(guard.claimInstance("file:///a/index.js"), true)
  // A genuinely different file is still refused.
  assert.equal(guard.claimInstance("file:///b/index.js"), false)
  assert.equal(guard.getInstanceOwner(), "file:///a/index.js")
})
