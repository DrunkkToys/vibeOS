#!/usr/bin/env node
// End-to-end TDD enforcement test for theSaver
// Tests: extractExports, buildTestSkeleton, enforceTestFile, dedup, multi-language

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { strict as assert } from 'node:assert'

const sb = mkdtempSync(join(tmpdir(), "tdd-e2e-"))
const CLAUSE = join(sb, ".claude")
const SCRATCH = join(CLAUSE, "scratch")
mkdirSync(SCRATCH, { recursive: true })
mkdirSync(join(sb, "proj/src"), { recursive: true })

const prevHome = process.env.HOME
process.env.HOME = sb

// Clear any lock state
const lockDir = join(CLAUSE, ".enforcement-lock")
mkdirSync(lockDir, { recursive: true })

console.log(`[sandbox] ${sb}`)

// Load plugin fresh
const mod = await import(`file://${process.cwd()}/src/index.js?t=${Date.now()}`)
const { extractExports, buildTestSkeleton, enforceTestFile } = mod

let passed = 0
let failed = 0
let total = 0

function test(name, fn) {
  total++
  try {
    fn()
    passed++
    console.log(`  ✅ ${name}`)
  } catch (e) {
    failed++
    console.log(`  ❌ ${name}: ${e.message}`)
    console.log(`     ${e.stack.split('\n')[1]}`)
  }
}

// ── extractExports ──────────────────────────────────────────────────────────

console.log("\n── extractExports ──")

test("Python: extracts def and class", () => {
  const src = `
def snake_case(name): pass
def truncate(s, max_len=80): pass
class StringHelper: pass
def _private(): pass
`
  const ex = extractExports(src, "py")
  assert.strictEqual(ex.length, 3, `got ${ex.length} exports: ${JSON.stringify(ex)}`)
  assert.strictEqual(ex[0].name, "snake_case")
  assert.strictEqual(ex[0].type, "function")
  assert.strictEqual(ex[2].name, "StringHelper")
  assert.strictEqual(ex[2].type, "class")
})

test("Python: empty source returns []", () => {
  const ex = extractExports("", "py")
  assert.deepStrictEqual(ex, [])
})

test("TypeScript: extracts export function and const", () => {
  const src = `export function handle(req: Request): Response {}\nexport const VERSION = "1.0"`
  const ex = extractExports(src, "ts")
  assert.strictEqual(ex.length, 2)
  assert.strictEqual(ex[0].name, "handle")
  assert.strictEqual(ex[1].name, "VERSION")
})

test("TypeScript: extracts export class", () => {
  const src = `export class MyService { run() {} }`
  const ex = extractExports(src, "ts")
  assert.strictEqual(ex.length, 1)
  assert.strictEqual(ex[0].name, "MyService")
  assert.strictEqual(ex[0].type, "class")
})

test("Go: extracts exported funcs", () => {
  const src = `func StartServer() {}\nfunc (s *Server) HandleRequest() {}\nfunc internal() {}`
  const ex = extractExports(src, "go")
  assert.strictEqual(ex.length, 2)
  assert.strictEqual(ex[0].name, "StartServer")
  assert.strictEqual(ex[1].name, "HandleRequest")
})

test("Rust: extracts pub fn and pub struct", () => {
  const src = `pub fn parse(s: &str) -> Result {}\npub struct Parser {}\nfn private() {}`
  const ex = extractExports(src, "rs")
  assert.strictEqual(ex.length, 2)
  assert.strictEqual(ex[0].name, "parse")
  assert.strictEqual(ex[1].name, "Parser")
  assert.strictEqual(ex[1].type, "struct")
})

test("JavaScript: extracts export function and const", () => {
  const src = `export function greet(name) {}\nexport const PI = 3.14`
  const ex = extractExports(src, "js")
  assert.strictEqual(ex.length, 2)
  assert.strictEqual(ex[0].name, "greet")
  assert.strictEqual(ex[1].name, "PI")
})

test("Ruby: extracts def and class", () => {
  const src = `class Greeter\n  def hello(name); end\n  def self.goodbye; end\nend`
  const ex = extractExports(src, "rb")
  assert.ok(ex.length >= 2)
  assert.ok(ex.some(e => e.name === "hello"))
  assert.ok(ex.some(e => e.name === "goodbye"))
})

test("Shell: extracts functions", () => {
  const src = `deploy() { echo deploy; }\nfunction cleanup { echo cleanup; }`
  const ex = extractExports(src, "sh")
  assert.strictEqual(ex.length, 2)
  assert.strictEqual(ex[0].name, "deploy")
  assert.strictEqual(ex[1].name, "cleanup")
})

