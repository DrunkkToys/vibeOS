import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname

test("buildTestSkeleton: generates skeleton path for .ts", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/worker.ts", 'export function worker() { return 42 }', { strict: false, quality: false })
  assert.ok(skeleton !== null, "skeleton is not null")
  assert.ok(typeof skeleton.path === "string", "skeleton.path is a string")
  assert.ok(typeof skeleton.content === "string", "skeleton.content is a string")
  assert.ok(skeleton.path.includes("worker.test.ts"), `path contains worker.test.ts: ${skeleton.path}`)
})

test("buildTestSkeleton: generates skeleton for .cjs", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/util.cjs", 'module.exports = { run: () => {} }', { strict: false, quality: false })
  assert.ok(skeleton !== null, "skeleton for cjs")
  assert.ok(typeof skeleton.path === "string", "path is string")
})

test("buildTestSkeleton: generates skeleton for .mts", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/config.mts", 'export const PORT = 3000', { strict: false, quality: false })
  assert.ok(skeleton !== null, "skeleton for mts")
  assert.ok(typeof skeleton.path === "string", "path is string")
})

test("buildTestSkeleton: strict mode includes fail marker", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/app.ts", 'export function app() {}', { strict: true, quality: false })
  assert.ok(skeleton !== null, "skeleton is not null")
  assert.ok(skeleton.content.includes("TODO") || skeleton.content.includes("Error"), "strict skeleton has fail marker")
})

test("buildTestSkeleton: handles Python files", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/main.py", 'def main():\n    pass', { strict: false, quality: false })
  assert.ok(skeleton !== null, "skeleton for python")
  assert.ok(skeleton.path.endsWith(".py"), "python extension")
})

test("buildTestSkeleton: handles Rust files", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/lib.rs", 'pub fn run() {}', { strict: false, quality: false })
  assert.ok(skeleton !== null, "skeleton for rust")
})

test("enforceTestFile: skips null for unsupported extension", async () => {
  const { enforceTestFile } = await import(join(ROOT, "src/index.js"))
  const result = enforceTestFile("src/data.json")
  assert.equal(result, null, "json returns null from enforceTestFile")
})
