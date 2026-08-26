// @ts-nocheck
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, appendFileSync } from "node:fs"
import { join, basename } from "node:path"
import { createHash } from "node:crypto"
import {
  currentTier, currentModel, currentProjectFingerprint, currentProjectName,
  _modelLocked, _blackboxEnabled,
  loadSelection, writeSelection, _readLifetimeSavings,
  _updateState, _withFileLock, safeJsonParse, applyDecadence,
  getSessionScratchpadDir, ensureSessionScratchpadDirs, _getSessionIndexPath,
  indexAppend, _scratchpadHitsSeen, briefedProjects,
  _loadActiveJobs, getActiveJobForProject, loadTodos,
  loadProjectState, saveProjectState, _ensureProjectBucket,
  touchProjectBucket,
  promotedProjectPatterns,
  detectTechStack, projectFingerprint,
  _loadMLState, _saveMLState,
  SCRATCHPAD_ROOT,
  TIERS_FILE,
  loadGlobalLearning,
  _getLearnedExploratoryWords,
  setCurrentProjectFingerprint, setCurrentProjectName,
  stableJson, TOOL_NAME_NORMALIZE,
  loadSessionOrchestration,
  _cacheDb, recordCacheSaving, getVibeOSHome, safeCopyIntoSession,
  _OC_SID,
} from "../state.js"
import { getLatestBlackboxLoopMsg, getLatestBlackboxPivotMsg, getLatestBlackboxState, resetBlackboxTracker, setLatestBlackboxState } from "../cascade.js"
import { appendJsonlWithRotation } from "../../utils/fs-helpers.js"
import { shouldSuppressLoopNotice } from "../loop-state.js"
import { nextTurn } from "../turn-memo.js"
import { evaluateClaimEvidence } from "../session-health.js"
import { projectTreeDirective, recordProjectFact } from "../project-tree.js"
import {
  _classify, _modelCostPerTurn, _isModelFree, _detectContext7, _isDocsTarget,
  _shortModelName, _formatUsd, _refreshModel, applySlot, reconcileSlotModel, loadTrinitySlotsFromTiersFile, TRINITY_CHEAP, TRINITY_MEDIUM, TRINITY_BRAIN,
  cacheSavePer1MInputTokens,
  clearWorkspaceFollowupPauseForSession,
} from "../pricing.js"
import {
  scoreStress, classifyTurnSimple, classifyTurnRemote, loadOptimizationMode,
  computeControlVector,
  getBlackboxTracker,
  loadBlackboxState as loadBlackboxStateFromCtx, saveBlackboxState as saveBlackboxStateToCtx,
  extractLastUserText,
  isLikelyOffTopic,
  updateGlobalLearning as _updateGlobalLearning,
  fetchBlackboxEnrichment,
  estimateContextBudget,
  buildControlHistoryEntry,
  setBlackboxEnabled,
  BRANDED_MODES, RUNTIME_MODES, MODE_TABLE, normalizeLegacyMode,
} from "../cascade.js"
import { addCacheEntry, extractRecentCacheOutputs } from "../../vibeOS-lib/smart-cache.js"
import { getApiClient, remoteCall, isApiConnected, isApiFallback } from "../api-client.js"
import { computeDifficulty } from "../../vibeOS-lib/ml-router.js"
import { loadCredit } from "../credit-api.js"
import { loadSessionOptMode, loadSessionSlot, writeSessionSlot } from "../selection-manager.js"
import { buildSessionBridge, recordSessionBridge } from "./footer.js"
import { noteProjectPattern } from "../index-helpers.js"
import { saveSessionStress } from "../index-helpers.js"
import { COMPRESS_THRESHOLD, KEEP_HOT, COMPRESS_MARKER, PROTOCOL_MARKER, PROTOCOL_TEXT } from "../constants.js"
import { TEMPLATES, DEFAULT_TEMPLATE, resolveTemplate, shouldInjectTemplate, resolveSessionTemplateDefinition } from "../templates.js"
import { getRealityCheckView } from "../../vibeOS-lib/flow-enforcer.js"
import { installVibeTierAgents } from "../runtime-config.js"

const BYTES_PER_TOKEN = 4

// Static directives — built once, reused every turn
const ANTI_FABRICATION_DIRECTIVE = "[anti-fabrication] Always work honestly — do NOT make up tool names, file paths, function signatures, code snippets, or exact outputs. If you must explain something you cannot verify, say 'I cannot verify that' and propose how to verify it. Under NO circumstance invent tool invocations, file contents, or final results. If you must correct an earlier response, say exactly what was wrong and then provide the corrected response. DO NOT LGTM."

const EMPIRICAL_ANSWER_DIRECTIVE = "[empirical answer] Prefer verified facts over assumptions. If something is not directly checked against tools, files, logs, or user-provided evidence, label it as unverified or say 'I cannot verify that'. Separate evidence, inference, and suggestions. In multi-turn work, carry forward only evidence-backed facts and keep any guess explicitly marked as a guess."

const _REALITY_CHECK_DIRECTIVE = "[reality-check global] Before saying something is done, complete, ready, successful, trained, fixed, or working, verify the actual files and state on disk. If the user asks for a reality check, read the relevant files first and report only verified facts. [claim enforcement] If you make a claim like 'done', 'fixed', 'validated', 'works', or 'score' without first reading relevant files to confirm, the verify-claim runtime will flag it as unverified."

// Deterministic anti-loop directive — always injected, not gated behind blackbox detection
const ANTI_LOOP_DIRECTIVE = "[anti-loop cost guard] Token waste is real money: if you detect the conversation is looping (repeating the same diagnosis, retrying the same fix, asking the same question, re-explaining the same concept, regenerating similar tool output), immediately break the loop by: (1) summarizing what has been tried in 1 line, (2) stating what is actually different this turn, (3) trying a substantially different approach, or (4) asking the user to clarify the goal. Do NOT continue a failing approach more than 3 times — each redundant retry burns tokens at real cost. When stuck, step back, simplify, and be honest about uncertainty."

// Cached context7 directive builder — only rebuilds when urgency changes
let _cachedC7Full: string | null = null
let _cachedC7Urgency: string | null = null

export function mergeRemoteControlVector(remoteControlVector: unknown, localControlVector: unknown, options: unknown = {}): unknown {
  const merged = { ...remoteControlVector }
  if (!options?.allowLocalOverride) return merged
  return {
    ...merged,
    agent_mode: localControlVector?.agent_mode,
    tier_bias: localControlVector?.tier_bias,
    optimization_mode: localControlVector?.optimization_mode,
    enforcement_mode: localControlVector?.enforcement_mode,
    flow_mode: localControlVector?.flow_mode,
    tdd_mode: localControlVector?.tdd_mode,
    thinking_mode: localControlVector?.thinking_mode,
  }
}

function ensureProjectContext(hookDirectory: string): string {
  const resolved = projectFingerprint(hookDirectory || currentProjectFingerprint || process.cwd() || "")
  if (resolved && resolved !== currentProjectFingerprint) setCurrentProjectFingerprint(resolved)
  if (hookDirectory) {
    const name = hookDirectory.split("/").filter(Boolean).pop() || "unknown"
    if (name && name !== currentProjectName) setCurrentProjectName(name)
  }
  try {
    if (resolved) {
      const pstate = loadProjectState()
      touchProjectBucket(pstate, resolved, {
        sessionId: _OC_SID,
        projectName: currentProjectName || (hookDirectory ? hookDirectory.split("/").filter(Boolean).pop() || "" : ""),
      })
      saveProjectState(pstate)
    }
  } catch {}
  return resolved
}

function vibeUltraXSubagentForSlot(slot: string | null): string | null {
  if (slot === "brain") return "vibe-brain"
  if (slot === "medium") return "vibe-medium"
  if (slot === "cheap") return "vibe-cheap"
  return null
}

function taskSubagentTypeForSlot(slot: string | null): string | null {
  if (slot === "brain" || slot === "medium" || slot === "cheap") return "general"
  return null
}

function modelForSlot(slot: string | null): string | null {
  if (slot === "brain") return TRINITY_BRAIN
  if (slot === "medium") return TRINITY_MEDIUM
  if (slot === "cheap") return TRINITY_CHEAP
  return null
}

function getRuntimeProjectDirectory(): string {
  return String((onSystemTransform as unknown)?._directory || process.cwd?.() || "")
}

// Memoizes the last (directory, slot, trinity) signature this process has already
// installed, so repeated calls within the same turn — or from a duplicate plugin
// instance, since OpenCode can load this plugin both globally and per-project in
// the same server process — skip the file read/parse entirely instead of re-checking
// on every chat.system.transform call.
let _lastVibeTierAgentsSignature = ""

function ensureVibeUltraXSubagents(activeSlot: string | null = null, projectDir = ""): boolean {
  try { loadTrinitySlotsFromTiersFile() } catch {}
  const directory = projectDir || getRuntimeProjectDirectory()
  const signature = `${directory}|${activeSlot}|${TRINITY_CHEAP}|${TRINITY_MEDIUM}|${TRINITY_BRAIN}`
  if (signature === _lastVibeTierAgentsSignature) return false
  // Scoped to this project's own opencode.json only (never the global homes): the
  // desktop app runs ONE server process shared across every open project tab, and a
  // write here landing on a shared global config races that process's other live
  // turns/tabs. Global homes already get the same agent install at deploy/setup time
  // (scripts/deploy.mjs, scripts/build-bundle.mjs, bin/setup.js) — a rare, explicit,
  // single-process operation, not a per-turn hook running inside a shared server.
  const result = installVibeTierAgents(directory, {
    cheap: { oc: TRINITY_CHEAP },
    medium: { oc: TRINITY_MEDIUM },
    brain: { oc: TRINITY_BRAIN },
  }, activeSlot, { includeGlobalHomes: false })
  _lastVibeTierAgentsSignature = signature
  return result.changed.length > 0
}

let latestUserIntent = null
let _latestBlackboxState = null
let _prevOutputText = ""
let _prevBlackboxRegime = null
let _currentTemplate = DEFAULT_TEMPLATE
let _currentTemplateSignature = DEFAULT_TEMPLATE
let _prevTemplate = null
let _prevTemplateSignature = null
let _turnCountInject = 0
let _pivotLastCheckTurn = 0
let _pivotLastRegime: string | null = null
let _lastLoopNoticeSignature: string | null = null
let _lastLoopNoticeAt = 0
let _calBuffer: string[] = []
let _pendingOrchestratorDirective = ""
// CV computed by trackBlackbox for the current turn, keyed by session+intent so
// onSystemTransform can reuse the exact same control vector (and avoid a second
// backend round-trip) when messages.transform ran first in the hook cycle.
let _turnCvCache: { key: string; cv: unknown } | null = null
let _chatTransformHome = getVibeOSHome()
const correctionSeenKeys = new Set()

function isGreetingLike(text: string): boolean {
  const value = String(text || "").trim().toLowerCase()
  return value === "hi" || value === "hello" || value === "hey" || value === "yo" || /^hi[!.?\s]*$/.test(value) || /^hello[!.?\s]*$/.test(value) || /^hey[!.?\s]*$/.test(value)
}

function resetChatTransformStateForHome(): void {
  const currentHome = getVibeOSHome()
  if (currentHome === _chatTransformHome) return
  resetChatTransformState()
  _chatTransformHome = currentHome
}

export function resetChatTransformState(): void {
  latestUserIntent = null
  _latestBlackboxState = null
  _prevOutputText = ""
  _prevBlackboxRegime = null
  _currentTemplate = DEFAULT_TEMPLATE
  _currentTemplateSignature = DEFAULT_TEMPLATE
  _prevTemplate = null
  _prevTemplateSignature = null
  _turnCountInject = 0
  _pivotLastCheckTurn = 0
  _pivotLastRegime = null
  _lastLoopNoticeSignature = null
  _lastLoopNoticeAt = 0
  _calBuffer = []
  _pendingOrchestratorDirective = ""
  correctionSeenKeys.clear()
  resetBlackboxTracker()
  setLatestBlackboxState(null)
}

async function apiComputeControlVector(state: unknown, action: unknown, optimizationMode: unknown): Promise<unknown> {
  try {
    const decisionInput = typeof optimizationMode === "string"
      ? {
        optimization_mode: optimizationMode,
        requested_mode: optimizationMode,
        requested_slot: null,
        pipeline_root: null,
        source: null,
      }
      : (optimizationMode || {})
    const effectiveMode = String(decisionInput?.optimization_mode || decisionInput?.requested_mode || "auto")
    const requestedMode = String(decisionInput?.requested_mode || effectiveMode)
    const res = await remoteCall("blackboxControlVector", [state, action, {
      optimization_mode: effectiveMode,
      requested_mode: requestedMode,
      requested_slot: decisionInput?.requested_slot || null,
      pipeline_root: decisionInput?.pipeline_root || null,
      source: decisionInput?.source || null,
    }], null)
    if (res && typeof res === "object") {
      return normalizeBackendDecision({
        ...res,
        optimization_mode: res?.optimization_mode || effectiveMode,
        requested_mode: res?.requested_mode || requestedMode,
      }, effectiveMode)
    }
  } catch {}
  const fallbackMode = typeof optimizationMode === "string"
    ? optimizationMode
    : String(optimizationMode?.optimization_mode || optimizationMode?.requested_mode || "auto")
  const controlVector = computeControlVector(state, action, fallbackMode)
  return normalizeBackendDecision({
    ...controlVector,
    control_vector: controlVector,
    decision: {
      optimization_mode: controlVector.optimization_mode || fallbackMode,
      tier_bias: controlVector.tier_bias || null,
      pipeline_root: controlVector.pipeline_root || [],
      source: "local",
      requested_mode: fallbackMode,
      requested_slot: controlVector.tier_bias || null,
    },
  }, fallbackMode)
}

