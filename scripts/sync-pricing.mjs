#!/usr/bin/env node
//
// sync-pricing.mjs — fetch current per-token pricing from OpenRouter
// and write the merged cache to ~/.vibeos/model-pricing-cache.json.
//
// Run before every release to ensure the plugin has fresh fallback data.
// Also updates the hardcoded MODEL_USD_PER_TURN entries in src/index.ts
// for models that have changed by more than 5%.
//

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const CACHE_PATH = join(homedir(), ".vibeos", "model-pricing-cache.json")
const INDEX_PATH = join(ROOT, "src", "index.ts")

const TURN_INPUT = 700
const TURN_OUTPUT = 300

// ── Key models to track ──────────────────────────────────────────
const TRACKED = new Set([
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "anthropic/claude-opus-4-7",
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "openai/o3",
  "openai/o4-mini",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "google/gemini-2.0-flash",
])
// Note: deepseek-chat, deepseek-reasoner, deepseek-r1, deepseek-v3
// are NOT tracked by OpenRouter sync because they are DeepSeek API
// aliases whose actual billing matches deepseek-v4-flash pricing
// (see https://api-docs.deepseek.com/quick_start/pricing).

function log(msg) { process.stderr.write(`[sync-pricing] ${msg}\n`) }

// ── Fetch OpenRouter pricing ─────────────────────────────────────
async function fetchOpenRouter() {
  log("fetching from OpenRouter /api/v1/models ...")
  const res = await fetch("https://openrouter.ai/api/v1/models")
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const models = Array.isArray(data) ? data : (data.data || [])
  const map = {}
  for (const m of models) {
    const id = (m.id || "").toLowerCase()
    const p = m.pricing || {}
    const prompt = parseFloat(p.prompt || "0") || 0
    const completion = parseFloat(p.completion || "0") || 0
    const turn = prompt * TURN_INPUT + completion * TURN_OUTPUT
    map[id] = Number(turn.toFixed(8))
  }
  log(`got ${Object.keys(map).length} models from OpenRouter`)
  return map
}

// ── Write cache ──────────────────────────────────────────────────
function writeCache(map) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true })
  writeFileSync(CACHE_PATH, JSON.stringify({
    ts: Date.now(),
    source: "scripts/sync-pricing.mjs",
    models: map,
  }, null, 2) + "\n")
  log(`cache written to ${CACHE_PATH}`)
}

// ── Update hardcoded entries in src/index.ts ─────────────────────
function updateHardcoded(map) {
  let src = readFileSync(INDEX_PATH, "utf-8")
  let changes = 0

  for (const [model, newPrice] of Object.entries(map)) {
    if (!TRACKED.has(model)) continue
    // Escape model ID for regex, match whole key including quotes
    const escaped = model.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")
    const re = new RegExp(`"${escaped}":\\s*[\\d.eE+-]+`, "g")
    const match = src.match(re)
    if (!match) continue
    for (const m of match) {
      const valStr = m.split(":")[1].trim()
      const oldPrice = parseFloat(valStr)
      if (isNaN(oldPrice)) continue
      const pctChange = Math.abs(newPrice - oldPrice) / oldPrice
      if (pctChange > 0.05) {
        const rounded = +newPrice.toFixed(newPrice < 0.001 ? 6 : newPrice < 0.01 ? 5 : 4)
        const newEntry = `"${model}": ${rounded}`
        // Only replace exact model key, not substrings
        src = src.replace(m, newEntry)
        changes++
        log(`  ${model}: $${oldPrice.toFixed(6)} → $${rounded.toFixed(6)} (${(pctChange*100).toFixed(1)}% change)`)
      }
    }
  }

  if (changes > 0) {
    writeFileSync(INDEX_PATH, src)
    log(`updated ${changes} entries in src/index.ts`)
  } else {
    log("no hardcoded entries needed updating (all within 5%)")
  }
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  try {
    const map = await fetchOpenRouter()
    writeCache(map)
    updateHardcoded(map)
    log("done.")
  } catch (err) {
    log(`ERROR: ${err.message}`)
    process.exit(1)
  }
}

main()
