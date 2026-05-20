import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname

const SRC_PY = "def calculate(price, tax):\n    return price * (1 + tax)\n\nclass Cart:\n    def add(self, item):\n        pass\n"
const SRC_TS = "export function handler(req) { return req.body }\nexport const MAX_SIZE = 1024\nexport class Store {\n  get(key) { return this.data.get(key) }\n}\n"

test("scoreStress: local fallback when no token", async () => {
  const { scoreStress } = await import(join(ROOT, "src/index.js"))
  const score = scoreStress("this is broken and useless")
  assert.ok(score > 0, "returns positive score for aggressive text")
  assert.equal(typeof score, "number")
})

test("scoreStress: handles empty/null input gracefully", async () => {
  const { scoreStress } = await import(join(ROOT, "src/index.js"))
  assert.equal(scoreStress(null), 0)
  assert.equal(scoreStress(""), 0)
  assert.equal(scoreStress(undefined), 0)
})

test("scoreStress: short hostile text scores higher than polite long text", async () => {
  const { scoreStress } = await import(join(ROOT, "src/index.js"))
  const hScore = scoreStress("fix this NOW")
  const pScore = scoreStress("when you have a moment could you please look at the import statements")
  assert.ok(hScore > pScore, `hostile=${hScore} > polite=${pScore}`)
})

test("extractExports: local fallback when no token - Python", async () => {
  const { extractExports } = await import(join(ROOT, "src/index.js"))
  const localExports = extractExports(SRC_PY, "py")
  const exports = extractExports(SRC_PY, "py")
  assert.ok(Array.isArray(exports))
  assert.ok(Array.isArray(localExports))
  assert.ok(exports.some(e => e.name === "calculate"))
  assert.ok(exports.some(e => e.name === "Cart" && e.type === "class"))
  assert.equal(exports.length, localExports.length)
})

test("extractExports: local fallback when no token - TypeScript", async () => {
  const { extractExports } = await import(join(ROOT, "src/index.js"))
  const exports = extractExports(SRC_TS, "ts")
  assert.ok(Array.isArray(exports))
  const names = exports.map(e => e.name)
  assert.ok(names.includes("handler"))
  assert.ok(names.includes("MAX_SIZE"))
  assert.ok(names.includes("Store"))
  assert.equal(exports.find(e => e.name === "Store").type, "class")
})

test("extractExports: handles empty source", async () => {
  const { extractExports } = await import(join(ROOT, "src/index.js"))
  assert.equal((extractExports("", "ts")).length, 0)
})

test("buildTestSkeleton: returns correct skeleton for .ts file", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/handler.ts", SRC_TS, { strict: false, quality: false })
  assert.ok(skeleton !== null)
  assert.ok(typeof skeleton.path === "string")
  assert.ok(typeof skeleton.content === "string")
  assert.ok(skeleton.path.includes("handler.test"))
  assert.ok(skeleton.content.length > 0)
})

test("buildTestSkeleton: returns correct skeleton for .py file", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/utils.py", SRC_PY, { strict: false, quality: false })
  assert.ok(skeleton !== null)
  assert.ok(skeleton.path.includes("utils"))
  assert.ok(skeleton.content.includes("calculate") || skeleton.content.includes("Cart"))
})

test("buildTestSkeleton: returns null for unsupported extension", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  assert.equal(buildTestSkeleton("src/data.json", '{"a": 1}', { strict: false, quality: false }), null)
})

test("buildTestSkeleton: returns null for test file path", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/tests/foo.ts", SRC_TS, { strict: false, quality: false })
  assert.equal(skeleton, null)
})

test("buildTestSkeleton: returns null for null input", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  assert.equal(buildTestSkeleton(null), null)
})

test("buildTestSkeleton: strict mode includes fail marker", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/app.ts", SRC_TS, { strict: true, quality: false })
  assert.ok(skeleton !== null)
  const hasFail = skeleton.content.includes("TODO") || skeleton.content.includes("Error") || skeleton.content.includes("fail") || skeleton.content.includes("throw")
  assert.ok(hasFail, "strict skeleton has a fail marker")
})

test("observeToolPattern: does not crash when no token (fire-and-forget)", async () => {
  const { observeToolPattern } = await import(join(ROOT, "src/index.js"))
  assert.doesNotThrow(() => {
    observeToolPattern("write", { args: { filePath: "/tmp/test.ts" } }, { messages: [] }, "/tmp")
  })
})

test("noteProjectPattern: does not crash when no token (fire-and-forget)", async () => {
  const { noteProjectPattern } = await import(join(ROOT, "src/index.js"))
  assert.doesNotThrow(() => {
    noteProjectPattern("friction", "test:key", "Test pattern summary", { family: "test", path: "/tmp" })
  })
})

test("remoteCall: falls back to local when no token", async () => {
  const { remoteCall } = await import(join(ROOT, "src/index.js"))
  assert.equal(await remoteCall("nonexistentMethod", ["arg1"], () => "fallback-ok"), "fallback-ok")
})

test("remoteCall: returns null when no token and no fallback", async () => {
  const { remoteCall } = await import(join(ROOT, "src/index.js"))
  assert.equal(await remoteCall("nonexistentMethod", ["arg1"], null), null)
})

test("all migration exports are functions", async () => {
  const mod = await import(join(ROOT, "src/index.js"))
  assert.equal(typeof mod.scoreStress, "function")
  assert.equal(typeof mod.extractExports, "function")
  assert.equal(typeof mod.buildTestSkeleton, "function")
  assert.equal(typeof mod.enforceTestFile, "function")
  assert.equal(typeof mod.observeToolPattern, "function")
  assert.equal(typeof mod.noteProjectPattern, "function")
  assert.equal(typeof mod.remoteCall, "function")
})



test("enforceTestFile: returns null directly (is synchronous after revert)", async () => {
  const { enforceTestFile } = await import(join(ROOT, "src/index.js"))
  assert.equal(enforceTestFile("src/foo.json"), null)
})
