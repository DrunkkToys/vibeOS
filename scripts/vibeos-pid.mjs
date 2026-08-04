#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { execFileSync, execSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const VIBEOS_HOME_DIR = process.env.VIBEOS_HOME || join(homedir(), ".vibeos")

const STATE_FILES = [
  "delegation-state.json",
  "model-tiers.json",
  "savings-ledger.jsonl",
  "active-jobs.json",
  "project-states.json",
  "global-learning.json",
  "credit-snapshot.json",
]

function fail(msg) {
  process.stderr.write(`[vibeos-pid] FAIL: ${msg}\n`)
}

function ok(msg) {
  process.stdout.write(`[vibeos-pid] OK: ${msg}\n`)
}

function log(msg) {
  process.stderr.write(`[vibeos-pid] ${msg}\n`)
}

function warn(msg) {
  process.stderr.write(`[vibeos-pid] WARN: ${msg}\n`)
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function checkmark(v) {
  return v ? "\u2705" : "\u274C"
}

function padEnd(str, len) {
  return str + " ".repeat(Math.max(0, len - str.length))
}

// ── Health Checks ──────────────────────────────────────────────────

function runSyntaxCheck() {
  try {
    execFileSync(process.execPath, ["--check", "dist/vibeOS.js"], { cwd: ROOT, stdio: "pipe" })
    return { status: "pass", output: null }
  } catch (err) {
    return { status: "fail", output: err.stderr?.toString() || err.message }
  }
}

function runTypecheck() {
  try {
    execSync("npm run typecheck", { cwd: ROOT, stdio: "pipe" })
    return { status: "pass", output: null }
  } catch (err) {
    return { status: "fail", output: err.stderr?.toString() || err.message }
  }
}

function runTests() {
  try {
    const out = execSync("npm test", { cwd: ROOT, stdio: "pipe", timeout: 120_000 }).toString()
    const lines = out.split("\n")
    let total = 0, pass = 0, fail = 0, skip = 0, durationMs = 0
    for (const line of lines) {
      const tm = line.match(/# tests (\d+)/)
      if (tm) total = parseInt(tm[1], 10)
      const pm = line.match(/# pass (\d+)/)
      if (pm) pass = parseInt(pm[1], 10)
      const fm = line.match(/# fail (\d+)/)
      if (fm) fail = parseInt(fm[1], 10)
      const sm = line.match(/# skip (\d+)/)
      if (sm) skip = parseInt(sm[1], 10)
      const dm = line.match(/# duration_ms\s*([\d.]+)/)
      if (dm) durationMs = parseFloat(dm[1])
    }
    return { run: true, total, pass, fail, skip, duration_ms: durationMs }
  } catch {
    return { run: true, total: 0, pass: 0, fail: 0, skip: 0, duration_ms: 0 }
  }
}

// ── State File Audit ───────────────────────────────────────────────

function auditStateFiles() {
  const results = {}
  for (const name of STATE_FILES) {
    const p = join(VIBEOS_HOME_DIR, name)
    const entry = { exists: false, valid_json: false, size_bytes: 0, size_human: "0B" }
    if (existsSync(p)) {
      entry.exists = true
      try {
        entry.size_bytes = statSync(p).size
        entry.size_human = formatSize(entry.size_bytes)
      } catch {
        entry.size_bytes = 0
      }
      try {
        const raw = readFileSync(p, "utf-8")
        if (raw.trim().length > 0) {
          if (name.endsWith(".jsonl")) {
            const lines = raw.split("\n").filter((l) => l.trim())
            entry.valid_json = lines.length > 0 && lines.every((l) => {
              try { JSON.parse(l); return true } catch { return false }
            })
          } else {
            JSON.parse(raw)
            entry.valid_json = true
          }
        } else {
          entry.valid_json = true
        }
      } catch {
        entry.valid_json = false
      }
    }
    results[name] = entry
  }

  const reportsDir = join(VIBEOS_HOME_DIR, "reports")
  const reportsEntry = { exists: false, valid_json: false, size_bytes: 0, size_human: "0B" }
  if (existsSync(reportsDir)) {
    reportsEntry.exists = true
    try {
      const st = statSync(reportsDir)
      reportsEntry.size_bytes = st.size
      reportsEntry.size_human = formatSize(st.size)
      reportsEntry.valid_json = true
    } catch {
      reportsEntry.size_bytes = 0
    }
  }
  results["reports/"] = reportsEntry

  return results
}

// ── KPI Extraction ─────────────────────────────────────────────────

function extractKPIs() {
  const delegPath = join(VIBEOS_HOME_DIR, "delegation-state.json")
  const ledgerPath = join(VIBEOS_HOME_DIR, "savings-ledger.jsonl")
  const creditPath = join(VIBEOS_HOME_DIR, "credit-snapshot.json")

  let delegationSav = 0, cacheSav = 0, sessionCount = 0
  let lifetimeWarnCount = 0, activeWarns = 0
  let creditPct = 0, creditRemaining = 0, creditLimit = 0
  let flowWarnsCount = 0, secretsCount = 0

  if (existsSync(delegPath)) {
    try {
      const state = safeJsonParse(readFileSync(delegPath, "utf-8"), {})
      const lt = state.lifetime || {}
      delegationSav = lt.est_savings_usd || 0
      cacheSav = lt.cache_savings_usd || 0
      const sessions = Object.values(state.sessions || {})
      sessionCount = sessions.length
      lifetimeWarnCount = sessions.reduce((sum, s) => sum + (Array.isArray(s.warns) ? s.warns.length : 0), 0)
      const now = Date.now()
      const active = sessions.find((s) => {
        const ts = s.started_at || s.started
        return ts && (now - new Date(ts).getTime()) < 24 * 3600_000
      })
      activeWarns = active && Array.isArray(active.warns) ? active.warns.length : 0
      const flowWarns = Array.isArray(state.flow_warns) ? state.flow_warns : []
      flowWarnsCount = flowWarns.length
      secretsCount = flowWarns.filter((w) => w.rule_id === "detect-secrets").length
    } catch {}
  }

  if (existsSync(creditPath)) {
    try {
      const credit = safeJsonParse(readFileSync(creditPath, "utf-8"), {})
      const tiersPath = join(VIBEOS_HOME_DIR, "model-tiers.json")
      let monthlyBudgetUsd = 50
      if (existsSync(tiersPath)) {
        const tiers = safeJsonParse(readFileSync(tiersPath, "utf-8"), {})
        monthlyBudgetUsd = (tiers.selection && tiers.selection.monthly_budget_usd) || 50
      }
      creditRemaining = credit.total || 0
      creditLimit = monthlyBudgetUsd
      creditPct = creditLimit > 0 ? Math.round((creditRemaining / creditLimit) * 100) : 0
    } catch {}
  }

  let ledgerEntries = 0, delegationLedger = 0, cacheLedger = 0
  let qualityCount = 0

  if (existsSync(ledgerPath)) {
    try {
      const lines = readFileSync(ledgerPath, "utf-8").split("\n").filter(Boolean)
      ledgerEntries = lines.length
      for (const line of lines) {
        try {
          const e = JSON.parse(line)
          const kind = String(e.kind || e.type || e.category || e.source || "").toLowerCase()
          const amt = e.amount_usd || 0
          if (kind.includes("quality")) {
            qualityCount++
          } else if (kind.includes("cache")) {
            cacheLedger += amt
          } else {
            delegationLedger += amt
          }
        } catch {}
      }
    } catch {}
  }

  return {
    all_time_delegation_savings: delegationSav,
    all_time_cache_savings: cacheSav,
    total_savings: delegationSav + cacheSav,
    session_count: sessionCount,
    lifetime_warn_count: lifetimeWarnCount,
    active_session_warnings: activeWarns,
    credit_percentage: creditPct,
    credit_remaining: creditRemaining,
    credit_limit: creditLimit,
    ledger_entry_count: ledgerEntries,
    delegation_from_ledger: delegationLedger,
    cache_from_ledger: cacheLedger,
    quality_entries_count: qualityCount,
    flow_warns_count: flowWarnsCount,
    detected_secrets_count: secretsCount,
  }
}

// ── Discrepancy Detection ──────────────────────────────────────────

function detectDiscrepancies(kpis) {
  const delegDiff = Math.abs(kpis.all_time_delegation_savings - kpis.delegation_from_ledger)
  const cacheDiff = Math.abs(kpis.all_time_cache_savings - kpis.cache_from_ledger)

  return {
    delegation: {
      state: kpis.all_time_delegation_savings,
      ledger: kpis.delegation_from_ledger,
      diff: delegDiff,
      flagged: delegDiff > 0.0005,
    },
    cache: {
      state: kpis.all_time_cache_savings,
      ledger: kpis.cache_from_ledger,
      diff: cacheDiff,
      flagged: cacheDiff > 0.0005,
    },
  }
}

// ── Anomaly Detection ──────────────────────────────────────────────

function detectAnomalies(stateFiles, kpis) {
  const lockDir = join(VIBEOS_HOME_DIR, ".vibeOS-locks")
  const lockFiles = []
  if (existsSync(lockDir)) {
    try {
      const entries = readdirSync(lockDir)
      if (entries.length > 0) entries.forEach((f) => lockFiles.push(f))
    } catch {}
  }

  const staleJobs = []
  const activePath = join(VIBEOS_HOME_DIR, "active-jobs.json")
  if (existsSync(activePath)) {
    try {
      const jobs = safeJsonParse(readFileSync(activePath, "utf-8"), [])
      const list = Array.isArray(jobs) ? jobs : (jobs.jobs || [])
      const now = Date.now()
      for (const job of list) {
        if (job.status === "running" && job.started_at && (now - job.started_at) > 3600_000) {
          staleJobs.push(job.id || job.task_id || "unknown")
        }
      }
    } catch {}
  }

  const largeFiles = []
  const LARGE_THRESHOLD = 500 * 1024
  for (const [name, entry] of Object.entries(stateFiles)) {
    if (entry.exists && entry.size_bytes > LARGE_THRESHOLD) {
      largeFiles.push(`${name} (${formatSize(entry.size_bytes)})`)
    }
  }

  const creditLow = kpis.credit_percentage < 10

  return { lock_files: lockFiles, stale_jobs: staleJobs, large_files: largeFiles, credit_low: creditLow }
}

// ── Status Determination ───────────────────────────────────────────

function determineStatus(health, discrepancies, anomalies, kpis) {
  if (health.syntax_check === "fail" || health.typecheck === "fail") return "fail"
  if (health.tests.run && health.tests.fail > 0) return "fail"
  if (anomalies.lock_files.length > 0) return "warn"
  if (anomalies.stale_jobs.length > 0) return "warn"
  if (anomalies.large_files.length > 0) return "warn"
  if (anomalies.credit_low) return "warn"
  if (discrepancies.delegation.flagged || discrepancies.cache.flagged) return "warn"
  return "healthy"
}

// ── Recommendation ─────────────────────────────────────────────────

function buildRecommendation(status, anomalies, discrepancies) {
  const parts = []
  if (status === "fail") {
    parts.push("Critical failures detected - check health section")
  }
  if (anomalies.stale_jobs.length > 0) {
    parts.push(`${anomalies.stale_jobs.length} stale job(s) - run 'trinity jobs' to inspect`)
  }
  if (anomalies.lock_files.length > 0) {
    parts.push("Lock files present - possible zombie instance")
  }
  if (anomalies.credit_low) {
    parts.push(`Credit critically low (${anomalies.credit_low ? "below 10%" : ""}) - top up recommended`)
  }
  if (anomalies.large_files.length > 0) {
    parts.push(`Large state file(s): ${anomalies.large_files.join(", ")}`)
  }
  if (discrepancies.delegation.flagged || discrepancies.cache.flagged) {
    parts.push("Discrepancy between state and ledger detected")
  }
  if (parts.length === 0) return "All systems nominal"
  return parts.join("; ")
}

// ── One-Shot Diagnostic ────────────────────────────────────────────

function runOnce(opts) {
  const health = {
    syntax_check: runSyntaxCheck().status,
    typecheck: runTypecheck().status,
    tests: { run: false, total: 0, pass: 0, fail: 0, skip: 0, duration_ms: 0 },
  }

  if (opts.test) {
    health.tests = runTests()
  }

  const stateFiles = auditStateFiles()
  const kpis = extractKPIs()
  const discrepancies = detectDiscrepancies(kpis)
  const anomalies = detectAnomalies(stateFiles, kpis)
  const status = determineStatus(health, discrepancies, anomalies, kpis)
  const recommendation = buildRecommendation(status, anomalies, discrepancies)

  const result = {
    timestamp: new Date().toISOString(),
    status,
    health,
    state_files: Object.fromEntries(
      Object.entries(stateFiles).map(([name, entry]) => [join(VIBEOS_HOME_DIR, name), entry])
    ),
    kpis,
    discrepancies,
    anomalies,
    recommendation,
  }

  if (opts.json) {
    if (opts.compact) {
      console.log(JSON.stringify({
        timestamp: result.timestamp,
        status: result.status,
        health: {
          typecheck: result.health.typecheck,
          tests: result.health.tests,
        },
        kpis: result.kpis,
        anomalies: result.anomalies,
        recommendation: result.recommendation,
      }))
    } else {
      console.log(JSON.stringify(result, null, 2))
    }
    process.exit(status === "fail" ? 1 : 0)
  }

  if (!opts.compact) {
    console.log("\n=== vibeOS PID Monitor ===\n")

    console.log("Health Checks:")
    console.log(`  Syntax check:  ${checkmark(health.syntax_check === "pass")} ${health.syntax_check.toUpperCase()}`)
    console.log(`  Typecheck:     ${checkmark(health.typecheck === "pass")} ${health.typecheck.toUpperCase()}`)
    if (opts.test) {
      console.log(`  Tests:         ${health.tests.pass} pass / ${health.tests.fail} fail / ${health.tests.skip} skip${health.tests.duration_ms ? ` (${health.tests.duration_ms}ms)` : ""}`)
    } else {
      console.log(`  Tests:         skipped (use --test to run)`)
    }
    console.log()

    console.log("State Files:")
    for (const [name, entry] of Object.entries(stateFiles)) {
      const p = join(VIBEOS_HOME_DIR, name)
      console.log(`  ${checkmark(entry.exists)} ${p}`)
      if (entry.exists && name !== "reports/") {
        console.log(`    JSON: ${checkmark(entry.valid_json)} ${entry.valid_json ? "valid" : "invalid"}  Size: ${entry.size_human}`)
      } else if (entry.exists) {
        console.log(`    Size: ${entry.size_human}`)
      }
    }
    console.log()

    console.log("KPIs:")
    console.log(`  Delegation savings:  $${kpis.all_time_delegation_savings.toFixed(2)}`)
    console.log(`  Cache savings:       $${kpis.all_time_cache_savings.toFixed(2)}`)
    console.log(`  Total savings:       $${kpis.total_savings.toFixed(2)}`)
    console.log(`  Sessions:            ${kpis.session_count}`)
    console.log(`  Lifetime warns:      ${kpis.lifetime_warn_count}`)
    console.log(`  Active warns:        ${kpis.active_session_warnings}`)
    console.log(`  Credit:              ${kpis.credit_percentage}% ($${kpis.credit_remaining.toFixed(2)} / $${kpis.credit_limit.toFixed(2)})`)
    console.log(`  Ledger entries:      ${kpis.ledger_entry_count}`)
    console.log(`  Quality entries:     ${kpis.quality_entries_count}`)
    console.log(`  Flow warns:          ${kpis.flow_warns_count}`)
    console.log(`  Secrets detected:    ${kpis.detected_secrets_count}`)
    console.log()

    if (discrepancies.delegation.flagged) {
      warn(`Delegation discrepancy: state=$${discrepancies.delegation.state.toFixed(6)} ledger=$${discrepancies.delegation.ledger.toFixed(6)} diff=$${discrepancies.delegation.diff.toFixed(6)}`)
    }
    if (discrepancies.cache.flagged) {
      warn(`Cache discrepancy: state=$${discrepancies.cache.state.toFixed(6)} ledger=$${discrepancies.cache.ledger.toFixed(6)} diff=$${discrepancies.cache.diff.toFixed(6)}`)
    }

    if (anomalies.lock_files.length > 0) {
      warn(`Lock files present: ${anomalies.lock_files.join(", ")}`)
    }
    if (anomalies.stale_jobs.length > 0) {
      warn(`Stale active jobs: ${anomalies.stale_jobs.join(", ")}`)
    }
    if (anomalies.large_files.length > 0) {
      warn(`Large state files: ${anomalies.large_files.join(", ")}`)
    }

    console.log()
  }

  const statusLabel = status === "healthy" ? "HEALTHY" : status === "warn" ? "WARN" : "FAIL"
  const statusIcon = status === "healthy" ? "\u2705" : status === "warn" ? "\u26A0" : "\u274C"
  const testsStr = opts.test
    ? `${health.tests.pass} pass / ${health.tests.fail} fail / ${health.tests.skip} skip`
    : "skipped"
  const savingsStr = `$${kpis.total_savings.toFixed(2)} total ($${kpis.all_time_delegation_savings.toFixed(2)} del + $${kpis.all_time_cache_savings.toFixed(2)} cache)`
  const creditStr = `${kpis.credit_percentage}% ($${kpis.credit_remaining.toFixed(2)} / $${kpis.credit_limit.toFixed(2)})`
  const warnsStr = `${kpis.lifetime_warn_count} lifetime / ${kpis.active_session_warnings} this session`
  const anomalyCount = anomalies.lock_files.length + anomalies.stale_jobs.length + anomalies.large_files.length + (anomalies.credit_low ? 1 : 0)

  const BOX_W = 46
  const boxLine = (label, value) => {
    const line = ` ${label} ${value}`
    return "\u2551" + padEnd(line, BOX_W) + "\u2551"
  }

  console.log("\u2554" + "\u2550".repeat(BOX_W) + "\u2557")
  console.log("\u2551" + padEnd("         vibeOS PID Monitor - Summary        ", BOX_W) + "\u2551")
  console.log("\u2560" + "\u2550".repeat(BOX_W) + "\u2563")
  console.log(boxLine(`Status:   `, `${statusIcon} ${statusLabel}`))
  console.log(boxLine(`Tests:    `, testsStr))
  console.log(boxLine(`Typecheck:`, `${checkmark(health.typecheck === "pass")} ${health.typecheck.toUpperCase()}`))
  console.log(boxLine(`Savings:  `, savingsStr))
  console.log(boxLine(`Credit:   `, creditStr))
  console.log(boxLine(`Warnings: `, warnsStr))
  console.log(boxLine(`Anomalies:`, `${anomalyCount}`))
  console.log("\u2560" + "\u2550".repeat(BOX_W) + "\u2563")
  console.log(boxLine(`Recommendation:`, recommendation))
  console.log("\u255a" + "\u2550".repeat(BOX_W) + "\u255d")

  if (status === "fail") process.exit(1)
}

// ── Watch Mode ─────────────────────────────────────────────────────

function watchMode(opts) {
  let lastCreditPct = null
  let lastMtimes = {}

  function recordMtimes() {
    const mtimes = {}
    for (const name of STATE_FILES) {
      const p = join(VIBEOS_HOME_DIR, name)
      if (existsSync(p)) {
        try {
          mtimes[p] = statSync(p).mtimeMs
        } catch {
          mtimes[p] = 0
        }
      }
    }
    const lockDir = join(VIBEOS_HOME_DIR, ".vibeOS-locks")
    if (existsSync(lockDir)) {
      try {
        mtimes[lockDir] = statSync(lockDir).mtimeMs
      } catch {
        mtimes[lockDir] = 0
      }
    }
    return mtimes
  }

  function detectChanges(current) {
    const changed = []
    for (const [p, mtime] of Object.entries(current)) {
      if (lastMtimes[p] !== undefined && lastMtimes[p] !== mtime) {
        changed.push(p.replace(CLAUDE + "/", ""))
      }
    }
    return changed
  }

  let tickCount = 0
  let timer = null

  function tick() {
    tickCount++
    const stateFiles = auditStateFiles()
    const kpis = extractKPIs()
    const discrepancies = detectDiscrepancies(kpis)
    const anomalies = detectAnomalies(stateFiles, kpis)
    const health = {
      syntax_check: "unchecked",
      typecheck: "unchecked",
      tests: { run: false, total: 0, pass: 0, fail: 0, skip: 0, duration_ms: 0 },
    }
    const status = determineStatus(health, discrepancies, anomalies, kpis)

    const currentMtimes = recordMtimes()
    const changed = tickCount > 1 ? detectChanges(currentMtimes) : []
    lastMtimes = currentMtimes

    let trend = ""
    if (lastCreditPct !== null) {
      trend = kpis.credit_percentage > lastCreditPct ? " \u25B2" : kpis.credit_percentage < lastCreditPct ? " \u25BC" : ""
    }
    lastCreditPct = kpis.credit_percentage

    const now = new Date()
    const ts = now.toTimeString().slice(0, 8)
    const statusLabel = status === "healthy" ? "HEALTHY" : status === "warn" ? "WARN" : "FAIL"

    if (opts.json) {
      const entry = {
        timestamp: now.toISOString(),
        tick: tickCount,
        status,
        kpis,
        credit_trend: trend.replace(" ", ""),
        changed_files: changed,
      }
      console.log(JSON.stringify(entry))
    } else {
      console.log(`[${ts}] model=N/A savings=$${kpis.total_savings.toFixed(2)} warns=${kpis.active_session_warnings} credit=${kpis.credit_percentage}%${trend} status=${statusLabel}`)
      if (changed.length > 0) {
        console.log(`  Changed: ${changed.join(", ")}`)
      }
    }

    if (tickCount === 1 && !opts.compact) {
      console.log(`Watching ${STATE_FILES.length} state files + locks directory... (Ctrl+C to stop)`)
    }
  }

  tick()
  timer = setInterval(tick, 5000)

  process.on("SIGINT", () => {
    clearInterval(timer)
    if (!opts.json && !opts.compact) {
      console.log(`\n[vibeos-pid] Watch stopped after ${tickCount} ticks`)
    }
    process.exit(0)
  })
}

// ── Argument Parsing ───────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  return {
    once: !args.includes("--watch"),
    watch: args.includes("--watch"),
    json: args.includes("--json"),
    test: args.includes("--test"),
    compact: args.includes("--compact"),
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs()

  try {
    if (opts.watch) {
      watchMode(opts)
    } else {
      runOnce(opts)
    }
  } catch (err) {
    fail(`Unexpected error: ${err.message}`)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

export { main }
