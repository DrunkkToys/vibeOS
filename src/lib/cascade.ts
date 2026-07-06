// @ts-nocheck
// SPDX-License-Identifier: MIT
// DOC: Auto-merged from classifiers.ts, axis-bundle.ts, mode-router.ts, turn-classify.ts

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs"
import { join, dirname } from "node:path"
import { memoCompute } from "./turn-memo.js"
import { reconcileStickyLoopState } from "./loop-state.js"
import { ResolutionTracker } from "../vibeOS-lib/blackbox/index.js"
import { vibeqmaxControlVector } from "../vibeOS-lib/blackbox/vibeqmax.js"
import { vibeultraxControlVector } from "../vibeOS-lib/blackbox/vibeultrax.js"
import { safeJsonParse, _blackboxEnabled, setBlackboxEnabled as _setGlobalBlackboxEnabled, _OC_SID, currentProjectFingerprint, currentTier, setCurrentProjectFingerprint, _handleStateCorruption, _lockPathFor, withFileLock, readJsonOrEmpty, validateState, loadBlackboxState, saveBlackboxState, loadGlobalLearning, updateGlobalLearning, getLearnedExploratoryWords, projectFingerprint, loadProjectState, saveProjectState, detectTechStack, ensureProjectBucket, recordMissedContext7, recentToolEvents, getVibeOSHome, getCurrentSessionId } from "./state.js"
import { loadSelection, loadSessionOptMode, loadGlobalOptMode, saveGlobalOptMode, writeSelection, writeSessionOptMode, writeSessionSlot } from "./selection-manager.js"
import { getApiClient, isApiFallback } from "./api-client.js"

export function detectOutcomeSignal(text) {
  if (!text) return null
  if (/thank|perfect|exactly|that.?s it|works great|works perfectly|solved|fixed|awesome|you rock|that works|finally|progress|much better|getting there|closer now/i.test(text)) return "positive"
  if (/doesn.?t work|still broken|not working|incorrect|wrong|failed|error|useless|stuck|still failing|broke again|worse|regression|new (problem|bug|issue|error)|made it worse|every (fix|change|attempt) (broke|breaks|introduces)|went backwards|back to square|start over|same (issue|problem|error) (again|still)|(another|yet another|different) (error|problem|issue)|(still|again|still not) (the|at|same)|\d+\s*(times|attempts|tries) (and|but) (still|same|same result)/i.test(text)) return "negative"
  return null
}

function normalizeActivitySignature(event) {
  if (!event || typeof event !== "object") return ""
  const tool = String(event.tool || "").trim().toLowerCase()
  const target = String(event.target || "").trim().toLowerCase()
  const action = String(event.action || event.kind || "").trim().toLowerCase()
  return [tool, target, action].filter(Boolean).join(":")
}

function countBehavioralRepeat(items, signatureOf, minLength = 3) {
  if (!Array.isArray(items) || items.length < minLength) return 0
  const last = signatureOf(items[items.length - 1])
  if (!last) return 0
  let streak = 0
  for (let i = items.length - 1; i >= 0; i--) {
    if (signatureOf(items[i]) !== last) break
    streak++
  }
  return streak
}

function getBehavioralStressSignals(context, blackboxState) {
  const recentEvents = Array.isArray(context?.recentToolEvents)
    ? context.recentToolEvents
    : Array.isArray(recentToolEvents)
      ? recentToolEvents
      : []
  const recentWindow = recentEvents.slice(-10)
  const toolRepeatStreak = countBehavioralRepeat(recentWindow, normalizeActivitySignature)
  const targetRepeatStreak = countBehavioralRepeat(recentWindow, (event) => String(event?.target || "").trim().toLowerCase())
  const outcomeHistory = Array.isArray(context?.outcomeHistory)
    ? context.outcomeHistory
    : Array.isArray(blackboxState?.outcomeHistory)
      ? blackboxState.outcomeHistory
      : []
  const negativeOutcomes = outcomeHistory
    .slice(-5)
    .filter((o) => /negative|failed|unresolved|loop_detected/i.test(String(o?.outcome || "")))
    .length
  const loopCount = Number(blackboxState?.loop_count ?? blackboxState?.loopConsecutive ?? blackboxState?.loop_consecutive ?? 0)
  const repeatStreak = Number(blackboxState?.repeat_streak ?? 0)
  const activityRepeatStreak = Number(blackboxState?.activity_repeat_streak ?? 0)
  const targetRepeatStateStreak = Number(blackboxState?.target_repeat_streak ?? 0)
  const messageLengthTrend = String(blackboxState?.message_length_trend || "stable")
  const messageLengthSlope = Number(blackboxState?.message_length_slope ?? 0)
  return {
    toolRepeatStreak,
    targetRepeatStreak,
    negativeOutcomes,
    loopCount,
    repeatStreak,
    activityRepeatStreak,
    targetRepeatStateStreak,
    messageLengthTrend,
    messageLengthSlope,
  }
}

export function scoreStress(text, context = {}) {
  const ctxKeys = Object.keys(context || {}).sort().join(",")
  const textKey = typeof text === "string" ? text.slice(0, 80) : String(text ?? "").slice(0, 80)
  const key = `scoreStress:${text?.length ?? 0}:${textKey}|${ctxKeys}`
  return memoCompute(key, () => {
    const blackboxState = loadBlackboxState()
    if (!text || typeof text !== "string") return 0
    const t = text.toLowerCase()
    let score = 0

    const aggressive = ["fuck","shit","bullshit","useless","wrong","bad","slow","broken","stupid","idiot","hell","damn","waste","annoying","terrible","hate"]
    for (const w of aggressive) {
      const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi")
      const hits = (t.match(re) || []).length
      score += hits * 0.18
    }

    const urgency = ["fix","now","fast","urgent","important","critical","hurry","immediately","asap","stressed","stress","frustrated","overwhelmed","panic","panicked","anxious"]
    for (const w of urgency) {
      const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi")
      const hits = (t.match(re) || []).length
      score += hits * 0.16
    }

    const negative = ["no","not","don't","can't","won't","doesn't","isn't","shouldn't","never","stop"]
    for (const w of negative) {
      const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi")
      const hits = (t.match(re) || []).length
      score += hits * 0.06
    }

    const capsAcronyms = new Set(["ai","ui","api","cli","ssh","dns","http","url","json","xml","css","html","sql","csv","yaml","ide","tdd","pr","ci","cd","env","os","sdk","gui","crud","rest","crlf","utf","ascii"])
    const words = text.split(/\s+/)
    for (const w of words) {
      if (w.length >= 3 && /^[A-Z]+$/.test(w) && !capsAcronyms.has(w.toLowerCase())) {
        score += 0.05
      }
    }

    const exclamParts = text.match(/!{2,}/g)
    if (exclamParts) score += exclamParts.length * 0.08

    const qmarkParts = text.match(/\?{2,}/g)
    if (qmarkParts) score += qmarkParts.length * 0.05

    const qeCombos = text.match(/\?!|!\?/g)
    if (qeCombos) score += qeCombos.length * 0.1

    const behavioralPhrases = [
      { re: /\b(restart|restarts|restarted|restart again|restart it|retry|retries|retrial|rerun|redo|repeat the step|try again|another attempt|another pass)\b/gi, weight: 0.09 },
      { re: /\b(still failing|keeps failing|keeps breaking|still broken|same issue|same result|same error|new error|new issue|broke again|breaks again|every fix|every time|over and over|again and again)\b/gi, weight: 0.12 },
      { re: /\b(blocked again|stuck again|failed again|fails again|this is not working|nothing changed|no change)\b/gi, weight: 0.1 },
      { re: /\b(start over|from scratch|back to square|back to the drawing board|reset|rethink|different approach)\b/gi, weight: 0.12 },
      { re: /\b(made it worse|went backwards|regression|introduced (a |a new |another )(problem|bug|issue)|worse than before|new (problem|bug|issue) (emerged|appeared|showed))\b/gi, weight: 0.15 },
      { re: /\b(\d+)\s*(times|attempts|tries)\b/gi, dynamic: true },
    ]
    for (const { re, weight, dynamic } of behavioralPhrases) {
      const matches = t.match(re)
      if (!matches) continue
      if (dynamic) {
        for (const m of matches) {
          const num = parseInt(m, 10) || 0
          score += Math.min(0.2, num * 0.04)
        }
      } else {
        score += matches.length * weight
      }
    }
    const {
      toolRepeatStreak,
      targetRepeatStreak,
      negativeOutcomes,
      loopCount,
      repeatStreak,
      activityRepeatStreak,
      targetRepeatStateStreak,
      messageLengthTrend,
      messageLengthSlope,
    } = getBehavioralStressSignals(context, blackboxState)
    if (toolRepeatStreak >= 2) {
      score += 0.08 + Math.min(0.24, (toolRepeatStreak - 1) * 0.05)
    }
    if (targetRepeatStreak >= 2) {
      score += 0.05 + Math.min(0.16, (targetRepeatStreak - 1) * 0.035)
    }
    if (negativeOutcomes >= 1) {
      score += 0.05 * negativeOutcomes + Math.min(0.18, negativeOutcomes * 0.03)
    }
    if (blackboxState?.is_looping || loopCount >= 2) {
      score += 0.1 + Math.min(0.18, loopCount * 0.03)
    }
    if (repeatStreak >= 2) {
      score += 0.06 + Math.min(0.12, repeatStreak * 0.025)
    }
    if (activityRepeatStreak >= 2) {
      score += 0.05 + Math.min(0.1, activityRepeatStreak * 0.02)
    }
    if (targetRepeatStateStreak >= 2) {
      score += 0.04 + Math.min(0.08, targetRepeatStateStreak * 0.015)
    }
    if (messageLengthTrend === "shortening" && messageLengthSlope < -0.3) {
      score += 0.08
    }

    if (text.length < 30) score += 0.06
    else if (text.length < 80) score += 0.05
    else if (text.length < 150) score += 0.03

    return Math.min(score, 0.95)
  })
}

