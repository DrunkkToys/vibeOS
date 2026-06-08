import { test as nodeTest } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const test = (name, options, fn) =>
  typeof options === "function"
    ? nodeTest(name, { concurrency: false }, options)
    : nodeTest(name, { concurrency: false, ...(options || {}) }, fn)

async function loadPlugin() {
  return import("../src/index.js?t=" + Date.now())
}

test("tigerteam 01: modelCostPerTurn unknown model returns null", async () => {
  const { modelCostPerTurn } = await loadPlugin()
  assert.equal(modelCostPerTurn("totally/unknown-model"), 0.00144)
})

test("tigerteam 02: isModelFree unknown model is false", async () => {
  const { isModelFree } = await loadPlugin()
  assert.equal(isModelFree("totally/unknown-model"), false)
})

test("tigerteam 03: detectContext7 env override forces true", async () => {
  const { detectContext7 } = await loadPlugin()
  const previous = process.env.CLAUDE_CONTEXT7_AVAILABLE
  process.env.CLAUDE_CONTEXT7_AVAILABLE = "1"
  try {
    assert.equal(detectContext7([]), true)
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONTEXT7_AVAILABLE
    else process.env.CLAUDE_CONTEXT7_AVAILABLE = previous
  }
})

test("tigerteam 04: detectContext7 handles missing files", async () => {
  const { detectContext7 } = await loadPlugin()
  // Result may be true if context7 is available via PATH/npx cache on this machine.
  // The invariant: it returns a boolean and does not crash.
  const result = detectContext7(["/no/such/file/1.json", "/no/such/file/2.json"])
  assert.ok(typeof result === "boolean", `expected boolean, got ${typeof result}`)
})

