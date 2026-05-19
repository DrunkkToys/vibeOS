#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const STATE_FILE = join(homedir(), ".claude", "delegation-state.json")
const LEDGER_FILE = join(homedir(), ".claude", "savings-ledger.jsonl")

function readLedger() {
  if (!existsSync(LEDGER_FILE)) return { delegation: 0, cache: 0, quality: 0, entries: 0 }
  const lines = readFileSync(LEDGER_FILE, "utf-8").split("\n").filter(Boolean)
  let delegation = 0, cache = 0, quality = 0
  for (const line of lines) {
    try {
      const e = JSON.parse(line)
      const kind = String(e.kind || e.type || e.category || e.source || "").toLowerCase()
      const amt = e.amount_usd || 0
      if (kind.includes("quality")) quality++
      else if (kind.includes("cache")) cache += amt
      else delegation += amt
    } catch {}
  }
  return { delegation, cache, quality, entries: lines.length }
}

function readState() {
  if (!existsSync(STATE_FILE)) return { sav: 0, cache: 0, total: 0 }
  const s = JSON.parse(readFileSync(STATE_FILE, "utf-8"))
  const lt = s.lifetime || {}
  return {
    sav: lt.est_savings_usd || 0,
    cache: lt.cache_savings_usd || 0,
    total: (lt.est_savings_usd || 0) + (lt.cache_savings_usd || 0),
  }
}

const ledger = readLedger()
const state = readState()

console.log("=== State Audit ===")
console.log()
console.log("State file (delegation-state.json):")
console.log(`  est_savings_usd:    $${state.sav.toFixed(6)}`)
console.log(`  cache_savings_usd:  $${state.cache.toFixed(6)}`)
console.log()
console.log("Ledger (savings-ledger.jsonl):")
console.log(`  delegation total:   $${ledger.delegation.toFixed(6)}`)
console.log(`  cache total:        $${ledger.cache.toFixed(6)}`)
console.log(`  quality entries:    ${ledger.quality}`)
console.log(`  total entries:      ${ledger.entries}`)
console.log()

const delegDiff = Math.abs(state.sav - ledger.delegation)
if (delegDiff > 0.0005) {
  console.log(`WARN: Delegation discrepancy $${delegDiff.toFixed(6)} (threshold $0.0005)`)
}
const cacheDiff = Math.abs(state.cache - ledger.cache)
if (cacheDiff > 0.0005) {
  console.log(`WARN: Cache discrepancy $${cacheDiff.toFixed(6)} (threshold $0.0005)`)
}
if (delegDiff <= 0.0005 && cacheDiff <= 0.0005) {
  console.log("OK: State and ledger are in sync.")
}
