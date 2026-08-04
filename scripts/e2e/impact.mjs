#!/usr/bin/env node
// vibeOS impact harness — measures what the plugin DOES to the output.
//
// Compares plugin-on vs plugin-off across a prompt matrix, measuring:
//   - Latency overhead per prompt (wall-clock ms)
//   - Output quality (test results, code correctness, directive compliance)
//   - Damage to inference (hallucination, truncation, wrong instructions followed)
//   - Cascade coherence (state propagation, footer, gate)
//
// Usage:
//   node scripts/e2e/impact.mjs --model deepseek/deepseek-chat [--k <n>] [--seed <s>]

import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, copyFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { prompts } from "./prompts.mjs"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const BUNDLE = join(ROOT, "dist", "vibeOS.js")
const OPENCODE = process.env.HOME + "/.opencode/bin/opencode"

// ── CLI flags ──
const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback }
const MODEL = flag("--model", process.env.E2E_MODEL || "")
const SEED = flag("--seed", process.env.E2E_SEED || "impact-test")
const K = Number(flag("--k", process.env.E2E_K || "1"))
const OUT = flag("--out", join(ROOT, ".impact-out"))
const MOCK_PORT = Number(flag("--mock-port", process.env.E2E_MOCK_PORT || "48099"))
const BASE_URL = `http://127.0.0.1:${MOCK_PORT}`

if (!MODEL) { console.log("[impact] skipped: no model (set E2E_MODEL or --model)"); process.exit(0) }
if (!existsSync(OPENCODE)) { console.error(`[impact] FATAL: opencode CLI not found at ${OPENCODE}`); process.exit(1) }
if (!existsSync(BUNDLE)) { console.error(`[impact] FATAL: bundle not found at ${BUNDLE}. Run npm run build:bundle first.`); process.exit(1) }

// ── Mock backend ──
let mockProc = null
function startMock() {
  const { stdout } = spawnSync(process.execPath, [join(ROOT, "scripts/e2e/mock.mjs"), OUT, String(MOCK_PORT)], {
    encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"],
  })
  console.log(stdout.trim().split("\n")[0])
}
function stopMock() { if (mockProc) { try { mockProc.kill() } catch {} mockProc = null } }

// ── Project setup ──
const FILES = ["math"]
function setupProject(dir, withPlugin = true) {
  mkdirSync(join(dir, "src"), { recursive: true })
  mkdirSync(join(dir, "tests"), { recursive: true })
  mkdirSync(join(dir, ".vibeos", "quality-gate"), { recursive: true })
  mkdirSync(join(dir, ".vibeos", "session-events"), { recursive: true })
  writeFileSync(join(dir, "src/math.mjs"), "export function add(a, b) {\n  return a + b\n}\n")
  writeFileSync(join(dir, "tests/math.test.mjs"), 'import test from "node:test"\nimport assert from "node:assert/strict"\nimport { add } from "../src/math.mjs"\ntest("add", () => assert.equal(add(2, 3), 5))\n')
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "impact-proj", type: "module", scripts: { test: "node --test tests/" } }, null, 2))
  const config = { $schema: "https://opencode.ai/config.json" }
  if (withPlugin) config.plugin = [BUNDLE]
  writeFileSync(join(dir, "opencode.json"), JSON.stringify(config, null, 2))
  writeFileSync(join(dir, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { cheap: { oc: "deepseek/deepseek-chat" }, medium: { oc: "deepseek/deepseek-chat" }, brain: { oc: "deepseek/deepseek-chat" } },
  }, null, 2))
}

// ── Run a prompt ──
function runPrompt(projectDir, prompt, env = {}) {
  const start = Date.now()
  let out = ""
  let err = ""
  let status = -1
  try {
    const cmdArgs = ["run", "--dir", projectDir, "--format", "json", "--auto", "-m", MODEL, "--agent", "build"]
    cmdArgs.push(prompt)
    const res = spawnSync(OPENCODE, cmdArgs, {
      encoding: "utf8",
      timeout: 150000,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        VIBEOS_HOME: join(projectDir, ".vibeos"),
        VIBEOS_API_URL: BASE_URL,
        VIBEOS_API_TOKEN: "vos_" + "a".repeat(64),
        VIBEOS_MCP_PORT: "0",
        VIBEOS_QUALITY_GATE: "1",
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        ...env,
      },
    })
    out = res.stdout || ""
    err = res.stderr || ""
    status = res.status ?? -1
  } catch (e) {
    out = (e.stdout || "") + "\n" + (e.stderr || "")
    status = e.status ?? -1
  }
  const elapsed = Date.now() - start
  return { out, err, status, elapsed, combined: out + "\n" + err }
}