export function estimateContextBudget(_input, output) {
  try {
    const DEFAULT_CONTEXT_LIMIT = 128000
    const CHARS_PER_TOKEN = 4
    let totalChars = 0
    const messages = output?.messages
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        const parts = msg?.parts
        if (!Array.isArray(parts)) continue
        for (const part of parts) {
          if (part?.type === "text" && typeof part.text === "string") {
            totalChars += part.text.length
          } else if (part?.type === "tool" && typeof part.state?.output === "string") {
            totalChars += part.state.output.length
          }
        }
      }
    }
    const systemParts = output?.system
    if (Array.isArray(systemParts)) {
      for (const s of systemParts) {
        if (typeof s === "string") totalChars += s.length
      }
    }
    const estimatedTokens = Math.round(totalChars / CHARS_PER_TOKEN)
    const pct = Math.round((estimatedTokens / DEFAULT_CONTEXT_LIMIT) * 100)
    return { estimatedTokens, pct, totalChars }
  } catch {
    return null
  }
}

export function classifyTurnSimple(userText) {
  return memoCompute(`classifyTurnSimple:${userText}`, () => {
    const lower = String(userText || "").trim()
    if (!lower) return "INIT"
    if (/(security|vulnerability|audit|owasp|compliance|gdpr|privacy|analyze dependencies|license audit|xss|csrf|authn|authz|pentest)/i.test(lower)) {
      return "AUDIT"
    }
    if (/(inject|exploit|penetration|cve|attack|threat|encrypt|forensic|research|deep analysis|investigate|root cause|reverse engineer|disassemble|memory dump|core dump)/i.test(lower)) {
      return "FORENSIC"
    }
    const IMPL_VERBS = "fix|write|create|build|implement|change|edit|modify|update|refactor|generate|delete|remove|migrate|deploy|commit|push"
    // "can you fix/rewrite/..." are implementation requests phrased as questions
    if (new RegExp("^(can you|could you|tell me|we should|we need to|please) (" + IMPL_VERBS + ")\\b", "i").test(lower)) {
      return "REFINING"
    }
    // "I need to fix/update/..." — implementation intent
    if (new RegExp("^I (need|want|would like) to (" + IMPL_VERBS + ")\\b", "i").test(lower)) {
      return "REFINING"
    }
    // Problem-description patterns — user is investigating/reporting, not commanding
    if (/^(the |there is |there are |i think |looks like |seems like |i see |why (is|are|does|did) )/i.test(lower)) {
      return "EXPLORING"
    }
    // Q&A / research patterns -> EXPLORING
    if (/^(how|what|why|when|where|who|can you|could you|let me|tell me|explain|describe|show|list|check|is there|are there|does|do you|summarize|elaborate|clarify|inspect|trace|find|search|look|read|show me|dump|debug)/i.test(lower)) {
      return "EXPLORING"
    }
    // Full-text scan for implementation verbs — catches "I need to fix", "we should fix" without leading patterns
    if (new RegExp("\\b(" + IMPL_VERBS + ")\\b", "i").test(lower)) {
      return "REFINING"
    }
    // Implementation / write patterns (leading verb) -> REFINING
    if (/^(write|create|add|build|implement|fix|change|edit|modify|update|refactor|generate|make|commit|push|deploy|release|publish|install|remove|delete|rename|move|copy|transform|convert|migrate)/i.test(lower)) {
      return "REFINING"
    }
    return "INIT"
  })
}

export function tokenizeWords(text) {
  if (!text || typeof text !== "string") return []
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w.length > 2)
}

export function topKeywords(text, max = 10) {
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "your", "you", "are", "but", "not", "all", "can", "use", "was", "have", "has", "had", "they", "them", "their", "then", "than", "when", "what", "why", "how", "who", "will", "would", "should", "about", "check", "make", "build", "write", "edit", "file", "code", "test", "tests", "run"])
  const freq = new Map()
  for (const w of tokenizeWords(text)) {
    if (stop.has(w)) continue
    freq.set(w, (freq.get(w) || 0) + 1)
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w)
}

export function extractLastUserText(obj) {
  if (!obj || typeof obj !== "object") return null
  const candidates = []
  const scan = (v) => {
    if (!v || typeof v !== "object") return
    if (Array.isArray(v)) {
      for (const i of v) scan(i)
      return
    }
    if (v.role === "user" && typeof v.content === "string") candidates.push(v.content)
    if (typeof v.text === "string") candidates.push(v.text)
    for (const val of Object.values(v)) scan(val)
  }
  scan(obj)
  if (!candidates.length) return null
  return candidates[candidates.length - 1]
}

export function isUserAskingForTests(text) {
  if (!text || typeof text !== "string") return false
  return /\b(test|tests|typecheck|coverage|qa|regression|e2e|unit test|integration test)\b/i.test(text)
}

export function isLikelyOffTopic(userText, job) {
  if (!userText || !job?.keywords?.length) return false
  if (/\b(new task|switch task|different task|ignore previous|start over)\b/i.test(userText)) return false
  const now = Date.now()
  const updatedAt = Date.parse(job.updatedAt || "")
  if (!Number.isFinite(updatedAt) || now - updatedAt > 2 * 60 * 60 * 1000) return false
  const userWords = new Set(topKeywords(userText, 12))
  const overlap = job.keywords.filter((k) => userWords.has(k))
  return overlap.length === 0 && userWords.size >= 3
}
// Mode Router — extracted to mode-table.ts (pure data, no Node deps).
export {
  Mode, MODES, isMode, ModeEntry, TierInfo, TIERS, MODE_TABLE,
  normalizeLegacyMode, BRANDED_MODES, RUNTIME_MODES, RAW_MODE, ALL_MODES,
  getMode, getDefault, getDefaultRuntime, getBrandedModes, getRuntimeModes,
  resolveCascadeSlot, resolveTierModels,
} from "./mode-table.js"
// Axis Bundle — single source of truth for per-turn control-vector composition.
// Replaces the duplicated logic previously spread across mode-router.ts (BRANDED_MODES/
// RUNTIME_MODES), mode-policy.ts (AdaptiveMode auto-switching), meta-controller.ts
// (REGIME_CONTROL/MODE_DELTAS, dead code — nothing called it), and turn-classify.ts
// (buildOfflineControlVector, the ad hoc reimplementation that was actually live).
//
// Composition order: raw bypass > regime base > mode defaults > user axis overrides >
// LOOPING safety hardening. Mode selection itself is never auto-switched — only axis
// values flex per regime/stress within whatever mode the user picked.

export type Regime =
  | "INIT" | "DIVERGENT" | "EXPLORING" | "REFINING" | "IMPLEMENTING" | "RESEARCH"
  | "REVIEWING" | "DESIGNING" | "CONVERGING" | "LOOPING" | "CLOSED" | "FORENSIC" | "AUDIT"

export type EnforcementAxis = "off" | "relaxed" | "normal" | "strict"
export type FlowAxis = "off" | "audit" | "normal" | "strict"
export type TddAxis = "off" | "lazy" | "normal" | "quality" | "strict"
export type TierAxis = "cheap" | "medium" | "brain" | "auto"
export type ThinkingAxis = "off" | "brief" | "full" | "auto"
export type Context7Axis = "optional" | "preferred" | "required"
export type WbpVerbosityAxis = "minimal" | "normal" | "detailed"
export type WebsearchAxis = "off" | "allowed" | "encouraged"

export interface AxisBundle {
  enforcement: EnforcementAxis
  flow: FlowAxis
  flow_focus: string[]
  tdd: TddAxis
  tdd_focus: string[]
  tier: TierAxis
  thinking: ThinkingAxis
  stress_multiplier: number
  context7_urgency: Context7Axis
  wbp_verbosity: WbpVerbosityAxis
  websearch: WebsearchAxis
}

export const AXIS_NAMES = [
  "enforcement", "flow", "tdd", "tier", "thinking",
  "context7_urgency", "wbp_verbosity", "websearch",
] as const
export type AxisName = (typeof AXIS_NAMES)[number]