async function apiResolveEmbeddingMode(sessionId: string, state: unknown, requestedMode: unknown, userText: unknown): Promise<unknown> {
  try {
    const text = String(userText || state?.user_text || state?.prompt || "").trim()
    if (!text) return null
    const normalizedRequestedMode = String(requestedMode || "auto").trim().toLowerCase()
    const res = await remoteCall("blackboxSelectModeEmbedding", [sessionId, {
      project_id: currentProjectFingerprint || null,
      userText: text,
      prompt: text,
      optimization_mode: normalizedRequestedMode || null,
    }], null)
    if (!res || typeof res !== "object") return null
    const mode = String(res.mode || "").trim().toLowerCase()
    if (!mode) return null
    return {
      optimization_mode: mode,
      requested_mode: normalizedRequestedMode || mode,
      requested_slot: slotFromMode(mode),
      source: "backend+embedding",
      embedding: res.embedding || null,
    }
  } catch {}
  return null
}

function normalizeSlot(value: unknown): "brain" | "medium" | "cheap" | null {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "brain" || normalized === "medium" || normalized === "cheap") return normalized
  return null
}

function slotFromMode(mode: unknown): "brain" | "medium" | "cheap" | null {
  const normalized = String(mode || "").trim().toLowerCase()
  if (!normalized || normalized === "auto") return null
  if (normalized === "speed" || normalized === "vibemax" || normalized === "vibelitex") return "medium"
  if (normalized === "quality" || normalized === "longrun" || normalized === "audit" || normalized === "forensic" || normalized === "vibeqmax") return "brain"
  if (normalized === "vibeultrax") return "cheap"
  if (normalized === "budget" || normalized === "balanced") return "cheap"
  return null
}

function normalizePipelineRoot(value: unknown, tierBias: unknown): string[] {
  if (Array.isArray(value)) {
    const out = value.map((entry) => normalizeSlot(entry)).filter(Boolean)
    if (out.length > 0) return out
  }
  const slot = normalizeSlot(value) || normalizeSlot(tierBias)
  return slot ? [slot] : []
}

function modeCascadeRoot(mode: unknown, fallbackPipeline: unknown = null, tierBias: unknown = null): string[] {
  const normalized = String(mode || "").trim().toLowerCase()
  if (normalized === "vibeultrax") return ["cheap", "medium", "brain"]
  const canonical = normalizeLegacyMode(normalized)
  const modeEntry = MODE_TABLE[canonical] || [...BRANDED_MODES, ...RUNTIME_MODES].find((e: unknown) => (e as { id: string }).id === normalized)
  if (modeEntry?.pipeline?.length) return modeEntry.pipeline
  return normalizePipelineRoot(fallbackPipeline, tierBias)
}

// Slices the durable pipeline down to "how far this turn actually escalated" —
// cheap → ["cheap"], medium → ["cheap","medium"], brain → the full route.
// Also used directly by tool-execute.ts (as the single implementation,
// replacing its own former duplicate _routePathForSlot) wherever a route
// array and slot are already in hand — normalizePipelineRoot/normalizeSlot
// are no-ops on already-clean inputs.
export function normalizeRoutePath(value: unknown, fallbackSlot: unknown): string[] {
  const route = normalizePipelineRoot(value, fallbackSlot)
  const slot = normalizeSlot(fallbackSlot)
  if (!slot) return route
  const idx = route.indexOf(slot)
  if (idx === -1) return [...route, slot]
  return route.slice(0, idx + 1)
}

function isVibeUltraXMode(mode: unknown): boolean {
  return String(mode || "").trim().toLowerCase() === "vibeultrax"
}

function rootSlotForControlVector(cv: unknown, durablePipeline: string[]): string | null {
  if (isVibeUltraXMode(cv?.optimization_mode)) return durablePipeline[0] || "cheap"
  return normalizeSlot(cv?.tier_bias) || normalizeSlot(cv?.selected_slot) || null
}

function normalizeBackendDecision(raw: unknown, fallbackMode: unknown = null): unknown {
  if (!raw || typeof raw !== "object") return raw
  const sourceDecision = raw.decision && typeof raw.decision === "object" ? raw.decision : raw
  const requestedMode = String(sourceDecision.requested_mode || sourceDecision.requestedMode || fallbackMode || raw.requested_mode || raw.requestedMode || "").trim().toLowerCase() || null
  const requestedSlot = normalizeSlot(sourceDecision.requested_slot || sourceDecision.requestedSlot || slotFromMode(requestedMode)) || null
  const optimizationMode = String(sourceDecision.optimization_mode || sourceDecision.mode || fallbackMode || raw.optimization_mode || raw.mode || requestedMode || "auto").trim().toLowerCase()
  const selectedSlot = normalizeSlot(sourceDecision.selected_slot || sourceDecision.selectedSlot || raw.selected_slot || raw.selectedSlot || sourceDecision.tier_bias || sourceDecision.active_slot || raw.tier_bias || raw.active_slot || slotFromMode(optimizationMode) || requestedSlot) || null
  const tierBias = isVibeUltraXMode(optimizationMode || requestedMode) ? "cheap" : selectedSlot
  const routePath = normalizeRoutePath(sourceDecision.route_path || sourceDecision.routePath || raw.route_path || raw.routePath || sourceDecision.pipeline_root || raw.pipeline_root || raw.active_pipeline, selectedSlot)
  const cascadeRoot = modeCascadeRoot(optimizationMode || requestedMode, sourceDecision.cascade_root || sourceDecision.cascadeRoot || raw.cascade_root || raw.cascadeRoot || sourceDecision.active_pipeline || raw.active_pipeline || sourceDecision.pipeline_root || raw.pipeline_root, selectedSlot)
  const pipelineRoot = cascadeRoot.length ? cascadeRoot : routePath
  const source = String(sourceDecision.source || raw.source || raw.optimization_source || "backend")
  const decision = {
    optimization_mode: optimizationMode || null,
    tier_bias: tierBias,
    selected_slot: selectedSlot,
    pipeline_root: pipelineRoot,
    cascade_root: cascadeRoot,
    route_path: routePath,
    cascade_depth: routePath.length || pipelineRoot.length || 1,
    source,
    requested_mode: requestedMode,
    requested_slot: requestedSlot,
  }
  const baseControlVector = raw.control_vector && typeof raw.control_vector === "object" ? raw.control_vector : raw
  const controlVector = {
    ...baseControlVector,
    optimization_mode: decision.optimization_mode,
    tier_bias: decision.tier_bias,
    selected_slot: decision.selected_slot,
    pipeline_root: decision.pipeline_root,
    cascade_root: decision.cascade_root,
    route_path: decision.route_path,
    cascade_depth: decision.cascade_depth,
    route_source: decision.source,
  }
  return {
    ...raw,
    optimization_mode: decision.optimization_mode,
    tier_bias: decision.tier_bias,
    selected_slot: decision.selected_slot,
    pipeline_root: decision.pipeline_root,
    cascade_root: decision.cascade_root,
    route_path: decision.route_path,
    cascade_depth: decision.cascade_depth,
    route_source: decision.source,
    source: decision.source,
    requested_mode: decision.requested_mode,
    requested_slot: decision.requested_slot,
    decision,
    control_vector: controlVector,
  }
}

function observeUserCorrection(text: string | null): void {
  if (!text || typeof text !== "string") return
  try {
    const t = text.toLowerCase()
    const corrections: string[] = []
    if (/wrong\b|that.s wrong|incorrect|not what i|didn.t mean|misunderstood/i.test(t)) {
      if (/\bimport\b|require\b|from\b|path\b|module\b/i.test(t)) corrections.push("correction:imports")
      if (/\bfunction\b|logic\b|algorithm\b|calculation\b|formula\b|return\b|result\b/i.test(t) && !corrections.includes("correction:imports")) corrections.push("correction:logic")
      if (/\brename\b|variable\b|const\b|let\b|var\b|name\b|called\b/i.test(t) && !corrections.includes("correction:logic")) corrections.push("correction:naming")
      if (/\bdelete\b|remove\b|get rid\b|revert\b|undo\b|rollback\b/i.test(t)) corrections.push("correction:deletion")
      if (/\brestructure\b|refactor\b|reorganize\b|move\b|split\b|extract\b/i.test(t) && !corrections.includes("correction:deletion")) corrections.push("correction:restructure")
      if (corrections.length === 0) corrections.push("correction:general")
    }
    if (corrections.length === 0 && /\bshould be\b|change .+ to\b|replace .+ with\b|instead of\b/i.test(t)) {
      corrections.push("correction:general")
    }
    for (const c of corrections) {
      const sessionKey = `friction:${c}`
      if (correctionSeenKeys.has(sessionKey)) continue
      correctionSeenKeys.add(sessionKey)
      try {
        noteProjectPattern("friction", c, `User corrected ${c.replace("correction:", "")} in a follow-up message.`, { family: c })
      } catch {}
    }
  } catch {}
}

function _buildProjectBriefing(directory: string): string | null {
  const label = currentProjectName || (directory ? basename(directory) : "")
  if (!label) return null
  return `[project memory] Active project: ${label}. Stay focused on the current repository and prefer the existing workflow.`
}

function compactMemoryText(text: string, limit: number): string {
  const clean = String(text || "").replace(/\s+/g, " ").trim()
  if (!clean) return ""
  if (clean.length <= limit) return clean
  return clean.slice(0, Math.max(0, limit - 1)).trimEnd() + "…"
}

export function projectMemoryDirective(fp: string): string | null {
  const pstate = loadProjectState()
  const proj = fp ? pstate?.project_hashes?.[fp] : null
  const label = currentProjectName || proj?.projectName || ""
  if (!label && !proj) return null

  const parts = [`[project memory: compressed] Active project: ${label || "unknown"}.`]
  if (proj) {
    const sessionCount = Number(proj.totalSessions || 0)
    const reportCount = Array.isArray(proj.reports) ? proj.reports.length : 0
    const topics = Array.isArray(proj.commonTopics) ? proj.commonTopics.slice(0, 3).map((topic: string) => compactMemoryText(topic, 32)).filter(Boolean) : []
    const techStack = Array.isArray(proj.techStack) ? proj.techStack.slice(0, 3).filter(Boolean) : []
    parts.push(`Sessions: ${sessionCount}.`)
    if (reportCount > 0) parts.push(`Reports: ${reportCount}.`)
    if (proj.researchChains) parts.push(`Research chains: ${proj.researchChains}.`)
    if (proj.context7Bypasses) parts.push(`Context7 bypasses: ${proj.context7Bypasses}.`)
    if (techStack.length > 0) parts.push(`Tech: ${techStack.join(", ")}.`)
    if (topics.length > 0) parts.push(`Topics: ${topics.join(", ")}.`)
  }

  const patterns = promotedProjectPatterns(fp).slice(0, 3)
  if (patterns.length > 0) {
    parts.push(`Patterns: ${patterns.map((ptn) => `[${ptn.label}] ${compactMemoryText(ptn.summary, 96)}`).join(" | ")}.`)
  }
  const directive = parts.join(" ")
  try {
    const expanded = JSON.stringify({
      projectName: label || "unknown",
      totalSessions: Number(proj?.totalSessions || 0),
      reports: Array.isArray(proj?.reports) ? proj.reports : [],
      researchChains: Number(proj?.researchChains || 0),
      context7Bypasses: Number(proj?.context7Bypasses || 0),
      techStack: Array.isArray(proj?.techStack) ? proj.techStack : [],
      commonTopics: Array.isArray(proj?.commonTopics) ? proj.commonTopics : [],
      patterns: patterns.map((ptn) => ({ label: ptn.label, summary: ptn.summary, sessions: ptn.sessions })),
    })
    const savedChars = Math.max(0, expanded.length - directive.length)
    if (savedChars > 0) {
      const modelRate = cacheSavePer1MInputTokens(currentModel)
      const rawUsd = Math.max(0.0001, Math.round((savedChars / BYTES_PER_TOKEN) * modelRate / 1_000_000 * 10000) / 10000)
      const creditedUsd = Math.max(0.0001, Math.round(rawUsd * 0.8 * 10000) / 10000)
      recordCacheSaving("project-memory", creditedUsd, {
        hash: createHash("sha256").update(`project-memory\n${fp}\n${directive}\n`).digest("hex").slice(0, 16),
      })
    }
  } catch {}
  return directive
}