test("Java/Kotlin: extracts methods", () => {
  const src = `public void doStuff() {}\nprivate String getName() {}`
  const ex = extractExports(src, "java")
  assert.strictEqual(ex.length, 2)
  assert.strictEqual(ex[0].name, "doStuff")
  assert.strictEqual(ex[1].name, "getName")
})

test("Kotlin: extracts fun", () => {
  const src = `fun calculate(x: Int): Int { return x * 2 }`
  const ex = extractExports(src, "kt")
  assert.strictEqual(ex.length, 1)
  assert.strictEqual(ex[0].name, "calculate")
})

// ── buildTestSkeleton ───────────────────────────────────────────────────────

console.log("\n── buildTestSkeleton ──")

test("Python: generates test path and imports exports", () => {
  const src = `def add(a, b): return a + b\ndef sub(a, b): return a - b`
  const s = buildTestSkeleton("/proj/src/calc.py", src)
  assert.ok(s)
  assert.ok(s.path.endsWith("tests/test_calc.py"))
  assert.ok(s.content.includes("from calc import add, sub"))
  assert.ok(s.content.includes("test_add_works_correctly_with_typical_valid_input"))
  assert.ok(s.content.includes("test_sub_works_correctly_with_typical_valid_input"))
})

test("Python: no exports → placeholder", () => {
  const s = buildTestSkeleton("/proj/src/empty.py", "")
  assert.ok(s)
  assert.ok(s.content.includes("raise AssertionError"))
})

test("TypeScript: generates .test.ts with exports", () => {
  const src = `export function run() {}`
  const s = buildTestSkeleton("/proj/src/runner.ts", src)
  assert.ok(s)
  assert.ok(s.path.endsWith("tests/runner.test.ts"))
  assert.ok(s.content.includes("import * as mod from '../runner'"))
  assert.ok(s.content.includes("run: works correctly with typical valid input"))
})

test("Go: generates _test.go with exports", () => {
  const src = `func Start() {}`
  const s = buildTestSkeleton("/proj/src/server.go", src)
  assert.ok(s)
  assert.ok(s.path.endsWith("server_test.go"))
  assert.ok(s.content.includes("TestServer_Start_works_correctly_with_typical_valid_input"))
})

test("Rust: generates _test.rs with exports", () => {
  const src = `pub fn parse() {}`
  const s = buildTestSkeleton("/proj/src/lib.rs", src)
  assert.ok(s)
  assert.ok(s.path.endsWith("tests/lib_test.rs"))
  assert.ok(s.content.includes("test_parse_works_correctly_with_typical_valid_input"))
})

test("Ruby: generates _test.rb with exports", () => {
  const src = `class Greeter\n  def hello; end\nend`
  const s = buildTestSkeleton("/proj/src/greeter.rb", src)
  assert.ok(s)
  assert.ok(s.path.endsWith("test/greeter_test.rb"))
  assert.ok(s.content.includes("def test_hello_works_correctly_with_typical_valid_input"))
})

test("Shell: generates test_.sh with exports", () => {
  const src = `deploy() { echo deploy; }`
  const s = buildTestSkeleton("/proj/src/deploy.sh", src)
  assert.ok(s)
  assert.ok(s.path.endsWith("tests/test_deploy.sh"))
  assert.ok(s.content.includes("test_deploy_works_correctly_with_typical_valid_input"))
})

test("JSX/TSX: delegates to JS/TS generators", () => {
  const src = `export function Component() {}`
  const jsx = buildTestSkeleton("/proj/src/App.jsx", src)
  const tsx = buildTestSkeleton("/proj/src/App.tsx", src)
  assert.ok(jsx)
  assert.ok(tsx)
  assert.ok(jsx.content.includes("Component: works correctly with typical valid input"))
  assert.ok(tsx.content.includes("Component: works correctly with typical valid input"))
})

test("Java: generates Test.java with exports", () => {
  const src = `public void doStuff() {}`
  const s = buildTestSkeleton("/proj/src/service.java", src)
  assert.ok(s)
  assert.ok(s.path.endsWith("src/test/ServiceTest.java"))
  assert.ok(s.content.includes("testDoStuff_works_correctly_with_typical_valid_input"))
})

test("Kotlin: generates Test.kt with exports", () => {
  const src = `fun add(a: Int, b: Int): Int = a + b`
  const s = buildTestSkeleton("/proj/src/calculator.kt", src)
  assert.ok(s)
  assert.ok(s.path.endsWith("src/test/CalculatorTest.kt"))
  assert.ok(s.content.includes("testAdd_works_correctly_with_typical_valid_input"))
})

test("Kotlin: generates Test.kt with exports (calculate)", () => {
  const src = `fun calculate(x: Int): Int { return x * 2 }`
  const s = buildTestSkeleton("/proj/src/calculator.kt", src)
  assert.ok(s)
  assert.ok(s.path.endsWith("src/test/CalculatorTest.kt"))
  assert.ok(s.content.includes("testCalculate_works_correctly_with_typical_valid_input"))
})