export function isAxisName(v: unknown): v is AxisName {
  return AXIS_NAMES.includes(String(v || "") as AxisName)
}

// Ported 1:1 from meta-controller.ts REGIME_CONTROL (tier_bias renamed to tier).
export const REGIME_AXIS_BASE: Record<Regime, AxisBundle> = {
  INIT: {
    enforcement: "normal", flow: "normal", flow_focus: [], tdd: "normal", tdd_focus: [],
    tier: "auto", thinking: "auto", stress_multiplier: 1.0,
    context7_urgency: "preferred", wbp_verbosity: "normal", websearch: "off",
  },
  DIVERGENT: {
    enforcement: "relaxed", flow: "audit", flow_focus: ["no-write-without-clarification"], tdd: "lazy", tdd_focus: [],
    tier: "medium", thinking: "off", stress_multiplier: 0.5,
    context7_urgency: "optional", wbp_verbosity: "detailed", websearch: "off",
  },
  EXPLORING: {
    enforcement: "relaxed", flow: "audit", flow_focus: [], tdd: "lazy", tdd_focus: [],
    tier: "cheap", thinking: "off", stress_multiplier: 0.7,
    context7_urgency: "optional", wbp_verbosity: "detailed", websearch: "off",
  },
  REFINING: {
    enforcement: "normal", flow: "normal", flow_focus: [], tdd: "normal", tdd_focus: [],
    tier: "auto", thinking: "auto", stress_multiplier: 1.0,
    context7_urgency: "preferred", wbp_verbosity: "normal", websearch: "off",
  },
  IMPLEMENTING: {
    enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files"],
    tdd: "strict", tdd_focus: ["skeleton-on-write", "assertion-check"],
    tier: "brain", thinking: "brief", stress_multiplier: 1.3,
    context7_urgency: "required", wbp_verbosity: "normal", websearch: "off",
  },
  RESEARCH: {
    enforcement: "normal", flow: "audit", flow_focus: ["trace-audit"], tdd: "lazy", tdd_focus: [],
    tier: "brain", thinking: "full", stress_multiplier: 1.2,
    context7_urgency: "required", wbp_verbosity: "detailed", websearch: "allowed",
  },
  REVIEWING: {
    enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files", "no-lgtm"],
    tdd: "quality", tdd_focus: ["full-coverage", "edge-cases"],
    tier: "brain", thinking: "brief", stress_multiplier: 1.1,
    context7_urgency: "required", wbp_verbosity: "normal", websearch: "off",
  },
  DESIGNING: {
    enforcement: "normal", flow: "audit", flow_focus: ["trace-audit"], tdd: "normal", tdd_focus: [],
    tier: "brain", thinking: "full", stress_multiplier: 1.1,
    context7_urgency: "required", wbp_verbosity: "detailed", websearch: "allowed",
  },
  CONVERGING: {
    enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files"],
    tdd: "strict", tdd_focus: ["skeleton-on-write", "assertion-check"],
    tier: "brain", thinking: "brief", stress_multiplier: 1.5,
    context7_urgency: "required", wbp_verbosity: "minimal", websearch: "off",
  },
  LOOPING: {
    enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files", "suggest-alternative"],
    tdd: "strict", tdd_focus: ["skeleton-on-write", "assertion-check"],
    tier: "brain", thinking: "brief", stress_multiplier: 2.0,
    context7_urgency: "required", wbp_verbosity: "detailed", websearch: "off",
  },
  CLOSED: {
    enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files", "no-lgtm"],
    tdd: "quality", tdd_focus: ["full-coverage", "edge-cases"],
    tier: "brain", thinking: "brief", stress_multiplier: 2.0,
    context7_urgency: "required", wbp_verbosity: "minimal", websearch: "off",
  },
  FORENSIC: {
    enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files", "trace-audit"],
    tdd: "quality", tdd_focus: ["full-coverage", "edge-cases", "property-based"],
    tier: "brain", thinking: "full", stress_multiplier: 1.5,
    context7_urgency: "required", wbp_verbosity: "detailed", websearch: "encouraged",
  },
  AUDIT: {
    enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files", "security-scan"],
    tdd: "quality", tdd_focus: ["full-coverage", "edge-cases", "security-test"],
    tier: "brain", thinking: "full", stress_multiplier: 1.2,
    context7_urgency: "required", wbp_verbosity: "detailed", websearch: "encouraged",
  },
}

export const DEFAULT_REGIME_BASE = REGIME_AXIS_BASE.EXPLORING

// One row per canonical mode. Old runtime-mode identities (balanced/speed/budget/
// quality/audit/longrun/forensic) no longer exist as selectable modes — their intent
// is expressed via these axis defaults plus per-turn regime/stress flex.
export const MODE_AXIS_DEFAULTS: Record<Mode, Partial<AxisBundle>> = {
  vibemax: {
    tier: "medium", thinking: "auto", tdd: "normal", flow: "audit",
    enforcement: "normal", websearch: "off", wbp_verbosity: "normal",
  },
  vibeqmax: {
    tier: "brain", thinking: "full", tdd: "quality", flow: "strict",
    enforcement: "strict", websearch: "off", context7_urgency: "required", wbp_verbosity: "normal",
  },
  vibeultrax: {
    tier: "auto", thinking: "full", tdd: "quality", flow: "strict",
    enforcement: "strict", websearch: "off", context7_urgency: "required", wbp_verbosity: "detailed",
    stress_multiplier: 2.5,
  },
  vibelitex: {
    tier: "medium", thinking: "brief", tdd: "lazy", flow: "audit",
    enforcement: "normal", websearch: "off", context7_urgency: "preferred", wbp_verbosity: "normal",
  },
  raw: {},
}

export const RAW_AXIS_BUNDLE: AxisBundle = {
  enforcement: "off", flow: "off", flow_focus: [], tdd: "off", tdd_focus: [],
  tier: "brain", thinking: "full", stress_multiplier: 1.0,
  context7_urgency: "optional", wbp_verbosity: "normal", websearch: "off",
}

const LOOPING_HARDENING: Partial<AxisBundle> = {
  enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files", "suggest-alternative"],
  tdd: "strict", tdd_focus: ["skeleton-on-write", "assertion-check"],
  tier: "brain", thinking: "brief", context7_urgency: "required",
}

export type AxisOverrides = Partial<Record<AxisName, string>>

function normalizeRegime(regime?: string | null): Regime {
  const r = String(regime || "INIT").toUpperCase()
  return (r in REGIME_AXIS_BASE ? r : "EXPLORING") as Regime
}

/**
 * Composition order: raw bypass > regime base > mode defaults > user axis overrides >
 * LOOPING safety hardening (hardening cannot be overridden — it's a safety rail, not a
 * mode switch). stress_multiplier is read-time-computed and not user-overridable.
 */
export function computeAxisBundle(
  regime: string | undefined,
  mode: Mode,
  axisOverrides: AxisOverrides = {},
  stress = 0,
): AxisBundle {
  if (mode === "raw") return { ...RAW_AXIS_BUNDLE }

  const normalizedRegime = normalizeRegime(regime)
  const base = REGIME_AXIS_BASE[normalizedRegime] || DEFAULT_REGIME_BASE
  const modeDefaults = MODE_AXIS_DEFAULTS[mode] || {}
  const looping = normalizedRegime === "LOOPING"

  const merged: AxisBundle = {
    ...base,
    ...modeDefaults,
    ...(axisOverrides.enforcement ? { enforcement: axisOverrides.enforcement as EnforcementAxis } : {}),
    ...(axisOverrides.flow ? { flow: axisOverrides.flow as FlowAxis } : {}),
    ...(axisOverrides.tdd ? { tdd: axisOverrides.tdd as TddAxis } : {}),
    ...(axisOverrides.tier ? { tier: axisOverrides.tier as TierAxis } : {}),
    ...(axisOverrides.thinking ? { thinking: axisOverrides.thinking as ThinkingAxis } : {}),
    ...(axisOverrides.context7_urgency ? { context7_urgency: axisOverrides.context7_urgency as Context7Axis } : {}),
    ...(axisOverrides.wbp_verbosity ? { wbp_verbosity: axisOverrides.wbp_verbosity as WbpVerbosityAxis } : {}),
    ...(axisOverrides.websearch ? { websearch: axisOverrides.websearch as WebsearchAxis } : {}),
  }

  if (looping) {
    Object.assign(merged, LOOPING_HARDENING)
    merged.stress_multiplier = Math.max(2.0, Number(stress || 0))
  } else {
    merged.stress_multiplier = Number(modeDefaults.stress_multiplier ?? base.stress_multiplier ?? 1.0)
  }

  return merged
}