export function ensureProjectSkill(dir: string, fp: string): { created: boolean; path?: string; skipped: boolean } {
  const skillsDir = join(dir, ".opencode", "skills")
  const projectName = basename(dir)
  const skillDir = join(skillsDir, projectName)
  const skillPath = join(skillDir, "SKILL.md")

  if (existsSync(skillPath)) {
    return { created: false, skipped: true, path: skillPath }
  }

  const promoted = promotedProjectPatterns(fp)
  if (!promoted || promoted.length === 0) {
    return { created: false, skipped: false }
  }

  const techStack = detectTechStack(dir)
  const globalLearning = loadGlobalLearning()
  const promotedRoutines: string[] = globalLearning.promotedRoutines || []

  const skillName = `project-${projectName.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`

  let content = `---\n`
  content += `name: ${skillName}\n`
  content += `description: Project-specific conventions, patterns, and workflows for ${projectName}. Auto-generated by vibeOS.\n`
  content += `---\n\n`
  content += `# ${projectName} Conventions\n\n`

  if (techStack.length > 0) {
    content += `## Tech Stack\n\n`
    content += techStack.map((t: string) => `- ${t}`).join("\n") + "\n\n"
  }

  const routines = promoted.filter((p: unknown) => p.label === "routine")
  if (routines.length > 0) {
    content += `## Routines (established workflows)\n\n`
    for (const r of routines) {
      content += `- ${r.summary} (${r.sessions} sessions)\n`
    }
    content += "\n"
  }

  const frictions = promoted.filter((p: unknown) => p.label === "friction")
  if (frictions.length > 0) {
    content += `## Frictions (patterns to avoid)\n\n`
    for (const f of frictions) {
      content += `- ${f.summary} (${f.sessions} sessions)\n`
    }
    content += "\n"
  }

  if (promotedRoutines.length > 0) {
    content += `## Common Tool Chains\n\n`
    for (const pair of promotedRoutines) {
      content += `- ${pair}\n`
    }
    content += "\n"
  }

  try {
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(skillPath, content, "utf-8")
    console.error(`[vibeOS] Project Guard: created .opencode/skills/${projectName}/SKILL.md`)
    return { created: true, path: skillPath, skipped: false }
  } catch (err: unknown) {
    console.error(`[vibeOS] Project Guard: failed to create skill for ${projectName}: ${err.message}`)
    return { created: false, skipped: false }
  }
}

export function syncControlSettings(cv: unknown, options: { persistOptimizationMode?: boolean; backendDecision?: unknown; authoritative?: boolean } = {}): unknown {
  if (!cv) return
  let authoritative = false
  let backendDecision: unknown = null
  try {
    _pendingOrchestratorDirective = orchestratorDirective(cv, loadSelection())
    const sid = _OC_SID
    if (!cv.agent_mode) {
      try {
        clearWorkspaceFollowupPauseForSession(sid)
      } catch {}
    }
    const persistOptimizationMode = options.persistOptimizationMode !== false
    backendDecision = options.backendDecision && typeof options.backendDecision === "object" ? options.backendDecision : null
    authoritative = options.authoritative === true || (backendDecision && backendDecision.source !== "manual")
    const syncDirectory = String(options.directory || options.projectDir || getRuntimeProjectDirectory())
    const currentSel = loadSelection()
    const userSetMode = loadSessionOptMode(sid + "_opt")
    const userOptMode = userSetMode || loadOptimizationMode()
    const durablePipeline = modeCascadeRoot(cv.optimization_mode || userOptMode, cv.cascade_root || cv.pipeline_root, cv.selected_slot || cv.tier_bias)
    const routePath = normalizeRoutePath(cv.route_path || cv.pipeline_root, cv.selected_slot || cv.tier_bias)
    const isUltraX = isVibeUltraXMode(cv.optimization_mode || userOptMode)
    // An explicit `vibe axis tier <slot>` pin is user intent and outranks the
    // backend slot on BOTH paths. computeAxisBundle() already honours it when the
    // API is unreachable; without this the pin silently did nothing whenever the
    // API answered, which is the normal case.
    const axisTierPin = normalizeSlot(
      currentSel.axis_overrides && typeof currentSel.axis_overrides === "object"
        ? (currentSel.axis_overrides as Record<string, unknown>).tier
        : null,
    )
    const entrySlot = axisTierPin || rootSlotForControlVector(cv, durablePipeline) || cv.selected_slot || cv.tier_bias || null
    const workerSlot = axisTierPin || normalizeSlot(cv.selected_slot || cv.tier_bias)
    // The backend may name a model this machine has not configured (observed live:
    // "openrouter/openai/o1-pro" against a trinity on another provider entirely).
    // tool-execute routes Task delegation off worker_model, so an unconfigured id
    // fails the turn -- clamp anything outside the local trinity to the slot model.
    const backendModel = String(cv.selected_model || cv.selectedModel || "").trim()
    const trinityModels = [TRINITY_CHEAP, TRINITY_MEDIUM, TRINITY_BRAIN].filter(Boolean)
    const backendModelIsConfigured = !!backendModel && trinityModels.includes(backendModel)
    const workerModel = String(
      (axisTierPin ? modelForSlot(axisTierPin) : backendModelIsConfigured ? backendModel : null) ||
      modelForSlot(workerSlot) || "",
    )
    const selectedSubagent = String(cv.selected_subagent || cv.selectedSubagent || vibeUltraXSubagentForSlot(workerSlot) || "")
    const requiresDelegation = isUltraX && (workerSlot === "medium" || workerSlot === "brain")

    const writeIf = (key: string, val: unknown) => {
      const sel = loadSelection()
      if (sel[key] !== val) writeSelection(key, val)
    }

    if (durablePipeline.length > 0) {
      const currentPipeline = currentSel.active_pipeline
      const currentPipelineStr = Array.isArray(currentPipeline) ? JSON.stringify(currentPipeline) : currentPipeline
      if (currentPipelineStr !== JSON.stringify(durablePipeline)) {
        writeSelection("active_pipeline", durablePipeline)
      }
    }

    writeIf("enabled", true)
    writeIf("route_path", routePath)
    if (isUltraX) {
      // Best-effort: registering the tier subagents is a convenience, while the
      // slot writes below are the actual routing decision. A failure here used to
      // throw out of syncControlSettings into its catch, which returns the
      // PREVIOUS state -- so the backend's tier choice was dropped every turn.
      try { ensureVibeUltraXSubagents(null, syncDirectory) } catch {}
      writeIf("cheap_first_degraded", false)
      writeIf("cheap_first_reason", null)
    }
    // Observability: the sync path had no audit row, so when a turn's slot state
    // did not move there was no way to tell whether syncControlSettings ran at
    // all, ran and computed the same values, or threw into the fallback. Every
    // other routing decision writes to cascade-audit.jsonl; this one did not.
    try {
      const vibeHome = getVibeOSHome()
      if (vibeHome && vibeHome !== "undefined" && !vibeHome.startsWith("undefined")) {
        const auditDir = join(vibeHome, "cascade-audit")
        mkdirSync(auditDir, { recursive: true })
        appendFileSync(join(auditDir, "cascade-audit.jsonl"), JSON.stringify({
          _ts: new Date().toISOString(),
          sessionId: String(sid || ""),
          source: "control-sync",
          optimizationMode: String(cv.optimization_mode || ""),
          isUltraX,
          axisTierPin: axisTierPin || null,
          axisOverrides: currentSel.axis_overrides || null,
          cvSelectedSlot: String(cv.selected_slot || ""),
          cvTierBias: String(cv.tier_bias || ""),
          entrySlot: entrySlot || null,
          workerSlot: workerSlot || null,
          workerModel: workerModel || null,
          authoritative,
        }) + "\n")
      }
    } catch {}

    // These six are the single source of truth that Task routing reads
    // (tool-execute.ts: `selection.worker_slot || selection.selected_slot`).
    // Each used to be written ONLY inside the isUltraX branch above, so the
    // moment the mode left vibeultrax all six froze at their last vibeultrax
    // value and every subagent route in every other mode ran off stale state.
    // They are per-turn state, not a vibeultrax feature.
    writeIf("entry_slot", entrySlot || (isUltraX ? "cheap" : null))
    writeIf("worker_slot", workerSlot || null)
    writeIf("selected_slot", workerSlot || null)
    writeIf("worker_model", workerModel || null)
    writeIf("selected_subagent", isUltraX ? selectedSubagent || null : null)
    writeIf("requires_delegation", requiresDelegation)

    const compatibilityMode = currentSel.onboarding_mode === "assist"
    const flowManuallyDisabled = currentSel.flow_enabled === false && currentSel.flow_enforce === false
    // A `vibe axis <name> <value>` pin must survive this per-turn auto-mode
    // re-sync -- otherwise the axis-override feature only ever stores a value
    // nobody reads, and silently loses to the very next turn's regime-driven
    // write. See docs/live-debug-session-notes.md round 13.
    const axisOverrides = currentSel.axis_overrides && typeof currentSel.axis_overrides === "object" ? currentSel.axis_overrides : {}
    const enforcementPinned = axisOverrides.enforcement != null
    const flowPinned = axisOverrides.flow != null
    const tddPinned = axisOverrides.tdd != null
    const thinkingPinned = axisOverrides.thinking != null

    if (!enforcementPinned) {
      writeIf("delegation_enforce", compatibilityMode ? cv.enforcement_mode === "strict" : cv.enforcement_mode !== "relaxed")
    }

    if (!flowManuallyDisabled && !flowPinned) {
      if (compatibilityMode) {
        writeIf("flow_enabled", cv.flow_mode === "strict")
        writeIf("flow_enforce", cv.flow_mode === "strict")
      } else if (cv.flow_mode === "audit") {
        writeIf("flow_enabled", true)
        writeIf("flow_enforce", false)
      } else {
        writeIf("flow_enabled", true)
        writeIf("flow_enforce", true)
      }
    }

    if (!tddPinned) {
      if (compatibilityMode) {
        writeIf("tdd_enforce", cv.tdd_mode === "quality")
        writeIf("tdd_strict", cv.tdd_mode === "quality")
        writeIf("tdd_quality", cv.tdd_mode === "quality")
      } else if (cv.tdd_mode === "lazy") {
        writeIf("tdd_enforce", false)
        writeIf("tdd_strict", false)
        writeIf("tdd_quality", false)
      } else {
        writeIf("tdd_enforce", true)
        writeIf("tdd_strict", cv.tdd_mode === "quality")
        writeIf("tdd_quality", cv.tdd_mode === "quality")
      }
    }

    if (cv.thinking_mode && !thinkingPinned) {
      const nextThinking = cv.thinking_mode === "auto" ? "off" : cv.thinking_mode
      if (currentSel.thinking_level !== nextThinking) writeIf("thinking_level", nextThinking)
    }

    const previousOptMode = typeof currentSel.previous_optimization_mode === "string" ? currentSel.previous_optimization_mode : null
    const prevSessionKey = `${sid}_prev_opt`
    const sessionPreviousOptMode = loadSessionOptMode(prevSessionKey)
    const liveSlot = String(currentSel.active_slot || cv.tier_bias || "").toLowerCase()
    const inferredRecoveryMode = liveSlot === "brain" ? "quality" : liveSlot === "medium" ? "vibemax" : "budget"

    if (persistOptimizationMode && cv.optimization_mode && (userOptMode !== "auto" || authoritative)) {
      if (authoritative) {
        writeIf("requested_optimization_mode", cv.optimization_mode)
      }
      const fallbackPinned = isApiFallback() && cv.optimization_mode === "vibelitex"
      const restoreMode = sessionPreviousOptMode || previousOptMode || inferredRecoveryMode
      const canRestorePrevious = !!restoreMode && cv.optimization_mode === "vibelitex" && (previousOptMode !== null || sessionPreviousOptMode !== null)

      if (fallbackPinned) {
        const snapshotMode =
          currentSel.optimization_mode && currentSel.optimization_mode !== "vibelitex"
            ? currentSel.optimization_mode
            : previousOptMode || sessionPreviousOptMode || inferredRecoveryMode
        if (snapshotMode && snapshotMode !== "vibelitex") {
          writeIf("previous_optimization_mode", snapshotMode)
          writeSessionOptMode(prevSessionKey, snapshotMode)
        }
      } else if (canRestorePrevious) {
        writeIf("optimization_mode", restoreMode)
        writeIf("previous_optimization_mode", null)
        writeSessionOptMode(sid, restoreMode)
        writeSessionOptMode(prevSessionKey, "")
      } else if (userOptMode !== cv.optimization_mode) {
        writeIf("optimization_mode", cv.optimization_mode)
        if (previousOptMode) writeIf("previous_optimization_mode", null)
      }
    }

    const slot = entrySlot
    const slotLocked = currentSel.slot_locked === true
    const SLOT_RANK: Record<string, number> = { cheap: 0, medium: 1, brain: 2 }
    const userRequestedQuality = currentSel.requested_optimization_mode === "quality"
    const qualityFloorBlock = userRequestedQuality && slot && slot !== "auto" && (SLOT_RANK[slot] ?? 0) < (SLOT_RANK["brain"] ?? 2)
    const canApplySlot = !qualityFloorBlock && slot && slot !== "auto" && (authoritative || (!slotLocked && !_modelLocked))
    let appliedSlot = currentSel.active_slot || null
    if (canApplySlot) {
      const existingSlot = loadSessionSlot(sid)
      appliedSlot = slot
      const _ocModel = slot === "brain" ? TRINITY_BRAIN : slot === "medium" ? TRINITY_MEDIUM : TRINITY_CHEAP
      if (existingSlot !== slot) {
        writeSessionSlot(sid, slot)
        writeIf("active_slot", slot)
        if (cv.optimization_mode) writeIf("vector_changed_mode", cv.optimization_mode)
        // NOTE: executed_model/selected_model are SHADOW_SELECTION_KEYS — derived
        // from active_slot + trinity[slot].oc at read time and stripped on every
        // writeSelection. Persisting them here is a no-op that fights the design;
        // the live model is the source of truth and is set by applySlot() below.
        try {
          const bridge = buildSessionBridge({
            sessionId: sid,
            fromModel: currentModel,
            fromTier: currentTier,
            toModel: _ocModel,
            toTier: slot,
            reason: `control vector selected ${slot}`,
            prompt: userText || latestUserIntent || "",
            userText: latestUserIntent || userText || "",
            activePipeline: durablePipeline || [],
            projectFingerprint: currentProjectFingerprint,
            projectName: currentProjectName || "",
            sourceStrategy: cv.optimization_mode || "auto",
          })
          recordSessionBridge(bridge)
        } catch (err) {
          console.error("[vibeOS] failed to record session bridge:", err?.message || err)
        }
        try {
          // Defer the live model switch to the turn boundary: applySlot still writes
          // model-tiers.json active_slot + opencode.json now (cheap/safe), but the SDK
          // switch is queued and flushed in onMessagesTransform so the NEXT turn runs the
          // new model. Switching mid-turn aborts the in-flight turn — the platform only
          // lets us change the model at turn end.
          const applied = applySlot(slot, syncDirectory, { deferLiveSwitch: true })
          if (!applied?.ok) {
            console.error(`[vibeOS] failed to persist slot ${slot}: ${applied?.reason || "unknown"}`)
          }
        } catch (err) {
          console.error("[vibeOS] failed to apply slot:", err?.message || err)
        }
      } else if (_ocModel) {
        // Slot unchanged this turn, but the live OpenCode model can still drift
        // (a stale/foreign model left in opencode.json). Reconcile SYNCHRONOUSLY
        // against the slot's model — the single source of truth — instead of an
        // async client.config.get().then() that may never resolve headless (which
        // is why drift previously went uncorrected).
        try {
          const r = reconcileSlotModel(slot, syncDirectory, _ocModel, { deferLiveSwitch: true })
          if (r.reconciled) {
            console.error(`[vibeOS] reconciled drifted model: live=${r.from || "∅"} → ${r.to}`)
          }
        } catch (err) {
          console.error("[vibeOS] failed to reconcile slot:", err?.message || err)
        }
      }
    }
    // The plugin no longer overrides the user's chosen default_agent. The
    // previous save/restore dance (writing previous_default_agent, forcing
    // `oc.default_agent = "plan"` during REFINING/CONVERGING regimes, then
    // restoring) ran on every turn and raced under concurrent OpenCode
    // instances writing the same opencode.json. Subagent routing already
    // works through task-tool interception (tool-execute.ts:764) without
    // touching the user's agent selection.

    if (cv.optimization_mode && cv.optimization_mode !== "vibelitex") {
      const finalSel = loadSelection()
      if (finalSel.optimization_mode === "vibelitex") {
        const liveSlot = String(finalSel.active_slot || currentSel.active_slot || cv.tier_bias || "").toLowerCase()
        const restoreCandidate = finalSel.previous_optimization_mode || loadSessionOptMode(prevSessionKey) || previousOptMode || (liveSlot === "brain" ? "quality" : liveSlot === "medium" ? "vibemax" : "budget")
        if (restoreCandidate && restoreCandidate !== "vibelitex") {
          writeSelection("optimization_mode", restoreCandidate)
          writeSelection("previous_optimization_mode", null)
          writeSessionOptMode(sid, restoreCandidate)
          writeSessionOptMode(prevSessionKey, "")
        }
      }
    }
    return {
      applied_slot: canApplySlot ? appliedSlot : currentSel.active_slot || null,
      applied_mode: cv.optimization_mode || null,
      applied_pipeline: durablePipeline,
      authoritative,
      decision: backendDecision || null,
      optimization_mode: cv.optimization_mode || null,
      tier_bias: cv.tier_bias || null,
      selected_slot: cv.selected_slot || cv.tier_bias || null,
      entry_slot: entrySlot || null,
      worker_slot: workerSlot || null,
      selected_model: workerModel || null,
      selected_subagent: selectedSubagent || null,
      requires_delegation: requiresDelegation,
      pipeline_root: durablePipeline,
      cascade_root: durablePipeline,
      route_path: routePath,
    }
  } catch (err) {
    console.error("[vibeOS] syncControlSettings failed:", err?.message || err)
    // This catch returns a fallback that PRESERVES the previous slot state. In the
    // desktop app console.error goes nowhere, so a throw here looked exactly like
    // "the backend chose the same slot again" -- the orchestrator silently stopped
    // honouring every routing decision and nothing anywhere said so.
    try {
      const vibeHome = getVibeOSHome()
      if (vibeHome && vibeHome !== "undefined" && !vibeHome.startsWith("undefined")) {
        const auditDir = join(vibeHome, "cascade-audit")
        mkdirSync(auditDir, { recursive: true })
        appendFileSync(join(auditDir, "cascade-audit.jsonl"), JSON.stringify({
          _ts: new Date().toISOString(),
          source: "control-sync-error",
          message: String(err?.message || err),
          stack: String(err?.stack || "").split("\n").slice(0, 4).join(" | "),
        }) + "\n")
      }
    } catch {}
    const fallbackSel = loadSelection()
    const fallbackSlot = fallbackSel?.active_slot || cv?.tier_bias || null
    const fallbackEntrySlot = fallbackSel?.entry_slot || fallbackSel?.active_slot || rootSlotForControlVector(cv, modeCascadeRoot(cv?.optimization_mode, cv?.cascade_root || cv?.pipeline_root, cv?.selected_slot || cv?.tier_bias)) || cv?.tier_bias || null
    const fallbackWorkerSlot = fallbackSel?.worker_slot || fallbackSel?.selected_slot || normalizeSlot(cv?.selected_slot || cv?.tier_bias) || null
    return {
      applied_slot: fallbackSlot,
      applied_mode: cv?.optimization_mode || null,
      applied_pipeline: modeCascadeRoot(cv?.optimization_mode, cv?.cascade_root || cv?.pipeline_root, cv?.selected_slot || cv?.tier_bias),
      authoritative,
      decision: backendDecision || null,
      optimization_mode: cv?.optimization_mode || null,
      tier_bias: cv?.tier_bias || null,
      selected_slot: cv?.selected_slot || cv?.tier_bias || null,
      entry_slot: fallbackEntrySlot,
      worker_slot: fallbackWorkerSlot,
      pipeline_root: modeCascadeRoot(cv?.optimization_mode, cv?.cascade_root || cv?.pipeline_root, cv?.selected_slot || cv?.tier_bias),
      cascade_root: modeCascadeRoot(cv?.optimization_mode, cv?.cascade_root || cv?.pipeline_root, cv?.selected_slot || cv?.tier_bias),
      route_path: normalizeRoutePath(cv?.route_path || cv?.pipeline_root, cv?.selected_slot || cv?.tier_bias),
    }
  }
}

