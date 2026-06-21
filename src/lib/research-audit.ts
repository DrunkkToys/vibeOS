// @ts-nocheck

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { safeJsonParse, VIBEOS_HOME, getVibeOSHome } from "./state.js"
import { modelCostPerTurn } from "./pricing.js"

const _OC_SID = "opencode-" + (process.pid || "x") + "-" + Date.now()
const SCRATCHPAD_ROOT = join(getVibeOSHome(), "scratch")
const SCRATCHPAD_GLOBAL_DIR = join(SCRATCHPAD_ROOT, "by-hash")
const SCRATCHPAD_SESSIONS_DIR = join(SCRATCHPAD_ROOT, "sessions")
const STATE_FILE = join(getVibeOSHome(), "delegation-state.json")

let currentModel = null

function getSessionRoot() { return join(SCRATCHPAD_SESSIONS_DIR, _OC_SID) }
function getSessionScratchpadDir() { return join(getSessionRoot(), "by-hash") }
function getGlobalIndexPath() { return join(SCRATCHPAD_ROOT, "index.jsonl") }

// Scans the scratchpad index and session state for WebFetch/WebSearch
// patterns: domain chains, redundant queries, context7 bypass.
// Returns a structured report object.
const FETCH_TOOLS = new Set(["WebFetch", "WebSearch", "webfetch", "websearch"])

export function researchAudit({ hours = 24, session: sessionFilter } = {}) {
  const cutoff = Date.now() - hours * 3600 * 1000
  const report = { totalFetches: 0, totalBytes: 0, estCost: 0, chains: [], byDomain: {}, sessions: 0, redundant: 0 }

  // 1. Scratchpad index entries (recent WebFetch/WebSearch only)
  try {
    const indexPath = getGlobalIndexPath()
    if (existsSync(indexPath)) {
      const lines = readFileSync(indexPath, "utf-8").trim().split("\n").filter(Boolean)
      const domainCache = {}

      for (const line of lines) {
        const e = JSON.parse(line)
        if (!FETCH_TOOLS.has(e.tool)) continue
        const ts = new Date(e.ts).getTime()
        if (ts < cutoff) continue
        if (sessionFilter && e.session !== sessionFilter) continue

        report.totalFetches++
        report.totalBytes += e.size || 0

        // Extract domain from summary if available
        const hash = e.hash
        const summaryPathSession = join(getSessionScratchpadDir(), hash + ".summary.txt")
        const summaryPathGlobal = join(SCRATCHPAD_GLOBAL_DIR, hash + ".summary.txt")
        const summaryPath = existsSync(summaryPathSession) ? summaryPathSession : summaryPathGlobal
        if (existsSync(summaryPath)) {
          const summary = readFileSync(summaryPath, "utf-8").slice(0, 200)
          const urlMatch = summary.match(/https?:\/\/([^\/\s\)]+)/i)
          const queryMatch = summary.match(/"query":"([^"]+)"/)
          let domain
          if (urlMatch) {
            // Extract registered domain (last 2 hostname parts) for grouping
            const parts = urlMatch[1].replace(/[\)\.,;:>]+$/, "").split(".")
            domain = parts.length >= 2 ? parts.slice(-2).join(".") : parts[0]
          } else if (queryMatch) {
            domain = queryMatch[1].split(/\s+/).slice(0, 3).join(" ")
          } else {
            // Fallback: extract first capitalized word sequence (e.g. "LDraw.org Library Spec")
            const wordSeq = summary.match(/^([A-Z][a-zA-Z.&-]+(?:\s+[A-Z][a-zA-Z.&-]+)*)/)
            domain = wordSeq?.[1] || (e.tool === "WebSearch" ? "web-search" : "unknown")
          }
          const domainKey = typeof domain === "string" ? domain : "unknown"
          domainCache[hash] = domainKey
          report.byDomain[domainKey] = (report.byDomain[domainKey] || 0) + 1
        } else {
          report.byDomain.unknown = (report.byDomain.unknown || 0) + 1
        }
      }
      // Warn if too many unknown domains
      const unknownCount = report.byDomain.unknown || 0
      if (unknownCount > report.totalFetches * 0.3 && report.totalFetches > 5) {
        console.error(`[vibeOS] ${unknownCount}/${report.totalFetches} fetches have unknown domain — summary files may be missing or fetches failed silently`)
      }

      // Detect chains: 3+ fetches to same domain within 5 entries
      const entries = lines
        .map(l => JSON.parse(l))
        .filter(e => FETCH_TOOLS.has(e.tool) && new Date(e.ts).getTime() >= cutoff)
        .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

      const domainSeq = entries.map(e => domainCache[e.hash] || "unknown")
      let chainStart = -1
      for (let i = 2; i < domainSeq.length; i++) {
        if (domainSeq[i] === domainSeq[i-1] && domainSeq[i-1] === domainSeq[i-2]) {
          if (chainStart === -1 || domainSeq[i] !== domainSeq[chainStart]) {
            chainStart = i - 2
            const domain = domainSeq[i]
            // Count how many consecutive
            let chainEnd = i
            while (chainEnd < domainSeq.length && domainSeq[chainEnd] === domain) chainEnd++
            report.chains.push({ domain, count: chainEnd - chainStart, startIdx: chainStart })
            i = chainEnd
            chainStart = -1
          }
        }
      }
    }
  } catch (err) {
    console.error(`[vibeOS] researchAudit index scan failed: ${err.message}`)
  }

  // 2. Session state for tool_counts and context7 bypass
  try {
    if (existsSync(STATE_FILE)) {
      const state = safeJsonParse(readFileSync(STATE_FILE, "utf-8"))
      for (const [sid, s] of Object.entries(state.sessions || {})) {
        if (sessionFilter && sid !== sessionFilter) continue
        report.sessions++
        const tc = s.tool_counts || {}
        const fetchCount = (tc.WebFetch || 0) + (tc.WebSearch || 0) + (tc.webfetch || 0) + (tc.websearch || 0)
        const c7Warns = (s.warns || []).filter(w => w.reason?.includes("context7")).length
        if (fetchCount > 0) {
          report.byDomain["_session"] = (report.byDomain["_session"] || 0) + 1
        }
        report.redundant += c7Warns
      }
    }
  } catch (err) {
    console.error(`[vibeOS] researchAudit state scan failed: ${err.message}`)
  }

  // 3. Estimated cost: ~$0.001 per fetch for brain model
  const brainCost = currentModel ? (modelCostPerTurn(currentModel) ?? 0.003) : 0.003
  report.estCost = Math.round(report.totalFetches * brainCost * 100) / 100

  return report
}