test("Unsupported extension → null", () => {
  const s = buildTestSkeleton("/proj/src/data.json", "")
  assert.strictEqual(s, null)
})

test("test file itself → null", () => {
  const s = buildTestSkeleton("/proj/src/tests/test_calc.py", "")
  assert.strictEqual(s, null)
})

test("node_modules path → null", () => {
  const s = buildTestSkeleton("/proj/node_modules/pkg/index.js", "")
  assert.strictEqual(s, null)
})

// ── enforceTestFile (on disk) ───────────────────────────────────────────────

console.log("\n── enforceTestFile (on disk) ──")

test("creates skeleton with exports on disk", () => {
  const dir = join(sb, "proj/src")
  const srcFile = join(dir, "math.py")
  writeFileSync(srcFile, "def add(a, b): return a + b\ndef mul(a, b): return a * b")
  const created = enforceTestFile(srcFile)
  assert.ok(created, "returned path")
  assert.ok(existsSync(created), "file exists on disk")
  const content = readFileSync(created, "utf-8")
  assert.ok(content.includes("[theSaver-enforced]"))
  assert.ok(content.includes("from math import add, mul"))
  assert.ok(content.includes("test_add_works_correctly_with_typical_valid_input"))
  assert.ok(content.includes("test_mul_works_correctly_with_typical_valid_input"))
  assert.ok(content.includes("test_math_smoke"))
})

test("dedup: second call does NOT create another file", () => {
  const dir = join(sb, "proj/src")
  const srcFile = join(dir, "math.py")
  writeFileSync(srcFile, "def add(a, b): return a + b\ndef div(a, b): return a / b")
  const created = enforceTestFile(srcFile)
  assert.strictEqual(created, null, "should not create duplicate")
})

test("creates skeleton for TypeScript", () => {
  const dir = join(sb, "proj/src")
  const srcFile = join(dir, "handler.ts")
  writeFileSync(srcFile, "export function handle(req: Request): Response {}\nexport const VERSION = '1.0'")
  const created = enforceTestFile(srcFile)
  assert.ok(created, "returned path")
  assert.ok(existsSync(created), "file exists on disk")
  const content = readFileSync(created, "utf-8")
  assert.ok(content.includes("import * as mod from '../handler'"))
  assert.ok(content.includes("handle: works correctly with typical valid input"))
  assert.ok(content.includes("VERSION: works correctly with typical valid input"))
})

test("creates skeleton for Go", () => {
  const dir = join(sb, "proj/src")
  const srcFile = join(dir, "server.go")
  writeFileSync(srcFile, "func StartServer() {}\nfunc (s *Server) HandleRequest() {}")
  const created = enforceTestFile(srcFile)
  assert.ok(created, "returned path")
  assert.ok(existsSync(created), "file exists on disk")
  const content = readFileSync(created, "utf-8")
  assert.ok(content.includes("TestServer_StartServer_works_correctly_with_typical_valid_input"))
  assert.ok(content.includes("TestServer_HandleRequest_works_correctly_with_typical_valid_input"))
})

test("creates skeleton for Rust", () => {
  const dir = join(sb, "proj/src")
  const srcFile = join(dir, "parser.rs")
  writeFileSync(srcFile, "pub fn parse(s: &str) -> Result<String, Error> { Ok(s.to_string()) }")
  const created = enforceTestFile(srcFile)
  assert.ok(created, "returned path")
  assert.ok(existsSync(created), "file exists on disk")
  const content = readFileSync(created, "utf-8")
  assert.ok(content.includes("test_parse_works_correctly_with_typical_valid_input"))
})

test("creates skeleton for Ruby", () => {
  const dir = join(sb, "proj/src")
  const srcFile = join(dir, "greeter.rb")
  writeFileSync(srcFile, "class Greeter\n  def hello(name); end\n  def goodbye; end\nend")
  const created = enforceTestFile(srcFile)
  assert.ok(created, "returned path")
  assert.ok(existsSync(created), "file exists on disk")
  const content = readFileSync(created, "utf-8")
  assert.ok(content.includes("def test_hello_works_correctly_with_typical_valid_input"))
  assert.ok(content.includes("def test_goodbye_works_correctly_with_typical_valid_input"))
})

test("creates skeleton for Shell", () => {
  const dir = join(sb, "proj/src")
  const srcFile = join(dir, "deploy.sh")
  writeFileSync(srcFile, 'deploy() { echo "deploying"; }\nrollback() { echo "rolling back"; }')
  const created = enforceTestFile(srcFile)
  assert.ok(created, "returned path")
  assert.ok(existsSync(created), "file exists on disk")
  const content = readFileSync(created, "utf-8")
  assert.ok(content.includes("test_deploy_works_correctly_with_typical_valid_input"))
  assert.ok(content.includes("test_rollback_works_correctly_with_typical_valid_input"))
})