function pushSystem(output: unknown, text: string | null): void {
  if (text && Array.isArray(output?.system)) {
    output.system.push(text)
  }
}

function oneShot(key: string): boolean {
  const scoped = (onSystemTransform as unknown)._briefedProjects || briefedProjects
  if (scoped.has(key)) return true
  scoped.add(key)
  return false
}

// tool-execute.ts's onToolExecuteAfter prepends a live footer alert line
// (savings, regime, XP, connectivity icon -- all of which change turn to
// turn) onto the raw output of virtually every non-task tool call before it
// ever reaches here. Hashing that raw, footer-and-all string means two
// otherwise-identical tool calls (e.g. reading the same unchanged file
// twice) almost never produce the same content hash, defeating cache-hit
// detection for the entire session. Strip it before hashing -- matches
// tool-execute.ts's own _stripLeadingFooter regex (duplicated here rather
// than imported, to avoid a footer.ts/chat-transform.ts/tool-execute.ts
// import cycle in an area with a history of subtle breakage).
function _stripLeadingFooterForHash(s: string): string {
  return s.replace(/^(?:— [^\n]*—\n\n)+/, "")
}

// Floor for the cache-write path only (hash + scratch/by-hash + indexAppend +
// future-hit pointer). Deliberately much lower than COMPRESS_THRESHOLD, which
// gates the separate "shrink into a context-saving summary" decision below --
// a tiny file read is never worth compressing into a longer marker string,
// but it's still worth caching so a later identical read can hit.
const MIN_CACHEABLE_BYTES = 40

// -- Context compression --------------------------------------------
export function compressToolOutputs(messages: unknown[]): number {
  let compressedBytes = 0
  const hotStart = Math.max(0, messages.length - KEEP_HOT)

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg || typeof msg !== "object") continue
    const { _info, parts } = msg
    if (!Array.isArray(parts)) continue
    const isCold = i < hotStart

    for (const part of parts) {
      if (part?.type !== "tool") continue
      const state = part.state
      if (state?.status !== "completed") continue
      const raw = state.output
      // Live-reproduced (real end-to-end scenario): reading the same small
      // file (src/utils.ts, 180 bytes) twice in a row created zero scratchpad
      // entries and zero cache activity, because this whole block -- hashing,
      // writing to scratch/by-hash, indexAppend, the future-hit pointer file
      // -- was gated behind COMPRESS_THRESHOLD (2000 bytes), a limit meant
      // for "is this worth shrinking into a context-saving summary", not
      // "is this worth caching for reuse". Most everyday file reads/greps/
      // command outputs are well under 2000 bytes, so the cache never
      // engaged for the common case. Only skip genuinely trivial content;
      // gate the actual context-compression rewrite below on COMPRESS_THRESHOLD
      // instead, so large cold messages still get shrunk the same as before.
      if (!raw || typeof raw !== "string" || raw.length < MIN_CACHEABLE_BYTES) continue
      if (raw.includes(COMPRESS_MARKER)) continue

      const hashableContent = _stripLeadingFooterForHash(raw)
      const hash = createHash("sha256")
        .update(`tool_result\n${hashableContent}\n`).digest("hex").slice(0, 16)
      const globalDir = join(SCRATCHPAD_ROOT, "by-hash")
      const sessPath = join(getSessionScratchpadDir(), `${hash}.txt`)
      const globalPath = join(globalDir, `${hash}.txt`)
      try {
        mkdirSync(globalDir, { recursive: true })
        ensureSessionScratchpadDirs()
        if (!existsSync(globalPath)) {
          writeFileSync(globalPath, raw)
          indexAppend(hash, part.tool, raw.length)
          // Clean up any existing session-local copy
          if (existsSync(sessPath)) rmSync(sessPath, { force: true })
        }
        safeCopyIntoSession(hash, globalPath)

        // Create pointer file for input-hash-based lookup
        const invPart = parts.slice(0, parts.indexOf(part)).reverse().find(
          (p: unknown) => p?.type === "tool" && p?.tool === (part as unknown).tool && p?.state?.input && p?.state?.status !== "completed",
        )
        if (invPart?.state?.input) {
          const toolKey = TOOL_NAME_NORMALIZE[(part as unknown).tool] || (part as unknown).tool
          const inputHash = createHash("sha256")
            .update(`${toolKey}\n${stableJson(invPart.state.input)}\n`)
            .digest("hex").slice(0, 16)
          const ptrPath = join(getSessionScratchpadDir(), `${inputHash}.ptr`)
          try {
            writeFileSync(ptrPath, JSON.stringify({ contentHash: hash, tool: (part as unknown).tool }))
          } catch {}
        }
      } catch (err) {
        console.error(`[vibeOS] ctx-compress write failed: ${err.message}`)
        continue
      }

      if (!isCold || raw.length < COMPRESS_THRESHOLD) continue

      const summary = raw.slice(0, 200).replace(/\n+/g, " ").trim() + (raw.length > 200 ? "\u2026" : "")
      const ref =
        `${COMPRESS_MARKER} [${raw.length} chars compressed -- cold storage at ${globalPath}] ` +
        `[summary] ${summary}`

      state.output = ref
      compressedBytes += raw.length - ref.length
      const toolKey = TOOL_NAME_NORMALIZE[(part as unknown).tool] || (part as unknown).tool
      const rate = cacheSavePer1MInputTokens(currentModel)
      if (rate > 0) {
        const inputTokens = Math.max(1, Math.round((raw.length - ref.length) / BYTES_PER_TOKEN))
        const saveEst = Math.max(0.0001, Math.round(inputTokens * rate / 1_000_000 * 10000) / 10000)
        recordCacheSaving(toolKey, saveEst, { hash })
      }
      console.error(`[vibeOS] ctx-compress: ${raw.length}\u2192${ref.length} chars (hash: ${hash})`)
    }
  }
  return compressedBytes
}