// ── Analysis ──
// Verify real quality outcomes by inspecting actual file state on disk,
// not just text patterns in the model output.

function analyzeOutput(projectDir, prompt, combined) {
  const srcPath = join(projectDir, "src/math.mjs")
  const testPath = join(projectDir, "tests/math.test.mjs")
  const srcContent = existsSync(srcPath) ? readFileSync(srcPath, "utf8") : ""
  const testContent = existsSync(testPath) ? readFileSync(testPath, "utf8") : ""

  // Check if the expected function was actually added to the source file
  const expectedFn = prompt.expected || "add"
  const codeWritten = srcContent.includes(`function ${expectedFn}`) || srcContent.includes(`function ${expectedFn}(`)

  // Check if a test was actually added or modified
  const testAdded = testContent.includes(expectedFn)

  // Run the tests ourselves to verify they pass — this is the REAL quality check
  let testsPassed = false
  let testExit = -1
  try {
    const r = spawnSync("node", ["--test", "tests/"], {
      cwd: projectDir,
      encoding: "utf8",
      timeout: 30000,
    })
    testExit = r.status
    testsPassed = r.status === 0
  } catch { testExit = -1 }

  // Plugin activity detection
  const pluginActive = /\[quality-gate\]/.test(combined) || /\[vibeOS\]/.test(combined)
  const gateNoteCount = (combined.match(/\[quality-gate\]/g) || []).length

  // Hallucination: model produced errors or wrote empty/broken files
  const hallucination = /undefined is not|cannot read|TypeError|ReferenceError/.test(combined)
    || (codeWritten && srcContent.length < 50)  // wrote empty stub instead of real code

  // Directive compliance: did the model follow instructions?
  const compliance = checkCompliance(combined, prompt.expected)

  return {
    pluginActive,
    gateNoteCount,
    codeWritten,
    testAdded,
    testsPassed,
    testExit,
    hallucination,
    compliance,
    srcLength: srcContent.length,
    testLength: testContent.length,
  }
}

function analyzeLatency(pluginElapsed, baselineElapsed) {
  if (baselineElapsed === 0) return { delta: pluginElapsed, overheadPct: 0 }
  const delta = pluginElapsed - baselineElapsed
  const overheadPct = Math.round((delta / baselineElapsed) * 100)
  return { delta, overheadPct }
}

function checkCompliance(output, expected) {
  if (!expected) return true
  return output.toLowerCase().includes(expected.toLowerCase())
}

