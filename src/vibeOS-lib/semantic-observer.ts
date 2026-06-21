// @ts-nocheck
// SPDX-License-Identifier: MIT
import { join } from "node:path"
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import {
  VIBEOS_HOME,
  _OC_SID,
  frictionSessionKeys,
  loadProjectState,
  currentProjectFingerprint,
  safeJsonParse,
} from "../lib/state.js"
import { commandFamily, commandFailed } from "../lib/pattern-helpers.js"
import { hasBypassFlag, targetsProtectedBranch, isDeployCommand } from "../lib/pattern-helpers.js"
import { upsertProjectPattern } from "../lib/pattern-store.js"

function deriveRole(toolName, input, output) {
  if (["write","edit","notebookedit","multiedit"].includes(toolName)) return "mutation"
  const cmd = input?.args?.command || ""
  if (typeof cmd !== "string") return "query"
  if (hasBypassFlag(cmd)) return "bypass"
  if (isDeployCommand(cmd)) return "deployment"
  const family = commandFamily(cmd)
  if (["git-status","syntax-check","typecheck","test","build"].includes(family)) return "verification"
  return "query"
}

function deriveTags(input, output) {
  const cmd = input?.args?.command || ""
  return {
    isGuardBreach: deriveRole(input?.name || "", input, output) === "bypass",
    isProtectedTarget: typeof cmd === "string" && targetsProtectedBranch(cmd),
    exitCode: output?.exitCode ?? output?.statusCode ?? output?.code ?? null,
    family: commandFamily(cmd),
    isFailed: commandFailed(output),
  }
}

function getSessionEventLogPath(sid) {
  const dir = join(VIBEOS_HOME, "session-events")
  mkdirSync(dir, { recursive: true })
  return join(dir, sid + ".jsonl")
}

function writeEvent(sid, event) {
  const path = getSessionEventLogPath(sid)
  let lines = []
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf-8").trim()
    if (raw) lines = raw.split("\n")
  }
  lines.push(JSON.stringify(event))
  if (lines.length > 200) lines = lines.slice(-200)
  writeFileSync(path, lines.join("\n") + "\n")
}

function readRecentEvents(sid, n) {
  const path = getSessionEventLogPath(sid)
  if (!existsSync(path)) return []
  const raw = readFileSync(path, "utf-8").trim()
  if (!raw) return []
  const lines = raw.split("\n")
  return lines.slice(-n).map((l) => {
    try { return JSON.parse(l) } catch { return null }
  }).filter(Boolean)
}

function detectPatterns(events, fingerprint) {
  const patterns = []
  for (let i = 1; i < events.length; i++) {
    const bypass = events[i]
    const prev = events[i - 1]
    if (!bypass.isGuardBreach) continue
    if (prev.family !== bypass.family) continue
    if (prev.exitCode === null || prev.exitCode === 0) continue
    const diff = bypass.at - prev.at
    if (diff >= 0 && diff <= 5 * 60 * 1000) {
      patterns.push({
        key: "workflow:bypass-after-failure:" + bypass.family,
        summary: "Guard blocked " + bypass.family + ", then bypassed with --no-verify or --force instead of resolving the failure.",
        kind: "friction",
      })
    }
  }
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (!ev.isGuardBreach) continue
    const hasPrior = events.slice(0, i).some(
      (e) => e.family === ev.family && e.exitCode !== null && e.exitCode !== 0 &&
        (ev.at - e.at) <= 10 * 60 * 1000 && (ev.at - e.at) >= 0
    )
    if (!hasPrior) {
      patterns.push({
        key: "workflow:guard-breach:" + ev.family,
        summary: "Executed " + ev.family + " with bypass flag without a prior guard trigger.",
        kind: "friction",
      })
    }
  }
  for (let i = 2; i < events.length; i++) {
    const dep = events[i]
    if (dep.role !== "deployment" || !dep.isProtectedTarget) continue
    const dAt = dep.at
    for (let j = i - 1; j >= 0; j--) {
      const bp = events[j]
      if (bp.role !== "bypass") continue
      if (dAt - bp.at > 10 * 60 * 1000) continue
      for (let k = j - 1; k >= 0; k--) {
        const mut = events[k]
        if (mut.role !== "mutation") continue
        if (bp.at - mut.at > 10 * 60 * 1000) continue
        patterns.push({
          key: "workflow:circumvented-review",
          summary: "Edited files, bypassed guard, and deployed directly to protected branch — circumvented pull request workflow.",
          kind: "friction",
        })
        break
      }
      break
    }
  }
  for (const p of patterns) {
    if (!p.key.startsWith("workflow:")) continue
    const pstate = loadProjectState()
    const existing = pstate?.project_hashes?.[fingerprint]?.userPatterns?.friction?.[p.key]
    if (existing && (existing.sessions?.length || 0) >= 2) {
      const family = p.key.split(":").pop()
      patterns.push({
        key: "workflow:systemic-bypass:" + family,
        summary: "Repeated bypass of " + family + " across sessions — systemic workflow violation.",
        kind: "friction",
      })
    }
  }
  // General friction: repeat failure (same family 2+ times)
  const seen = {}
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    if (!e.isFailed || e.family === "unknown" || e.family === "command") continue
    if (i > 0 && events[i-1].family === e.family && events[i-1].isFailed) {
      const key = "friction:repeat-fail:" + e.family
      if (!seen[key]) {
        seen[key] = true
        patterns.push({
          key,
          summary: e.family + " failed repeatedly — possible systematic issue.",
          kind: "friction",
        })
      }
    }
  }
  // General friction: post-edit failure (mutation -> verification fail)
  for (let i = 1; i < events.length; i++) {
    const ver = events[i]
    if (ver.role !== "verification" || !ver.isFailed) continue
    const prev = events[i - 1]
    if (prev.role !== "mutation") continue
    const diff = ver.at - prev.at
    if (diff >= 0 && diff <= 3 * 60 * 1000) {
      const key = "friction:post-edit-fail:" + ver.family
      if (!seen[key]) {
        seen[key] = true
        patterns.push({
          key,
          summary: "Edit followed by " + ver.family + " failure — check your changes.",
          kind: "friction",
        })
      }
    }
  }
  return patterns
}