// -- Worker-to-Brain Protocol ---------------------------------------
function injectWBP(messages: unknown[]): void {
  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i]
    if (!msg || typeof msg !== "object") continue
    const { _info, parts } = msg
    if (!Array.isArray(parts)) continue
    const hasTask = parts.some(p => p?.type === "tool" && p?.tool === "task" && p?.state?.status === "completed")
    if (!hasTask) continue

    const nextMsg = messages[i + 1]
    if (!Array.isArray(nextMsg?.parts)) continue
    const alreadyHas = nextMsg.parts.some(p => p?.type === "text" && p?.text?.includes(PROTOCOL_MARKER))
    if (alreadyHas) continue

    const textPart = nextMsg.parts.find(p => p?.type === "text")
    if (textPart) {
      textPart.text = textPart.text + "\n\n" + PROTOCOL_TEXT
    } else {
      nextMsg.parts.push({ type: "text", text: PROTOCOL_TEXT, synthetic: true })
    }
  }
}

// -- Blackbox resolution tracking -----------------------------------
async function trackBlackbox(messages: unknown[]): Promise<void> {
  const lastUserMsg = messages.slice().reverse().find(m => m?.info?.role === "user" || m?.role === "user")
  if (!lastUserMsg) return

  const textPart = lastUserMsg.parts?.find(p => p?.type === "text")
  const fallbackText = typeof lastUserMsg.content === "string" ? lastUserMsg.content
    : typeof lastUserMsg.text === "string" ? lastUserMsg.text
      : null
  if (!textPart?.text && !fallbackText) return
  if (isGreetingLike(textPart?.text || fallbackText || "")) return

  latestUserIntent = textPart?.text || fallbackText
  if (!_blackboxEnabled) return

  try {
    const tracker = getBlackboxTracker()
    const localState = tracker.update(latestUserIntent)
    const state = loadBlackboxStateFromCtx()
    const sid = _OC_SID
    ensureProjectContext(process.cwd() || "")
    const serialized = tracker.serialize()
    const existingSession = state.sessions[sid] || {}
    if (!state.sessions[sid]) state.sessions[sid] = {}
    state.sessions[sid].control_history ??= []

    const st = scoreStress(latestUserIntent)
    if (st) {
      localState.latest_stress_multiplier = st
      saveSessionStress(st, st > 1.5 ? "critical" : st > 0.7 ? "elevated" : st > 0.3 ? "moderate" : "none")
    }
    localState.user_text = latestUserIntent

    // API is authoritative: await the remote blackbox analysis and use it as the
    // source of truth for regime/loop/pivot. Fall back to the local tracker only
    // when the API is unreachable or exceeds BLACKBOX_API_DEADLINE_MS (3000ms).
    const enriched = await fetchBlackboxEnrichment(sid, latestUserIntent, localState)
    const bbState = enriched || localState

    const cv = await apiComputeControlVector(bbState, undefined, loadOptimizationMode())
    _turnCvCache = { key: `${sid}::${String(latestUserIntent || "")}`, cv }
    const lastEntry = state.sessions[sid].control_history?.[state.sessions[sid].control_history.length - 1]
    const cvFingerprint = JSON.stringify({ regime: bbState.sub_regime, mode: cv?.enforcement_mode })
    const isDuplicate = lastEntry && (
      lastEntry.fingerprint === cvFingerprint ||
      (lastEntry.regime === bbState.sub_regime && lastEntry.enforcement === cv?.enforcement_mode)
    )
    if (!isDuplicate) {
      const turnNum = (existingSession.turn_counter || 0) + 1
      const entry = buildControlHistoryEntry(
        turnNum,
        bbState.sub_regime || "INIT",
        cv,
      )
      if (entry) {
        entry.fingerprint = cvFingerprint
        state.sessions[sid].control_history.push(entry)
        if (state.sessions[sid].control_history.length > 100) {
          state.sessions[sid].control_history = state.sessions[sid].control_history.slice(-100)
        }
      }
    }
    state.sessions[sid] = {
      ...existingSession,
      ...serialized,
      project_fingerprint: currentProjectFingerprint || existingSession.project_fingerprint || "",
      sub_regime: bbState.sub_regime || existingSession.sub_regime || "INIT",
      regime: bbState.sub_regime || existingSession.regime || "INIT",
      resolution: bbState.resolution || existingSession.resolution || "unresolved",
      momentum: bbState.momentum ?? existingSession.momentum ?? 0,
      signals: bbState.signals || existingSession.signals || {},
      intent_state: bbState.intent_state || existingSession.intent_state || {},
      continuity_state: bbState.continuity_state || existingSession.continuity_state || "HIGH",
      is_looping: bbState.is_looping ?? existingSession.is_looping ?? false,
      loop_consecutive: bbState.loop_consecutive ?? existingSession.loop_consecutive ?? 0,
      loop_intervention_level: bbState.loop_intervention_level || existingSession.loop_intervention_level || "none",
      loop_authority: bbState.loop_authority ?? null,
      loop_detector_kind: bbState.loop_detector_kind ?? null,
      loop_detector_confidence: bbState.loop_detector_confidence ?? null,
      loop_source_reason: bbState.loop_source_reason ?? null,
      loop_notice_signature: bbState.loop_notice_signature ?? existingSession.loop_notice_signature ?? null,
      loop_notice_at: bbState.loop_notice_at ?? existingSession.loop_notice_at ?? null,
      loop_notice_hold_until: bbState.loop_notice_hold_until ?? existingSession.loop_notice_hold_until ?? null,
      loop_notice_count: Number(bbState.loop_notice_count ?? existingSession.loop_notice_count ?? 0) || 0,
      pivot_detected: bbState.pivot_detected ?? existingSession.pivot_detected ?? false,
      pivot_score: bbState.pivot_score ?? existingSession.pivot_score ?? 0,
      outcome: bbState.outcome || existingSession.outcome || null,
      decision_source: bbState.source || "local",
      n_interactions: bbState.n_interactions ?? serialized.n_interactions ?? existingSession.n_interactions ?? 0,
      control_history: state.sessions[sid].control_history,
      optimization_mode: existingSession.optimization_mode || null,
      active_slot: existingSession.active_slot || null,
      turn_counter: (existingSession.turn_counter || 0) + 1,
    }
    saveBlackboxStateToCtx(state)
    _latestBlackboxState = bbState
    setLatestBlackboxState(bbState)
  } catch {}
}

export const onMessagesTransform = async (_input, output) => {
  resetChatTransformStateForHome()
  nextTurn()
  try {
    const { flushPendingLiveSwitch } = await import("../pricing.js")
    const flushed = await flushPendingLiveSwitch()
    if (flushed) console.error(`[vibeOS] flushed deferred model switch → ${flushed}`)
  } catch (err) {
    console.error("[vibeOS] failed to flush deferred model switch:", err?.message || err)
  }
  if (!loadSelection().enabled) return
  try {
    const messages = output?.messages
    if (!Array.isArray(messages)) return

    const compressedBytes = compressToolOutputs(messages)
    if (compressedBytes > 0) {
      console.error(`[vibeOS] ctx-compress total saved this transform: ~${Math.round(compressedBytes / 4)} tokens`)
    }

    injectWBP(messages)
    applyDecadence()
    await trackBlackbox(messages)

    // auto-amend: inject verification message if unsubstantiated claims found
    try {

      if (!Array.isArray(messages) || Object.isFrozen(messages)) return
      const vibeHome = getVibeOSHome()
      if (typeof vibeHome !== "string" || vibeHome.length === 0) return
      let currentAssistantText = ""
      let lastInjectTs = 0
      for (let i = messages.length - 1; i >= Math.max(0, messages.length - 4); i--) {
        const m = messages[i]
        if (!m || typeof m !== "object") continue
        if (m.role === "assistant" && Array.isArray(m.parts)) {
          currentAssistantText = m.parts.filter(p => p && typeof p === "object" && p.type === "text" && typeof p.text === "string").map(p => p.text).join("\n")
          for (const p of m.parts) {
            if (p && typeof p === "object" && p.type === "text" && typeof p.text === "string" && p.text.includes("[verify]")) {
              lastInjectTs = Date.now()
            }
          }
          if (currentAssistantText) break
        }
      }
      if (Date.now() - lastInjectTs < 30000) return
      const claimStatus = evaluateClaimEvidence({ text: currentAssistantText, vibeHome, sessionId: "" })
      const unsubClaims = claimStatus.unsubstantiatedCount > 0 ? claimStatus.claims.map(c => c.text).filter(Boolean) : []
      if (unsubClaims.length > 0 && !Object.isFrozen(messages)) {
        const verifyText = "\n[vibeOS verify]\nUnsubstantiated claims from previous turn:\n" +
          unsubClaims.slice(0, 5).map(t => "  - \"" + (typeof t === "string" ? t.substring(0, 80) : "") + "\"").join("\n") +
          "\nPlease verify each claim and correct if inaccurate."
        try {
          messages.push({ info: { role: "assistant" }, parts: [{ type: "text", text: verifyText, synthetic: true }] })
        } catch {}
      }
    } catch {}
  } catch (err) {
    console.error(`[vibeOS] messages.transform failed: ${err.message}`)
  }
}

// -- Directive builders for system prompt injection ------------------
const C7_URGENCY = {
  required: " CRITICAL: context7 usage is REQUIRED this turn.",
  optional: " (context7 is optional this turn -- use if helpful but not required.)",
}

function context7Directive(cv: unknown): string {
  const urgency = cv?.context7_urgency || "preferred"
  if (_cachedC7Full && _cachedC7Urgency === urgency) return _cachedC7Full
  _cachedC7Urgency = urgency
  _cachedC7Full = "[cost policy] If mcp__context7__resolve-library-id and mcp__context7__get-library-docs " +
    "are available, prefer them over WebFetch/WebSearch for library and framework docs " +
    "(docs.*, readthedocs.*, npmjs.com/package/*, pypi.org/project/*, pkg.go.dev, /api/reference/). " +
    "Use the cheapest accurate source first. " +
    "This usually saves about $0.06/turn." +
    (C7_URGENCY[urgency] || "")
  return _cachedC7Full
}

function thinkingDirective(level: string): string {
  const credit = loadCredit()
  const creditNote = `credit ${credit}%`
  if (level === "brief") {
    return `[thinking policy] Reasoning depth: BRIEF (manually set, ${creditNote}). Keep the answer crisp and only expand when the task truly needs it.`
  }
  return `[thinking policy] Reasoning depth: OFF (manually set, ${creditNote}). Respond directly, avoid extra scratch work, and reserve extended thinking for when the user asks for it.`
}

export function regimeAwareToolStyleDirective(regime: string, mode: string, stress: number, agentMode = ""): string {
  const normalizedRegime = String(regime || "INIT").toUpperCase()
  const normalizedMode = String(mode || "budget").toLowerCase()
  const stressLabel = stress > 1.5 ? "high stress"
    : stress > 0.4 ? "elevated stress"
      : "calm"
  const isPlan = agentMode === "plan"

  const regimeToneByName: Record<string, string> = {
    INIT: "The session is starting, so keep descriptions lightweight, status-oriented, and easy to scan.",
    DIVERGENT: "The session is branching, so keep descriptions exploratory and open to alternatives without sounding vague.",
    EXPLORING: "The session is investigating, so keep descriptions discovery-oriented, specific, and lightweight.",
    REFINING: "The session is polishing implementation, so keep descriptions action-oriented, concrete, and tied to the next visible code step.",
    IMPLEMENTING: "The session is executing implementation work, so keep descriptions exact, build-focused, and next-step driven.",
    RESEARCH: "The session is researching, so keep descriptions evidence-seeking, careful, and explicit about what was checked.",
    REVIEWING: "The session is reviewing, so keep descriptions audit-style, traceable, and focused on proof.",
    DESIGNING: "The session is designing, so keep descriptions structured, intent-driven, and aligned to the target shape.",
    CONVERGING: "The session is converging, so keep descriptions closure-oriented, exact, and ready for final verification.",
    CLOSED: "The session is closing, so keep descriptions final, concise, and clearly outcome-focused.",
    LOOPING: "The session is looping, so keep descriptions verification-first, state-aware, and loop-breaking.",
    AUDIT: "The session is auditing, so keep descriptions evidence-first, compliance-aware, and traceable.",
    FORENSIC: "The session is doing forensic work, so keep descriptions investigative, reproducible, and proof-heavy.",
  }
  const regimeTone = regimeToneByName[normalizedRegime] || "The session should stay aligned to the active regime and avoid generic filler."

  let planLine = ""
  if (isPlan) {
    if (normalizedRegime === "REFINING" || normalizedRegime === "CONVERGING" || normalizedRegime === "CLOSED") {
      planLine = ` [plan update protocol] When the user adds new files, modifies requirements, or provides steering context, update the existing plan to incorporate the new information. Extend the current plan — do NOT create a new one. The task is NOT complete until all plan items are marked done. Do not declare completion, ask if the user wants to continue, or wrap up while the plan has open items.`
    }
    if (normalizedRegime === "DIVERGENT" || normalizedRegime === "INIT") {
      planLine = ` [plan close protocol] The current plan no longer matches the session direction. Summarize what was completed from the old plan, then close it before starting the new direction. Do not keep stale plan items open.`
    }
  }

  return `[tool style: dopamine] Active regime: ${normalizedRegime}; mode: ${normalizedMode}; stress: ${stressLabel}. ` +
    `When calling the bash tool, use a short, calm, progress-focused description that matches the current regime. ` +
    `${regimeTone} ` +
    `${planLine} ` +
    `Name the user-visible milestone being advanced, keep the wording human, and avoid hype or raw technical labels. ` +
    `Combine independent bash commands into a single call with && or ;.`
}