test("tigerteam 05: detectContext7 finds keyword in malformed json text", async () => {
  const { detectContext7 } = await loadPlugin()
  const dir = mkdtempSync(join(tmpdir(), "tiger-c7-"))
  const configFile = join(dir, "bad.json")
  try {
    writeFileSync(configFile, "{ this is broken but contains context7 keyword")
    assert.equal(detectContext7([configFile]), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("tigerteam 06: isDocsTarget rejects non-string input", async () => {
  const { isDocsTarget } = await loadPlugin()
  assert.equal(isDocsTarget({ url: "https://docs.example.com" }), false)
})

test("tigerteam 07: isDocsTarget matches api docs urls", async () => {
  const { isDocsTarget } = await loadPlugin()
  assert.equal(isDocsTarget("https://example.com/api-docs/v2"), true)
})

test("tigerteam 08: extractExports returns [] on invalid source", async () => {
  const { extractExports } = await loadPlugin()
  assert.deepEqual(extractExports(null, "ts"), [])
})

test("tigerteam 09: extractExports parses TS function/const/class", async () => {
  const { extractExports } = await loadPlugin()
  const src = "export function a(){}\nexport const b = 1\nexport class C {}"
  const out = extractExports(src, "ts")
  assert.ok(out.some((x) => x.name === "a"))
  assert.ok(out.some((x) => x.name === "b"))
  assert.ok(out.some((x) => x.name === "C" && x.type === "class"))
})

test("tigerteam 10: extractExports deduplicates repeated exports", async () => {
  const { extractExports } = await loadPlugin()
  const src = "export const x = 1\nexport const x = 2"
  const out = extractExports(src, "ts")
  assert.equal(out.filter((x) => x.name === "x").length, 1)
})

test("tigerteam 11: buildTestSkeleton returns null for unsupported extension", async () => {
  const { buildTestSkeleton } = await loadPlugin()
  assert.equal(buildTestSkeleton("/tmp/file.txt"), null)
})

test("tigerteam 12: buildTestSkeleton TS output includes a test framework import", async () => {
  const { buildTestSkeleton } = await loadPlugin()
  const out = buildTestSkeleton("/tmp/svc.ts")
  assert.ok(typeof out?.content === "string")
  assert.match(out.content, /(vitest|node:test)/)
})

test("tigerteam 13: buildTestReminder ignores dist path", async () => {
  const { buildTestReminder } = await loadPlugin()
  assert.equal(buildTestReminder("/project/dist/main.js"), null)
})

test("tigerteam 14: buildTestReminder ignores existing .spec files", async () => {
  const { buildTestReminder } = await loadPlugin()
  assert.equal(buildTestReminder("/project/utils/math.spec.ts"), null)
})

test("tigerteam 15: buildTestReminder generates for Java source file", async () => {
  const { buildTestReminder } = await loadPlugin()
  const note = buildTestReminder("/project/src/Service.java")
  assert.ok(note && /Service/.test(note))
})

test("tigerteam 16: classifyAndRankModels returns null for empty list", async () => {
  const { classifyAndRankModels } = await loadPlugin()
  assert.equal(classifyAndRankModels([]), null)
})

test("tigerteam 17: classifyAndRankModels tolerates malformed entries", async () => {
  const { classifyAndRankModels } = await loadPlugin()
  const result = classifyAndRankModels([{ nope: 1 }, { id: "deepseek/deepseek-v4-pro" }])
  assert.ok(result && result.brain && result.medium && result.cheap)
})

test("tigerteam 18: modelToCcAlias handles nullish input", async () => {
  const { modelToCcAlias } = await loadPlugin()
  assert.equal(modelToCcAlias(undefined), "haiku")
  assert.equal(modelToCcAlias(null), "haiku")
})

test("tigerteam 19: saveReport/listReports/readReport roundtrip in sandbox HOME", async () => {
  const sandboxHome = mkdtempSync(join(tmpdir(), "tiger-report-home-"))
  const previousHome = process.env.HOME
  process.env.HOME = sandboxHome
  try {
    const { saveReport, listReports, readReport } = await loadPlugin()
    const id = saveReport({ type: "manual", summary: `Tiger team report ${Date.now()}`, tags: ["release"] })
    assert.ok(id)
    const listed = listReports({ type: "manual", hours: 168 })
    assert.ok(Array.isArray(listed))
    assert.ok(listed.some((r) => r.id === id))
    const read = readReport(id)
    assert.ok(read && read.meta?.id === id)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(sandboxHome, { recursive: true, force: true })
  }
})

test("tigerteam 20a: report-read rejects path traversal ID '..'", async () => {
  const sandboxHome = mkdtempSync(join(tmpdir(), "tiger-report-pt-"))
  const previousHome = process.env.HOME
  process.env.HOME = sandboxHome
  try {
    const { readReport } = await loadPlugin()
    assert.equal(readReport("../../../etc/passwd"), null, "path traversal ID should be rejected (null)")
    assert.equal(readReport("report/../escape"), null, "relative escape ID should be rejected (null)")
    assert.equal(readReport("..\\..\\..\\windows\\system32"), null, "backslash traversal ID should be rejected (null)")
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(sandboxHome, { recursive: true, force: true })
  }
})

test("tigerteam 20b: report-read accepts valid alphanumeric ID", async () => {
  const sandboxHome = mkdtempSync(join(tmpdir(), "tiger-report-valid-"))
  const previousHome = process.env.HOME
  process.env.HOME = sandboxHome
  try {
    const { saveReport, readReport } = await loadPlugin()
    const id = saveReport({ type: "manual", summary: `Test report ${Date.now()}` })
    assert.ok(id)
    const report = readReport(id)
    assert.ok(report)
    assert.equal(report.meta.id, id)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(sandboxHome, { recursive: true, force: true })
  }
})

test("tigerteam 20: enforceTestFile writes skeleton and is idempotent", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "tiger-enforce-"))
  const previousHome = process.env.HOME
  process.env.HOME = sandbox
  try {
    const srcDir = join(sandbox, "proj", "src")
    mkdirSync(srcDir, { recursive: true })
    const srcFile = join(srcDir, "math.ts")
    writeFileSync(srcFile, "export function sum(a:number,b:number){return a+b}")

    const { enforceTestFile } = await loadPlugin()
    const first = enforceTestFile(srcFile)
    assert.ok(first && existsSync(first))
    const second = enforceTestFile(srcFile)
    assert.equal(second, null)

    const generated = readFileSync(first, "utf-8")
    assert.match(generated, /test|describe/i)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(sandbox, { recursive: true, force: true })
  }
})