export function buildAxisDirectives(bundle: AxisBundle, mode: Mode, looping = false): string[] {
  if (mode === "raw") return []
  const d: string[] = []
  if (bundle.enforcement !== "normal") {
    d.push(`[delegation enforcement: ${bundle.enforcement}] ` +
      (bundle.enforcement === "relaxed"
        ? "Write/Edit restrictions are temporarily eased. Proceed with caution."
        : bundle.enforcement === "off"
          ? "Delegation enforcement is disabled."
          : "ALL write/edit operations must pass strict validation. No exceptions."))
  }
  if (bundle.flow !== "normal") {
    const focusNote = bundle.flow_focus.length > 0 ? ` Focus rules: ${bundle.flow_focus.join(", ")}.` : ""
    d.push(`[flow: ${bundle.flow}] Flow enforcer is in ${bundle.flow} mode.${focusNote}`)
  }
  if (bundle.tdd !== "normal") {
    const focusNote = bundle.tdd_focus.length > 0 ? ` Focus: ${bundle.tdd_focus.join(", ")}.` : ""
    d.push(`[tdd: ${bundle.tdd}] TDD enforcement is ${bundle.tdd}.${focusNote}`)
  }
  if (bundle.tier !== "auto") {
    d.push(`[tier routing] Route to ${bundle.tier} tier for this turn.`)
  }
  if (bundle.thinking !== "auto") {
    d.push(`[thinking mode: ${bundle.thinking}] Reasoning depth set to ${bundle.thinking}. ` +
      (bundle.thinking === "off"
        ? "Skip extended thinking entirely. Respond directly and concisely."
        : "Use extended thinking only for genuinely complex multi-step problems."))
  }
  if (bundle.context7_urgency !== "preferred") {
    d.push(`[context7] Documentation lookup is ${bundle.context7_urgency}. ` +
      (bundle.context7_urgency === "required"
        ? "You MUST use mcp__context7__* tools before any web search for library/framework docs."
        : "context7 tools are available but not required."))
  }
  if (bundle.websearch !== "off") {
    d.push(`[websearch: ${bundle.websearch}] Web research is ${bundle.websearch}. ` +
      (bundle.websearch === "encouraged"
        ? "Prefer verifying claims against current external sources before asserting facts."
        : "Web research may be used if helpful."))
  }
  if (bundle.wbp_verbosity !== "normal") {
    d.push(`[wbp protocol] Delegation output synthesis is ${bundle.wbp_verbosity}. ` +
      (bundle.wbp_verbosity === "minimal"
        ? "Summarize subagent results in 1-2 sentences."
        : "Provide full detail from subagent output including code changes and rationale."))
  }
  if (looping) {
    d.push(`[loop prevention] The conversation may be looping — stop repeating the same answer path and try a different approach.`)
  }
  return d
}

export const REGIME_CONTROL_TABLE: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(REGIME_AXIS_BASE).map(([regime, b]) => [regime, {
    enforcement_mode: b.enforcement,
    flow_mode: b.flow,
    tdd_mode: b.tdd,
    tier_bias: b.tier,
    thinking_mode: b.thinking,
    wbp_verbosity: b.wbp_verbosity,
    context7_urgency: b.context7_urgency,
    stress_multiplier: b.stress_multiplier,
  }])
)

let _lastClassifiedByApi = false
let _lastApiPredictedMode = ""
export function isApiClassified(): boolean { return _lastClassifiedByApi }
export function lastApiPredictedMode(): string { return _lastApiPredictedMode }


export async function classifyTurnRemote(text: string): Promise<string> {
  try {
    const client = getApiClient()
    if (!client || isApiFallback()) {
      _lastClassifiedByApi = false
      return classifyTurnSimple(text)
    }
    try {
      const embedding = await client.blackboxSelectModeEmbedding(_OC_SID, {
        session_id: _OC_SID,
        project_id: currentProjectFingerprint || null,
        userText: text,
        prompt: text,
        optimization_mode: loadOptimizationMode() || null,
      } as unknown)
      if (embedding && typeof embedding === "object" && "mode" in (embedding as Record<string, unknown>)) {
        _lastApiPredictedMode = String((embedding as Record<string, unknown>).mode || "")
      }
    } catch {}
    const res = await client.blackboxAnalyze(_OC_SID, {
      session_id: _OC_SID,
      project_id: currentProjectFingerprint || null,
      userText: text,
      lastRegime: null as string | null,
      lastIntent: "",
      lastAction: "",
      stress: 0,
      state: {},
    } as unknown)
    if (res && typeof res === "object" && "sub_regime" in (res as Record<string, unknown>)) {
      _lastClassifiedByApi = true
      if (!_lastApiPredictedMode) _lastApiPredictedMode = (res as Record<string, string>).optimization_mode || ""
      return (res as Record<string, string>).sub_regime
    }
  } catch {}
  _lastClassifiedByApi = false
  return classifyTurnSimple(text)
}

type OptimizationMode = "balanced" | "budget" | "quality" | "speed" | "longrun" | "auto" | "forensic" | "audit" | "vibeultrax" | "vibeqmax" | "vibemax" | "vibelitex"
const QUALITY_STRESS_THRESHOLD = 1.5
const AUTO_MODE_BY_REGIME: Record<string, OptimizationMode> = {
  AUDIT: "audit",
  FORENSIC: "forensic",
  LOOPING: "quality",
  CONVERGING: "quality",
  CLOSED: "quality",
  IMPLEMENTING: "quality",
  RESEARCH: "longrun",
  DESIGNING: "longrun",
  REVIEWING: "audit",
}

const SUPPORTED_OPTIMIZATION_MODES = new Set<OptimizationMode>([
  "balanced",
  "budget",
  "quality",
  "speed",
  "longrun",
  "auto",
  "forensic",
  "audit",
  "vibeultrax",
  "vibeqmax",
  "vibemax",
  "vibelitex",
])

const BRAIN_ROOT_MODES = new Set<OptimizationMode>([
  "quality",
  "longrun",
  "vibeultrax",
  "vibeqmax",
  "forensic",
  "audit",
])
const MEDIUM_ROOT_MODES = new Set<OptimizationMode>(["speed", "vibemax", "vibelitex"])

function normalizeOptimizationMode(mode: OptimizationMode | string | undefined): OptimizationMode | "" {
  const normalized = String(mode || "auto").toLowerCase() as OptimizationMode | ""
  return normalized
}

function isSupportedOptimizationMode(mode: string): mode is OptimizationMode {
  return SUPPORTED_OPTIMIZATION_MODES.has(mode as OptimizationMode)
}



function autoSelectMode(subRegime: string, stressMultiplier?: number): OptimizationMode {
  const regime = String(subRegime || "INIT").toUpperCase()
  const stress = Number(stressMultiplier ?? 0)
  if (AUTO_MODE_BY_REGIME[regime]) return AUTO_MODE_BY_REGIME[regime]
  if (stress > QUALITY_STRESS_THRESHOLD) return "quality"
  return "quality"
}

export function resolveOptimizationMode(
  subRegime: string | undefined,
  stressMultiplier: number | undefined,
  optimizationMode: OptimizationMode | string | undefined,
): OptimizationMode {
  const normalized = normalizeOptimizationMode(optimizationMode)
  if (normalized === "auto" || normalized === "") {
    return autoSelectMode(subRegime || "INIT", stressMultiplier)
  }
  return isSupportedOptimizationMode(normalized) ? normalized : "budget"
}

export function resolveOptimizationSlot(mode: OptimizationMode | string | undefined): "brain" | "medium" | "cheap" {
  const normalized = normalizeOptimizationMode(mode)
  if (MEDIUM_ROOT_MODES.has(normalized as OptimizationMode)) return "medium"
  if (BRAIN_ROOT_MODES.has(normalized as OptimizationMode)) return "brain"
  return "cheap"
}

function buildModeRoot(mode: OptimizationMode): { mode_root: string; mode_family: string; cascade_depth: number; pipeline_root: string[] } {
  if (mode === "vibeqmax") {
    return { mode_root: "vibeqmax", mode_family: "brain-ml", cascade_depth: 1, pipeline_root: ["brain"] }
  }
  if (mode === "vibeultrax") {
    return { mode_root: "vibeultrax", mode_family: "cascade", cascade_depth: 3, pipeline_root: ["cheap", "medium", "brain"] }
  }
  if (mode === "vibemax") {
    return { mode_root: "vibemax", mode_family: "medium-ml", cascade_depth: 1, pipeline_root: ["medium"] }
  }
  if (mode === "quality") {
    return { mode_root: "quality", mode_family: "brain-runtime", cascade_depth: 1, pipeline_root: ["brain"] }
  }
  return {
    mode_root: mode,
    mode_family: "runtime",
    cascade_depth: 1,
    pipeline_root: mode === "speed" ? ["medium"] : mode === "budget" || mode === "balanced" || mode === "longrun" ? ["cheap"] : ["cheap"],
  }
}

