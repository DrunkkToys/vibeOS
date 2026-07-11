// SPDX-License-Identifier: MIT
// DEEP TEST 2: TDD enforcer — enforceTestFile, buildTestSkeleton, buildTestReminder
import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const mod = await import("../dist/vibeOS.js")
const { enforceTestFile, buildTestSkeleton, buildTestReminder } = mod

const TMP = join(tmpdir(), "vibeos-tdd-deep-" + Date.now())

test("setup: create temp dir", () => {
  mkdirSync(TMP, { recursive: true })
  assert.ok(existsSync(TMP))
})

test("tdd: enforceTestFile returns string (suggested test path)", () => {
  const srcFile = join(TMP, "src.ts")
  writeFileSync(srcFile, 'export function add(a: number, b: number) { return a + b }\n')
  const result = enforceTestFile(srcFile)
  assert.equal(typeof result, "string", "enforceTestFile returns string")
  assert.ok(result.length > 0, "string is non-empty")
  assert.ok(result.includes("test") || result.includes(".ts") || result.includes(".mjs"),
    "result references a test file path")
})

test("tdd: enforceTestFile suggests .test.mjs path for source file", () => {
  const srcFile = join(TMP, "untested.ts")
  writeFileSync(srcFile, 'export function multiply(a: number, b: number) { return a * b }\n')
  const result = enforceTestFile(srcFile)
  assert.equal(typeof result, "string", "returns string")
  assert.ok(result.includes(".test.") || result.includes("test"),
    "result suggests a test file")
})

test("tdd: buildTestSkeleton with source path returns skeleton object", () => {
  const srcFile = join(TMP, "utils.ts")
  writeFileSync(srcFile, 'export function parse(s: string) { return JSON.parse(s) }\n')
  const skeleton = buildTestSkeleton(srcFile)
  assert.ok(skeleton, "skeleton is truthy")
  assert.equal(typeof skeleton, "object", "skeleton is object")
  assert.ok(skeleton.path, "skeleton has path")
  assert.ok(skeleton.content, "skeleton has content")
  assert.ok(skeleton.dir, "skeleton has dir")
})

test("tdd: buildTestSkeleton content contains test boilerplate", () => {
  const srcFile = join(TMP, "auth.ts")
  writeFileSync(srcFile, 'export function login(u: string, p: string) { return true }\n')
  const skeleton = buildTestSkeleton(srcFile)
  assert.ok(skeleton, "skeleton returned")
  assert.ok(typeof skeleton.content === "string", "content is string")
  assert.ok(skeleton.content.includes("import") || skeleton.content.includes("test") || skeleton.content.includes("TODO"),
    "skeleton content has test boilerplate")
})

test("tdd: buildTestSkeleton returns null for no-arg call", () => {
  const skeleton = buildTestSkeleton()
  assert.equal(skeleton, null, "no-arg returns null")
})

test("tdd: buildTestReminder returns string with test path suggestion", () => {
  const reminder = buildTestReminder("src/utils.ts")
  assert.equal(typeof reminder, "string", "reminder is string")
  assert.ok(reminder.length > 10, "reminder has meaningful content")
  assert.ok(reminder.includes("test"), "reminder mentions test")
})

test("tdd: buildTestReminder includes file reference", () => {
  const reminder = buildTestReminder("src/auth.ts")
  assert.ok(reminder.includes("auth"), "reminder references the source file")
})

test("cleanup: remove temp dir", () => {
  rmSync(TMP, { recursive: true, force: true })
})