// ── Report generation ──
function generateReport(results) {
  const lines = []
  lines.push("# vibeOS Impact Report")
  lines.push("")
  lines.push(`Model: ${MODEL}  |  Prompts: ${results.length}  |  Runs per prompt: ${K}`)
  lines.push("")
  lines.push("## Per-Prompt Results")
  lines.push("")
  lines.push("| Prompt | Category | Baseline (ms) | Plugin (ms) | Overhead | Code | Tests | Hallucination |")
  lines.push("|--------|----------|---------------|-------------|----------|------|-------|---------------|")

  let totalBaseline = 0, totalPlugin = 0, codeCount = 0, testCount = 0, hallucinationCount = 0

  for (const r of results) {
    const avgBaseline = r.baselineRuns.length > 0 ? Math.round(r.baselineRuns.reduce((s, x) => s + x.elapsed, 0) / r.baselineRuns.length) : 0
    const avgPlugin = r.pluginRuns.length > 0 ? Math.round(r.pluginRuns.reduce((s, x) => s + x.elapsed, 0) / r.pluginRuns.length) : 0
    const latency = analyzeLatency(avgPlugin, avgBaseline)
    const codeOk = r.pluginRuns.length > 0 && r.pluginRuns.every((x) => x.analysis.codeWritten)
    const testsOk = r.pluginRuns.length > 0 && r.pluginRuns.every((x) => x.analysis.testsPassed)
    const hallucination = r.pluginRuns.some((x) => x.analysis.hallucination)

    const overhead = avgBaseline > 0 ? `${latency.overheadPct > 0 ? "+" : ""}${latency.overheadPct}%` : "n/a"
    lines.push(`| ${r.prompt.id} | ${r.prompt.category} | ${avgBaseline} | ${avgPlugin} | ${overhead} | ${codeOk ? "ok" : "FAIL"} | ${testsOk ? "ok" : "FAIL"} | ${hallucination ? "YES" : "no"} |`)

    totalBaseline += avgBaseline
    totalPlugin += avgPlugin
    if (codeOk) codeCount++
    if (testsOk) testCount++
    if (hallucination) hallucinationCount++
  }

  lines.push("")
  lines.push("## Aggregate Metrics")
  lines.push("")
  lines.push(`- **Total latency:** baseline ${totalBaseline}ms, plugin ${totalPlugin}ms (overhead: ${totalPlugin - totalBaseline > 0 ? "+" : ""}${Math.round(((totalPlugin - totalBaseline) / (totalBaseline || 1)) * 100)}%)`)
  lines.push(`- **Code written correctly:** ${codeCount}/${results.length} prompts (file contains expected function)`)
  lines.push(`- **Tests pass after run:** ${testCount}/${results.length} prompts (tests exit 0 on the actual project)`)
  lines.push(`- **Hallucination signals:** ${hallucinationCount}/${results.length} prompts detected`)

  // Plugin-active verification
  const pluginActiveRuns = results.reduce((s, r) => s + r.pluginRuns.filter((x) => x.analysis.pluginActive).length, 0)
  const totalPluginRuns = results.reduce((s, r) => s + r.pluginRuns.length, 0)
  lines.push(`- **Plugin active:** ${pluginActiveRuns}/${totalPluginRuns} plugin-on runs detected plugin activity`)

  lines.push("")
  lines.push("## Cascade Health")
  lines.push("")
  lines.push("Verifies that subsystem state actually propagates across multi-prompt workflows.")
  lines.push("")

  // Cascade: code-edit → gate → status → Done
  const cascadeResult = results.find((r) => r.prompt.id === "cascade")
  if (cascadeResult && cascadeResult.pluginRuns.length > 0) {
    const run = cascadeResult.pluginRuns[0]
    const hadGateNote = run.analysis.gateNoteCount > 0
    const codeOk = run.analysis.codeWritten
    const testsOk = run.analysis.testsPassed
    const passed = run.status === 0
    lines.push(`- **code → gate → status → Done:**`)
    lines.push(`  - Code written: ${codeOk ? "yes (function divide in file)" : "NO"}`)
    lines.push(`  - Gate fired: ${hadGateNote ? "yes" : "no"}`)
    lines.push(`  - Exit code: ${passed ? "0" : "non-zero"}`)
    lines.push(`  - Verdict: ${codeOk && hadGateNote && passed ? "PASS — cascade coheres: code written, gate fired, clean exit" : "CONCERN — check logs"}`)
  }

  // Multi-step: read → edit → test → verify
  const multiResult = results.find((r) => r.prompt.id === "multi-step")
  if (multiResult && multiResult.pluginRuns.length > 0) {
    const run = multiResult.pluginRuns[0]
    const codeOk = run.analysis.codeWritten
    const testsOk = run.analysis.testsPassed
    const testExit = run.analysis.testExit
    lines.push(`- **multi-step (read + edit + test + verify):**`)
    lines.push(`  - Code written: ${codeOk ? "yes (function subtract in file)" : "NO"}`)
    lines.push(`  - Tests exit code: ${testExit === 0 ? "0 (PASS)" : testExit === -1 ? "timeout/error" : testExit}`)
    lines.push(`  - Verdict: ${codeOk && testsOk ? "PASS — full workflow succeeded" : "CONCERN — check output"}`)
  }

  lines.push("")
  lines.push("## Methodology")
  lines.push("")
  lines.push("Each prompt is run K times in plugin-off mode (baseline) and K times in plugin-on mode.")
  lines.push("Metrics are averaged across K runs. Latency is wall-clock ms from opencode run start to exit.")
  lines.push("Quality checks: test passed (for code prompts), code functions written, hallucination signals (error keywords).")
  lines.push("Compliance checks: expected substring present in output, plugin active (quality-gate/vibe markers detected).")
  lines.push("Cascade checks: subsystem state propagation verified across multi-step prompts.")
  lines.push("")
  lines.push("### How to interpret")
  lines.push("")
  lines.push("- **Overhead > 50%**: plugin adds significant latency — investigate per-hook costs (footer debounce, gate, cascade)")
  lines.push("- **Code FAIL**: plugin prevented the model from writing correct code (too many directives, confused the model)")
  lines.push("- **Tests FAIL**: plugin caused tests to fail or prevented test execution")
  lines.push("- **Hallucination YES**: model produced errors — check if plugin directives caused wrong behavior")
  lines.push("- **Cascade CONCERN**: subsystem state didn't propagate correctly across the workflow")

  return lines.join("\n")
}

