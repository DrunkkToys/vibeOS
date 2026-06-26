// @ts-nocheck
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs"
import { join, dirname, basename } from "node:path"
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
  TRINITY_OPENCODE_CONFIG, _TRINITY_OPENCODE_CONFIGC, TIERS_FILE, _VIBEOS_HOME, _OPENCODE_HOME,
  loadGlobalLearning, _updateGlobalLearning, _DFLT_GL,
  _getLearnedExploratoryWords,
  setCurrentProjectFingerprint, setCurrentProjectName,
  stableJson, TOOL_NAME_NORMALIZE,
  loadSessionOrchestration,
  _cacheDb, recordCacheSaving, getOpenCodeHome, getVibeOSHome, safeCopyIntoSession,
} from "../state.js"
import { getOcSessionId } from "../runtime-state.js"
import { nextTurn } from "../turn-memo.js"
import { evaluateClaimVerification } from "../claim-verification.js"
import { projectTreeDirective, recordProjectFact } from "../project-tree.js"
import {
  _classify, _modelCostPerTurn, _isModelFree, _detectContext7, _isDocsTarget,
  _shortModelName, _formatUsd, _refreshModel, applySlot, reconcileSlotModel, TRINITY_CHEAP, TRINITY_MEDIUM, TRINITY_BRAIN,
  cacheSavePer1MInputTokens,
  clearWorkspaceFollowupPauseForSession,
} from "../pricing.js"
import {
  scoreStress, classifyTurnSimple, classifyTurnRemote, loadOptimizationMode,
  _saveOptimizationMode,
  computeControlVector,
  getBlackboxTracker, _getBlackboxResolution,
  loadBlackboxState as loadBlackboxStateFromCtx, saveBlackboxState as saveBlackboxStateToCtx,
  _resolveEnforcementMode, extractLastUserText,
  _isUserAskingForTests, isLikelyOffTopic,
  updateGlobalLearning as _updateGlobalLearning,
  _noteTaskRoutingLearning,
  fetchBlackboxEnrichment,
  estimateContextBudget,
  buildControlHistoryEntry,
  setBlackboxEnabled,
} from "../turn-classify.js"
import { peekBudgetFirstMode } from "../mode-policy.js"
import { BRANDED_MODES, RUNTIME_MODES } from "../mode-router.js"
import { addCacheEntry, extractRecentCacheOutputs } from "../../vibeOS-lib/smart-cache.js"
import { getApiClient, remoteCall, isApiConnected, isApiFallback } from "../api-client.js"
import { loadCredit } from "../credit-api.js"
import { loadSessionOptMode, loadSessionSlot, writeSessionSlot } from "../selection-manager.js"
import { buildSessionBridge, recordSessionBridge } from "../session-bridge.js"
import { noteProjectPattern } from "../index-helpers.js"
import { saveSessionStress } from "../index-helpers.js"
import { COMPRESS_THRESHOLD, KEEP_HOT, COMPRESS_MARKER, PROTOCOL_MARKER, PROTOCOL_TEXT } from "../constants.js"
import { TEMPLATES, DEFAULT_TEMPLATE, resolveTemplate, shouldInjectTemplate, resolveSessionTemplateDefinition } from "../templates.js"
import { getRealityCheckView } from "../../vibeOS-lib/flow-enforcer.js"
import { installVibeSkill } from "../../../scripts/lib/vibe-skill.mjs"

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

export function ensureVibeSkill(dir: string): { created: boolean; path?: string; skipped: boolean } {
  try {
    return installVibeSkill(dir)
  } catch (err: unknown) {
    console.error(`[vibeOS] Project Guard: failed to create /vibe skill for ${basename(dir || "") || "unknown"}: ${err.message}`)
    return { created: false, skipped: false }
  }
}

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

