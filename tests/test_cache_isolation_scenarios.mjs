// Cache isolation scenarios — verify no cross-session/project hallucination
// Run: node --test tests/test_cache_isolation_scenarios.mjs

import { test as baseTest, after } from "node:test"; const test = (name, fn) => baseTest(name, { concurrency: false }, fn)
import assert from "node:assert/strict"
import { tmpdir } from "node:os"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"

// ── Test infrastructure ───────────────────────────────────────

const sandboxes = []
function makeSandbox(name) {
  const home = mkdtempSync(join(tmpdir(), `cache-${name}-`))
  sandboxes.push(home)
  mkdirSync(join(home, ".claude/scratch/sessions"), { recursive: true })
  mkdirSync(join(home, ".claude/scratch/by-hash"), { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")
  process.env.VIBEOS_MCP_PORT = "0"
  process.env.VIBEOS_API_URL = "http://127.0.0.1:1"
  process.env.VIBEOS_API_TOKEN = "vos_test_" + Date.now()
  delete globalThis.__vibeOSRuntimeState
  return home
}

function sessionDir(name) {
  const d = join(process.env.HOME, ".claude/scratch/sessions", name)
  mkdirSync(d, { recursive: true })
  return d
}

function stableJson(o) {
  if (o === null || typeof o !== "object") return JSON.stringify(o)
  if (Array.isArray(o)) return "[" + o.map(stableJson).join(",") + "]"
  return "{" + Object.keys(o).sort()
    .map(k => JSON.stringify(k) + ":" + stableJson(o[k]))
    .join(",") + "}"
}

const TOOL_TITLE = {
  read: "Read", bash: "Bash", grep: "Grep", glob: "Glob",
  webfetch: "WebFetch", websearch: "WebSearch", list: "LS",
  "context7_query-docs": "Context7QueryDocs",
  "context7_resolve-library-id": "Context7ResolveLibrary",
  obsidian: "Obsidian",
}

function cacheHash(tool, args) {
  const title = TOOL_TITLE[tool] || (tool.charAt(0).toUpperCase() + tool.slice(1))
  return createHash("sha256").update(`${title}\n${stableJson(args)}\n`).digest("hex").slice(0, 16)
}


function writeCache(sdir, tool, args, content, summary = null) {
  const hash = cacheHash(tool, args)
  writeFileSync(join(sdir, `${hash}.txt`), content)
  if (summary) writeFileSync(join(sdir, `${hash}.summary.txt`), summary)
}

function writePointer(sdir, tool, args, contentHash) {
  const hash = cacheHash(tool, args)
  writeFileSync(join(sdir, `${hash}.ptr`), JSON.stringify({ contentHash }))
  writeFileSync(join(sdir, `${contentHash}.txt`), "pointer-content-" + contentHash)
}

async function importState() {
  // The ?hash ensures a fresh ESM import (avoids Node.js module cache)
  const mod = await import(`../src/lib/state.js?iso=${Date.now()}`)
  return mod
}

function cleanup() {
  for (const h of sandboxes) {
    try { rmSync(h, { recursive: true, force: true }) } catch {}
  }
  sandboxes.length = 0
  delete process.env.VIBEOS_HOME
  delete process.env.VIBEOS_MCP_PORT
  delete process.env.VIBEOS_API_URL
  delete process.env.VIBEOS_API_TOKEN
  delete globalThis.__vibeOSRuntimeState
}

// ── 10 Cache Isolation Scenarios ──────────────────────────────

test("SC1: session A cache NOT visible in session B (direct hash)", async () => {
  const h = makeSandbox("sc1")
  try {
    const sA = sessionDir("sess-A"), sB = sessionDir("sess-B")
    writeCache(sA, "read", { path: "/etc/hostname" }, "A-data")
    const api = await importState()
    assert.equal(api.getScratchpadHit("read", { path: "/etc/hostname" }, sB), null, "B sees A")
    const hit = api.getScratchpadHit("read", { path: "/etc/hostname" }, sA)
    assert.notEqual(hit, null, "A sees itself")
    assert.equal(readFileSync(hit.fullPath,"utf8"), "A-data")
  } finally { cleanup() }
})

test("SC2: pointer files NOT shared across sessions", async () => {
  const h = makeSandbox("sc2")
  try {
    const sA = sessionDir("sess-A"), sB = sessionDir("sess-B")
    writePointer(sA, "glob", { pattern: "*.json" }, "contentHashXYZ")
    const api = await importState()
    assert.equal(api.getScratchpadHit("glob", { pattern: "*.json" }, sB), null, "B sees A pointer")
    assert.notEqual(api.getScratchpadHit("glob", { pattern: "*.json" }, sA), null, "A sees its pointer")
  } finally { cleanup() }
})

test("SC3: summary files session-scoped", async () => {
  const h = makeSandbox("sc3")
  try {
    const sA = sessionDir("sess-A"), sB = sessionDir("sess-B")
    writeCache(sA, "bash", { command: "ls" }, "out-A", "sum-A")
    writeCache(sB, "bash", { command: "ls" }, "out-B", "sum-B")
    const api = await importState()
    const hitA = api.getScratchpadHit("bash", { command: "ls" }, sA)
    assert.notEqual(hitA, null, "A finds own")
    assert.equal(readFileSync(hitA.summaryPath,"utf8"), "sum-A")
    const hitB = api.getScratchpadHit("bash", { command: "ls" }, sB)
    assert.notEqual(hitB, null, "B finds own")
    assert.equal(readFileSync(hitB.summaryPath,"utf8"), "sum-B")
  } finally { cleanup() }
})

test("SC4: project-scoped baseDir shares within project", async () => {
  const h = makeSandbox("sc4")
  try {
    const p1 = sessionDir("projX"), p2 = sessionDir("projX-other"), pY = sessionDir("projY")
    writeCache(p1, "glob", { pattern: "*.ts" }, "projX-data")
    const api = await importState()
    // Same dir (project-scoped baseDir shared across sessions) -> found
    assert.notEqual(api.getScratchpadHit("glob", { pattern: "*.ts" }, p1), null, "projX same dir sees own cache")
    // Different baseDir -> NOT found (session isolation)
    assert.equal(api.getScratchpadHit("glob", { pattern: "*.ts" }, p2), null, "different baseDir does NOT share cache")
    // Different project -> NOT found
    assert.equal(api.getScratchpadHit("glob", { pattern: "*.ts" }, pY), null, "projY does NOT see projX")
  } finally { cleanup() }
})

test("SC4b: session mirror restores hits without cross-session bleed", async () => {
  const h = makeSandbox("sc4b")
  try {
    const sARoot = sessionDir("sess-A")
    const sBRoot = sessionDir("sess-B")
    const sA = join(sARoot, "by-hash")
    const sB = join(sBRoot, "by-hash")
    const api = await importState()
    const tool = "bash"
    const args = { command: "echo hello cache" }
    const hash = cacheHash(tool, args)
    const globalDir = join(h, ".claude/scratch/by-hash")
    writeFileSync(join(globalDir, `${hash}.txt`), "session-A-body")
    writeFileSync(join(globalDir, `${hash}.summary.txt`), "session-A-summary")

    api.safeCopyIntoSession(hash, join(globalDir, `${hash}.txt`), sA)

    const hitA = api.getScratchpadHit(tool, args, sA)
    assert.notEqual(hitA, null, "session A sees its mirrored cache")
    assert.equal(readFileSync(hitA.fullPath, "utf8"), "session-A-body")
    assert.equal(readFileSync(hitA.summaryPath, "utf8"), "session-A-summary")
    assert.equal(api.getScratchpadHit(tool, args, sB), null, "session B does not see session A mirror")
  } finally { cleanup() }
})

test("SC5: old user-wide by-hash dir NOT consulted", async () => {
  const h = makeSandbox("sc5")
  try {
    const globalDir = join(h, ".claude/scratch/by-hash")
    writeFileSync(join(globalDir, `${cacheHash("read", { path: "/etc/profile" })}.txt`), "GLOBAL-ONLY")
    const api = await importState()
    assert.equal(api.getScratchpadHit("read", { path: "/etc/profile" }, sessionDir("sess-A")), null, "found global-only cache")
  } finally { cleanup() }
})

test("SC6: unregistered tool returns null", async () => {
  const h = makeSandbox("sc6")
  try {
    const s = sessionDir("sess-A")
    writeCache(s, "nonexistent_tool_xyz", { x: 1 }, "data")
    const api = await importState()
    assert.equal(api.getScratchpadHit("nonexistent_tool_xyz", { x: 1 }, s), null, "unregistered tool should not produce cache hit")
  } finally { cleanup() }
})

test("SC7: same tool, different args = different entries", async () => {
  const h = makeSandbox("sc7")
  try {
    const s = sessionDir("sess-A")
    writeCache(s, "read", { path: "/a" }, "A-data")
    writeCache(s, "read", { path: "/b" }, "B-data")
    const api = await importState()
    const hitA = api.getScratchpadHit("read", { path: "/a" }, s)
    assert.notEqual(hitA, null); assert.equal(readFileSync(hitA.fullPath,"utf8"), "A-data")
    const hitB = api.getScratchpadHit("read", { path: "/b" }, s)
    assert.notEqual(hitB, null); assert.equal(readFileSync(hitB.fullPath,"utf8"), "B-data")
  } finally { cleanup() }
})

test("SC8: expired cache returns null", async () => {
  const h = makeSandbox("sc8")
  try {
    const s = sessionDir("sess-A")
    const t = "bash", a = { command: "old-cmd" }
    writeCache(s, t, a, "old-data")
    utimesSync(join(s, `${cacheHash(t,a)}.txt`), new Date(Date.now()-2*86400*1000), new Date(Date.now()-2*86400*1000))
    const api = await importState()
    assert.equal(api.getScratchpadHit(t, a, s), null, "returned expired cache")
  } finally { cleanup() }
})

test("SC9: 3 isolated sessions with same tool/args all independent", async () => {
  const h = makeSandbox("sc9")
  try {
    const [s1,s2,s3] = [sessionDir("s1"),sessionDir("s2"),sessionDir("s3")]
    writeCache(s1, "bash", { command: "echo hi" }, "from-s1")
    writeCache(s2, "bash", { command: "echo hi" }, "from-s2")
    writeCache(s3, "bash", { command: "echo hi" }, "from-s3")
    const api = await importState()
    for (const [sd,exp,lab] of [[s1,"from-s1","s1"],[s2,"from-s2","s2"],[s3,"from-s3","s3"]]) {
      const hit = api.getScratchpadHit("bash", { command: "echo hi" }, sd)
      assert.notEqual(hit, null, `${lab} finds cache`)
      assert.equal(readFileSync(hit.fullPath,"utf8"), exp, `${lab} has own content`)
    }
  } finally { cleanup() }
})

test("SC10: pointer in B to session A's content hash does NOT resolve", async () => {
  const h = makeSandbox("sc10")
  try {
    const sA = sessionDir("sess-A"), sB = sessionDir("sess-B")
    const t = "glob", a = { pattern: "*.json" }
    // Write content + pointer into sA
    writeCache(sA, t, a, "only-in-A")
    // Create pointer in sB pointing to a content hash that only exists in sA
    const hash = cacheHash(t, a)
    // Get the real content hash from sA's file
    const sA_files = await import("node:fs").then(m => m.readdirSync(sA))
    const txtFile = sA_files.find(f => f.endsWith(".txt") && !f.includes(".summary"))
    const realContentHash = txtFile ? txtFile.replace(".txt","") : ""
    // Write a pointer in sB that points to sA's content hash
    writeFileSync(join(sB, hash + ".ptr"), JSON.stringify({ contentHash: realContentHash }))
    // Also create a DIFFERENT content file with the same content hash name in sB
    // (simulates a different session having the same tool/args producing the same content hash)
    writeFileSync(join(sB, realContentHash + ".txt"), "SESSION-BS-OWN-DATA")
    const api = await importState()
    // session B SHOULD find its own content via pointer resolution (same dir)
    const hitB = api.getScratchpadHit(t, a, sB)
    assert.notEqual(hitB, null, "B resolves pointer to its own content")
    assert.equal(readFileSync(hitB.fullPath, "utf-8"), "SESSION-BS-OWN-DATA", "B gets its OWN content, not A's")
    // session A also finds its own content
    const hitA = api.getScratchpadHit(t, a, sA)
    assert.notEqual(hitA, null, "A finds its own")
    assert.equal(readFileSync(hitA.fullPath, "utf-8"), "only-in-A", "A gets its own content")
  } finally { cleanup() }
})

// ── Additional: api-client fallback regression ────────────────
test("SC11: setApiToken clears fallback after API failure (regression)", async () => {
  const h = makeSandbox("sc11")
  try {
    const api = await import(`../src/lib/api-client.js?regr=${Date.now()}`)
    assert.equal(api.isApiFallback(), false, "not in fallback initially")
    const r = await api.remoteCall("health", [], () => "fallback")
    assert.equal(r, "fallback"); assert.equal(api.isApiFallback(), true, "in fallback")
    api.setApiToken("vos_fix_token")
    assert.equal(api.isApiFallback(), false, "fallback cleared by setApiToken")
  } finally { cleanup() }
})

test("SC12: syncApiTokenFromDisk else branch clears fallback", async () => {
  const h = makeSandbox("sc12")
  try {
    const api = await import(`../src/lib/api-client.js?regr2=${Date.now()}`)
    await api.remoteCall("health", [], () => "fb")
    assert.equal(api.isApiFallback(), true)
    api.setApiToken(api.VIBEOS_API_TOKEN) // same token — else branch
    assert.equal(api.isApiFallback(), false, "else branch cleared fallback")
  } finally { cleanup() }
})