function getCurrentSid() {
  return globalThis.__vibeOS_SID || _OC_SID || process.env.OPENCODE_SESSION_ID || "unknown"
}

function getProjectFingerprint(directory) {
  return currentProjectFingerprint || directory || "unknown"
}

function recordFrictionPattern(key, summary, meta = {}) {
  const sessionKey = "friction:" + key
  if (frictionSessionKeys.has(sessionKey)) return
  frictionSessionKeys.add(sessionKey)
  upsertProjectPattern("friction", key, summary, {
    ...meta,
    fingerprint: meta.fingerprint || currentProjectFingerprint || "unknown",
    sessionId: (meta.sessions || [])[0] || getCurrentSid(),
  })
  try {
    import("../lib/api-client.js").then((api) => {
      const client = api.getApiClient?.()
      if (client && _OC_SID) {
        const family = meta.family || meta.path || "unknown"
        client.patternsObserve(_OC_SID, family, summary, key, fp).catch(() => {})
      }
    }).catch(() => {})
  } catch {}
}

function observeToolPattern(toolName, input, output, directory) {
  const role = deriveRole(toolName, input, output)
  const tags = deriveTags(input, output)
  const sid = getCurrentSid()
  writeEvent(sid, {
    tool: toolName,
    role,
    family: tags.family,
    at: Date.now(),
    isGuardBreach: tags.isGuardBreach,
    isProtectedTarget: tags.isProtectedTarget,
    exitCode: tags.exitCode,
  })
}

function sessionCompact(sid, fingerprint) {
  try {
    const events = readRecentEvents(sid, 200)
    if (events.length < 3) return
    const patterns = detectPatterns(events, fingerprint)
    for (const p of patterns) {
      recordFrictionPattern(p.key, p.summary, { kind: p.kind, sessions: [sid], fingerprint })
    }
    const bbPath = join(VIBEOS_HOME, "blackbox-state.json")
    if (existsSync(bbPath)) {
      const raw = readFileSync(bbPath, "utf-8")
      if (raw) {
        const bb = safeJsonParse(raw, null) || {}
        bb.sessions ??= {}
        const existing = bb.sessions?.[sid] || null
        const shouldWrite = Boolean(existing && existing.sub_regime === "LOOPING") || patterns.length > 0
        if (shouldWrite) {
          const ses = existing || (bb.sessions[sid] = { sessionId: sid })
          const topPattern = patterns[0]
          const summary = patterns.map((p) => p.summary).slice(0, 3).join(" | ")
          ses.resolution_state = "intervened"
          ses.resolution_reason = summary || "looping friction detected"
          ses.live_next_action = patterns.length > 0
            ? `Address friction: ${topPattern?.summary || "review the repeated loop"}`
            : "Review the repeated loop and reduce friction"
          ses.live_updated_at = new Date().toISOString()
          writeFileSync(bbPath, JSON.stringify(bb, null, 2))
        }
      }
    }
  } catch (e) {
    console.error("[vibeOS] semantic session analysis:", e)
  }
}

function flushSessionAnalysis(sid) {
}

export { observeToolPattern, sessionCompact, flushSessionAnalysis, getCurrentSid, getSessionEventLogPath, deriveRole, deriveTags, detectPatterns, writeEvent, readRecentEvents }