function buildQmaxControlVector(state: { sub_regime?: string; latest_stress_multiplier?: number; user_text?: string; prompt?: string }): unknown {
  const subRegime = String(state?.sub_regime || "INIT").toUpperCase()
  const stress = Number(state?.latest_stress_multiplier ?? 0)
  const text = state?.user_text || state?.prompt || ""
  const qmax = vibeqmaxControlVector({
    sub_regime: state?.sub_regime || "INIT",
    stress_multiplier: stress,
    user_text: text,
  })
  return {
    enforcement_mode: qmax.enforcement_mode,
    enforcement_reason: `[optimize: vibeqmax] difficulty-driven brain root`,
    flow_mode: qmax.flow_mode,
    flow_focus: qmax.flow_focus || [],
    tdd_mode: qmax.tdd_mode,
    tdd_focus: qmax.tdd_focus || [],
    tier_bias: qmax.tier_bias,
    thinking_mode: qmax.thinking_mode,
    stress_multiplier: qmax.stress_multiplier,
    context7_urgency: qmax.context7_urgency,
    wbp_verbosity: qmax.wbp_verbosity,
    agent_mode: (subRegime === "REFINING" || subRegime === "CONVERGING" || subRegime === "CLOSED") && stress <= QUALITY_STRESS_THRESHOLD ? "plan" : undefined as unknown,
    optimization_mode: "vibeqmax",
    ...buildModeRoot("vibeqmax"),
    qmax_strategy: qmax.qmax_strategy,
    qmax_difficulty_score: qmax.qmax_difficulty_score,
    qmax_difficulty_level: qmax.qmax_difficulty_level,
    qmax_confidence: qmax.qmax_confidence,
    qmax_source_prediction: qmax.qmax_strategy,
    qmax_suggested_tier: qmax.qmax_suggested_tier,
    qmax_features: qmax.qmax_features,
    directives: [`[qmax root] Dedicated brain-ml root active for ${state?.sub_regime || "INIT"}.`],
  }
}

function buildUltraxControlVector(state: { sub_regime?: string; latest_stress_multiplier?: number; user_text?: string; prompt?: string }): unknown {
  const stress = Number(state?.latest_stress_multiplier ?? 0)
  const ultra = vibeultraxControlVector({
    sub_regime: state?.sub_regime || "INIT",
    stress_multiplier: stress,
    user_text: state?.user_text || state?.prompt || "",
  })
  return {
    ...ultra,
    enforcement_reason: `[optimize: vibeultrax] cascade root`,
    agent_mode: ultra.ultrax_profile === "deep" ? "plan" : undefined as unknown,
    directives: [`[ultrax root] Dedicated cascade root active for ${state?.sub_regime || "INIT"}.`],
  }
}

function legacyModeToCanonical(mode: string): { mode: "vibemax" | "vibeqmax" | "vibeultrax" | "vibelitex" | "raw"; overrides: Record<string, string> } {
  switch (mode) {
    case "vibemax":    return { mode: "vibemax",    overrides: {} }
    case "vibeqmax":   return { mode: "vibeqmax",   overrides: {} }
    case "vibeultrax": return { mode: "vibeultrax", overrides: {} }
    case "vibelitex":  return { mode: "vibelitex",  overrides: {} }
    case "raw":        return { mode: "raw",        overrides: {} }
    case "litex":      return { mode: "vibelitex",  overrides: {} }
    case "quality":    return { mode: "vibeqmax",   overrides: {} }
    case "audit":      return { mode: "vibeqmax",   overrides: { websearch: "encouraged", context7_urgency: "required" } }
    case "forensic":   return { mode: "vibeqmax",   overrides: { websearch: "encouraged", wbp_verbosity: "detailed" } }
    case "longrun":    return { mode: "vibeqmax",   overrides: { wbp_verbosity: "detailed" } }
    case "speed":      return { mode: "vibemax",    overrides: { thinking: "off", enforcement: "relaxed" } }
    case "balanced":   return { mode: "vibemax",    overrides: {} }
    case "budget":     return { mode: "vibelitex",  overrides: { tier: "cheap" } }
    default:           return { mode: "vibeultrax", overrides: {} }
  }
}

function buildOfflineControlVector(
  state: { sub_regime?: string; latest_stress_multiplier?: number },
  mode: OptimizationMode,
): unknown {
  const subRegime = String(state?.sub_regime || "INIT").toUpperCase()
  const stress = Number(state?.latest_stress_multiplier ?? 0)
  const looping = subRegime === "LOOPING"
  const { mode: canonicalMode, overrides } = legacyModeToCanonical(String(mode || ""))
  const bundle = computeAxisBundle(subRegime, canonicalMode, overrides, stress)
  const hardenedMode = looping ? "quality" : mode
  const hardenedRoot = looping ? buildModeRoot("quality") : buildModeRoot(mode)
  const agentMode = (subRegime === "REFINING" || subRegime === "CONVERGING" || subRegime === "CLOSED") && stress <= QUALITY_STRESS_THRESHOLD ? "plan" : undefined

  return {
    enforcement_mode: bundle.enforcement,
    enforcement_reason: looping
      ? "[optimize: LOOPING] recovery posture — tighten enforcement and preserve outcome detection"
      : `[optimize: ${mode}] using offline axis bundle`,
    flow_mode: bundle.flow,
    flow_focus: bundle.flow_focus,
    tdd_mode: bundle.tdd,
    tdd_focus: bundle.tdd_focus,
    tier_bias: bundle.tier,
    thinking_mode: bundle.thinking,
    stress_multiplier: bundle.stress_multiplier,
    context7_urgency: bundle.context7_urgency,
    wbp_verbosity: bundle.wbp_verbosity,
    agent_mode: agentMode,
    optimization_mode: hardenedMode,
    ...hardenedRoot,
    outcome_detection: true,
    directives: buildAxisDirectives(bundle, canonicalMode, looping),
  }
}

export function bootstrapOptimizationSession(): { mode: OptimizationMode; slot: "brain" | "medium" | "cheap" } {
  const sid = _OC_SID
  const sel = loadSelection()
  const sessionMode = loadSessionOptMode(sid)
  const globalMode = loadGlobalOptMode()
  const requestedMode = String(sel?.requested_optimization_mode || "").toLowerCase()
  const persistedMode = String(sel?.optimization_mode || "").toLowerCase()
  const resolvedMode =
    (sessionMode && sessionMode !== "auto" ? sessionMode : null) ||
    (globalMode && globalMode !== "auto" ? globalMode : null) ||
    (requestedMode && requestedMode !== "auto" ? requestedMode : null) ||
    (persistedMode && persistedMode !== "auto" ? persistedMode : null) ||
    DFLT_OPTIMIZATION_MODE
  const resolvedSlot = resolvedMode === "vibeultrax"
    ? "cheap"
    : resolveOptimizationSlot(resolvedMode)
  try {
    writeSessionOptMode(sid, resolvedMode)
    writeSessionSlot(sid, resolvedSlot)
    const state = loadBlackboxState()
    if (!state.sessions) state.sessions = {}
    if (sid && sid !== "undefined") {
      if (!state.sessions[sid]) state.sessions[sid] = {}
      state.sessions[sid].optimization_mode = resolvedMode
      state.sessions[sid].active_slot = resolvedSlot
      state.sessions[sid].sub_regime = state.sessions[sid].sub_regime || "INIT"
      state.sessions[sid].regime = state.sessions[sid].regime || "INIT"
      state.sessions[sid].resolution = state.sessions[sid].resolution || "unresolved"
      state.sessions[sid].momentum = Number(state.sessions[sid].momentum || 0)
      state.sessions[sid].loop_count = Number(state.sessions[sid].loop_count || 0)
      state.sessions[sid].loop_intervention_level = state.sessions[sid].loop_intervention_level || "none"
      state.sessions[sid].loop_start_turn = Number(state.sessions[sid].loop_start_turn || 0)
      state.sessions[sid].loop_pattern_count = Number(state.sessions[sid].loop_pattern_count || 0)
    }
    saveBlackboxState(state)
  } catch {}
  return { mode: resolvedMode, slot: resolvedSlot }
}

export async function selectOptimizationModeRemote(
  subRegime: string | undefined,
  stressMultiplier: number | undefined,
  fallbackMode: OptimizationMode | string | undefined,
): Promise<OptimizationMode> {
  const normalizedRequestedMode = normalizeOptimizationMode(fallbackMode)
  const fallback = resolveOptimizationMode(subRegime, stressMultiplier, fallbackMode)
  if (normalizedRequestedMode !== "auto" && normalizedRequestedMode !== "") return fallback
  if (isApiFallback()) return fallback
  try {
    const client = getApiClient()
    if (client) {
      const res = await client.blackboxSelectMode(subRegime || "INIT", Number(stressMultiplier ?? 0))
      const selected = normalizeOptimizationMode((res as unknown)?.mode || "")
      if (isSupportedOptimizationMode(selected) && selected !== "auto") return selected
    }
  } catch {}
  return fallback
}

function computeControlVector(
  _state: { sub_regime?: string; is_looping?: boolean; loop_intervention_level?: string; momentum?: number; n_interactions?: number; latest_stress_multiplier?: number },
  _action?: string,
  _optimizationMode?: OptimizationMode,
): unknown {
  const mode = resolveOptimizationMode(_state?.sub_regime, _state?.latest_stress_multiplier, _optimizationMode)
  if (mode === "vibeqmax") {
    return buildQmaxControlVector(_state)
  }
  if (mode === "vibeultrax") {
    return buildUltraxControlVector(_state)
  }
  return buildOfflineControlVector(_state, mode)
}