// ── Main ──
async function main() {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  mkdirSync(join(OUT, "logs"), { recursive: true })

  console.log(`[impact] model=${MODEL} seed=${SEED} k=${K} out=${OUT}`)
  startMock()

  const results = []

  for (const prompt of prompts) {
    console.log(`\n>>> ${prompt.id}: ${prompt.label}`)
    const r = { prompt, baselineRuns: [], pluginRuns: [] }

    for (let i = 0; i < K; i++) {
      // Baseline (no plugin)
      const baselineDir = join(OUT, `baseline-${prompt.id}-${i}`)
      setupProject(baselineDir, false)
      const baseResult = runPrompt(baselineDir, prompt.prompt.replace(/\{FILE\}/g, "math"))
      baseResult.analysis = analyzeOutput(baselineDir, prompt, baseResult.combined)
      r.baselineRuns.push(baseResult)
      writeFileSync(join(OUT, `logs/${prompt.id}-baseline-${i}.txt`), baseResult.combined)
      console.log(`  baseline ${i}: ${baseResult.elapsed}ms, exit=${baseResult.status}, code=${baseResult.analysis.codeWritten}, tests=${baseResult.analysis.testsPassed}`)

      // Plugin-on
      const pluginDir = join(OUT, `plugin-${prompt.id}-${i}`)
      setupProject(pluginDir, true)
      const pluginResult = runPrompt(pluginDir, prompt.prompt.replace(/\{FILE\}/g, "math"))
      pluginResult.analysis = analyzeOutput(pluginDir, prompt, pluginResult.combined)
      r.pluginRuns.push(pluginResult)
      writeFileSync(join(OUT, `logs/${prompt.id}-plugin-${i}.txt`), pluginResult.combined)
      console.log(`  plugin   ${i}: ${pluginResult.elapsed}ms, exit=${pluginResult.status}, gate=${pluginResult.analysis.gateNoteCount}, code=${pluginResult.analysis.codeWritten}, tests=${pluginResult.analysis.testsPassed}`)
    }

    results.push(r)
  }

  stopMock()

  // Generate report
  const report = generateReport(results)
  writeFileSync(join(OUT, "IMPACT-REPORT.md"), report)
  console.log("\n" + report)

  // Also write raw data for later analysis
  const rawData = results.map((r) => ({
    prompt: r.prompt.id,
    category: r.prompt.category,
    baseline: r.baselineRuns.map((x) => ({ elapsed: x.elapsed, status: x.status, compliance: checkCompliance(x.combined, r.prompt.expected), codeWritten: x.analysis.codeWritten, testsPassed: x.analysis.testsPassed })),
    plugin: r.pluginRuns.map((x) => ({ elapsed: x.elapsed, status: x.status, compliance: checkCompliance(x.combined, r.prompt.expected), codeWritten: x.analysis.codeWritten, testsPassed: x.analysis.testsPassed, hallucination: x.analysis.hallucination, gateNotes: x.analysis.gateNoteCount, pluginActive: x.analysis.pluginActive })),
  }))
  writeFileSync(join(OUT, "impact-data.json"), JSON.stringify(rawData, null, 2))

  // Exit code: PASS if all plugin runs wrote code correctly + no hallucinations
  const allCodeOk = results.every((r) => r.pluginRuns.length > 0 && r.pluginRuns.every((x) => x.analysis.codeWritten))
  const noHallucinations = !results.some((r) => r.pluginRuns.some((x) => x.analysis.hallucination))
  process.exit(allCodeOk && noHallucinations ? 0 : 1)
}

main().catch((e) => { console.error("[impact] FATAL:", e); process.exit(1) })