function orchestratorDirective(cv: unknown, sel: unknown): string {
  const tierBias = cv?.tier_bias || "auto"
  const selectedSlot = normalizeSlot(cv?.selected_slot || cv?.tier_bias)
  const selectedSubagent = String(taskSubagentTypeForSlot(selectedSlot) || "general")
  const requiresDelegation = isVibeUltraXMode(cv?.optimization_mode) && (selectedSlot === "medium" || selectedSlot === "brain")
  let brainModel = "(brain)"
  try { brainModel = safeJsonParse(readFileSync(TIERS_FILE, "utf-8")).trinity?.brain?.oc || brainModel } catch {}
  const cheapModel = TRINITY_CHEAP || "the cheaper model"
  const mediumModel = TRINITY_MEDIUM || "the medium model"
  const targetModel = tierBias === "cheap" ? cheapModel : tierBias === "medium" ? mediumModel : tierBias === "brain" ? brainModel : `${cheapModel} or ${mediumModel}`
  const compatibilityMode = sel?.onboarding_mode === "assist"
  const delegateNote = requiresDelegation
    ? ` [vibeultrax cascade] This turn requires delegation: call the task tool with subagent_type="${selectedSubagent}" for the substantive work before final synthesis.`
    : ""
  const orchestrationPlan = cv?.orchestration_plan
  const orchestrationNote = orchestrationPlan?.recommended_next_action
    ? ` [orchestration plan] ${orchestrationPlan.recommended_next_action}${orchestrationPlan.reason ? ` ${orchestrationPlan.reason}` : ""}`
    : ""
  return `[AI ORCHESTRATOR AGENT] You are an AI orchestrator agent. ` +
    `Delegate heavy work to Task subagents (runs on ${targetModel}). ` +
    `Your role is to verify, fill gaps, and synthesize cleanly. ` +
    (compatibilityMode
      ? "Compatibility mode is active, so direct Write/Edit stays available until strict guardrails are enabled."
      : "Brain-tier focuses on orchestration — hand file writes and edits to Task subagents (cheaper, same quality). Use medium directly with `trinity medium` if the task is simple enough.") +
    ` [delegation guide] When a write/edit is blocked, use the \`task\` tool with: ` +
    `subagent_type="${selectedSubagent}" prompt="write <path> with: <content>". ` +
    `The tier subagent carries the selected VibeUltraX model and handles file operations transparently. ` +
    `Parallel task calls are encouraged for independent file changes. ` +
    ` Always display the vibeOS cost footer.` +
    delegateNote +
    orchestrationNote +
    (tierBias !== "auto" ? ` [tier routing] This turn is biased toward ${tierBias} tier.` : "")
}

const TDD_NOTES = {
  lazy: " Skeletons only when explicitly requested.",
  strict: " STRICT mode: TODO tests MUST pass before considering work complete.",
  quality: " QUALITY mode: Full coverage including edge cases.",
}

function _tddDirective(cv: unknown, sel: unknown): string {
  const tddMode = cv?.tdd_mode || (sel.tdd_strict ? "strict" : "normal")
  const tddFocus = cv?.tdd_focus || []
  const focusNote = tddFocus.length > 0 ? ` Focus: ${tddFocus.join(", ")}.` : ""
  return `[tdd enforcement: ${tddMode}] Auto-create skeleton tests for source files being written or edited.${TDD_NOTES[tddMode] || ""}${focusNote} ` +
    "When the work changes code, keep the test path visible and make the next test step obvious."
}

function _flowDirective(cv: unknown, sel: unknown): string {
  const flowMode = cv?.flow_mode || (sel.flow_enforce ? "normal" : "audit")
  const flowFocus = cv?.flow_focus || []
  const enforceNote = sel.flow_enforce ? " TODO/FIXME extraction is active." : ""
  const focusNote = flowFocus.length > 0 ? ` Focus rules: ${flowFocus.join(", ")}.` : ""
  return `[flow enforcement: ${flowMode}] Development flow rules are active: write/edit operations are checked against project conventions.${enforceNote}${focusNote} ` +
    "Stay close to the existing code patterns, naming style, and project structure."
}

function flowTodosDirective(): string | null {
  const pendingTodos = loadTodos().filter((t: unknown) => t.status === "pending").length
  if (pendingTodos === 0) return null
  return "[vibeOS] " + pendingTodos + " extracted TODO/FIXME items are waiting. " +
    "If useful, call `todowrite` so they land in the native task list."
}

function _empiricalAnswerDirective(): string {
  return "[empirical answer] Prefer verified facts over assumptions. " +
    "If something is not directly checked against tools, files, logs, or user-provided evidence, label it as unverified or say \"I cannot verify that\". " +
    "Separate evidence, inference, and suggestions. In multi-turn work, carry forward only evidence-backed facts and keep any guess explicitly marked as a guess."
}

function realityCheckDirective(): string | null {
  const view = getRealityCheckView(currentProjectFingerprint || "")
  if (!view.enabled) return null
  const scope = view.scope === "project" && view.project_id ? `project:${view.project_id}` : "global"
  return `[reality-check ${scope}] Before saying something is done, complete, ready, successful, trained, fixed, or working, verify the actual files and state on disk. If the user asks for a reality check, read the relevant files first and report only verified facts.`
}

function _patternDirective(fp: string): string | null {
  const patterns = promotedProjectPatterns(fp)
  if (!patterns || patterns.length === 0) return null
  const gl = loadGlobalLearning()
  const pq = (gl as unknown).patternQuality || { ignoredCount: 0, trustedCount: 0 }
  if (pq.ignoredCount > 0 && (pq.trustedCount === 0 || pq.ignoredCount >= pq.trustedCount * 5)) return null
  const routines = patterns.filter(p => p.label === "routine")
  const frictions = patterns.filter(p => p.label === "friction")
  const parts = []
  if (routines.length > 0) {
    parts.push("Routines: " + routines.map(r => r.summary).join("; "))
  }
  if (frictions.length > 0) {
    parts.push("Frictions: " + frictions.map(f => f.summary).join("; "))
  }
  if (parts.length === 0) return null
  return "[project patterns] " + parts.join(". ") + "."
}

function welcomeDirective(): string {
  const sel = loadSelection()
  const active = sel.active_slot || "medium"
  const current = currentModel || "(unknown)"
  return "[vibeOS] Active plugin. Slot: " + active + " (" + current + "). " +
    "Use `trinity status` for a quick check, `trinity help` for the full command list, " +
    "or `trinity set`, `trinity mode`, and `trinity rebuild` to move forward."
}

function contextBudgetDirective(_input: unknown, output: unknown): string | null {
  const ctxBudget = estimateContextBudget(_input, output)
  if (!ctxBudget || ctxBudget.pct <= 70) return null
  const severity = ctxBudget.pct > 90 ? "CRITICAL" : "WARNING"
  return `[context budget: ${severity}] Context window is ${ctxBudget.pct}% full (~${ctxBudget.estimatedTokens} tokens). ` +
    "Use Task subagents for heavy work, compress tool output, or start a fresh session before context gets cramped."
}