function buildControlHistoryEntry(
  turn: number,
  regime: string,
  control: unknown,
  reward: number | null = null,
): Record<string, unknown> | null {
  if (!control || typeof control !== "object" || Object.keys(control).length === 0) return null
  const entryControl = {
    enforcement_mode: control.enforcement_mode,
    flow_mode: control.flow_mode,
    tdd_mode: control.tdd_mode,
    tier_bias: control.tier_bias,
    thinking_mode: control.thinking_mode,
    stress_multiplier: control.stress_multiplier,
    context7_urgency: control.context7_urgency,
    wbp_verbosity: control.wbp_verbosity,
    cascade_depth: control.cascade_depth,
    pipeline_root: control.pipeline_root,
    ultrax_profile: control.ultrax_profile,
  }
  if (Object.values(entryControl).every((v) => v === undefined || v === null)) return null
  return {
    turn,
    regime,
    control: entryControl,
    reward,
  }
}

function classifyBlackboxAction(text: string): string {
  if (/refactor|change|replace|switch|pivot|migrate/i.test(text)) return "change"
  if (/commit|save|push|merge|release|finalize/i.test(text)) return "commit"
  if (/write|create|build|make|add|implement|generate/i.test(text)) return "act"
  if (/explain|why|how|what|analyze|review|check|find|search|look/i.test(text)) return "explore"
  if (/show|list|get|read|see|view|display|print/i.test(text)) return "observe"
  return "explore"
}

function computeBlackboxEntropy(features: unknown): number {
  const questionRatio = Number(features?.question_ratio || 0)
  const complexity = Number(features?.complexity || 0)
  const repetition = Number(features?.repetition || 0)
  const instructionDensity = Number(features?.instruction_density || 0)
  return Math.min(2.58, 0.5 + questionRatio * 0.5 + complexity * 0.8 + repetition * 0.6 + instructionDensity * 0.4)
}

function computeBlackboxUncertainty(features: unknown): number {
  const questionRatio = Number(features?.question_ratio || 0)
  const codeBlocks = Number(features?.code_blocks || 0)
  const sentiment = Number(features?.sentiment || 0.5)
  const urgency = Number(features?.urgency || 0)
  return Math.min(100, Math.max(10, 50 + questionRatio * 40 - codeBlocks * 10 + sentiment * 30 - urgency * 20))
}

function normalizeBlackboxFeatures(text: string): unknown {
  const features = ResolutionTracker.extractFeatures(text)
  return {
    features,
    action: classifyBlackboxAction(text),
    entropy: computeBlackboxEntropy(features),
    uncertainty: computeBlackboxUncertainty(features),
  }
}

function summarizeRecentToolActivity(limit = 5): unknown {
  const events = Array.isArray(recentToolEvents) ? recentToolEvents.slice(-limit) : []
  if (events.length === 0) return null
  const last = events[events.length - 1] || {}
  const actionType = String(last.action || last.kind || "").trim().toLowerCase()
  const toolTarget = `${String(last.tool || "").trim().toLowerCase()}:${String(last.target || "").trim().toLowerCase()}`
  const signature = `${toolTarget}:${actionType}`
  let repeatCount = 0
  for (let i = events.length - 1; i >= 0; i--) {
    const cur = events[i] || {}
    const curAction = String(cur.action || cur.kind || "").trim().toLowerCase()
    const curSig = `${String(cur.tool || "").trim().toLowerCase()}:${String(cur.target || "").trim().toLowerCase()}:${curAction}`
    if (curSig !== signature) break
    repeatCount++
  }
  return {
    tool: String(last.tool || "").toLowerCase(),
    target: String(last.target || "").toLowerCase(),
    action: actionType,
    signature,
    repeat_count: repeatCount,
    recent_count: events.length,
  }
}

function normalizeBlackboxHistoryEntry(entry: unknown): unknown {
  const text = typeof entry?.text === "string" ? entry.text : ""
  const fallback = normalizeBlackboxFeatures(text)
  const entryFeatures = entry?.features && typeof entry.features === "object" ? { ...fallback.features, ...entry.features } : fallback.features
  return {
    text,
    features: entryFeatures,
    action: typeof entry?.action === "string" && entry.action ? entry.action : fallback.action,
    entropy: Number.isFinite(Number(entry?.entropy)) ? Number(entry.entropy) : fallback.entropy,
    uncertainty: Number.isFinite(Number(entry?.uncertainty)) ? Number(entry.uncertainty) : fallback.uncertainty,
    embedding: Array.isArray(entry?.embedding) ? [...entry.embedding] : null,
    timestamp: Number.isFinite(Number(entry?.timestamp)) ? Number(entry.timestamp) : Date.now() / 1000,
    is_pivot: Boolean(entry?.is_pivot),
    outcome: typeof entry?.outcome === "string" ? entry.outcome : (entry?.outcome ?? null),
    activity: entry?.activity && typeof entry.activity === "object" ? { ...entry.activity } : null,
  }
}

function normalizeBlackboxHistory(history: unknown[]): unknown[] {
  if (!Array.isArray(history)) return []
  return history.map(normalizeBlackboxHistoryEntry)
}

function createResolutionTracker(data: unknown): ResolutionTracker {
  const tracker = new ResolutionTracker(data?.sessionId || _OC_SID, data?.maxHistory || 10)
  tracker.history = normalizeBlackboxHistory(data?.history || [])
  tracker.loopCount = Number(data?.loopCount || 0)
  tracker.pivotHistory = Array.isArray(data?.pivotHistory) ? [...data.pivotHistory] : []
  tracker.outcomeHistory = Array.isArray(data?.outcomeHistory) ? [...data.outcomeHistory] : []
  tracker.calibratedWeights = data?.calibratedWeights || null
  return tracker
}

class _BlackboxStub {
  tracker: ResolutionTracker
  static deserialize(data: unknown): _BlackboxStub {
    return new _BlackboxStub(data)
  }
  constructor(data: unknown = null) {
    this.tracker = createResolutionTracker(data)
  }
  update(text: string): unknown {
    const normalized = normalizeBlackboxFeatures(text)
    const recentActivity = summarizeRecentToolActivity()
    const state = this.tracker.update(text, normalized.features, normalized.action, normalized.entropy, normalized.uncertainty, null, recentActivity)
    return { ...state, ...normalized }
  }
  snapshot(): unknown {
    return this.tracker.snapshot()
  }
  serialize(): unknown {
    return this.tracker.serialize()
  }
  recordOutcome(outcome: unknown): void {
    this.tracker.recordOutcome(outcome)
  }
  getLoopIntervention(): unknown {
    return this.tracker.getLoopIntervention()
  }
  getPivotDirective(): unknown {
    return this.tracker.getPivotDirective()
  }
  setCalibratedWeights(weights: unknown): void {
    this.tracker.setCalibratedWeights(weights)
  }
  getHistory(): unknown[] {
    return this.tracker.getHistory()
  }
  getOutcomeHistory(): unknown[] {
    return this.tracker.getOutcomeHistory()
  }
}

let _blackboxTracker = null
let _blackboxTrackerHome = ""
let _prevOutputText = ""
let _latestBlackboxState = null
let _latestBlackboxStateHome = ""
let _latestBlackboxStateSessionId = ""
let _latestBlackboxLoopMsg = null
let _latestBlackboxPivotMsg = null

const WARN_DEDUPE_WINDOW_MS = 120 * 1000
const warnLogThrottle = new Map()
const warnPerSession = new Map()
const WARN_MAX_PER_SESSION = 3
const WARN_COALESCE_THRESHOLD = 10
const warnCoalesceCounters = new Map()

function updateState(mutator) {
  const stateFile = join(getVibeOSHome(), "delegation-state.json")
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = withFileLock(stateFile, () => {
        const preGen = (readJsonOrEmpty(stateFile)._gen || 0)
        let state = readJsonOrEmpty(stateFile)
        if (!state || typeof state !== "object") state = {}
        if (!state.session_started_at || state.session_started_at === "not-a-valid-date" || isNaN(Date.parse(state.session_started_at))) {
          state.session_started_at = new Date().toISOString()
        }
        state.lifetime ??= {}
        state.lifetime.missed_context7_usd ??= 0
        state.lifetime.cache_savings_usd ??= 0
        state.lifetime.total_savings_usd ??= 0
        state._ledgerFormatVersion ??= 2
        state._gen = preGen + 1
        const next = mutator(state) ?? state
        validateState(next, stateFile)
        mkdirSync(dirname(stateFile), { recursive: true })
        const tmp = stateFile + ".tmp"
        writeFileSync(tmp, JSON.stringify(next, null, 2))
        renameSync(tmp, stateFile)
        return next
      })
      if (!result || typeof result !== "object") return result
      const postGen = result._gen
      const onDiskGen = (readJsonOrEmpty(stateFile)._gen || 0)
      if (onDiskGen === postGen) return result
      if (attempt < MAX_RETRIES - 1) continue
      if (process.env.VIBEOS_DEBUG_INTERNALS === "1") {
        console.error("[vibeOS] WARN: updateState retry exhausted - possible state divergence")
      }
      return result
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) continue
      if (process.env.VIBEOS_DEBUG_INTERNALS === "1") {
        console.error("[vibeOS] updateState error: " + err.message)
      }
      return null
    }
  }
  return null
}

