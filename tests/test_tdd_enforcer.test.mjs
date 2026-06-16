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
  assert.ok(skeleton.path.includes("worker.test."), `path: ${skeleton.path}`)
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
  assert.ok(typeof skeleton.path === "string" && skeleton.path.length > 0, "python skeleton path valid")
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

// Added in v0.25-phase2a
test("buildTestSkeleton: quality mode includes quality assertions", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/example.ts", "export function calculateTax(income: number): number { return income * 0.2 }", { strict: false, quality: true })
  assert.ok(skeleton !== null, "quality skeleton is not null")
  assert.ok(skeleton.content.includes("expect(result).toBeDefined()"), "quality skeleton has expect assertions")
})

// Added in v0.25-phase2a
test("buildTestSkeleton: quality mode off excludes assertions", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/example2.ts", "export function calculateTax(income: number): number { return income * 0.2 }", { strict: false, quality: false })
  assert.ok(skeleton !== null, "non-quality skeleton is not null")
  assert.ok(!skeleton.content.includes("expect(result).toBeDefined()"), "non-quality skeleton has no quality assertions")
})

// Added in v0.25-phase2a
test("buildTestSkeleton: tsx file generates skeleton", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/component.tsx", "export function Button() {}", { strict: false, quality: false })
  assert.ok(skeleton !== null, "tsx skeleton is not null")
  assert.ok(skeleton.path.includes("component.test"), `tsx path: ${skeleton.path}`)
})

// Added in v0.25-phase2a
test("buildTestSkeleton: jsx file generates skeleton", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/component.jsx", "export function Button() {}", { strict: false, quality: false })
  assert.ok(skeleton !== null, "jsx skeleton is not null")
  assert.ok(skeleton.path.includes("component.test"), `jsx path: ${skeleton.path}`)
})

// Added in v0.25-phase2a
test("buildTestSkeleton: unsupported extension returns null", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/style.css", "", { strict: false, quality: false })
  assert.equal(skeleton, null, "css returns null")
})

// Added in v0.25-phase2a
test("buildTestSkeleton: null/undefined filePath returns null", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  assert.equal(buildTestSkeleton(null), null, "null returns null")
  assert.equal(buildTestSkeleton(undefined), null, "undefined returns null")
})

// Added in v0.25-phase2a
test("buildTestSkeleton: node_modules path is skipped", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const skeleton = buildTestSkeleton("src/node_modules/foo.ts", "", { strict: false, quality: false })
  assert.equal(skeleton, null, "node_modules returns null")
})

// Added in v0.25-phase2a
test("buildTestReminder: returns suggestion for .ts", async () => {
  const { buildTestReminder } = await import(join(ROOT, "src/index.js"))
  const reminder = buildTestReminder("src/reminder-test.ts")
  assert.ok(reminder !== null, "reminder is not null")
  assert.ok(typeof reminder === "string", "reminder is a string")
  assert.ok(reminder.includes("tests/reminder-test"), `reminder: ${reminder}`)
})

// Added in v0.25-phase2a
test("buildTestReminder: returns null for unsupported ext", async () => {
  const { buildTestReminder } = await import(join(ROOT, "src/index.js"))
  const reminder = buildTestReminder("src/config.json")
  assert.equal(reminder, null, "json returns null for buildTestReminder")
})

// Added in v0.25-phase2a
test("buildTestSkeleton: source content with multiple exports", async () => {
  const { buildTestSkeleton } = await import(join(ROOT, "src/index.js"))
  const source = "export function foo() { return 1 }\nexport function bar() { return 2 }"
  const skeleton = buildTestSkeleton("src/multi.ts", source, { strict: false, quality: false })
  assert.ok(skeleton !== null, "multi export skeleton is not null")
  assert.ok(skeleton.content.includes("foo") && skeleton.content.includes("bar"), "both function names appear in skeleton")
})

// Added in v0.25-phase2a
test("enforceTestFile: unsupported ext returns null", async () => {
  const { enforceTestFile } = await import(join(ROOT, "src/index.js"))
  const result = enforceTestFile("src/style.css")
  assert.equal(result, null, "css returns null from enforceTestFile")
})

// Added in v0.25-phase2a
test("enforceTestFile: already-test file returns null", async () => {
  const { enforceTestFile } = await import(join(ROOT, "src/index.js"))
  const result = enforceTestFile("src/util.test.ts")
  assert.equal(result, null, "already-test file returns null")
})