export const onSystemTransform = async (_input, output) => {
  resetChatTransformStateForHome()
  nextTurn()
  if (!loadSelection().enabled) return
  try {
    // Ensure the live blackbox snapshot is fresh (guard against cross-session module cache leak)
    let liveBlackboxState = getLatestBlackboxState() || loadBlackboxStateFromCtx()
    const bbOnDisk = loadBlackboxStateFromCtx()
    if (liveBlackboxState && bbOnDisk) {
      const diskHasSessions = Object.keys(bbOnDisk.sessions || {}).length > 0
      const stateHasRegime = !!liveBlackboxState.sub_regime
      if (diskHasSessions && !stateHasRegime) {
        liveBlackboxState = bbOnDisk
        _latestBlackboxState = bbOnDisk
        setLatestBlackboxState(bbOnDisk)
      }
    }
    let cvLoopPreventionPushed = false
    const hookDirectory = String((onSystemTransform as unknown)._directory || "")
    const userText = extractLastUserText(_input) || extractLastUserText(output)
    if (typeof userText === "string" && userText.trim()) latestUserIntent = userText
    else if (!latestUserIntent) latestUserIntent = null
    if (latestUserIntent) observeUserCorrection(latestUserIntent)

    const selectionMode = String(loadSelection()?.requested_optimization_mode || loadSelection()?.optimization_mode || "").trim().toLowerCase()
    const requestedOptimizationMode = selectionMode || loadOptimizationMode()
    const backendAutoModes = new Set(["auto", "vibeultrax", "vibeqmax", "vibemax", "vibelitex"])
    const useBackendDecision = backendAutoModes.has(String(requestedOptimizationMode || "").toLowerCase())
    const classifiedRegime = liveBlackboxState?.sub_regime
      || (latestUserIntent && isGreetingLike(latestUserIntent) ? "INIT" : latestUserIntent ? await classifyTurnRemote(latestUserIntent) : "INIT")
    if (latestUserIntent && isApiConnected() && !isApiFallback()) {
      try {
        const client = getApiClient()
        if (client) {
          const cascadeData = await client.classify(latestUserIntent, {})
          if (cascadeData) {
            const bb = loadBlackboxStateFromCtx() || { sessions: {}, enabled: true }
            bb.sessions ??= {}
            const prev = bb.sessions[_OC_SID] || {}
            // resolved_tier is the single BE-authoritative tier signal: web_search/loop_break
            // signals force brain directly here rather than via a selection-state flag.
            // When the classify response omits resolved_tier itself, fall back to the same
            // response's tier/entry_tier fields before giving up on a fresh signal entirely.
            const resolvedTier = cascadeData.resolved_tier
              || ((cascadeData.web_search === true || cascadeData.loop_break === true) ? "brain" : null)
              || cascadeData.tier
              || cascadeData.entry_tier
              || prev.resolved_tier
            bb.sessions[_OC_SID] = {
              ...prev,
              cascade_depth: cascadeData.cascade_depth || prev.cascade_depth || 0,
              resolved_tier: resolvedTier,
            }
            saveBlackboxStateToCtx(bb)
          } else {
            console.warn("[vibeOS] cascade classify returned no usable data; resolved_tier not updated this turn")
          }
        }
      } catch (classifyErr) {
        console.error("[vibeOS] cascade classify failed:", classifyErr?.message || classifyErr)
      }
    } else if (latestUserIntent) {
      // BE classify is gated off (API disconnected or in fallback cooldown). Without this
      // branch resolved_tier just freezes at whatever it last was (often never-set/None)
      // for the entire fallback window, since the block above is the only resolved_tier
      // writer. Derive a local estimate from the same difficulty scorer tool-execute.ts
      // uses for cascade routing so blackbox state still gets a tier this turn.
      try {
        const { suggestedTier } = computeDifficulty(latestUserIntent)
        const bb = loadBlackboxStateFromCtx() || { sessions: {}, enabled: true }
        bb.sessions ??= {}
        const prev = bb.sessions[_OC_SID] || {}
        bb.sessions[_OC_SID] = {
          ...prev,
          resolved_tier: suggestedTier || prev.resolved_tier,
        }
        saveBlackboxStateToCtx(bb)
      } catch (localClassifyErr) {
        console.error("[vibeOS] local fallback cascade classify failed:", localClassifyErr?.message || localClassifyErr)
      }
    }
    let optimizationDecision = null
    let optimizationMode = requestedOptimizationMode
    let _controlVector = null
    ensureProjectContext(hookDirectory)
    const st = latestUserIntent ? scoreStress(latestUserIntent) : 0
    const cvState = liveBlackboxState
      ? { ...liveBlackboxState, latest_stress_multiplier: st || liveBlackboxState.latest_stress_multiplier || 0 }
      : {
        sub_regime: classifiedRegime || "INIT",
        latest_stress_multiplier: st || undefined,
        user_text: latestUserIntent || undefined,
      }
    const embeddingDecision = useBackendDecision
      ? await apiResolveEmbeddingMode(_OC_SID, cvState, requestedOptimizationMode, latestUserIntent)
      : null
    const requestedDecision = {
      optimization_mode: requestedOptimizationMode,
      requested_mode: requestedOptimizationMode,
      requested_slot: null,
      source: useBackendDecision ? "backend" : "manual",
    }
    if (useBackendDecision) {
      // Reuse the control vector trackBlackbox already computed for THIS turn
      // (same session + intent) so the directive CV matches the one recorded in
      // control_history and we avoid a duplicate backend round-trip. Only when
      // there is no embedding decision, which needs a distinct request shape.
      const cvKey = `${_OC_SID}::${String(latestUserIntent || "")}`
      const cvHit = !embeddingDecision && _turnCvCache && _turnCvCache.key === cvKey && _turnCvCache.cv
      if (cvHit) {
        const cached = _turnCvCache.cv
        _controlVector = cached
        optimizationDecision = normalizeBackendDecision({
          ...cached,
          decision: {
            optimization_mode: cached?.optimization_mode || requestedOptimizationMode,
            tier_bias: cached?.tier_bias || null,
            pipeline_root: cached?.pipeline_root || [],
            source: useBackendDecision ? "backend" : "manual",
            requested_mode: requestedOptimizationMode,
            requested_slot: cached?.tier_bias || null,
          },
        }, requestedOptimizationMode)
        optimizationMode = optimizationDecision?.optimization_mode || optimizationMode
      } else {
        const backendResult = await apiComputeControlVector(cvState, undefined, embeddingDecision
          ? {
            ...requestedDecision,
            optimization_mode: embeddingDecision.optimization_mode,
            requested_mode: requestedOptimizationMode,
            requested_slot: embeddingDecision.requested_slot || requestedDecision.requested_slot,
            source: embeddingDecision.source || requestedDecision.source,
            embedding: embeddingDecision.embedding || null,
          }
          : requestedDecision)
        optimizationDecision = backendResult?.decision || backendResult || null
        _controlVector = backendResult?.control_vector || backendResult || null
        optimizationMode = optimizationDecision?.optimization_mode || optimizationMode
      }
    } else {
      _controlVector = computeControlVector(cvState, undefined, requestedOptimizationMode)
      optimizationDecision = normalizeBackendDecision({
        ..._controlVector,
        decision: {
          optimization_mode: _controlVector?.optimization_mode || requestedOptimizationMode,
          tier_bias: _controlVector?.tier_bias || null,
          pipeline_root: _controlVector?.pipeline_root || [],
          source: "manual",
          requested_mode: requestedOptimizationMode,
          requested_slot: _controlVector?.tier_bias || null,
        },
      }, requestedOptimizationMode)
      _controlVector = optimizationDecision?.control_vector || _controlVector
      optimizationMode = optimizationDecision?.optimization_mode || optimizationMode
    }
    // ── BE-authoritative tier: resolved_tier from client.classify() is the single
    // source of truth for the applied slot this turn, overriding the separately
    // computed control vector so BE's decision and the applied slot never diverge.
    // EXCEPT during API fallback: the fallback pin (vibelitex) is the governing
    // posture — a local/estimate resolved_tier must not yank the session out of
    // the pinned cheap slot the same turn the pin was applied.
    const _fallbackPinning = typeof isApiFallback === "function" && isApiFallback()
    const _resolvedTier = loadBlackboxStateFromCtx()?.sessions?.[_OC_SID]?.resolved_tier
    if (_resolvedTier && _controlVector && !(_fallbackPinning && _controlVector.optimization_mode === "vibelitex")) {
      _controlVector = { ..._controlVector, selected_slot: _resolvedTier, tier_bias: _resolvedTier }
    }
    if (_controlVector) {
      const fullState = loadBlackboxStateFromCtx() || { sessions: {}, enabled: true }
      fullState.cv = _controlVector
      if (liveBlackboxState) {
        if (liveBlackboxState.sub_regime) fullState.sub_regime = liveBlackboxState.sub_regime
        if (liveBlackboxState.latest_stress_multiplier) fullState.latest_stress_multiplier = liveBlackboxState.latest_stress_multiplier
        if (liveBlackboxState.n_interactions) fullState.n_interactions = liveBlackboxState.n_interactions
        if (liveBlackboxState.resolution) fullState.resolution = liveBlackboxState.resolution
        if (liveBlackboxState.momentum) fullState.momentum = liveBlackboxState.momentum
        if (liveBlackboxState.loop_notice_signature !== undefined) fullState.loop_notice_signature = liveBlackboxState.loop_notice_signature
        if (liveBlackboxState.loop_notice_at !== undefined) fullState.loop_notice_at = liveBlackboxState.loop_notice_at
        if (liveBlackboxState.loop_notice_hold_until !== undefined) fullState.loop_notice_hold_until = liveBlackboxState.loop_notice_hold_until
        if (liveBlackboxState.loop_notice_count !== undefined) fullState.loop_notice_count = liveBlackboxState.loop_notice_count
        fullState.latest_control_vector_ts = Date.now()
      }
      fullState.sessions ??= {}
      saveBlackboxStateToCtx(fullState)
    }
    try {
      const blackboxState = loadBlackboxStateFromCtx() || { sessions: {}, enabled: true }
      const existingSession = blackboxState.sessions?.[_OC_SID] || null
      if (!existingSession || !existingSession.sub_regime) {
        const sessionState = liveBlackboxState || {
          sub_regime: classifiedRegime || "INIT",
          resolution: "unresolved",
          momentum: 0,
        }
        const turnCounter = Number(existingSession?.turn_counter || 0) + 1
        const controlHistory = Array.isArray(existingSession?.control_history) ? [...existingSession.control_history] : []
        if (_controlVector) {
          const entry = buildControlHistoryEntry(turnCounter, sessionState.sub_regime || "INIT", _controlVector)
          if (entry) {
            const lastEntry = controlHistory[controlHistory.length - 1]
            if (!lastEntry || JSON.stringify(lastEntry) !== JSON.stringify(entry)) {
              controlHistory.push(entry)
            }
          }
        }
        blackboxState.sessions ??= {}
        blackboxState.sessions[_OC_SID] = {
          ...existingSession,
          cv: _controlVector || existingSession?.cv || null,
          project_fingerprint: currentProjectFingerprint || existingSession?.project_fingerprint || "",
          sub_regime: sessionState.sub_regime || existingSession?.sub_regime || "INIT",
          regime: sessionState.sub_regime || existingSession?.regime || "INIT",
          resolution: sessionState.resolution || existingSession?.resolution || "unresolved",
          momentum: sessionState.momentum ?? existingSession?.momentum ?? 0,
          loop_notice_signature: sessionState.loop_notice_signature ?? existingSession?.loop_notice_signature ?? null,
          loop_notice_at: sessionState.loop_notice_at ?? existingSession?.loop_notice_at ?? null,
          loop_notice_hold_until: sessionState.loop_notice_hold_until ?? existingSession?.loop_notice_hold_until ?? null,
          loop_notice_count: Number(sessionState.loop_notice_count ?? existingSession?.loop_notice_count ?? 0) || 0,
          control_history: controlHistory,
          optimization_mode: optimizationDecision?.optimization_mode || existingSession?.optimization_mode || null,
          active_slot: optimizationDecision?.entry_slot || optimizationDecision?.tier_bias || _controlVector?.tier_bias || existingSession?.active_slot || null,
          worker_slot: optimizationDecision?.worker_slot || _controlVector?.selected_slot || existingSession?.worker_slot || null,
          turn_counter: turnCounter,
          orchestration_plan: _controlVector?.orchestration_plan || existingSession?.orchestration_plan || null,
          orchestration_kind: _controlVector?.orchestration_kind || existingSession?.orchestration_kind || null,
          orchestration_recommended_next_action: _controlVector?.orchestration_recommended_next_action || existingSession?.orchestration_recommended_next_action || null,
        }
        saveBlackboxStateToCtx(blackboxState)
      }
      if (_controlVector && existingSession?.sub_regime) {
        blackboxState.sessions ??= {}
        blackboxState.sessions[_OC_SID] = {
          ...existingSession,
          cv: _controlVector,
          optimization_mode: optimizationDecision?.optimization_mode || existingSession?.optimization_mode || null,
          active_slot: optimizationDecision?.entry_slot || optimizationDecision?.tier_bias || _controlVector?.tier_bias || existingSession?.active_slot || null,
          worker_slot: optimizationDecision?.worker_slot || _controlVector?.selected_slot || existingSession?.worker_slot || null,
          latest_control_vector_ts: Date.now(),
          loop_notice_signature: existingSession?.loop_notice_signature ?? null,
          loop_notice_at: existingSession?.loop_notice_at ?? null,
          loop_notice_hold_until: existingSession?.loop_notice_hold_until ?? null,
          loop_notice_count: Number(existingSession?.loop_notice_count ?? 0) || 0,
          orchestration_plan: _controlVector?.orchestration_plan || existingSession?.orchestration_plan || null,
          orchestration_kind: _controlVector?.orchestration_kind || existingSession?.orchestration_kind || null,
          orchestration_recommended_next_action: _controlVector?.orchestration_recommended_next_action || existingSession?.orchestration_recommended_next_action || null,
        }
        saveBlackboxStateToCtx(blackboxState)
      }
    } catch {}
    // The backend control vector must be APPLIED before this hook can return.
    // It previously ran after the `!Array.isArray(output.system)` guard below, so
    // a turn whose output carried no system array returned first and the routing
    // decision was silently discarded. Injecting system directives needs the
    // system array; applying routing state does not.
    const sel = loadSelection()
    const syncResult = syncControlSettings(_controlVector, {
      persistOptimizationMode: true,
      backendDecision: optimizationDecision,
      authoritative: useBackendDecision,
    })
    if (useBackendDecision && syncResult) {
      try {
        const client = getApiClient()
        if (client && !isApiFallback()) {
          await client.blackboxState(_OC_SID, {
            applied_slot: syncResult.applied_slot,
            applied_mode: syncResult.applied_mode,
            applied_pipeline: syncResult.applied_pipeline,
            source: optimizationDecision?.source || "backend",
            requested_mode: optimizationDecision?.requested_mode || requestedOptimizationMode,
            requested_slot: optimizationDecision?.requested_slot || null,
          })
        }
      } catch {}
    }
    try {
      const bb = loadBlackboxStateFromCtx()
      if (bb?.sessions?.[_OC_SID]) {
        const s = bb.sessions[_OC_SID]
        // Reset the persisted cascade route to THIS turn's entry decision every turn —
        // otherwise a Task delegation's escalated route_path (written by tool-execute.ts
        // on a prior turn) never comes back down once the orchestrator stops delegating,
        // and the footer stays stuck at the last escalated tier/icon forever.
        if (Array.isArray(syncResult?.route_path)) {
          s.route_path = syncResult.route_path
          s.pipeline_root = syncResult.pipeline_root || s.pipeline_root
          s.cascade_depth = syncResult.route_path.length || 1
          saveBlackboxStateToCtx(bb)
        }
      }
    } catch {}

    const system = output?.system
    if (!Array.isArray(system)) return

    if (isApiConnected()) {
      try {
        const bb = loadBlackboxStateFromCtx()
        if (!bb.enabled || _blackboxEnabled === false) {
          setBlackboxEnabled(true)
          if (!bb.enabled) { bb.enabled = true; saveBlackboxStateToCtx(bb) }
        }
      } catch {}
    } else if (_blackboxEnabled === false) {
      try {
        const bb = loadBlackboxStateFromCtx()
        if (!bb.enabled) { bb.enabled = true; saveBlackboxStateToCtx(bb) }
        setBlackboxEnabled(true)
      } catch {}
    }

    const fp = ensureProjectContext(hookDirectory)
    const rawStress = latestUserIntent ? scoreStress(latestUserIntent) : 0
    const stressScore = rawStress * (_controlVector?.stress_multiplier ?? 1)
    const credit = loadCredit()
    _turnCountInject++

    // ── Pivot detection and PIVOT BACK injection (gated — 1/5 turns or regime change) ──
    const _pivotRegimeChanged = liveBlackboxState?.sub_regime && liveBlackboxState.sub_regime !== _pivotLastRegime
    const _pivotTurnTrigger = _turnCountInject - _pivotLastCheckTurn >= 5
    if (latestUserIntent && _blackboxEnabled !== false && (_pivotRegimeChanged || _pivotTurnTrigger)) {
      try {
        let pivotResult = null
        const pivotPipeline = String(optimizationMode || "").toLowerCase() === "vibeultrax" ? "vibeultraxPipeline" : "vibemaxPipeline"
        try {
          const remote = await remoteCall(pivotPipeline, [{
            user_text: latestUserIntent,
            _pivotContext: {
              files: (onSystemTransform as unknown)._recentFiles || [],
              decisions: (onSystemTransform as unknown)._recentDecisions || [],
              blockers: (onSystemTransform as unknown)._recentBlockers || [],
              toolOutputs: _cacheDb ? extractRecentCacheOutputs(_cacheDb, 10) : [],
            },
          }], null)
          if (remote?.pivot) pivotResult = remote
        } catch { /* remote pivot pipeline */ }
        if (!pivotResult) {
          const localModule = pivotPipeline === "vibeultraxPipeline"
            ? await import("../../vibeOS-lib/blackbox/vibeultrax.js")
            : await import("../../vibeOS-lib/blackbox/vibemax.js")
          const localPipeline = pivotPipeline === "vibeultraxPipeline"
            ? localModule.vibeultraxPipeline
            : localModule.vibemaxPipeline
          pivotResult = await localPipeline({
            user_text: latestUserIntent,
            _pivotContext: {
              files: (onSystemTransform as unknown)._recentFiles || [],
              decisions: (onSystemTransform as unknown)._recentDecisions || [],
              blockers: (onSystemTransform as unknown)._recentBlockers || [],
              toolOutputs: _cacheDb ? extractRecentCacheOutputs(_cacheDb, 10) : [],
            },
          })
        }
        if (pivotResult?.pivot?.injection) {
          pushSystem(output, pivotResult.pivot.injection)
          // Warm smart cache with workflow tool outputs
          const pivotWorkflowId = pivotResult.pivot.workflowId || pivotResult.pivot.matchedId
          if (pivotWorkflowId && pivotResult.pivot.toolOutputs?.length > 0) {
            try {
              for (const entry of pivotResult.pivot.toolOutputs) {
                addCacheEntry(
                  _cacheDb, entry.hash, entry.tool, entry.prompt,
                  entry.sizeBytes || 1024, entry.ageSec || 3600,
                )
              }
            } catch { /* cache warming is best-effort */ }
          }
        }
      } catch { /* pivot pipeline is best-effort */ }
      _pivotLastCheckTurn = _turnCountInject
      if (liveBlackboxState?.sub_regime) _pivotLastRegime = liveBlackboxState.sub_regime
    }
    const stressMitigationDirective = rawStress > 0.7
      ? "[stress mitigation: CRITICAL] The user's message shows very high stress indicators. " +
        "Stay calm, structured, and thorough. Lead with the answer, keep steps explicit, and avoid playful language or overload. " +
        "Do not mirror the user's urgency."
      : rawStress > 0.4
        ? "[stress mitigation: elevated] The user's message has elevated stress indicators. " +
          "Keep the response structured, readable, and lightly reassuring."
        : null

    if (stressMitigationDirective) {
      pushSystem(output, stressMitigationDirective)
    }

    // ── Template resolution ──
    _prevTemplate = _currentTemplate
    _prevTemplateSignature = _currentTemplateSignature
    _currentTemplate = resolveTemplate(_prevTemplate, stressScore, latestUserIntent, credit, liveBlackboxState?.sub_regime)
    const sessionTemplate = loadSessionOrchestration(_OC_SID)?.template || null
    const activeTemplate = resolveSessionTemplateDefinition(sessionTemplate)
    _currentTemplateSignature = activeTemplate.signature || _currentTemplate

    // ── Gated template directive (only on transition or periodic) ──
    if (shouldInjectTemplate(_currentTemplateSignature, _prevTemplateSignature)) {
      const directive = activeTemplate.body || (TEMPLATES[_currentTemplate] || TEMPLATES[DEFAULT_TEMPLATE]).directive
      let fused = directive
      if (sel.delegation_enforce && _controlVector?.enforcement_mode !== "relaxed") {
        fused += " Keep brain for planning — hand file changes to Task subagents. Parallel Task calls are encouraged for independent work."
      }
      if (sel.tdd_enforce && _controlVector?.tdd_mode !== "lazy") {
        fused += " Keep test skeletons ready for changed source files."
      }
      if (sel.flow_enabled && _controlVector?.flow_mode !== "audit") {
        fused += " Stay close to existing code conventions and project patterns."
      }
      pushSystem(output, fused)
    }

    // ── Cost policy (every turn — lightweight) ──
    pushSystem(output, context7Directive(_controlVector))

    // ── Thinking directive — the local manual pin and the control-vector's
    // [thinking mode] directive must never both appear in one prompt (they
    // carried conflicting depths, e.g. OFF vs full). User's manual pin wins.
    const isThinkingModeDirective = (d: unknown): boolean =>
      typeof d === "string" && /^\[thinking mode/i.test(String(d).trim())
    const manualThinking = sel.thinking_level && sel.thinking_level !== "full"
    if (manualThinking) {
      pushSystem(output, thinkingDirective(sel.thinking_level))
    }

    // ── Remote control-vector directives ──
    if (_controlVector?.directives?.length > 0) {
      for (const directive of _controlVector.directives) {
        if (manualThinking && isThinkingModeDirective(directive)) continue
        if (typeof directive === "string" && /^\[loop prevention/i.test(directive)) {
          // The blackbox regime block emits a severity-tagged
          // [loop prevention] when looping; emitting the generic CV one too
          // would triple-fire the same guidance. Let the specific one win.
          if (cvLoopPreventionPushed) continue
          cvLoopPreventionPushed = true
        }
        pushSystem(output, directive)
      }
    }

    // ── Blackbox — only on regime change ──
    else if (_blackboxEnabled && liveBlackboxState?.n_interactions > 0) {
      const prevRegime = _prevBlackboxRegime
      const res = liveBlackboxState
      const currentRegime = res.sub_regime || "EXPLORING"
      const { signature: loopNoticeSignature, suppress: suppressLoopInterruption } = shouldSuppressLoopNotice(res, res)
      const persistedLoopNoticeSignature = String(res.loop_notice_signature || "")
      const persistedLoopNoticeHoldUntil = Date.parse(String(res.loop_notice_hold_until || res.loop_hold_until || ""))
      const loopNoticeAlreadyEmitted = Boolean(loopNoticeSignature) && (
        loopNoticeSignature === persistedLoopNoticeSignature ||
        loopNoticeSignature === _lastLoopNoticeSignature
      )
      const loopNoticeHeld = Number.isFinite(persistedLoopNoticeHoldUntil) && persistedLoopNoticeHoldUntil > Date.now()
      const suppressLoopNoticeByState = Boolean(
        res.is_looping &&
        res.loop_intervention_level &&
        res.loop_intervention_level !== "none" &&
        loopNoticeAlreadyEmitted &&
        (loopNoticeHeld || persistedLoopNoticeSignature === loopNoticeSignature)
      )
      const suppressNotice = suppressLoopInterruption || suppressLoopNoticeByState
      if (currentRegime !== prevRegime) {
        _prevBlackboxRegime = currentRegime
        if (!suppressNotice) {
          pushSystem(output, "[decision engine] Resolution: " + (res.resolution || "unresolved") + " " +
            "(" + currentRegime + "). Momentum: " + ((res.momentum || 0) > 0 ? "↗ positive" : (res.momentum || 0) < 0 ? "↘ negative" : "→ steady") + ".")
          if (res.is_looping && res.loop_intervention_level && res.loop_intervention_level !== "none") {
            const severity = res.loop_intervention_level === "escalated" ? "CRITICAL"
              : res.loop_intervention_level === "assertive" ? "WARNING" : "NOTICE"
            if (!cvLoopPreventionPushed) {
              pushSystem(output, "[loop prevention: " + severity + "] " + (getLatestBlackboxLoopMsg() || "The conversation may be looping — try a different approach.") + " " +
                "(level: " + res.loop_intervention_level + ")")
            }
          }
          if (res.pivot_detected && getLatestBlackboxPivotMsg()) {
            pushSystem(output, "[context switch: PIVOT] " + getLatestBlackboxPivotMsg())
          }
        }
        if (res.is_looping && res.loop_intervention_level && res.loop_intervention_level !== "none" && loopNoticeSignature) {
          _lastLoopNoticeSignature = loopNoticeSignature
          _lastLoopNoticeAt = Date.now()
        }
      }
      if (res.is_looping && res.loop_intervention_level && res.loop_intervention_level !== "none" && loopNoticeSignature && !loopNoticeAlreadyEmitted) {
        try {
          const persisted = loadBlackboxStateFromCtx() || { sessions: {}, enabled: true }
          persisted.sessions ??= {}
          persisted.sessions[_OC_SID] ??= {}
          const nextNoticeAt = new Date().toISOString()
          const nextNoticeHoldUntil = typeof res.loop_hold_until === "string" && res.loop_hold_until ? res.loop_hold_until : persisted.sessions[_OC_SID].loop_hold_until || null
          const nextNoticeCount = Number(persisted.sessions[_OC_SID].loop_notice_count || 0) + 1
          persisted.sessions[_OC_SID].loop_notice_signature = loopNoticeSignature
          persisted.sessions[_OC_SID].loop_notice_at = nextNoticeAt
          persisted.sessions[_OC_SID].loop_notice_hold_until = nextNoticeHoldUntil
          persisted.sessions[_OC_SID].loop_notice_count = nextNoticeCount
          saveBlackboxStateToCtx(persisted)
          const refreshed = {
            ...(res || {}),
            loop_notice_signature: loopNoticeSignature,
            loop_notice_at: nextNoticeAt,
            loop_notice_hold_until: nextNoticeHoldUntil,
            loop_notice_count: nextNoticeCount,
          }
          _latestBlackboxState = refreshed
          setLatestBlackboxState(refreshed)
        } catch {}
      }
    }

    // ── Job focus ──
    const projectJob2 = (onSystemTransform as unknown)._activeJob || getActiveJobForProject(fp)
    if (latestUserIntent && projectJob2 && isLikelyOffTopic(latestUserIntent, projectJob2)) {
      pushSystem(output, "[job-focus] Active job context exists: \"" + ((projectJob2.prompt || "").slice(0, 140)) + "...\". " +
        "The latest user request appears off-topic relative to this running job. " +
        "Before taking write/edit/task actions, ask one concise confirmation question to validate switching scope.")
      console.error("[vibeOS] [job-focus] off-topic request detected vs active job context")
    }

    // ── Flow todos ──
    if (sel.flow_enabled && sel.flow_enforce) {
      const todoDirective = flowTodosDirective()
      if (todoDirective) pushSystem(output, todoDirective)
    }

    // ── Project guard (every 5 turns instead of every turn) ──
    if (_turnCountInject % 5 === 0) {
      pushSystem(output, "[project guard: CRITICAL] AGENTS.md and README.md are protected by vibeOS. " +
        "Do NOT modify either file without explicit user permission. " +
        "AGENTS.md defines that AI agents must ask before changing code.")
    }

    // ── Anti-fabrication enforcement (cached constants — byte-identical every turn) ──
    pushSystem(output, ANTI_FABRICATION_DIRECTIVE)
    pushSystem(output, EMPIRICAL_ANSWER_DIRECTIVE)
    pushSystem(output, ANTI_LOOP_DIRECTIVE)
    const realityDirective = realityCheckDirective()
    if (realityDirective) pushSystem(output, realityDirective)

    // ── Context budget ──
    const budgetDirective = contextBudgetDirective(_input, output)
    if (budgetDirective) pushSystem(output, budgetDirective)

    // ── One-shots ──
    if (!oneShot("vibeos_project_memory_" + fp)) {
      pushSystem(output, projectMemoryDirective(fp))
      // Persistent project knowledge tree — decisions/blockers/facts that survive across
      // sessions, condensed to one line per topic branch. null when nothing recorded yet.
      pushSystem(output, projectTreeDirective(fp))
    }
    // WRITER: capture the turn's user intent into the knowledge tree under a branch keyed
    // by the current sub-regime, so the tree accumulates real, deduped project context
    // across sessions instead of being a write-only display. Capped + deduped internally.
    try {
      if (fp && latestUserIntent && String(latestUserIntent).trim().length > 8) {
        const branch = String(classifiedRegime || liveBlackboxState?.sub_regime || "intent").toLowerCase()
        recordProjectFact(fp, currentProjectName || "", branch, "fact", String(latestUserIntent))
      }
    } catch {}
    if (!oneShot("trinity_welcome_" + fp)) {
      pushSystem(output, welcomeDirective())
    }

    // ── Calibration logging (buffered — flush every 10 turns) ──
    const regime2 = liveBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || "")
    _calBuffer.push(JSON.stringify({
      ts: new Date().toISOString(), sid: _OC_SID,
      mode: _currentTemplate, regime: regime2, stress: stressScore,
      fp: currentProjectFingerprint || "",
    }) + "\n")
    if (_turnCountInject % 10 === 0 && _calBuffer.length > 0) {
      try {
        const calFile = join(getVibeOSHome(), "calibration-data.jsonl")
        mkdirSync(getVibeOSHome(), { recursive: true })
        appendJsonlWithRotation(calFile, _calBuffer.join(""))
        _calBuffer.length = 0
      } catch {}
    }

    if (!oneShot("vibeos_dashboard_instruct")) {
      pushSystem(output,
        "[vibeOS dashboard display] When the trinity tool returns output starting with '[vibeOS-dashboard]', " +
        "use the question tool to display that data in a clean, human-readable format. " +
        "Use the question field (not the header) to show the dashboard data. " +
        "Format it with clear sections separated by blank lines, aligned columns with spaces, " +
        "and plain text only. " +
        "The header should be 'vibeOS Dashboard'. " +
        "Include only one option in options: {label: 'Dismiss', description: ''}. " +
        "Strip the '[vibeOS-dashboard]' marker line before displaying.")
    }

    if (!oneShot("vibeos_dopamine_style_" + fp)) {
      pushSystem(output, regimeAwareToolStyleDirective(liveBlackboxState?.sub_regime || classifiedRegime, _currentTemplate, stressScore, _controlVector?.agent_mode))
    }
    if (_pendingOrchestratorDirective) {
      pushSystem(output, _pendingOrchestratorDirective)
      _pendingOrchestratorDirective = ""
    }

  } catch (err) {
    console.error(`[vibeOS] system.transform failed: ${err.message}`)
    // console.error is not reachable in the desktop app, so a throw here used to
    // be completely invisible: the hook died, no routing was applied, and the
    // only symptom was slot state that silently never moved. Record it where the
    // rest of the routing evidence already lives.
    try {
      const vibeHome = getVibeOSHome()
      if (vibeHome && vibeHome !== "undefined" && !vibeHome.startsWith("undefined")) {
        const auditDir = join(vibeHome, "cascade-audit")
        mkdirSync(auditDir, { recursive: true })
        appendFileSync(join(auditDir, "cascade-audit.jsonl"), JSON.stringify({
          _ts: new Date().toISOString(),
          sessionId: String(_OC_SID || ""),
          source: "system-transform-error",
          message: String(err?.message || err),
        }) + "\n")
      }
    } catch {}
  }
}

export { latestUserIntent, injectWBP, context7Directive, C7_URGENCY }