function loadTrinityModels() {
  try {
    const p = join(getVibeOSHome(), "model-tiers.json")
    if (!existsSync(p)) return { brain: "", cheap: "", medium: "" }
    const j = safeJsonParse(readFileSync(p, "utf-8"))
    return {
      brain:  j?.trinity?.brain?.oc  || j?.trinity?.brain  || "",
      cheap:  j?.trinity?.cheap?.oc  || j?.trinity?.cheap  || "",
      medium: j?.trinity?.medium?.oc || j?.trinity?.medium || "",
    }
  } catch { return { brain: "", cheap: "", medium: "" } }
}
const _trinityModels = loadTrinityModels()
const TRINITY_CHEAP_MOD = _trinityModels.cheap
const TRINITY_MEDIUM_MOD = _trinityModels.medium

export function getBlackboxTracker() {
  const currentHome = getVibeOSHome()
  if (_blackboxTrackerHome && _blackboxTrackerHome !== currentHome) {
    _blackboxTracker = null
    _latestBlackboxState = null
    _latestBlackboxStateHome = ""
    _latestBlackboxStateSessionId = ""
  }
  if (!_blackboxTracker) {
    _blackboxTrackerHome = currentHome
    const state = loadBlackboxState()
    if (state.enabled !== undefined) _setGlobalBlackboxEnabled(state.enabled)
    const sid = _OC_SID
    if (sid && sid !== "undefined" && state.sessions?.[sid]?.history) {
      _blackboxTracker = _BlackboxStub.deserialize(state.sessions[sid])
    } else if (currentProjectFingerprint && sid && sid !== "undefined") {
      const projectKeys = Object.keys(state.sessions || {}).filter(k => state.sessions[k].project_fingerprint === currentProjectFingerprint && k !== "undefined" && k !== null && k.trim() !== "")
      const latest = projectKeys.sort().slice(-1)[0]
      if (latest && state.sessions[latest]?.history) {
        const data = state.sessions[latest]
        _blackboxTracker = _BlackboxStub.deserialize(data)
      } else {
        _blackboxTracker = new _BlackboxStub()
      }
    } else {
      _blackboxTracker = new _BlackboxStub()
    }
    const localCal = computeLocalCalibration()
    if (localCal && _blackboxTracker?.setCalibratedWeights) {
      _blackboxTracker.setCalibratedWeights(localCal)
    }
  }
  return _blackboxTracker
}

function getBlackboxResolution() {
  try {
    const tracker = getBlackboxTracker()
    return tracker.snapshot()
  } catch { return null }
}

function computeLocalCalibration(): unknown {
  try {
    const calFile = join(getVibeOSHome(), "calibration-data.jsonl")
    if (!existsSync(calFile)) return null
    const lines = readFileSync(calFile, "utf-8").trim().split("\n").filter(Boolean)
    if (lines.length < 10) return null
    const _recent = lines.slice(-50)
    const state = loadBlackboxState()
    const allOutcomes = []
    for (const [sid, session] of Object.entries(state.sessions || {})) {
      if (session?.outcomeHistory?.length) {
        for (const o of session.outcomeHistory) {
          allOutcomes.push({ sid, outcome: o.outcome, turn: o.turn })
        }
      }
    }
    if (allOutcomes.length < 5) return null
    const positiveCount = allOutcomes.filter(o => o.outcome === "positive").length
    const ratio = positiveCount / allOutcomes.length
    return {
      loopJaccard: ratio > 0.7 ? 0.55 : 0.65,
      closureConfidence: ratio > 0.7 ? 0.75 : 0.65,
      exploringContradiction: ratio > 0.7 ? 0.15 : 0.25,
      momentum: [-0.3, 0.5, 0.2],
    }
  } catch { return null }
}

export function resolveEnforcementMode() {
  const sub = getLatestBlackboxState()?.sub_regime || "INIT"
  if (sub === "EXPLORING" || sub === "DIVERGENT") return "relaxed"
  if (sub === "LOOPING") return "strict"
  if (sub === "CONVERGING" || sub === "CLOSED") return "strict"
  return "normal"
}

async function syncOutcomeToApi(outcome) {
  try {
    const client = getApiClient()
    if (!client || isApiFallback()) return
    await client.blackboxOutcome(_OC_SID, outcome)
  } catch {}
}

export const BLACKBOX_API_DEADLINE_MS = 3000

export async function raceWithDeadline(promise, ms, onTimeout) {
  const TIMEOUT = Symbol("blackboxDeadline")
  const FAILED = Symbol("blackboxFailed")
  let timer = null
  const guarded = Promise.resolve(promise).catch(() => FAILED)
  const result = await Promise.race([
    guarded,
    new Promise((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), ms) }),
  ])
  if (timer) clearTimeout(timer)
  if (result === TIMEOUT || result === FAILED) {
    return typeof onTimeout === "function" ? onTimeout() : null
  }
  return result
}

export function mergeAuthoritativeBlackboxState(localState, apiResult) {
  if (!apiResult || typeof apiResult !== "object") return localState
  return reconcileStickyLoopState(localState, {
    ...localState,
    ...apiResult,
    source: "api",
    decision_source: "api",
  }, { now: Date.now(), source: "api" })
}

async function fetchBlackboxEnrichment(sessionId, userText, localState) {
  try {
    const client = getApiClient()
    if (!client || isApiFallback()) return null
    const analyze = client.blackboxAnalyze(sessionId, {
      userText: typeof userText === "string" ? userText : "",
      features: localState.features || {},
      action: localState.action || "explore",
      entropy: localState.entropy ?? 1.0,
      uncertainty: localState.uncertainty ?? 50,
      project_id: currentProjectFingerprint || null,
    })
    const result = await raceWithDeadline(analyze, BLACKBOX_API_DEADLINE_MS, () => null)
    if (result) {
      _latestBlackboxLoopMsg = result.loop_intervention_directive || null
      _latestBlackboxPivotMsg = result.pivot_directive || null
      return mergeAuthoritativeBlackboxState(localState, result)
    }
  } catch {}
  return null
}

function extractFirstWordFromArgs(tool, args) {
  try {
    if (!args || typeof args !== "object") return null
    const pick = (...vals) => vals.find(v => typeof v === "string" && v.trim())
    const raw = pick(
      args.prompt, args.query, args.url, args.command, args.cmd,
      args.oldString, args.newString, args.filePath, args.file_path,
    )
    if (!raw) return null
    const token = String(raw).trim().toLowerCase().split(/\s+/)[0] || ""
    return /^[a-z][a-z0-9_-]{1,24}$/.test(token) ? token : null
  } catch {
    return null
  }
}

function shouldLogWarn(key, windowMs = WARN_DEDUPE_WINDOW_MS) {
  const now = Date.now()
  const prev = warnLogThrottle.get(key) || 0
  if (now - prev < windowMs) return false
  warnLogThrottle.set(key, now)
  if (warnLogThrottle.size > 2000) {
    for (const [k, ts] of warnLogThrottle.entries()) {
      if (now - ts > windowMs * 10) warnLogThrottle.delete(k)
    }
    if (warnLogThrottle.size > 2000) {
      const entries = [...warnLogThrottle.entries()].sort((a, b) => a[1] - b[1])
      for (let i = 0; i < entries.length - 2000; i++) warnLogThrottle.delete(entries[i][0])
    }
  }
  // Session-level cap: max WARN_MAX_PER_SESSION fires per category
  const cat = key.split("|")[0]
  const ps = warnPerSession.get(cat) || 0
  if (ps >= WARN_MAX_PER_SESSION) {
    // Track for coalesce message
    const cc = (warnCoalesceCounters.get(cat) || 0) + 1
    warnCoalesceCounters.set(cat, cc)
    if (cc === WARN_COALESCE_THRESHOLD) {
      console.error("[vibeOS] " + cat + ": " + cc + " warnings coalesced — `trinity medium` recommended")
    }
    return false
  }
  warnPerSession.set(cat, ps + 1)
  return true
}