test("creates skeleton for JavaScript (ESM)", () => {
  const dir = join(sb, "proj/src")
  const srcFile = join(dir, "utils.mjs")
  writeFileSync(srcFile, "export function format(s) { return s.trim() }\nexport const MAX_LEN = 80")
  const created = enforceTestFile(srcFile)
  assert.ok(created, "returned path")
  assert.ok(existsSync(created), "file exists on disk")
  const content = readFileSync(created, "utf-8")
  assert.ok(content.includes("import * as mod from '../utils'"))
  assert.ok(content.includes("format: works correctly with typical valid input"))
  assert.ok(content.includes("MAX_LEN: works correctly with typical valid input"))
})

test("creates skeleton for JSX", () => {
  const dir = join(sb, "proj/src")
  const srcFile = join(dir, "Button.jsx")
  writeFileSync(srcFile, "export function Button({ label }) { return <button>{label}</button> }")
  const created = enforceTestFile(srcFile)
  assert.ok(created, "returned path")
  assert.ok(existsSync(created), "file exists on disk")
  const content = readFileSync(created, "utf-8")
  assert.ok(content.includes("Button: works correctly with typical valid input"))
})

test("creates skeleton for TSX", () => {
  const dir = join(sb, "proj/src")
  const srcFile = join(dir, "Card.tsx")
  writeFileSync(srcFile, "export function Card({ title }: { title: string }) { return <div>{title}</div> }")
  const created = enforceTestFile(srcFile)
  assert.ok(created, "returned path")
  assert.ok(existsSync(created), "file exists on disk")
  const content = readFileSync(created, "utf-8")
  assert.ok(content.includes("Card: works correctly with typical valid input"))
})

test("creates skeleton for Java", () => {
  const dir = join(sb, "proj/src")
  const srcFile = join(dir, "Service.java")
  writeFileSync(srcFile, "public class Service { public void run() {} }")
  const created = enforceTestFile(srcFile)
  assert.ok(created, "returned path")
  assert.ok(existsSync(created), "file exists on disk")
  const content = readFileSync(created, "utf-8")
  assert.ok(content.includes("testRun_works_correctly_with_typical_valid_input"))
})

test("creates skeleton for Kotlin", () => {
  const dir = join(sb, "proj/src")
  const srcFile = join(dir, "Calculator.kt")
  writeFileSync(srcFile, "fun add(a: Int, b: Int): Int = a + b")
  const created = enforceTestFile(srcFile)
  assert.ok(created, "returned path")
  assert.ok(existsSync(created), "file exists on disk")
  const content = readFileSync(created, "utf-8")
  assert.ok(content.includes("testAdd_works_correctly_with_typical_valid_input"))
})

test("tdd_enforced counter increments in state file", () => {
  const stateFile = join(CLAUSE, "delegation-state.json")
  assert.ok(existsSync(stateFile), "state file exists")
  const state = JSON.parse(readFileSync(stateFile, "utf-8"))
  assert.ok(state.lifetime.tdd_enforced > 0, `tdd_enforced = ${state.lifetime.tdd_enforced}`)
})

// ── Edge cases ──────────────────────────────────────────────────────────────

console.log("\n── Edge cases ──")

test("source file doesn't exist yet → still creates skeleton", () => {
  const dir = join(sb, "proj/src")
  const srcFile = join(dir, "future.py")
  // Don't write the file
  const created = enforceTestFile(srcFile)
  assert.ok(created, "returned path")
  assert.ok(existsSync(created), "test file exists even without source")
})

test("empty file → no exports → placeholder", () => {
  const dir = join(sb, "proj/src")
  const srcFile = join(dir, "empty.go")
  writeFileSync(srcFile, "")
  const created = enforceTestFile(srcFile)
  assert.ok(created, "returned path")
  const content = readFileSync(created, "utf-8")
  assert.ok(content.includes("t.Error"), "has strict marker")
})

test("private functions not extracted (Go)", () => {
  const src = `func StartServer() {}\nfunc internalHelper() {}`
  const ex = extractExports(src, "go")
  assert.strictEqual(ex.length, 1)
  assert.strictEqual(ex[0].name, "StartServer")
})

test("multiple functions with same name → dedup", () => {
  const src = `def foo(): pass\ndef foo(): pass`
  const ex = extractExports(src, "py")
  assert.strictEqual(ex.length, 1)
})

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n── Results: ${passed}/${total} passed, ${failed} failed ──`)

// Cleanup
process.env.HOME = prevHome
rmSync(sb, { recursive: true, force: true })

process.exit(failed > 0 ? 1 : 0)