function resolveRestorableOpenCodeAgent(currentSel: unknown): string | null {
  const remembered = typeof currentSel?.previous_default_agent === "string" ? currentSel.previous_default_agent.trim() : ""
  if (remembered && remembered !== "plan") return remembered

  try {
    const configDir = dirname(TRINITY_OPENCODE_CONFIG || join(getOpenCodeHome(), "opencode.json"))
    const candidates = readdirSync(configDir)
      .filter((name) => /^opencode\.json\.bak/.test(name))
      .map((name) => {
        const path = join(configDir, name)
        return { path, mtime: statSync(path).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)

    for (const candidate of candidates) {
      try {
        const snapshot = safeJsonParse(readFileSync(candidate.path, "utf-8"))
        const agent = typeof snapshot?.default_agent === "string" ? snapshot.default_agent.trim() : ""
        if (agent && agent !== "plan") return agent
      } catch {}
    }
  } catch {}

  return null
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

function resolveOpenCodeConfigPath(): string {
  return TRINITY_OPENCODE_CONFIG || join(getOpenCodeHome(), "opencode.json")
}

function updateOpenCodeConfig(mutator: (oc: unknown) => boolean | void): boolean {
  try {
    const OC_CONFIG = resolveOpenCodeConfigPath()
    if (!existsSync(OC_CONFIG)) return false
    const oc = safeJsonParse(readFileSync(OC_CONFIG, "utf-8"))
    if (!oc) return false
    const result = mutator(oc)
    if (result === false) return false
    writeFileSync(OC_CONFIG, JSON.stringify(oc, null, 2) + "\n")
    return true
  } catch {
    return false
  }
}

let latestUserIntent = null
// Use the single canonical session id (from runtime-state, memoized on globalThis).
// Previously this module minted its own "opencode-<pid>-<Date.now()>" id, which
// diverged from the id the blackbox *reader* (turn-classify) used — so the writer
// saved resolution history under one key and the reader looked under another,
// leaving every session frozen at INIT. getOcSessionId() guarantees read==write.
const _OC_SID = getOcSessionId()
let _latestBlackboxState = null
let _latestBlackboxLoopMsg = null
let _latestBlackboxPivotMsg = null
let _prevOutputText = ""
let _prevBlackboxRegime = null
let _currentTemplate = DEFAULT_TEMPLATE
let _currentTemplateSignature = DEFAULT_TEMPLATE
let _prevTemplate = null
let _prevTemplateSignature = null
let _turnCountInject = 0
let _pivotLastCheckTurn = 0
let _pivotLastRegime: string | null = null
let _calBuffer: string[] = []
let _pendingOrchestratorDirective = ""
const correctionSeenKeys = new Set()

async function apiComputeControlVector(state: unknown, action: unknown, optimizationMode: unknown): Promise<unknown> {
  try {
    const requestedMode = typeof optimizationMode === "string"
      ? optimizationMode
      : String(optimizationMode?.optimization_mode || optimizationMode?.requested_mode || "auto")
    const res = await remoteCall("blackboxControlVector", [state, action, {
      optimization_mode: requestedMode,
      requested_mode: requestedMode,
      requested_slot: typeof optimizationMode === "object" ? optimizationMode?.requested_slot || null : null,
      pipeline_root: typeof optimizationMode === "object" ? optimizationMode?.pipeline_root || null : null,
      source: typeof optimizationMode === "object" ? optimizationMode?.source || null : null,
    }], null)
    if (res && typeof res === "object") {
      return normalizeBackendDecision(res, requestedMode)
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
  const allEntries = [...BRANDED_MODES, ...RUNTIME_MODES]
  const modeEntry = allEntries.find((e: unknown) => e.id === normalized)
  if (modeEntry?.pipeline?.length) return modeEntry.pipeline
  return normalizePipelineRoot(fallbackPipeline, tierBias)
}

function normalizeRoutePath(value: unknown, fallbackSlot: unknown): string[] {
  const route = normalizePipelineRoot(value, fallbackSlot)
  const slot = normalizeSlot(fallbackSlot)
  if (!slot || route.includes(slot)) return route
  return [...route, slot]
}

function normalizeBackendDecision(raw: unknown, fallbackMode: unknown = null): unknown {
  if (!raw || typeof raw !== "object") return raw
  const sourceDecision = raw.decision && typeof raw.decision === "object" ? raw.decision : raw
  const requestedMode = String(sourceDecision.requested_mode || sourceDecision.requestedMode || fallbackMode || raw.requested_mode || raw.requestedMode || "").trim().toLowerCase() || null
  const requestedSlot = normalizeSlot(sourceDecision.requested_slot || sourceDecision.requestedSlot || slotFromMode(requestedMode)) || null
  const optimizationMode = String(sourceDecision.optimization_mode || sourceDecision.mode || fallbackMode || raw.optimization_mode || raw.mode || requestedMode || "auto").trim().toLowerCase()
  const selectedSlot = normalizeSlot(sourceDecision.selected_slot || sourceDecision.selectedSlot || raw.selected_slot || raw.selectedSlot || sourceDecision.tier_bias || sourceDecision.active_slot || raw.tier_bias || raw.active_slot || slotFromMode(optimizationMode) || requestedSlot) || null
  const tierBias = selectedSlot
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
  try {
    ensureVibeSkill(dir)
  } catch {}
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
    const currentSel = loadSelection()
    const userSetMode = loadSessionOptMode(sid + "_opt")
    const userOptMode = userSetMode || loadOptimizationMode()
    const durablePipeline = modeCascadeRoot(cv.optimization_mode || userOptMode, cv.cascade_root || cv.pipeline_root, cv.selected_slot || cv.tier_bias)
    const routePath = normalizeRoutePath(cv.route_path || cv.pipeline_root, cv.selected_slot || cv.tier_bias)

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

    const compatibilityMode = currentSel.onboarding_mode === "assist"
    const flowManuallyDisabled = currentSel.flow_enabled === false && currentSel.flow_enforce === false
    writeIf("delegation_enforce", compatibilityMode ? cv.enforcement_mode === "strict" : cv.enforcement_mode !== "relaxed")

    if (!flowManuallyDisabled) {
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

    if (compatibilityMode) {
      writeIf("tdd_enforce", cv.tdd_mode === "strict")
      writeIf("tdd_strict", cv.tdd_mode === "strict")
    } else if (cv.tdd_mode === "lazy") {
      writeIf("tdd_enforce", false)
      writeIf("tdd_strict", false)
    } else {
      writeIf("tdd_enforce", true)
      writeIf("tdd_strict", cv.tdd_mode === "strict")
    }

    if (cv.thinking_mode) {
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
      const canRestorePrevious = !!restoreMode && cv.optimization_mode !== "vibelitex" && (previousOptMode !== null || sessionPreviousOptMode !== null)

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

    const slot = cv.selected_slot || cv.tier_bias
    const slotLocked = currentSel.slot_locked === true
    const canApplySlot = slot && slot !== "auto" && (authoritative || (!slotLocked && !_modelLocked))
    let appliedSlot = currentSel.active_slot || null
    if (canApplySlot) {
      const existingSlot = loadSessionSlot(sid)
      appliedSlot = slot
      const _ocModel = slot === "brain" ? TRINITY_BRAIN : slot === "medium" ? TRINITY_MEDIUM : TRINITY_CHEAP
      if (existingSlot !== slot) {
        writeSessionSlot(sid, slot)
        writeIf("active_slot", slot)
        writeIf("vector_changed_slot", slot)
        writeIf("vector_changed_at", Date.now())
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
          const applied = applySlot(slot, directory, { deferLiveSwitch: true })
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
          const r = reconcileSlotModel(slot, directory, _ocModel, { deferLiveSwitch: true })
          if (r.reconciled) {
            console.error(`[vibeOS] reconciled drifted model: live=${r.from || "∅"} → ${r.to}`)
          }
        } catch (err) {
          console.error("[vibeOS] failed to reconcile slot:", err?.message || err)
        }
      }
    }
    if (cv.agent_mode) {
      updateOpenCodeConfig((oc) => {
        if (oc.default_agent === cv.agent_mode) return false
        if (cv.agent_mode === "plan" && oc.default_agent && oc.default_agent !== "plan") {
          writeSelection("previous_default_agent", oc.default_agent)
        }
        oc.default_agent = cv.agent_mode
      })
    } else {
      updateOpenCodeConfig((oc) => {
        const restoreAgent = oc.default_agent === "plan" ? resolveRestorableOpenCodeAgent(currentSel) : null
        if (restoreAgent && oc.default_agent === "plan") {
          oc.default_agent = restoreAgent
          if (currentSel.previous_default_agent) writeSelection("previous_default_agent", null)
        }
      })
    }

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
      pipeline_root: durablePipeline,
      cascade_root: durablePipeline,
      route_path: routePath,
    }
  } catch (err) {
    console.error("[vibeOS] syncControlSettings failed:", err?.message || err)
    const fallbackSel = loadSelection()
    const fallbackSlot = fallbackSel?.active_slot || cv?.tier_bias || null
    return {
      applied_slot: fallbackSlot,
      applied_mode: cv?.optimization_mode || null,
      applied_pipeline: modeCascadeRoot(cv?.optimization_mode, cv?.cascade_root || cv?.pipeline_root, cv?.selected_slot || cv?.tier_bias),
      authoritative,
      decision: backendDecision || null,
      optimization_mode: cv?.optimization_mode || null,
      tier_bias: cv?.tier_bias || null,
      selected_slot: cv?.selected_slot || cv?.tier_bias || null,
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

// -- Context compression --------------------------------------------
function compressToolOutputs(messages: unknown[]): number {
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
      if (!raw || typeof raw !== "string" || raw.length < COMPRESS_THRESHOLD) continue
      if (raw.includes(COMPRESS_MARKER)) continue

      const hash = createHash("sha256")
        .update(`tool_result\n${raw}\n`).digest("hex").slice(0, 16)
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

      if (!isCold) continue

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

    const modePreview = peekBudgetFirstMode({
      requestedMode: loadOptimizationMode(),
      subRegime: localState.sub_regime || "INIT",
      stress: st || 0,
    })
    const cv = await apiComputeControlVector(localState, undefined, modePreview.mode)
    const lastEntry = state.sessions[sid].control_history?.[state.sessions[sid].control_history.length - 1]
    const cvFingerprint = JSON.stringify({ regime: localState.sub_regime, mode: cv?.enforcement_mode })
    const isDuplicate = lastEntry && (
      lastEntry.fingerprint === cvFingerprint ||
      (lastEntry.regime === localState.sub_regime && lastEntry.enforcement === cv?.enforcement_mode)
    )
    if (!isDuplicate) {
      const turnNum = (existingSession.turn_counter || 0) + 1
      const entry = buildControlHistoryEntry(
        turnNum,
        localState.sub_regime || "INIT",
        cv,
      )
      entry.fingerprint = cvFingerprint
      state.sessions[sid].control_history.push(entry)
      if (state.sessions[sid].control_history.length > 100) {
        state.sessions[sid].control_history = state.sessions[sid].control_history.slice(-100)
      }
    }
    state.sessions[sid] = {
      ...existingSession,
      ...serialized,
      project_fingerprint: currentProjectFingerprint || existingSession.project_fingerprint || "",
      sub_regime: localState.sub_regime || existingSession.sub_regime || "INIT",
      regime: localState.sub_regime || existingSession.regime || "INIT",
      resolution: localState.resolution || existingSession.resolution || "unresolved",
      momentum: localState.momentum ?? existingSession.momentum ?? 0,
      signals: localState.signals || existingSession.signals || {},
      intent_state: localState.intent_state || existingSession.intent_state || {},
      continuity_state: localState.continuity_state || existingSession.continuity_state || "HIGH",
      is_looping: localState.is_looping ?? existingSession.is_looping ?? false,
      loop_consecutive: localState.loop_consecutive ?? existingSession.loop_consecutive ?? 0,
      loop_intervention_level: localState.loop_intervention_level || existingSession.loop_intervention_level || "none",
      pivot_detected: localState.pivot_detected ?? existingSession.pivot_detected ?? false,
      pivot_score: localState.pivot_score ?? existingSession.pivot_score ?? 0,
      outcome: localState.outcome || existingSession.outcome || null,
      control_history: state.sessions[sid].control_history,
      optimization_mode: existingSession.optimization_mode || null,
      active_slot: existingSession.active_slot || null,
      turn_counter: (existingSession.turn_counter || 0) + 1,
    }
    saveBlackboxStateToCtx(state)
    _latestBlackboxState = localState
    fetchBlackboxEnrichment(sid, localState).then(enriched => {
      if (enriched) _latestBlackboxState = enriched
    }).catch(() => {})
  } catch {}
}

export const onMessagesTransform = async (_input, output) => {
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
      const claimStatus = evaluateClaimVerification({ text: currentAssistantText, vibeHome })
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
  let brainModel = "(brain)"
  try { brainModel = safeJsonParse(readFileSync(TIERS_FILE, "utf-8")).trinity?.brain?.oc || brainModel } catch {}
  const cheapModel = TRINITY_CHEAP || "the cheaper model"
  const mediumModel = TRINITY_MEDIUM || "the medium model"
  const targetModel = tierBias === "cheap" ? cheapModel : tierBias === "medium" ? mediumModel : tierBias === "brain" ? brainModel : `${cheapModel} or ${mediumModel}`
  const compatibilityMode = sel?.onboarding_mode === "assist"
  const cheapSlot = TRINITY_CHEAP || cheapModel
  return `[AI ORCHESTRATOR AGENT] You are an AI orchestrator agent. ` +
    `Delegate heavy work to Task subagents (runs on ${targetModel}). ` +
    `Your role is to verify, fill gaps, and synthesize cleanly. ` +
    (compatibilityMode
      ? "Compatibility mode is active, so direct Write/Edit stays available until strict guardrails are enabled."
      : "Brain-tier focuses on orchestration — hand file writes and edits to Task subagents (cheaper, same quality). Use medium directly with `trinity medium` if the task is simple enough.") +
    ` [delegation guide] When a write/edit is blocked, use the \`task\` tool with: ` +
    `subagent_type="general" model="${cheapSlot}" prompt="write <path> with: <content>". ` +
    `The task subagent runs on the cheap tier and handles file operations transparently. ` +
    `Parallel task calls are encouraged for independent file changes. ` +
    ` Always display the vibeOS cost footer.` +
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
  nextTurn()
  if (!loadSelection().enabled) return
  try {
    // Ensure _latestBlackboxState is fresh (guard against cross-session module cache leak)
    const bbOnDisk = loadBlackboxStateFromCtx()
    if (_latestBlackboxState && bbOnDisk) {
      const diskHasSessions = Object.keys(bbOnDisk.sessions || {}).length > 0
      const stateHasRegime = !!_latestBlackboxState.sub_regime
      if (diskHasSessions && !stateHasRegime) {
        _latestBlackboxState = bbOnDisk
      }
    }
    const hookDirectory = String((onSystemTransform as unknown)._directory || "")
    const userText = extractLastUserText(_input) || extractLastUserText(output)
    if (typeof userText === "string" && userText.trim()) latestUserIntent = userText
    else if (!latestUserIntent) latestUserIntent = null
    if (latestUserIntent) observeUserCorrection(latestUserIntent)

    const classifiedRegime = _latestBlackboxState?.sub_regime || (latestUserIntent ? await classifyTurnRemote(latestUserIntent) : "INIT")
    const requestedOptimizationMode = loadOptimizationMode()
    const backendAutoModes = new Set(["auto", "vibeultrax", "vibeqmax", "vibemax", "vibelitex"])
    const useBackendDecision = backendAutoModes.has(String(requestedOptimizationMode || "").toLowerCase())
    let optimizationDecision = null
    let optimizationMode = requestedOptimizationMode
    let _controlVector = null
    ensureProjectContext(hookDirectory)
    const st = latestUserIntent ? scoreStress(latestUserIntent) : 0
    const cvState = _latestBlackboxState
      ? { ..._latestBlackboxState, latest_stress_multiplier: st || _latestBlackboxState.latest_stress_multiplier || 0 }
      : {
        sub_regime: classifiedRegime || "INIT",
        latest_stress_multiplier: st || undefined,
        user_text: latestUserIntent || undefined,
      }
    const requestedDecision = {
      optimization_mode: requestedOptimizationMode,
      requested_mode: requestedOptimizationMode,
      requested_slot: null,
      source: useBackendDecision ? "backend" : "manual",
    }
    if (useBackendDecision) {
      const backendResult = await apiComputeControlVector(cvState, undefined, requestedDecision)
      optimizationDecision = backendResult?.decision || backendResult || null
      _controlVector = backendResult?.control_vector || backendResult || null
      optimizationMode = optimizationDecision?.optimization_mode || optimizationMode
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
    if (_controlVector) {
      const fullState = loadBlackboxStateFromCtx() || { sessions: {}, enabled: true }
      fullState.cv = _controlVector
      if (_latestBlackboxState) {
        if (_latestBlackboxState.sub_regime) fullState.sub_regime = _latestBlackboxState.sub_regime
        if (_latestBlackboxState.latest_stress_multiplier) fullState.latest_stress_multiplier = _latestBlackboxState.latest_stress_multiplier
        if (_latestBlackboxState.n_interactions) fullState.n_interactions = _latestBlackboxState.n_interactions
        if (_latestBlackboxState.resolution) fullState.resolution = _latestBlackboxState.resolution
        if (_latestBlackboxState.momentum) fullState.momentum = _latestBlackboxState.momentum
        fullState.latest_control_vector_ts = Date.now()
      }
      fullState.sessions ??= {}
      saveBlackboxStateToCtx(fullState)
    }
    try {
      const blackboxState = loadBlackboxStateFromCtx() || { sessions: {}, enabled: true }
      const existingSession = blackboxState.sessions?.[_OC_SID] || null
      if (!existingSession || !existingSession.sub_regime) {
        const sessionState = _latestBlackboxState || {
          sub_regime: classifiedRegime || "INIT",
          resolution: "unresolved",
          momentum: 0,
        }
        const turnCounter = Number(existingSession?.turn_counter || 0) + 1
        const controlHistory = Array.isArray(existingSession?.control_history) ? [...existingSession.control_history] : []
        if (_controlVector) {
          const entry = buildControlHistoryEntry(turnCounter, sessionState.sub_regime || "INIT", _controlVector)
          const lastEntry = controlHistory[controlHistory.length - 1]
          if (!lastEntry || JSON.stringify(lastEntry) !== JSON.stringify(entry)) {
            controlHistory.push(entry)
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
          control_history: controlHistory,
          optimization_mode: optimizationDecision?.optimization_mode || existingSession?.optimization_mode || null,
          active_slot: optimizationDecision?.selected_slot || optimizationDecision?.tier_bias || _controlVector?.selected_slot || _controlVector?.tier_bias || existingSession?.active_slot || null,
          turn_counter: turnCounter,
        }
        saveBlackboxStateToCtx(blackboxState)
      }
      if (_controlVector && existingSession?.sub_regime) {
        blackboxState.sessions ??= {}
        blackboxState.sessions[_OC_SID] = {
          ...existingSession,
          cv: _controlVector,
          optimization_mode: optimizationDecision?.optimization_mode || existingSession?.optimization_mode || null,
          active_slot: optimizationDecision?.selected_slot || optimizationDecision?.tier_bias || _controlVector?.selected_slot || _controlVector?.tier_bias || existingSession?.active_slot || null,
          latest_control_vector_ts: Date.now(),
        }
        saveBlackboxStateToCtx(blackboxState)
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
    const fp = ensureProjectContext(hookDirectory)
    const rawStress = latestUserIntent ? scoreStress(latestUserIntent) : 0
    const stressScore = rawStress * (_controlVector?.stress_multiplier ?? 1)
    const credit = loadCredit()
    _turnCountInject++

    // ── Pivot detection and PIVOT BACK injection (gated — 1/5 turns or regime change) ──
    const _pivotRegimeChanged = _latestBlackboxState?.sub_regime && _latestBlackboxState.sub_regime !== _pivotLastRegime
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
      if (_latestBlackboxState?.sub_regime) _pivotLastRegime = _latestBlackboxState.sub_regime
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
    _currentTemplate = resolveTemplate(_prevTemplate, stressScore, latestUserIntent, credit, _latestBlackboxState?.sub_regime)
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

    // ── Thinking directive ──
    if (sel.thinking_level && sel.thinking_level !== "full") {
      pushSystem(output, thinkingDirective(sel.thinking_level))
    }

    // ── Remote control-vector directives ──
    if (_controlVector?.directives?.length > 0) {
      for (const directive of _controlVector.directives) {
        pushSystem(output, directive)
      }
    }

    // ── Blackbox — only on regime change ──
    else if (_blackboxEnabled && _latestBlackboxState?.n_interactions > 0) {
      const prevRegime = _prevBlackboxRegime
      const res = _latestBlackboxState
      const currentRegime = res.sub_regime || "EXPLORING"
      if (currentRegime !== prevRegime) {
        _prevBlackboxRegime = currentRegime
        pushSystem(output, "[decision engine] Resolution: " + (res.resolution || "unresolved") + " " +
          "(" + currentRegime + "). Momentum: " + ((res.momentum || 0) > 0 ? "↗ positive" : (res.momentum || 0) < 0 ? "↘ negative" : "→ steady") + ".")
        if (res.is_looping && res.loop_intervention_level && res.loop_intervention_level !== "none") {
          const severity = res.loop_intervention_level === "escalated" ? "CRITICAL"
            : res.loop_intervention_level === "assertive" ? "WARNING" : "NOTICE"
          pushSystem(output, "[loop prevention: " + severity + "] " + (_latestBlackboxLoopMsg || "The conversation may be looping — try a different approach.") + " " +
            "(level: " + res.loop_intervention_level + ")")
        }
        if (res.pivot_detected && _latestBlackboxPivotMsg) {
          pushSystem(output, "[context switch: PIVOT] " + _latestBlackboxPivotMsg)
        }
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
        const branch = String(classifiedRegime || _latestBlackboxState?.sub_regime || "intent").toLowerCase()
        recordProjectFact(fp, currentProjectName || "", branch, "fact", String(latestUserIntent))
      }
    } catch {}
    if (!oneShot("trinity_welcome_" + fp)) {
      pushSystem(output, welcomeDirective())
    }

    // ── Calibration logging (buffered — flush every 10 turns) ──
    const regime2 = _latestBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || "")
    _calBuffer.push(JSON.stringify({
      ts: new Date().toISOString(), sid: _OC_SID,
      mode: _currentTemplate, regime: regime2, stress: stressScore,
      fp: currentProjectFingerprint || "",
    }) + "\n")
    if (_turnCountInject % 10 === 0 && _calBuffer.length > 0) {
      try {
        const calFile = join(getVibeOSHome(), "calibration-data.jsonl")
        mkdirSync(getVibeOSHome(), { recursive: true })
        appendFileSync(calFile, _calBuffer.join(""))
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
      pushSystem(output, regimeAwareToolStyleDirective(_latestBlackboxState?.sub_regime || classifiedRegime, _currentTemplate, stressScore, _controlVector?.agent_mode))
    }
    if (_pendingOrchestratorDirective) {
      pushSystem(output, _pendingOrchestratorDirective)
      _pendingOrchestratorDirective = ""
    }

  } catch (err) {
    console.error(`[vibeOS] system.transform failed: ${err.message}`)
  }
}

export { latestUserIntent, injectWBP, context7Directive, C7_URGENCY }