function noteTaskRoutingLearning(firstWord, targetModel, reason) {
  if (!firstWord || !/^[a-z][a-z0-9_-]{1,24}$/.test(firstWord)) return
  try {
    const now = new Date().toISOString()
    const nonExploratory = new Set(["build", "implement", "fix", "add", "update", "remove", "write", "edit", "refactor", "create"])
    // Per-project: store this learning in the current project bucket
    try {
      const pstate = loadProjectState()
      const fp = currentProjectFingerprint || projectFingerprint(process.cwd())
      const bucket = ensureProjectBucket(pstate, fp)
      bucket.taskWordPatterns ??= {}
      const localRow = bucket.taskWordPatterns[firstWord] || { total: 0, cheap: 0, medium: 0, high: 0, lastSeen: null }
      localRow.total += 1
      if (targetModel === TRINITY_CHEAP_MOD) localRow.cheap += 1
      else if (targetModel === TRINITY_MEDIUM_MOD) localRow.medium += 1
      else localRow.high += 1
      localRow.lastSeen = now
      bucket.taskWordPatterns[firstWord] = localRow
      saveProjectState(pstate)
    } catch {}

    updateGlobalLearning((gl) => {
      gl.task_first_words ??= {}
      const row = gl.task_first_words[firstWord] || { total: 0, cheap: 0, medium: 0, high: 0, lastSeen: null, lastReason: null }
      row.total += 1
      if (targetModel === TRINITY_CHEAP_MOD) row.cheap += 1
      else if (targetModel === TRINITY_MEDIUM_MOD) row.medium += 1
      else row.high += 1
      row.lastSeen = now
      row.lastReason = reason || "unknown"
      gl.task_first_words[firstWord] = row

      // Cross-project pattern merging: search other project buckets with overlapping techStack
      try {
        const pstate = loadProjectState()
        const currentFp = currentProjectFingerprint || ""
        const currentTech = currentFp ? pstate.project_hashes?.[currentFp]?.techStack : null
        if (currentTech && Array.isArray(currentTech) && currentTech.length > 0) {
          for (const [fp, bucket] of Object.entries(pstate.project_hashes || {})) {
            if (fp === currentFp) continue
            const otherTech = bucket?.techStack
            if (!otherTech || !Array.isArray(otherTech)) continue
            if (!otherTech.some(t => currentTech.includes(t))) continue
            const otherRow = bucket?.taskWordPatterns?.[firstWord]
            if (otherRow && otherRow.total) {
              row.total += otherRow.total
            }
          }
        }
      } catch {}
      gl.task_first_words[firstWord] = row

      // Learn portable exploratory intent across projects after repeated cheap-safe routes.
      if (!nonExploratory.has(firstWord) && row.cheap >= 3 && row.cheap / Math.max(1, row.total) >= 0.7) {
        gl.exploratory_words ??= {}
        const e = gl.exploratory_words[firstWord] || { count: 0, lastSeen: null }
        e.count += 1
        e.lastSeen = now
        gl.exploratory_words[firstWord] = e
      }
      return gl
    })
  } catch {}
}

// State accessors — called from index.ts to sync mutable state
export function setProjectFingerprint(fp) {
  setCurrentProjectFingerprint(fp)
}

export function getBlackboxEnabled() {
  return _blackboxEnabled
}

export function setBlackboxEnabled(val) {
  _setGlobalBlackboxEnabled(val)
}

export function getLatestBlackboxState() {
  if (_latestBlackboxStateHome && _latestBlackboxStateHome !== getVibeOSHome()) return null
  if (_latestBlackboxStateSessionId && _latestBlackboxStateSessionId !== getCurrentSessionId()) return null
  return _latestBlackboxState
}

export function setLatestBlackboxState(val) {
  _latestBlackboxState = val
  _latestBlackboxStateHome = getVibeOSHome()
  _latestBlackboxStateSessionId = getCurrentSessionId()
}

export function getLatestBlackboxLoopMsg() {
  return _latestBlackboxLoopMsg
}

export function setLatestBlackboxLoopMsg(val) {
  _latestBlackboxLoopMsg = val
}

export function getLatestBlackboxPivotMsg() {
  return _latestBlackboxPivotMsg
}

export function setLatestBlackboxPivotMsg(val) {
  _latestBlackboxPivotMsg = val
}

export function getOC_SID() {
  return _OC_SID
}

// ── Optimization Mode persistence ───────────────────────────────────────
// Stored in blackbox-state.json under sessions[<SID>].optimization_mode
// Default: "budget" (fresh session / restart). User can lock per session.
const DFLT_OPTIMIZATION_MODE = "budget"

function recoverOptimizationModeFromSelection(sel: unknown): string {
  const slot = String(sel?.active_slot || "").toLowerCase()
  if (slot === "brain") return "quality"
  if (slot === "medium") return "vibemax"
  if (slot === "cheap") return "budget"
  return "budget"
}

function recoverOptimizationModeFromLiveState(sel: unknown): string {
  const liveTier = String(currentTier || "").toLowerCase()
  if (liveTier === "high") return "quality"
  if (liveTier === "mid") return "vibemax"
  if (liveTier === "cheap" || liveTier === "budget") return "budget"
  return recoverOptimizationModeFromSelection(sel)
}

export function loadOptimizationMode(): string {
  try {
    const sel = loadSelection()
    const persistedMode = sel.optimization_mode || null
    const prevKey = `${_OC_SID}_prev_opt`
    const sessionMode = loadSessionOptMode(_OC_SID)
    const globalMode = loadGlobalOptMode()
    const liveRecovery = recoverOptimizationModeFromLiveState(sel)
    const storedModes = [
      persistedMode,
      sel.previous_optimization_mode,
      loadSessionOptMode(prevKey),
      sessionMode,
      globalMode,
    ].map(mode => String(mode || "").toLowerCase())
    if (storedModes.includes("vibelitex")) {
      const recoveryMode =
        (sel.previous_optimization_mode && sel.previous_optimization_mode !== "vibelitex" ? sel.previous_optimization_mode : "") ||
        loadSessionOptMode(prevKey) ||
        (sessionMode && sessionMode !== "vibelitex" ? sessionMode : "") ||
        (globalMode && globalMode !== "vibelitex" ? globalMode : "") ||
        liveRecovery
      if (recoveryMode && recoveryMode !== "vibelitex") {
        try { writeSelection("optimization_mode", recoveryMode) } catch {}
        try { writeSelection("previous_optimization_mode", null) } catch {}
        try { writeSessionOptMode(_OC_SID, recoveryMode) } catch {}
        try { writeSessionOptMode(prevKey, "") } catch {}
        return recoveryMode
      }
    }
    if (sessionMode && sessionMode !== "auto") return sessionMode
    if (globalMode && globalMode !== "auto") return globalMode
    return DFLT_OPTIMIZATION_MODE
  } catch { return DFLT_OPTIMIZATION_MODE }
}

export function saveOptimizationMode(mode: string): boolean {
  try {
    writeSessionOptMode(_OC_SID, mode)
  } catch (e) {
    console.error("[vibeOS] saveOptimizationMode session write failed: " + e.message)
  }
  try {
    if (mode && mode !== "auto") saveGlobalOptMode(mode)
    return true
  } catch (e) {
    console.error("[vibeOS] saveOptimizationMode global write failed: " + e.message)
    return false
  }
}

// ── Turn counter for compaction triggers ───────────────────────────────
// Stored in blackbox-state.json under sessions[<SID>].turn_counter
// Incremented each interaction turn. At % 10 === 0, compaction fires.

export function getTurnCounter(): number {
  try {
    const state = loadBlackboxState()
    const sid = _OC_SID
    return state.sessions?.[sid]?.turn_counter || 0
  } catch { return 0 }
}

export function incrementTurnCounter(): number {
  try {
    const state = loadBlackboxState()
    const sid = _OC_SID
    if (!state.sessions) state.sessions = {}
    if (sid && sid !== "undefined") {
      if (!state.sessions[sid]) state.sessions[sid] = {}
      const next = (state.sessions[sid].turn_counter || 0) + 1
      state.sessions[sid].turn_counter = next
    }
    saveBlackboxState(state)
    return 0
  } catch { return 0 }
}

export { autoSelectMode, computeControlVector, buildControlHistoryEntry }

export {
  // Blackbox
  getBlackboxResolution,
  syncOutcomeToApi,
  fetchBlackboxEnrichment,
  // Warnings
  extractFirstWordFromArgs,
  shouldLogWarn,
  // Global learning
  loadGlobalLearning,
  updateGlobalLearning,
  getLearnedExploratoryWords,
  noteTaskRoutingLearning,
  // Missed context7
  recordMissedContext7,
  // State helpers
  updateState,
  loadProjectState,
  saveProjectState,
  ensureProjectBucket,
  projectFingerprint,
  withFileLock,
  readJsonOrEmpty,
  detectTechStack,
  loadBlackboxState,
  saveBlackboxState,
}

export function resetBlackboxTracker() {
  _blackboxTracker = null
  _blackboxTrackerHome = ""
  _latestBlackboxState = null
  _latestBlackboxStateHome = ""
  _latestBlackboxStateSessionId = ""
}

export function resetTurnClassifyRuntimeState() {
  _latestBlackboxLoopMsg = null
  _latestBlackboxPivotMsg = null
  _lastClassifiedByApi = false
  _lastApiPredictedMode = ""
  resetBlackboxTracker()
}


// ── Alias exports for hooks/tool-execute.ts compatibility ──
export { getBlackboxTracker as _getBlackboxTracker };
export function _isLikelyOffTopic(text, projectName) { return false; }
export function _loadGlobalLearning() { return { exploratoryWords: [], noisyWords: [], userTerms: [] }; }
export function _updateGlobalLearning(word, type, intent) { /* noop */ }

