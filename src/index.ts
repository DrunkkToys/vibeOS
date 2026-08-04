// @ts-nocheck
/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
 *
 * vibeOS — OpenCode plugin: cost-aware delegation enforcer, trinity tier
 * control, live savings footer, TDD enforcer, flow enforcer, project guard,
 * research audit, reporting, decision engine, context7 optimization, and more.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, statSync, appendFileSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import { getFlowWarns, ensureProjectDocs, syncFlowTodosToNative } from "./vibeOS-lib/flow-enforcer.js"
import { computeSessionMetrics } from "./vibeOS-lib/session-metrics.js"
import { createMcpServer, writeDashboardBaseConfig } from "./lib/vibeos-mcp-server.js"
import { isApiConnected, isApiFallback, getBackendVersion, getApiFallbackSince, setApiToken, setApiBootstrapToken, ensureBootstrapExchange, syncApiTokenFromDisk, VIBEOS_API_URL, getApiClient } from "./lib/api-client.js"
import { applySlot, reconcileSlotModel, modelCostPerTurn, detectContext7, formatUsd, classify, resolveEffectiveTier, _refreshModel, HIGH_TIER_RE, MID_TIER_RE, PLACEHOLDER_RE, readConfig, readLiveOpenCodeModel, getTrinitySlotOrder, loadTrinitySlotsFromTiersFile, isModelFree, resolveCurrentExecution, modelDisplayName, TRINITY_BRAIN, TRINITY_MEDIUM, TRINITY_CHEAP, getPendingLiveSwitch, resetPendingLiveSwitch } from "./lib/pricing.js"
import { scoreStress, detectTechStack, loadBlackboxState, saveBlackboxState, getBlackboxTracker, getBlackboxResolution, getLatestBlackboxState, saveOptimizationMode, resetBlackboxTracker, getLatestBlackboxLoopMsg, getLatestBlackboxPivotMsg } from "./lib/cascade.js"
import { safeJsonParse, readFullState, loadSelection, writeSelection, readLifetimeSavings, _OC_SID, _modelLocked, _blackboxEnabled, setBlackboxEnabled, _lockedSlot, _lockedModel, setModelLocked, setLockedSlot, setLockedModel, currentTier, currentModel, currentProjectFingerprint, currentProjectName, setCurrentTier, setCurrentModel, setCurrentProjectFingerprint, setCurrentProjectName, setCurrentSessionId, getCurrentSessionId, briefedProjects, getActiveJobForProject, projectFingerprint, loadProjectState, saveProjectState, ensureProjectBucket, mergeProjectBucket, setVibeOSHomeContext, resetSessionId, SAVINGS_LEDGER_FILE, USER_HOME, CREDIT_CACHE_F, pruneScratchpadOnce, registerSessionCleanupHandlers, runStartupMaintenanceOnce, promotedProjectPatterns, projectPatternRows, clearProjectPatterns, loadTodos, loadTodosForCurrentProject, getTodos, upsertTodo, markTodoDone, tool, loadSessionOrchestration, mutateSessionOrchestration, withFileLock } from "./lib/state.js"
import { getRuntimeVibeOSHome, setRuntimeVibeOSHome, resetRuntimeStateForTest as _resetRuntimeGlobalStateForTest } from "./lib/runtime-state.js"
import { researchAudit } from "./lib/research-audit.js"
import { buildStatusPayload, buildSavingsPayload, buildSessionCheckout, diagnoseStructuredFromText, projectStructuredFromText } from "./lib/runtime-surface.js"
import { TEMPLATE_LIBRARY } from "./lib/templates.js"
import { saveReport, listReports, readReport } from "./lib/reporting.js"
import { appendJsonlWithRotation } from "./utils/fs-helpers.js"
import { writeSessionSlot, writeSessionOptMode, _resetSelectionCacheForTest } from "./lib/selection-manager.js"
import { loadCredit, thinkingLevel, _lazyRefresh, _readAuth } from "./lib/credit-api.js"
import { createTrinityTool } from "./lib/trinity-tool.js"
import { classifyAndRankModels, modelToCcAlias, discoverAvailableModels, probeModel } from "./lib/trinity-rebuild.js"
import { _appendFooter, buildFooterAlert, didTextCompletePainted, resetFooterRuntimeState } from "./lib/hooks/footer.js"
import { buildResilientFooterLine } from "./lib/hooks/footer.js"
import { onToolExecuteBefore, onToolExecuteAfter, setToolDirectory, _resetWarnCountsForTest } from "./lib/hooks/tool-execute.js"
import { onMessagesTransform, onSystemTransform, latestUserIntent, ensureProjectSkill, resetChatTransformState } from "./lib/hooks/chat-transform.js"
import { onChatParams, onChatHeaders, setChatParamsDirectory } from "./lib/hooks/chat-params.js"
import { onSessionCompacting } from "./lib/hooks/session-compact.js"
import { onShellEnv, setShellDirectory } from "./lib/hooks/shell-env.js"
import { setTddDirectory } from "./lib/tdd-enforcer.js"
import { installVibeTierAgents, readDefaultAgent } from "./lib/runtime-config.js"
import { getOpenCodeHome, getVibeOSHome, recentToolEvents } from "./lib/state.js"
import { resetTurnClassifyRuntimeState } from "./lib/cascade.js"
import { getTiersFile, getReportsDir, readPublishedMcpRuntime, publishMcpRuntime } from "./lib/bootstrap-paths.js"
import { flushDashboardMutationQueue, primeDashboardBridgeCache, queueDashboardProjectionRefresh } from "./lib/dashboard-bridge.js"
import { getSessionDelegationSavings } from "./lib/session-savings.js"
import { getLatestTurnTruth } from "./lib/turn-ledger.js"
import { runQualityGate, formatGateReport, readGateEvents, readGateVerdicts, recordGateVerdict, dedupeGateReportKey, QUALITY_GATE_MARKER } from "./vibeOS-lib/quality-gate.js"
function ensureDeferredBootstrap() {
  if (_deferredBootstrapDone || _modelLocked)
    return
  _deferredBootstrapDone = true
  try {
    _runDeferredStartupBootstrap?.()
  }
  catch { }
}

// Claim verifier: structural grammar for assistant output claims.
// ACTION:  /(I|we|the)\s+(pushed|released|merged|deployed|fixed|wrote|implemented|completed|committed)\b/i
// STATE:   /(tests?|build|CI|checks?|suite|output|result)\s+(pass|green|clean|succeed|stable|positive)\b/i
// VERSION: /v\d+\.\d+\.\d+/
// NUMERIC: /\d+\s*(test|spec)s?\s*(pass|passing)/i
// DONE:    /done|finished|complete/i
// FIX:     /fixed|resolved|solved/i
// WORKS:   /works|working|validated|verified/i
// EXIT:    /exit\s*code\s*0|0\s*errors|0\s*failures/i
// SCORE:   /\d+%|score|scored|passing|passed/i
const CLAIM_PATTERNS = [
  /(?:I|we|the)\s+(?:pushed|released|merged|deployed|fixed|wrote|implemented|completed|committed)\b/i,
  /(?:tests?|build|CI|checks?|suite|output|result)\s+(?:is\s+|are\s+)?(?:pass(?:ing|ed|es)?|green|clean|succeed|stable|positive)/i,
  /v\d+\.\d+\.\d+/,
  /\d+\s*(?:test|spec)s?\s*(?:pass|passing)/i,
  /(?:done|finished|complete)/i,
  /(?:fixed|resolved|solved)/i,
  /(?:works|working|validated|verified)/i,
  /(?:exit\s*code\s*0|0\s*errors|0\s*failures)/i,
  /(?:\d+%|score|scored|passing|passed)/i,
  // Bare health/status claims that slip past "fixed/works/passed" wording.
  // Covers "Cascade Diagnosis: Healthy... No lock, no stress, no degradation."
  // and similar fabricated "no degradation" or "all good" assertions.
  /\b(?:healthy|no\s+(?:degradation|issues|problems)|all\s+good|everything\s+(?:is\s+)?(?:fine|ok|okay)|nominal|operating\s+normally)\b/i,
]
function scanClaimsInOutput(output) {
  let text = ""
  if (typeof output === "string") {
    text = output
  } else if (output && typeof output === "object") {
    const payload = typeof output.message === "object" && output.message ? output.message : output
    if (typeof payload.text === "string") text = payload.text
    else if (typeof payload.result === "string") text = payload.result
    else if (typeof payload.content === "string") text = payload.content
    else if (Array.isArray(payload.content)) text = payload.content.filter(p => p?.type === "text").map(p => p.text).filter(Boolean).join("\n")
    else if (Array.isArray(payload.parts)) text = payload.parts.filter(p => p?.type === "text").map(p => p.text).filter(Boolean).join("\n")
  }
  if (!text) return
  try {
    const claims = []
    const lines = String(text).split(String.fromCharCode(10))
    for (let i = 0; i < lines.length; i++) {
      for (const pat of CLAIM_PATTERNS) {
        if (pat.test(lines[i])) claims.push({ line: i + 1, text: lines[i].trim().substring(0, 120), pattern: pat.source })
      }
    }
    if (claims.length === 0) return
    const vibeHome = getVibeOSHome()
    if (!vibeHome || vibeHome === "undefined" || vibeHome.startsWith("undefined")) return
    const auditDir = join(vibeHome, "cascade-audit")
    mkdirSync(auditDir, { recursive: true })
    const auditFile = join(auditDir, "claim-audit.jsonl")
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      // Live-reproduced: without a sessionId, _checkAndRecordUnsubstantiatedClaims
      // reads the last 10 lines of this file with no session boundary at all --
      // a genuinely test-backed claim from THIS session ("All 3 tests pass") got
      // flagged unverified because unrelated older sessions' claims (a Redis
      // rate-limiter writeup, old footer-bug claims) shared the scan window.
      sessionId: getCurrentSessionId() || _OC_SID || "",
      claims: claims.slice(0, 10),
      totalClaims: claims.length,
      responseHash: "",
    })
    appendFileSync(auditFile, entry + String.fromCharCode(10))
  } catch {}
}
// This cross-check already ran every turn in both hooks below -- it just threw
// its own answer away. `_unsubstantiatedClaims` was computed and reassigned
// here but never read anywhere else in the codebase, so a real fabricated
// claim (e.g. "Cascade Diagnosis: Healthy... no degradation" while
// cheap_first_degraded was actually true) never surfaced to a human unless
// they ran `vibe verify-claims` by hand. Now it also appends to
// drift-alerts.jsonl so the footer (see footer.ts's readLatestDriftAlert)
// and `vibe reality-check` can pick it up without a manual command.
function _checkAndRecordUnsubstantiatedClaims() {
  try {
    const auditDir = join(getVibeOSHome(), "cascade-audit")
    const claimFile = join(auditDir, "claim-audit.jsonl")
    const cascadeFile = join(auditDir, "cascade-audit.jsonl")
    if (!existsSync(claimFile) || statSync(claimFile).size === 0) return
    // Live-reproduced: slicing the last 10 RAW lines of claim-audit.jsonl mixed
    // claims from completely unrelated sessions into this session's count -- a
    // genuinely test-backed claim ("All 3 tests pass") from THIS session got
    // flagged alongside an old Redis-rate-limiter claim and old footer-bug
    // claims from a different conversation entirely. Scan a wider raw window,
    // then keep only entries that actually belong to the current session
    // (an entry with no sessionId is a legacy/unscoped write and must not be
    // treated as a match, same principle as footer.ts's drift-alert reader).
    const currentSid = getCurrentSessionId() || _OC_SID || ""
    const rawClaimLines = readFileSync(claimFile, "utf-8").trim().split("\n").slice(-200)
    const claimLines = currentSid
      ? rawClaimLines.filter((l) => {
        try { return String(JSON.parse(l)?.sessionId || "") === String(currentSid) } catch { return false }
      }).slice(-10)
      : rawClaimLines.slice(-10)
    const cascadeLines = existsSync(cascadeFile) ? readFileSync(cascadeFile, "utf-8").trim().split("\n").slice(-30) : []
    const cascadeRuns = cascadeLines.filter(Boolean).map(l => { try { return JSON.parse(l) } catch {} }).filter(Boolean)
    let unsub = 0
    const unsubClaimTexts = []
    for (const cl of claimLines) {
      if (!cl.trim()) continue
      let entry
      try { entry = JSON.parse(cl) } catch { continue }
      if (!entry) continue
      const claimTexts = (entry.claims || []).map(function(c) { return c.text }).join(" | ")
      if (!CLAIM_PATTERNS.some(function(p) { return p.test(claimTexts) })) continue
      let cascadeMatch = false
      for (const cr of cascadeRuns) {
        // chat-params (chat-params.ts's _writeChatRouteAudit) appends a line to
        // this SAME file on every single turn regardless of whether any tool
        // ran or anything was actually verified -- it never sets `executed`.
        // Live-reproduced: without this guard, a claim's timestamp landed ~2s
        // after a routine chat-params entry and was marked "substantiated" by
        // pure proximity, even though nothing about the claim's content was
        // checked. Only count entries that represent a real routing decision
        // (ml/backend/task cascade writes, which always set executed:true).
        if (cr.executed !== true) continue
        const cTs = cr._ts || ""
        if (cTs && entry.ts && Math.abs(new Date(cTs).getTime() - new Date(entry.ts).getTime()) < 120000) {
          cascadeMatch = true
          break
        }
      }
      if (!cascadeMatch) {
        unsub++
        for (const c of (entry.claims || [])) unsubClaimTexts.push(c.text)
      }
    }
    _unsubstantiatedClaims = unsub
    if (unsub > 0) {
      const driftFile = join(auditDir, "drift-alerts.jsonl")
      appendFileSync(driftFile, JSON.stringify({
        ts: new Date().toISOString(),
        // Live-reproduced: without a sessionId, footer.ts's readLatestDriftAlert
        // just reads the file's LAST line with no session scoping at all -- an
        // unrelated older session's stale unsubstantiated-claim count (from
        // completely different work, e.g. "scratch-flow-test.py") bled into a
        // brand-new session's footer that never made any unverified claim.
        sessionId: getCurrentSessionId() || _OC_SID || "",
        count: unsub,
        claims: unsubClaimTexts.slice(0, 5),
      }) + "\n")
    }
  } catch {}
}
const _gateNoteBySession = new Map<string, string>()
function _extractOutputText(output) {
  try {
    const payload = typeof output?.message === "object" && output.message ? output.message : output
    if (typeof payload.text === "string") return payload.text
    if (typeof payload.result === "string") return payload.result
    if (typeof payload.content === "string") return payload.content
    if (Array.isArray(payload.content)) return payload.content.filter((p) => p?.type === "text").map((p) => p.text).filter(Boolean).join("\n")
    if (Array.isArray(payload.parts)) return payload.parts.filter((p) => p?.type === "text").map((p) => p.text).filter(Boolean).join("\n")
  } catch {}
  return ""
}
// Deterministic quality gate — vibeOS v2. Runs on every completion. Silent when
// the model's claims are backed by real tool evidence; on failure appends one
// concise, deduped report listing the exact missing evidence. Never blocks.
function _runQualityGate(output) {
  try {
    if (process.env.VIBEOS_QUALITY_GATE === "0") return
    const text = _extractOutputText(output)
    if (!text) return
    const sessionId = getCurrentSessionId()
    const home = getVibeOSHome()
    const events = readGateEvents(home, sessionId)
    const recentTools = Array.isArray(recentToolEvents) ? recentToolEvents.slice(-20) : []
    const verdict = runQualityGate({ text, events, recentTools })
    const key = dedupeGateReportKey(verdict)
    // Persistent dedup: if this exact failure was already reported for this
    // session (across turns AND processes — each opencode run is a new process,
    // so the in-memory map below cannot survive turns), do not append the note
    // again. Checked BEFORE recording so the current verdict is not counted.
    const priorReported = !verdict.passed && readGateVerdicts(home, sessionId, 100).some(
      (v) => v && !v.passed && dedupeGateReportKey(v) === key,
    )
    recordGateVerdict(home, sessionId, verdict)
    // Real feedback signal: send the deterministic verdict to the backend so
    // blackbox_sessions.outcome and the prediction ground-truth plumbing are fed
    // with actual outcomes. Offline/degraded API = no-op, never throws.
    if (typeof isApiConnected === "function" && isApiConnected()) {
      try {
        getApiClient().blackboxOutcome(sessionId, verdict.passed ? "positive" : "negative").catch(() => {})
      } catch {}
    }
    if (verdict.passed) return
    if (priorReported) return
    if (text.includes(QUALITY_GATE_MARKER)) return
    if (_gateNoteBySession.get(sessionId) === key) return
    _gateNoteBySession.set(sessionId, key)
    const report = formatGateReport(verdict)
    if (!report) return
    const payload = typeof output?.message === "object" && output.message ? output.message : output
    if (typeof payload.text === "string") payload.text += report
    else if (typeof payload.result === "string") payload.result += report
    else if (typeof payload.content === "string") payload.content += report
  } catch {}
}
function ensureFooterFallback(input, output, directory, hookName = "fallback") {
  try {
    const messageID =
      input?.messageID ||
      input?.messageId ||
      input?.message?.id ||
      output?.messageID ||
      output?.messageId ||
      output?.message?.id ||
      null
    if (messageID && footerFallbackPainted.has(messageID)) return false
    const payload = typeof output?.message === "object" && output.message ? output.message : output
    const currentText =
      typeof payload?.text === "string"
        ? payload.text
        : typeof payload?.result === "string"
          ? payload.result
          : typeof payload?.content === "string"
            ? payload.content
            : ""
    if (!currentText) return false
    if (messageID && didTextCompletePainted(messageID)) return false
    if (/\n\n— [^\n]+ —\s*$/.test(currentText)) {
      if (messageID) footerFallbackPainted.add(messageID)
      return false
    }
    _refreshModel(directory)
    const sid = getCurrentSessionId()
    const latestTurnTruth = getLatestTurnTruth(sid)
    const latestExecutedRoute = latestTurnTruth?.executedRoute || null
    const latestRouteDrivesVisibleAnswer = latestExecutedRoute?.contributedToFinalAnswer === true
    const latestFinalized = latestTurnTruth?.finalized || null
    const sessionSlot = latestFinalized?.finalVisibleSlot
      || (latestRouteDrivesVisibleAnswer ? latestExecutedRoute?.selectedSlot : "")
      || loadSelection().active_slot
      || "cheap"
    const slotModel = sessionSlot === "brain" ? TRINITY_BRAIN
      : sessionSlot === "medium" ? TRINITY_MEDIUM
        : TRINITY_CHEAP
    const liveModel = readLiveOpenCodeModel(directory) || readConfig(directory) || readConfig(getOpenCodeHome()) || process?.env?.OPENCODE_MODEL || ""
    const resolvedModel = latestFinalized?.finalVisibleModel
      || (latestRouteDrivesVisibleAnswer ? latestExecutedRoute?.selectedModel : "")
      || liveModel
      || currentModel
      || slotModel
      || ""
    const resolvedTier = String(classify(resolvedModel) || "").toLowerCase()
    const label = latestFinalized?.finalVisibleSlot
      || (latestRouteDrivesVisibleAnswer ? latestExecutedRoute?.selectedSlot : "")
      || (resolvedTier === "high" ? "brain" : resolvedTier === "mid" ? "medium" : "cheap")
    const fallbackExecution = resolveCurrentExecution({
      directory,
      activeSlot: label,
      currentModel,
      liveModel: resolvedModel,
      tiersData: {
        trinity: {
          brain: { oc: TRINITY_BRAIN || currentModel },
          medium: { oc: TRINITY_MEDIUM || currentModel },
          cheap: { oc: TRINITY_CHEAP || currentModel },
        },
      },
    })
    // SINGLE SOURCE OF TRUTH: the safety net renders the SAME README footer line as the
    // rich path (buildResilientFooterLine → buildFooterLine), with the same alert/cascade
    // data so a degraded turn still shows model drift, cascade depth, and the enforcement
    // mode the user configured.
    let alertTag = ""
    try {
      const pendingSwitch = getPendingLiveSwitch()
      const expected = label === "brain" ? TRINITY_BRAIN : label === "medium" ? TRINITY_MEDIUM : TRINITY_CHEAP
      alertTag = buildFooterAlert({
        apiDegraded: isApiFallback(),
        apiSlow: false,
        liveModel: resolvedModel || undefined,
        expectedModel: expected || undefined,
        lastModelError: undefined,
        pendingLiveModel: pendingSwitch?.model || undefined,
        sessionId: sid,
        cheapFirstDegraded: loadSelection().cheap_first_degraded === true,
      })
    } catch {}
    const cascadeState = typeof loadBlackboxState === "function" ? loadBlackboxState() : null
    // cascade_tier's one real consumer — do not delete this field from state.ts's
    // control-vector normalization (_normalizeVibeUltraXControlVector) in a future
    // cleanup pass just because it looks like a duplicate of selected_slot.
    const cvCt = cascadeState?.control_vector?.cascade_tier
    const selectedRoutePathDepth = Array.isArray(loadSelection().route_path) ? loadSelection().route_path.length : null
    const cascadeDepth = Number(
      cvCt === "medium" ? 2 : cvCt === "brain" ? 3
        : selectedRoutePathDepth ?? cascadeState?.control_vector?.cascade_depth ?? cascadeState?.cascade_depth ?? 0,
    ) || 0
    const footer = `${currentText}\n\n${buildResilientFooterLine({
      activeSlot: label,
      providerLabel: fallbackExecution.provider_label || "Unknown",
      modelName: modelDisplayName(fallbackExecution.model || resolvedModel || "unknown"),
      optMode: String(loadSelection().optimization_mode || ""),
      flashIcon: typeof isApiConnected === "function" && isApiConnected() ? " ⚡" : "",
      cascadeIcon: cascadeDepth >= 3 ? "▸▸▸" : cascadeDepth >= 2 ? "▸▸" : cascadeDepth >= 1 ? "▸" : "",
      alertTag: alertTag || undefined,
    })}`
    try {
        if (sid) {
          const eventsDir = join(getVibeOSHome(), "session-events")
        mkdirSync(eventsDir, { recursive: true })
        appendJsonlWithRotation(join(eventsDir, `${sid}.jsonl`), JSON.stringify({
          ts: new Date().toISOString(),
          kind: "footer-probe",
          hook: hookName,
          builder: "fallback",
          provider_label: fallbackExecution.provider_label || "",
          provider: fallbackExecution.provider || "",
          model_id: fallbackExecution.model || "",
          model_name: modelDisplayName(fallbackExecution.model || resolvedModel || "unknown"),
          active_slot: label,
          session_slot: loadSelection().active_slot || "",
          mode: "",
          message_id: messageID || null,
          footer_line: footer.split("\n").pop() || "",
        }) + "\n", 200, 50)
      }
    } catch {}
    if (typeof payload?.text === "string") payload.text = footer
    else if (typeof payload?.result === "string") payload.result = footer
    else if (typeof payload?.content === "string") payload.content = footer
    else if (Array.isArray(payload?.content)) {
      const textParts = payload.content.filter(p => p?.type === "text")
      if (textParts.length > 0) textParts[textParts.length - 1].text = footer
      else payload.content.push({ type: "text", text: footer })
    } else if (Array.isArray(payload?.parts)) {
      const textParts = payload.parts.filter(p => p?.type === "text")
      if (textParts.length > 0) textParts[textParts.length - 1].text = footer
      else payload.parts.push({ type: "text", text: footer })
    } else payload.text = footer
    if (messageID) footerFallbackPainted.add(messageID)
    return true
  } catch {
    return false
  }
}
// ── Remote API client state ──────────────────────────────────────────
let _apiClient = null

// Live-reproduced (2026-07-15, driven for real in OpenCode Desktop): this
// variable was assigned in _checkAndRecordUnsubstantiatedClaims (and, before
// the refactor, in both duplicated hook blocks) but never declared anywhere
// in this file's history -- the assignment threw a ReferenceError on every
// single turn, silently swallowed by the function's own catch block, so the
// whole cross-check never once completed successfully in production.
let _unsubstantiatedClaims = 0

let activeJob = null
let fp = ""
let _mcpServerRuntime = null
let _mcpServerHooked = false
let _mcpServerStartupPromise = null
let _mcpServerRestartTimer = null
let _mcpServerShouldRun = false
let _mcpServerClosing = false
let _dashboardBaseUrl = null
let _mcpProjectDirectory = ""
// Reference to the MCP server's data deps so the dashboard-sync loop can build
// the same status/savings/sessions payloads without duplicating them.
let _dashboardSyncDeps: any = null
let _dashboardSyncTimer: any = null
const DASHBOARD_SYNC_INTERVAL_MS = Number(process.env.VIBEOS_DASHBOARD_SYNC_MS || 20000)

// Build the same {status, savings, sessions} payloads the local MCP server
// serves, but treat them as the local projection/journal input rather than the
// authoritative durable state.
function buildDashboardSyncSnapshot(): Record<string, unknown> | null {
  const deps = _dashboardSyncDeps
  if (!deps) return null
  try {
    const state = (deps.getState?.() || {}) as Record<string, any>
    const { sessions_raw, ...statusLite } = state
    const sessionsMap = (sessions_raw && typeof sessions_raw === "object") ? sessions_raw : {}
    const sessions = Object.entries(sessionsMap).map(([id, ses]: [string, any]) => ({
      id,
      started: ses?.started || null,
      cost_usd: Number(ses?.cost_usd ?? 0) || 0,
      delegation_savings_usd: getSessionDelegationSavings(ses),
      cache_savings_usd: Number(ses?.cache_savings_usd ?? 0) || 0,
      warns_count: Array.isArray(ses?.warns) ? ses.warns.length : 0,
    }))
    const currentSessionId = deps.getCurrentSessionId?.() || _OC_SID
    return {
      status: statusLite,
      savings: deps.getSavings?.() ?? {},
      sessions: { sessions, total_sessions: sessions.length },
      current_session: {
        session_id: currentSessionId,
      },
    }
  } catch {
    return null
  }
}

// Periodically persist the latest local projection into the write-behind bridge
// and flush pending mutations to the durable backend. The backend becomes the
// source of truth when reachable; the bridge preserves continuity when it is not.
function startDashboardSyncLoop(): void {
  if (_dashboardSyncTimer) return
  const push = async () => {
    try {
      const snapshot = buildDashboardSyncSnapshot()
      if (!snapshot) return
      primeDashboardBridgeCache(snapshot)
      queueDashboardProjectionRefresh({
        session_id: _dashboardSyncDeps?.getCurrentSessionId?.() || _OC_SID,
        status: snapshot.status,
        savings: snapshot.savings,
        sessions: snapshot.sessions,
        current_session: snapshot.current_session,
      })
      if (!isApiFallback()) await flushDashboardMutationQueue()
    } catch { }
  }
  void push()
  _dashboardSyncTimer = setInterval(() => { void push() }, DASHBOARD_SYNC_INTERVAL_MS)
  if (_dashboardSyncTimer && typeof _dashboardSyncTimer.unref === "function") _dashboardSyncTimer.unref()
}
let _pluginHooksRuntime = null
let _context7Seen = new Set()
let _prevOutputText = ""
let _deferredBootstrapDone = false
let _skillsEnsured = new Set()
let _runDeferredStartupBootstrap = null
const footerFallbackPainted = new Set()
const _SAVE_EST = {
  WRITE_EDIT: 0.005,
  SOFT_QUOTA: 0.0003,
  CONTEXT7: 0.002,
  OPUS_DISABLE: 0.03,
}
function _readOpenCodeConfigObject(dir) {
  const jsonPath = join(dir, "opencode.json")
  const jsoncPath = join(dir, "opencode.jsonc")
  if (existsSync(jsonPath))
    return safeJsonParse(readFileSync(jsonPath, "utf-8"))
  if (existsSync(jsoncPath))
    return _parseJsonc(readFileSync(jsoncPath, "utf-8"))
  return {}
}
function _loadOpenCodeProviders(directory) {
  try {
    const merged = {}
    const dirs = [directory ? join(directory, ".") : null, getOpenCodeHome()].filter(Boolean)
    for (const dir of dirs) {
      const cfg = _readOpenCodeConfigObject(String(dir))
      const providers = cfg?.provider || {}
      for (const [providerName, providerCfg] of Object.entries(providers)) {
        if (!merged[providerName])
          merged[providerName] = {}
        merged[providerName] = {
          ...merged[providerName],
          ...providerCfg,
          models: {
            ...(merged[providerName]?.models || {}),
            ...(providerCfg?.models || {}),
          },
        }
      }
    }
    return merged
  }
  catch {
    return {}
  }
}
async function _resolveBootstrapModel(client, directory) {
  const normalize = (value) => {
    const model = String(value || "").trim()
    return model && !PLACEHOLDER_RE.test(model) ? model : ""
  }
  const readExplicitModel = (dir) => {
    try {
      const candidates = [
        join(dir || "", "opencode.json"),
        join(process.env.HOME || "", ".config", "opencode", "opencode.json"),
        join(getOpenCodeHome(), "opencode.json"),
      ]
      for (const cfgPath of candidates) {
        if (!cfgPath || !existsSync(cfgPath)) continue
        const oc = safeJsonParse(readFileSync(cfgPath, "utf-8"))
        const model = normalize(oc?.agent?.build?.model || oc?.model || "")
        if (model) return model
      }
    } catch {}
    return ""
  }
  const projectModel = readExplicitModel(directory)
  if (projectModel)
    return { model: projectModel, source: "project-config" }
  const home = process.env.HOME || ""
  if (home) {
    const globalModel = readExplicitModel(getOpenCodeHome())
    if (globalModel)
      return { model: globalModel, source: "global-config" }
  }
  const envModel = normalize(process?.env?.OPENCODE_MODEL || "")
  if (envModel)
    return { model: envModel, source: "env" }
  return { model: "", source: "" }
}
function _loadActiveJobForProject(directory, fp = "") {
  const candidates = [getVibeOSHome(), directory ? join(directory, "..") : ""].filter(Boolean)
  for (const base of candidates) {
    try {
      const activeJobsPath = join(String(base), "active-jobs.json")
      if (!existsSync(activeJobsPath))
        continue
      const jobs = safeJsonParse(readFileSync(activeJobsPath, "utf-8")) || {}
      const job = fp ? jobs?.[fp] : null
      if (job && typeof job === "object")
        return job
    }
    catch { }
  }
  return getActiveJobForProject(fp)
}
function _tiersNeedRepair(tiers) {
  const slots = ["brain", "medium", "cheap"]
  if (!tiers || typeof tiers !== "object") return true
  return slots.some((slot) => {
    const oc = String(tiers?.trinity?.[slot]?.oc || "").trim()
    return !oc || PLACEHOLDER_RE.test(oc)
  })
}
function _normalizeSeedModelId(value) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const parts = raw.split("/")
  return parts[parts.length - 1] || raw
}
function _pickPreferredFreeSeed(models, candidates) {
  const list = Array.isArray(models) ? models : []
  for (const candidate of candidates) {
    const normalizedCandidate = _normalizeSeedModelId(candidate)
    const found = list.find((model) => {
      const id = String(model?.id || "").trim()
      return id === candidate || _normalizeSeedModelId(id) === normalizedCandidate
    })
    if (found?.id)
      return String(found.id).trim()
  }
  return String(candidates?.[0] || "").trim()
}
function _collectFreeSeedModels(models) {
  const list = Array.isArray(models) ? models : []
  const free = []
  const seen = new Set()
  for (const model of list) {
    const id = String(model?.id || "").trim()
    const provider = String(model?.providerID || "").trim()
    if (!id || provider !== "opencode") continue
    if (!/-free$/i.test(_normalizeSeedModelId(id))) continue
    if (seen.has(id)) continue
    seen.add(id)
    free.push(id)
  }
  return free.sort((a, b) => a.localeCompare(b))
}
async function _seedOrRepairModelTiers(directory) {
  const TIERS_FILE = getTiersFile()
  const DEFAULT_FREE_MODEL = "opencode/big-pickle"
  let existing = null
  if (existsSync(TIERS_FILE)) {
    try {
      const st = statSync(TIERS_FILE)
      if (st.size > 10485760) {
        _handleStateCorruption(TIERS_FILE)
        return false
      }
      existing = safeJsonParse(readFileSync(TIERS_FILE, "utf-8")) || {}
    } catch {
      existing = null
    }
  }
  if (existing && !_tiersNeedRepair(existing))
    return false
  const providers = _loadOpenCodeProviders(directory)
  const auth = typeof _readAuth === "function" ? _readAuth() : {}
  let discovered = []
  try {
    discovered = await discoverAvailableModels(providers, auth)
  }
  catch { }
  const existingTrinity = existing?.trinity && typeof existing.trinity === "object" ? existing.trinity : {}
  const _hasAnyValidSlot = ["brain", "medium", "cheap"].some((slot) => {
    const oc = String(existingTrinity?.[slot]?.oc || "").trim()
    return !!oc && !PLACEHOLDER_RE.test(oc)
  })
  const existingSelection = existing?.selection && typeof existing.selection === "object" ? existing.selection : {}
  const freeSeeds = _collectFreeSeedModels(discovered)
  const readExplicitModel = (dir) => {
    try {
      const candidates = [
        join(dir || "", "opencode.json"),
        join(process.env.HOME || "", ".config", "opencode", "opencode.json"),
        join(getOpenCodeHome(), "opencode.json"),
      ]
      for (const cfgPath of candidates) {
        if (!cfgPath || !existsSync(cfgPath)) continue
        const oc = safeJsonParse(readFileSync(cfgPath, "utf-8"))
        const model = String(oc?.agent?.build?.model || oc?.model || "").trim()
        if (model) return model
      }
    } catch {}
    return ""
  }
  const explicitSeedModel = readExplicitModel(directory)
  const liveModel = explicitSeedModel || String(currentModel || "").trim()
  const _liveTier = liveModel ? classify(liveModel) : ""
  const liveFreeModel = isModelFree(liveModel) ? liveModel : ""
  const seedBrain = explicitSeedModel || freeSeeds[0] || liveFreeModel || DEFAULT_FREE_MODEL
  const seedMedium = freeSeeds[1] || freeSeeds[0] || explicitSeedModel || liveFreeModel || DEFAULT_FREE_MODEL
  const seedCheap = freeSeeds[2] || freeSeeds[1] || freeSeeds[0] || explicitSeedModel || liveFreeModel || DEFAULT_FREE_MODEL
  const keepExistingSlot = (slotRow: unknown, fallbackModel: string) => {
    const currentOc = String(slotRow?.oc || "").trim()
    if (currentOc && !PLACEHOLDER_RE.test(currentOc) && !/placeholder/i.test(currentOc)) {
      return { ...slotRow, cc: slotRow?.cc || modelToCcAlias(currentOc) }
    }
    return { oc: fallbackModel, cc: modelToCcAlias(fallbackModel) }
  }
  const nextTrinity = {
    brain: keepExistingSlot(existingTrinity.brain, seedBrain),
    medium: keepExistingSlot(existingTrinity.medium, seedMedium),
    cheap: keepExistingSlot(existingTrinity.cheap, seedCheap),
  }
  const activeSlot = ["brain", "medium", "cheap"].includes(String(existingSelection.active_slot || "").trim())
    ? String(existingSelection.active_slot)
    : "brain"
  const tiers = {
    ...existing,
    selection: {
      ...existingSelection,
      enabled: existingSelection.enabled !== false,
      active_slot: activeSlot,
      thinking_level: existingSelection.thinking_level || "off",
      delegation_enforce: existingSelection.delegation_enforce !== false,
      flow_enabled: existingSelection.flow_enabled === true,
      flow_enforce: existingSelection.flow_enforce === true,
      tdd_enforce: existingSelection.tdd_enforce === true,
      tdd_strict: existingSelection.tdd_strict === true,
      tdd_quality: existingSelection.tdd_quality !== false,
      onboarding_mode: existingSelection.onboarding_mode || "assist",
      optimization_mode: existingSelection.optimization_mode || "vibeultrax",
      requested_optimization_mode: existingSelection.requested_optimization_mode || "vibeultrax",
      setup_completed_at: existingSelection.setup_completed_at || new Date().toISOString(),
    },
    trinity: nextTrinity,
  }
  mkdirSync(dirname(TIERS_FILE), { recursive: true })
  try {
    withFileLock(TIERS_FILE, () => {
      const tmp = TIERS_FILE + ".tmp"
      writeFileSync(tmp, JSON.stringify(tiers, null, 2) + "\n", "utf-8")
      renameSync(tmp, TIERS_FILE)
    }, { timeoutMs: 4000 })
  } catch {}
  return true

}
function _parseJsonc(raw) {
  const noBlock = String(raw || "").replace(/\/\*[\s\S]*?\*\//g, "")
  const noLine = noBlock.replace(/(^|\s)\/\/.*$/gm, "$1")
  const noTrailing = noLine.replace(/,\s*([}\]])/g, "$1")
  return safeJsonParse(noTrailing)
}
function _modelCost(id) {
  if (!id)
    return 0
  const c = modelCostPerTurn(id)
  if (c != null)
    return c
  const stripped = String(id).includes("/") ? String(id).split("/").slice(1).join("/") : String(id)
  return modelCostPerTurn(stripped) ?? 0
}
function _modelTier(id) {
  if (!id)
    return "budget"
  const high = HIGH_TIER_RE?.test?.(id)
  if (high)
    return "high"
  const mid = MID_TIER_RE?.test?.(id)
  return mid ? "mid" : "budget"
}
function _backupFile(path, label) {
  try {
    if (!existsSync(path))
      return null
    const bkDir = join(getVibeOSHome(), ".backups")
    mkdirSync(bkDir, { recursive: true })
    const bk = join(bkDir, `${basename(path)}.${label}.${Date.now()}.bak`)
    copyFileSync(path, bk)
    return bk
  }
  catch {
    return null
  }
}
function readPackageVersion() {
  try {
    const pkg = safeJsonParse(readFileSync(join(process.cwd(), "package.json"), "utf-8"))
    return String(pkg?.version || "")
  }
  catch {
    return ""
  }
}
function loadMcpPort() {
  const envPort = process.env.VIBEOS_MCP_PORT
  if (envPort != null && envPort !== "") {
    const n = Number(envPort)
    if (!Number.isFinite(n))
      return 0
    return n
  }
  try {
    if (existsSync(getTiersFile())) {
      const tiers = safeJsonParse(readFileSync(getTiersFile(), "utf-8"))
      // mcp_port used to be written automatically after a successful bind, so
      // an existing value is not proof that the user opted into the expensive
      // dashboard sync loop. Require an explicit opt-in flag before treating
      // the stored port as an instruction to start a server.
      if (tiers?.selection?.dashboard_mcp_enabled !== true)
        return 0
      const cfg = tiers?.selection?.mcp_port
      if (cfg === false || cfg === "disabled" || cfg === 0)
        return 0
      const n = Number(cfg)
      if (Number.isFinite(n))
        return n
    }
  }
  catch { }
  // The MCP/dashboard server owns a periodic full-state sync. Reusing a port
  // from mcp-runtime.json silently re-enabled that loop on every OpenCode
  // startup, including after a user had disabled it. It made the plugin consume
  // a CPU core while idle. Start it only when the user explicitly configures a
  // port (or VIBEOS_MCP_PORT); the published runtime remains readable by an
  // already-running dashboard but is never an autostart instruction.
  return 0
}
function persistMcpPort(port) {
  try {
    if (!existsSync(getTiersFile()))
      return
    const tiers = safeJsonParse(readFileSync(getTiersFile(), "utf-8"))
    tiers.selection ??= {}
    if (Number(tiers.selection.mcp_port) === Number(port) && !("mcp_port" in tiers))
      return
    tiers.selection.mcp_port = port
    if ("mcp_port" in tiers)
      delete tiers.mcp_port
    mkdirSync(dirname(getTiersFile()), { recursive: true })
    const tmp = getTiersFile() + ".tmp." + Date.now()
    writeFileSync(tmp, JSON.stringify(tiers, null, 2) + "\n", "utf-8")
    renameSync(tmp, getTiersFile())
  }
  catch { }
}
function clearMcpRestartTimer() {
  if (_mcpServerRestartTimer != null) {
    clearTimeout(_mcpServerRestartTimer)
    _mcpServerRestartTimer = null
  }
}
function scheduleMcpServerRestart() {
  if (_mcpServerClosing || !_mcpServerShouldRun)
    return
  if (_mcpServerRestartTimer != null)
    return
  _mcpServerRestartTimer = setTimeout(() => {
    _mcpServerRestartTimer = null
    void ensureMcpServerRunning()
  }, 500)
  if (typeof _mcpServerRestartTimer.unref === "function") _mcpServerRestartTimer.unref()
}
function attachMcpServerWatchdog(server) {
  server?.once?.("close", () => {
    if (_mcpServerClosing)
      return
    _mcpServerRuntime = null
    scheduleMcpServerRestart()
  })
  server?.once?.("error", () => {
    if (_mcpServerClosing)
      return
    _mcpServerRuntime = null
    scheduleMcpServerRestart()
  })
}
async function ensureMcpServerRunning() {
  const port = loadMcpPort()
  if (port === 0)
    return null
  if (_mcpServerRuntime)
    return _mcpServerRuntime
  if (_mcpServerStartupPromise)
    return _mcpServerStartupPromise
  _mcpServerClosing = false
  _mcpServerShouldRun = true
  _mcpServerStartupPromise = Promise.resolve().then(async () => {
    try {
      if (!_mcpServerRuntime) {
        _dashboardSyncDeps = {
          getState: () => ({
            ...buildStatusPayload({
              selection: loadSelection(),
              tiersData: (() => {
                try {
                  return safeJsonParse(readFileSync(getTiersFile(), "utf-8"))
                }
                catch {
                  return {}
                }
              })(),
              currentModel: currentModel || "",
              creditPercent: loadCredit(),
              version: readPackageVersion(),
              todos: loadTodosForCurrentProject(),
              fallbackThinking: thinkingLevel(loadCredit()),
              backendConnected: isApiConnected(),
              backendHealthUrl: `${VIBEOS_API_URL}/health`,
              backendVersion: getBackendVersion(),
              optimizationMode: loadSelection()?.optimization_mode || null,
              nativeAgent: readDefaultAgent(_mcpProjectDirectory) || "vibe",
              tiers: (() => { try { return safeJsonParse(readFileSync(getTiersFile(), "utf-8"))?.trinity } catch { return null } })(),
              blackbox: loadBlackboxState(),
              sessionId: _OC_SID,
              apiFallbackMode: isApiFallback(),
              apiFallbackSince: getApiFallbackSince(),
              modelLocked: _modelLocked,
              lockedSlot: _lockedSlot,
              lockedModel: _lockedModel,
            }),
            sessions_raw: readFullState()?.sessions || {},
          }),
          getSavings: () => buildSavingsPayload({
            lifetime: readLifetimeSavings(),
            session: readFullState()?.sessions?.[_OC_SID] || {},
          }),
          getSessionMetrics: () => computeSessionMetrics(readFullState(), _OC_SID),
          getTodos: () => loadTodosForCurrentProject(),
          getSessionOrchestration: (sessionId: string) => loadSessionOrchestration(sessionId),
          mutateSessionOrchestration: (sessionId: string, mutator: (session: unknown) => unknown) => mutateSessionOrchestration(sessionId, mutator),
          listSessionTemplates: () => TEMPLATE_LIBRARY,
          currentProjectName: currentProjectName || "",
          currentProjectFingerprint: currentProjectFingerprint || "",
          listReports: (filter) => {
            if (!existsSync(getReportsDir())) {
              const e = new Error("reports dir not found")
              e.status = 404
              throw e
            }
            return listReports(filter || {})
          },
          readReport: (rvId) => readReport(rvId),
          runDiagnose: async () => {
            const trinity = _pluginHooksRuntime?.tool?.trinity
            if (!trinity?.execute)
              return { error: "trinity runtime unavailable" }
            const raw = await trinity.execute({ action: "diagnose" })
            const parsed = diagnoseStructuredFromText(raw, loadCredit())
            const state = readFullState() || {}
            const sessions = state?.sessions || {}
            const blackbox = loadBlackboxState() || {}
            const runtime = readPublishedMcpRuntime() || {}
            const orphanedSessions = Object.entries(sessions).filter(([, ses]) => {
              if (!ses || typeof ses !== "object")
                return true
              const startedAt = Date.parse(String(ses.started || ses.session_started_at || ""))
              const ageMs = Number.isFinite(startedAt) ? Date.now() - startedAt : Number.POSITIVE_INFINITY
              const hasActivity = [
                Array.isArray(ses.warns) ? ses.warns.length : 0,
                Array.isArray(ses.cache_hits) ? ses.cache_hits.length : 0,
                Number(ses.total_savings_usd || 0),
                Number(ses.cache_savings_usd || 0),
                Number(ses.tool_counts ? Object.keys(ses.tool_counts).length : 0),
                Array.isArray(ses.notes) ? ses.notes.length : 0,
                Array.isArray(ses.tags) ? ses.tags.length : 0,
              ].some((value) => Number(value) > 0)
              return !hasActivity && ageMs > 24 * 60 * 60 * 1000
            }).map(([sid]) => sid)
            return {
              ...parsed,
              raw: typeof raw === "string" ? raw : null,
              live: {
                dashboard_base_url: _dashboardBaseUrl || runtime.baseUrl || null,
                mcp_port: runtime.port || loadMcpPort() || null,
                state_sessions: Object.keys(sessions).length,
                orphaned_sessions: orphanedSessions.length,
                blackbox_sessions: Object.keys(blackbox.sessions || {}).length,
                blackbox_enabled: blackbox.enabled !== false,
              },
            }
          },
          runProject: async () => {
            const trinity = _pluginHooksRuntime?.tool?.trinity
            if (!trinity?.execute)
              return { error: "trinity runtime unavailable" }
            return projectStructuredFromText(await trinity.execute({ action: "project" }), loadSelection(), loadCredit())
          },
          runTrinity: async (rvAction, params = {}) => {
            const trinity = _pluginHooksRuntime?.tool?.trinity
            if (!trinity?.execute)
              return { error: "trinity runtime unavailable" }
            return trinity.execute({ action: rvAction, slot: params.slot, level: params.level, token: params.token })
          },
          runResearchAudit: (hours) => researchAudit({ hours: hours ?? 24 }),
          saveReport: (data) => saveReport(data),
          getCurrentSessionId: () => _OC_SID,
          generateSessionCheckout: () => {
            const state = readFullState()
            const metrics = computeSessionMetrics(state, _OC_SID)
            const session = state?.sessions?.[_OC_SID] || {}
            const flowWarns = getFlowWarns().filter((w) => String(w?.sid || "") === String(process.pid || ""))
            const checkout = buildSessionCheckout({
              sessionId: _OC_SID,
              metrics,
              session,
              flowWarns,
            })
            const reportId = saveReport(checkout.report)
            return { ok: true, summary: checkout.summary, report_id: reportId }
          },
          getBlackboxState: () => {
            const persisted = loadBlackboxState() || {}
            const session = persisted?.sessions?.[_OC_SID] || {}
            const liveBlackboxState = getLatestBlackboxState() || {}
            return {
              enabled: persisted?.enabled !== false,
              sub_regime: session?.sub_regime || liveBlackboxState?.sub_regime || "INIT",
              resolution: session?.resolution || liveBlackboxState?.resolution || "INIT",
              momentum: Number(session?.momentum ?? liveBlackboxState?.momentum ?? 0),
              features: session?.features || liveBlackboxState?.features || {},
              signals: session?.signals || liveBlackboxState?.signals || {},
              loop: {
                active: Boolean(session?.loop?.active || getLatestBlackboxLoopMsg() !== null),
                message: session?.loop?.message || getLatestBlackboxLoopMsg(),
                intervention_level: session?.loop?.intervention_level || getLatestBlackboxLoopMsg()?.intervention_level || liveBlackboxState?.loop?.intervention_level || 0,
                consecutive_loops: session?.loop?.consecutive_loops || liveBlackboxState?.loop?.consecutive_loops || 0,
              },
              pivot: {
                detected: Boolean(session?.pivot?.detected || getLatestBlackboxPivotMsg() !== null),
                message: session?.pivot?.message || getLatestBlackboxPivotMsg(),
              },
              continuity_state: session?.continuity_state || liveBlackboxState?.continuity_state || null,
              turn_index: session?.turn_index ?? liveBlackboxState?.turn_index ?? 0,
              stress_level: session?.stress_level ?? liveBlackboxState?.stress_level ?? 0,
              dashboard_vectors: session?.dashboard_vectors || [],
              dashboard_outcomes: session?.dashboard_outcomes || [],
              session_id: _OC_SID,
              project_fingerprint: currentProjectFingerprint,
            }
          },
          saveBlackboxVector: (vector) => {
            const state = loadBlackboxState() || {}
            const sid = getCurrentSessionId() || _OC_SID
            if (!state.sessions)
              state.sessions = {}
            if (!state.sessions[sid])
              state.sessions[sid] = {}
            if (!state.sessions[sid].dashboard_vectors)
              state.sessions[sid].dashboard_vectors = []
            state.sessions[sid].dashboard_vectors.push({
              timestamp: Date.now(),
              received_at: new Date().toISOString(),
              ...vector,
            })
            saveBlackboxState(state)
          },
          saveBlackboxOutcome: (outcome) => {
            const state = loadBlackboxState() || {}
            const sid = getCurrentSessionId() || _OC_SID
            if (!state.sessions)
              state.sessions = {}
            if (!state.sessions[sid])
              state.sessions[sid] = {}
            if (!state.sessions[sid].dashboard_outcomes)
              state.sessions[sid].dashboard_outcomes = []
            state.sessions[sid].dashboard_outcomes.push({
              timestamp: Date.now(),
              received_at: new Date().toISOString(),
              ...outcome,
            })
            saveBlackboxState(state)
          },
        }
        _mcpServerRuntime = createMcpServer(_dashboardSyncDeps)
      }
      const requestedPort = port == null ? 0 : port
      const mcpServer = await _mcpServerRuntime.start(requestedPort)
      const actualPort = Number(mcpServer?.address?.()?.port || requestedPort)
      if (actualPort && actualPort !== requestedPort)
        persistMcpPort(actualPort)
      if (actualPort) {
        _dashboardBaseUrl = `http://127.0.0.1:${actualPort}`
        publishMcpRuntime(actualPort, _dashboardBaseUrl)
        writeDashboardBaseConfig(`http://127.0.0.1:${actualPort}`)
        startDashboardSyncLoop()
      }
      console.error(`[vibeOS] MCP server on http://127.0.0.1:${actualPort}`)
      if (actualPort)
        console.error(`[vibeOS] Dashboard at http://127.0.0.1:${actualPort}/`)
      if (!_mcpServerHooked) {
        _mcpServerHooked = true
        process.on("SIGTERM", () => {
          try {
            _mcpServerRuntime?.close()
          }
          catch { }
        })
        process.on("SIGINT", () => {
          try {
            _mcpServerRuntime?.close()
          }
          catch { }
        })
      }
      clearMcpRestartTimer()
      attachMcpServerWatchdog(mcpServer)
      return mcpServer
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err || "unknown error")
      console.error(`[vibeOS] MCP startup failed: ${msg}`)
      _mcpServerRuntime = null
      scheduleMcpServerRestart()
      return null
    }
    finally {
      _mcpServerStartupPromise = null
    }
  })
  return _mcpServerStartupPromise
}
// ── DelegationEnforcer — main plugin entry point ─────────────────────
export async function DelegationEnforcer({ client, directory } = {}) {
  console.error(`[vibeOS] LOADED cwd=${directory}`)
  _mcpProjectDirectory = directory || ""
  const hookHome = process.env.HOME || USER_HOME
  const hookFp = projectFingerprint(directory || "")
  const resolvedVibeOSHome = process.env.VIBEOS_HOME || join(hookHome, ".claude")
  const lastVibeOSHome = getRuntimeVibeOSHome()
  const existingSessionId = _OC_SID
  const shouldReuseSessionId = lastVibeOSHome === resolvedVibeOSHome && existingSessionId && existingSessionId.startsWith("opencode-") && existsSync(join(resolvedVibeOSHome, "delegation-state.json"))
  const hookSessionId = shouldReuseSessionId
    ? existingSessionId
    : `opencode-${process.pid || "x"}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  // Expose the live OpenCode SDK client for best-effort reads. NOTE: vibeOS does NOT use
  // client.config.update to switch the running model — that handler persists
  // <projectDir>/config.json, a watched file whose change disposes the active project
  // instance and aborts the in-flight turn. Per-turn tier routing is done by the
  // chat.params override and subagent delegation. Guard against a falsy client clobbering
  // a good one.
  if (client) globalThis.__vibeOS_client = client
  setCurrentModel(null)
  setCurrentTier(null)
  resetPendingLiveSwitch()
  resetFooterRuntimeState()
  resetTurnClassifyRuntimeState()
  // Reset once per fresh plugin instance (test isolation across test files sharing
  // the module cache), not per tool call -- resetting per call would defeat the
  // per-session warn cap itself under VIBEOS_TEST_CONTEXT=1 (every CI test run).
  if (process.env.VIBEOS_TEST_CONTEXT === "1") _resetWarnCountsForTest()
  setVibeOSHomeContext(resolvedVibeOSHome)
  setRuntimeVibeOSHome(resolvedVibeOSHome)
  resetSessionId(hookSessionId)
  resetChatTransformState()
  setCurrentSessionId(hookSessionId)
  if (hookFp) {
    setCurrentProjectFingerprint(hookFp)
    setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
  }
  if (typeof setToolDirectory === "function")
    setToolDirectory(directory || "")
  if (typeof setShellDirectory === "function")
    setShellDirectory(directory || "")
  if (typeof setTddDirectory === "function")
    setTddDirectory(directory || "")
  registerSessionCleanupHandlers()
  pruneScratchpadOnce()
  runStartupMaintenanceOnce()
  // Detect model: project opencode.json → OpenCode API → global ~/.config/opencode/opencode.json → env.
  const _bootstrapModel = await _resolveBootstrapModel(client, directory)
  if (_bootstrapModel.model) {
    setCurrentModel(_bootstrapModel.model)
    setCurrentTier(resolveEffectiveTier(_bootstrapModel.model, _bootstrapModel.slot || ""))
  }
  if (currentModel) {
    setCurrentTier(resolveEffectiveTier(currentModel, ""))
    try {
      const _tiersData = safeJsonParse(readFileSync(getTiersFile(), "utf-8"))
      const _slotOrder = getTrinitySlotOrder(_tiersData)
      const _primarySlot = _slotOrder[0] || "brain"
      const _activeSlot = _tiersData?.selection?.active_slot || _primarySlot
      if (_activeSlot === _primarySlot) {
        const _brainOcModel = _tiersData?.trinity?.[_primarySlot]?.oc || ""
        if (_brainOcModel && currentModel === _brainOcModel && !PLACEHOLDER_RE.test(_brainOcModel)) {
          setCurrentTier("high")
          console.error(`[vibeOS] tier override → high (primary slot)`)
        }
      }
      if (currentTier !== "high" && _activeSlot === "brain" && currentModel && !PLACEHOLDER_RE.test(currentModel)) {
        setCurrentTier("high")
        console.error(`[vibeOS] tier override → high (brain slot fallback)`)
      }
    }
    catch { }
    console.error(`[vibeOS] ACTIVE: model=${currentModel} tier=${currentTier}`)
  }
  else {
    console.error("[vibeOS] NO MODEL — enforcement disabled, will auto-detect on first hook")
  }
  try {
    const startupSelection = loadSelection()
    if (startupSelection?.slot_locked === true) {
      const lockedSlot = ["brain", "medium", "cheap"].includes(String(startupSelection.active_slot || "").trim())
        ? String(startupSelection.active_slot)
        : "brain"
      let lockedModel = currentModel || null
      try {
        const tiers = safeJsonParse(readFileSync(getTiersFile(), "utf-8"))
        lockedModel = tiers?.trinity?.[lockedSlot]?.oc || lockedModel || null
      }
      catch {}
      setModelLocked(true)
      setLockedSlot(lockedSlot)
      setLockedModel(lockedModel)
      console.error(`[vibeOS] startup lock restored → ${lockedSlot}${lockedModel ? ` (${lockedModel})` : ""}`)
    } else {
      setModelLocked(false)
      setLockedSlot(null)
      setLockedModel(null)
    }
  } catch {}
  console.error(`[vibeOS] auto-config guard: currentModel=${currentModel ? "SET" : "NONE"}, TIERS_FILE=${getTiersFile()}, exists=${existsSync(getTiersFile())}`)
  try {
    if (!existsSync(getTiersFile())) {
      console.error(`[vibeOS] model-tiers.json missing at load; will seed on first hook`)
    }
    await _seedOrRepairModelTiers(directory)
    loadTrinitySlotsFromTiersFile()
    // ── Make the dropdown default match the active tier ───────────────────
    // OpenCode binds the model PER PROMPT from the dropdown, and a NEW session's
    // dropdown defaults to opencode.json `model`. If that default doesn't match
    // active_slot (e.g. VibeUltraX starts on cheap), the very first turn runs on
    // the wrong tier and the footer/alert/dropdown disagree. chat.params CANNOT
    // fix this — it can't switch providers, and our tiers span 3 providers.
    // So we reconcile the default model to trinity[active_slot].oc at load, while
    // no turn is in flight (deferLiveSwitch:false is safe at startup — there is no
    // in-flight turn to abort). This is the ONLY reliable lever on the live model.
    try {
      const _sel = safeJsonParse(readFileSync(getTiersFile(), "utf-8"))?.selection
      const _activeSlot = String(_sel?.active_slot || "").trim()
      // OpenCode watches its configuration and disposes/reloads the active
      // project when it changes. Writing agents or the default model during
      // plugin startup can therefore abort or stall the user's current work.
      // Keep startup observational; legacy hosts can explicitly opt in.
      if (_activeSlot && process.env.VIBEOS_ENABLE_STARTUP_CONFIG_RECONCILE === "1") {
        // reconcileSlotModel below only re-installs the agent topology as a side
        // effect of applySlot, which it SKIPS when the live model already matches
        // the active slot (no drift). That left a gap: a config with the right
        // `model` but a missing/stripped `agent`/`default_agent` block (e.g. after a
        // manual repair, or a fresh global home that was never seeded) never got
        // fixed, because no drift was ever detected. Install the tier agents
        // unconditionally here — once per process load, no turn in flight, same
        // safety window as the model reconcile below — so the unified vibe primary
        // and tier subagents are always present regardless of whether the model
        // itself needed reconciling this time.
        try {
          const _tiersForAgents = safeJsonParse(readFileSync(getTiersFile(), "utf-8"))?.trinity || {}
          installVibeTierAgents(directory, _tiersForAgents, null)
        } catch (e) { console.error("[vibeOS] startup agent install failed:", e?.message || e) }
        const r = reconcileSlotModel(_activeSlot, directory, "", { deferLiveSwitch: false })
        // _bootstrapModel ran BEFORE this reconcile (when opencode.json had no model),
        // so currentModel/currentTier can be stale (e.g. the brain model) while the live
        // default is now the active tier. The footer reads currentModel for its leading
        // execution identity — sync it so footer ↔ dropdown ↔ VibeUltraX agree from turn 1.
        const _liveModel = String(r.to || "").trim()
        if (_liveModel) {
          setCurrentModel(_liveModel)
          setCurrentTier(resolveEffectiveTier(_liveModel, _activeSlot))
        }
        if (r.reconciled)
          console.error(`[vibeOS] startup: default model → ${r.to} (slot=${_activeSlot}, was ${r.from || "∅"})`)
      }
    }
    catch (e) { console.error("[vibeOS] startup default-model reconcile failed:", e?.message || e) }
  }
  catch { }
  if (detectContext7())
    console.error(`[vibeOS] context7 detected — docs nudge enabled`)
    // ── Startup safety ──────────────────────────────────────────────────
    // Keep load-time side effects minimal: defer any slot/catalog writes until
    // the first real hook runs after OpenCode is fully ready.
  fp = projectFingerprint(directory)
  setCurrentProjectFingerprint(fp)
  setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
  briefedProjects.clear()
  activeJob = _loadActiveJobForProject(directory, fp)
  const systemBriefedProjects = new Set()
  const hookVibeHome = getVibeOSHome()
  const hookStateFile = join(hookVibeHome, "delegation-state.json")
  const hookProjectStateFile = join(hookVibeHome, "project-states.json")
  const hookReportsDir = join(hookVibeHome, "reports")
  const hookReportsIndex = join(hookReportsDir, "index.json")
  const hookTiersFile = join(hookVibeHome, "model-tiers.json")
  const loadProjectStateStable = () => {
    try {
      const state = safeJsonParse(readFileSync(hookProjectStateFile, "utf-8"))
      if (state && typeof state === "object") {
        state.project_hashes ??= {}
        return state
      }
    }
    catch { }
    return { project_hashes: {} }
  }
  const saveProjectStateStable = (state) => {
    try {
      mkdirSync(dirname(hookProjectStateFile), { recursive: true })
      const tmp = hookProjectStateFile + ".tmp"
      writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n")
      renameSync(tmp, hookProjectStateFile)
    }
    catch { }
  }
  const reportsIndexStable = () => {
    try {
      const idx = safeJsonParse(readFileSync(hookReportsIndex, "utf-8"))
      if (!idx || !Array.isArray(idx.reports))
        return { reports: [] }
      return idx
    }
    catch {
      return { reports: [] }
    }
  }
  const saveReportsIndexStable = (idx) => {
    try {
      mkdirSync(hookReportsDir, { recursive: true })
      writeFileSync(hookReportsIndex, JSON.stringify(idx, null, 2) + "\n")
    }
    catch { }
  }
  const backupFileStable = (path, label) => {
    try {
      if (!existsSync(path))
        return null
      const bkDir = join(hookVibeHome, ".backups")
      mkdirSync(bkDir, { recursive: true })
      const bk = join(bkDir, `${basename(path)}.${label}.${Date.now()}.bak`)
      copyFileSync(path, bk)
      return bk
    }
    catch {
      return null
    }
  }
  _runDeferredStartupBootstrap = () => { }
  // ── Plugin hooks ──────────────────────────────────────────────────
  // trinity tool dependency injection
  const _tiersData = (() => {
    try {
      return safeJsonParse(readFileSync(getTiersFile(), "utf-8"))
    }
    catch {
      return {}
    }
  })()
  const trinityDeps = {
    tool, _lazyRefresh, _readAuth, _tiersData,
    _loadOpenCodeProviders, _modelCost, _modelTier,
    getLatestBlackboxState,
    currentModel, currentTier, currentProjectFingerprint, currentProjectName,
    get latestUserIntent() { return latestUserIntent }, directory,
    safeJsonParse, readFileSync, writeFileSync, existsSync, renameSync, mkdirSync,
    get TIERS_FILE() { return hookTiersFile }, USER_HOME, get STATE_FILE() { return hookStateFile }, CREDIT_CACHE_F,
    SAVINGS_LEDGER_FILE, PROJECT_STATE_FILE: hookProjectStateFile, get REPORTS_DIR() { return hookReportsDir }, get REPORTS_INDEX() { return hookReportsIndex },
    get OPENCODE_HOME() { return getOpenCodeHome() }, get VIBEOS_HOME() { return hookVibeHome },
    get dashboardBaseUrl() { return _dashboardBaseUrl },
    loadPublishedMcpBaseUrl: async () => {
      const runtime = readPublishedMcpRuntime()
      if (!runtime?.baseUrl)
        return ""
      try {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 1000)
        const res = await fetch(`${runtime.baseUrl.replace(/\/$/, "")}/health`, { signal: ctl.signal })
        clearTimeout(timer)
        if (res.ok)
          return runtime.baseUrl
      } catch {}

      return ""
    },
    ensureMcpServerRunning,
    _loadMcpPort: loadMcpPort,
    loadSelection, writeSelection, loadCredit, thinkingLevel,
    readLifetimeSavings, readFullState, _OC_SID, formatUsd,
    getBlackboxResolution, scoreStress, applySlot, saveOptimizationMode,
    getFlowWarns, projectFingerprint, loadProjectState: loadProjectStateStable, saveProjectState: saveProjectStateStable,
    ensureProjectBucket, mergeProjectBucket, clearProjectPatterns,
    projectPatternRows, promotedProjectPatterns, detectTechStack, ensureProjectDocs, ensureProjectSkill,
    discoverAvailableModels, classifyAndRankModels, modelToCcAlias, probeModel,
    setBlackboxEnabled, loadBlackboxState, saveBlackboxState,
    isApiFallback: () => isApiFallback(),
    get _apiFallbackSince() { return getApiFallbackSince() },
    reportsIndex: reportsIndexStable, saveReportsIndex: saveReportsIndexStable, backupFile: backupFileStable, writeSessionSlot, writeSessionOptMode, _refreshModel,
    client,
    setApiToken,
    setApiBootstrapToken,
    ensureBootstrapExchange,
    loadTodos, loadTodosForCurrentProject, upsertTodo, getTodos, markTodoDone, syncFlowTodosToNative,
    resetBlackboxTracker,
    get _blackboxTracker() { return getBlackboxTracker() },
    set _blackboxTracker(v) { resetBlackboxTracker() },
    get _blackboxEnabled() { return _blackboxEnabled },
    set _blackboxEnabled(v) { setBlackboxEnabled(v) },
    get _modelLocked() { return _modelLocked },
    set _modelLocked(v) { setModelLocked(v) },
    get _lockedSlot() { return _lockedSlot },
    set _lockedSlot(v) { setLockedSlot(v) },
    get _lockedModel() { return _lockedModel },
    set _lockedModel(v) { setLockedModel(v) },
  }
  const pluginHooks = {
    "tool.execute.before": async (input, output) => {
      if (input?.sessionID) setCurrentSessionId(input.sessionID)
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      ensureDeferredBootstrap()
      if (directory && hookFp && !_skillsEnsured.has(hookFp)) {
        try {
          ensureProjectSkill(directory, hookFp)
          _skillsEnsured.add(hookFp)
        }
        catch { }
      }
      onToolExecuteBefore._directory = directory
      return onToolExecuteBefore(input, output)
    },
    "tool.execute.after": async (input, output) => {
      if (input?.sessionID) setCurrentSessionId(input.sessionID)
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      onToolExecuteAfter._directory = directory
      return onToolExecuteAfter(input, output)
    },
    "chat.params": async (_input, output) => {
      if (_input?.sessionID) setCurrentSessionId(_input.sessionID)
      setVibeOSHomeContext(hookVibeHome)
      syncApiTokenFromDisk()
      if (typeof setChatParamsDirectory === "function") setChatParamsDirectory(directory || "")
      _input._directory = directory
      return onChatParams(_input, output)
    },
    "chat.headers": async (_input, output) => {
      setVibeOSHomeContext(hookVibeHome)
      if (typeof setChatParamsDirectory === "function") setChatParamsDirectory(directory || "")
      _input._directory = directory
      return onChatHeaders(_input, output)
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      if (_input?.sessionID) setCurrentSessionId(_input.sessionID)
      setVibeOSHomeContext(hookVibeHome)
      ensureDeferredBootstrap()
      return onMessagesTransform(_input, output)
    },
    "experimental.session.compacting": async (_input, output) => {
      if (_input?.sessionID) setCurrentSessionId(_input.sessionID)
      return onSessionCompacting(_input, output)
    },
    "experimental.chat.system.transform": async (_input, output) => {
      if (_input?.sessionID) setCurrentSessionId(_input.sessionID)
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      ensureDeferredBootstrap()
      onSystemTransform._directory = directory
      onSystemTransform._activeJob = activeJob
      onSystemTransform._briefedProjects = systemBriefedProjects
      return onSystemTransform(_input, output)
    },
    "shell.env": async (_input, output) => {
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      if (typeof setShellDirectory === "function")
        setShellDirectory(directory || "")
      return onShellEnv(_input, output)
    },
    "experimental.text.complete": async (_input, output) => {
      if (_input?.sessionID) setCurrentSessionId(_input.sessionID)
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      ensureDeferredBootstrap()
      scanClaimsInOutput(output)
      await _appendFooter(_input, output, directory, undefined, "experimental.text.complete")
      ensureFooterFallback(_input, output, directory, "experimental.text.complete")
      _checkAndRecordUnsubstantiatedClaims()
      _runQualityGate(output)

    },
    "message.updated": async (_input, output) => {
      // OpenCode emits this hook for plugin-authored message mutations. A
      // footer write therefore feeds back into this hook and can repeatedly
      // run the footer/API/state path. text.complete is the authoritative
      // completion hook on current OpenCode builds; legacy hosts may opt in.
      if (process.env.VIBEOS_ENABLE_MESSAGE_UPDATED_FOOTER !== "1") return
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      ensureDeferredBootstrap()
      scanClaimsInOutput(output)
      await _appendFooter(_input, output, directory, undefined, "message.updated")
      ensureFooterFallback(_input, output, directory, "message.updated")
      // auto-verify: cross-check against cascade-audit
      _checkAndRecordUnsubstantiatedClaims()
      _runQualityGate(output)

    },
    tool: {
      trinity: tool(createTrinityTool(trinityDeps)),
      vibe: tool(createTrinityTool(trinityDeps)),
      "research-audit": tool({
        description: "Scan session for research anti-patterns (domain chains, redundant queries, no synthesis). hours=N (default 24).",
        args: { hours: tool.schema.number().optional() },
        async execute({ hours } = {}) {
          const report = researchAudit({ hours: hours ?? 24 })
          try {
            const state = loadProjectState()
            const bucket = ensureProjectBucket(state, fp)
            bucket.lastSeen = new Date().toISOString()
            bucket.researchChains = Math.max(bucket.researchChains || 0, report.chains.length)
            saveProjectState(state)
          }
          catch { }
          try {
            const findings = []
            for (const c of report.chains)
              findings.push({ severity: "warn", topic: "Domain chain", detail: `${c.domain}: ${c.count} fetches` })
            if (report.redundant > 0)
              findings.push({ severity: "warn", topic: "Context7 bypass", detail: `${report.redundant} bypasses` })
            if (report.totalFetches > 0)
              findings.push({ severity: "info", topic: "Fetch volume", detail: `${report.totalFetches} fetches, ${(report.totalBytes / 1024).toFixed(0)}KB` })
            saveReport({ type: "research-audit", summary: `${report.totalFetches} fetches, ${report.chains.length} chains`, findings, metrics: report, tags: ["research"] })
          }
          catch { }
          const lines = [`Research audit (last ${hours ?? 24}h):`]
          if (report.totalFetches === 0)
            return lines.concat("  No activity.").join("\n")
          lines.push(`  Fetches: ${report.totalFetches} (${(report.totalBytes / 1024).toFixed(0)}KB)`)
          if (report.redundant > 0)
            lines.push(`  Context7 bypasses: ${report.redundant}`)
          for (const c of report.chains)
            lines.push(`  Chain: ${c.domain} (${c.count}x)`)
          return lines.join("\n")
        },
      }),
      "report-save": tool({
        description: "Save report with findings, metrics, narrative.",
        args: {
          summary: tool.schema.string({ description: "One-line summary" }),
          findings: tool.schema.string({ description: "Plain text lines or JSON array" }).optional(),
          metrics: tool.schema.string({ description: "Plain text lines key=value or JSON" }).optional(),
          narrative: tool.schema.string({ description: "Free-form markdown" }).optional(),
          tags: tool.schema.string({ description: "Comma-separated tags" }).optional(),
        },
        async execute({ summary, findings, metrics, narrative, tags } = {}) {
          let parsedFindings = []
          let parsedMetrics = {}
          try {
            if (findings)
              parsedFindings = JSON.parse(findings)
          }
          catch {
            if (findings)
              for (const line of findings.split("\n").map((l) => l.trim()).filter(Boolean)) {
                const m = line.match(/^(warn|info|hint)\s*:\s*(.+?)\s*:\s*(.+)/i)
                if (m)
                  parsedFindings.push({ severity: m[1].toLowerCase(), topic: m[2].trim(), detail: m[3].trim() })
                else
                  parsedFindings.push({ severity: "info", topic: "Note", detail: line })
              }
          }
          try {
            if (metrics)
              parsedMetrics = JSON.parse(metrics)
          }
          catch {
            if (metrics)
              for (const line of metrics.split("\n").map((l) => l.trim()).filter(Boolean)) {
                const m = line.match(/^([\w-]+)\s*=\s*([\d.]+)/)
                if (m)
                  parsedMetrics[m[1]] = parseFloat(m[2])
              }
          }
          const tagList = tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : []
          const id = saveReport({ type: "manual", summary, findings: parsedFindings, metrics: parsedMetrics, narrative: narrative || "", tags: tagList })
          return id ? `Report saved: ${id}` : "Failed"
        },
      }),
      "report-list": tool({
        description: "List reports. Filter by type, project, hours (default 168).",
        args: {
          type: tool.schema.string().optional(),
          project: tool.schema.string().optional(),
          hours: tool.schema.number().optional(),
        },
        async execute({ type, project, hours } = {}) {
          const reports = listReports({ type, project, hours: hours ?? 168 })
          if (reports.length === 0)
            return "No reports found."
          const lines = [`Reports (last ${hours ?? 168}h): ${reports.length} total`]
          for (const r of reports.slice(0, 15)) {
            const d = r.created.slice(0, 16).replace("T", " ")
            lines.push(`  [${d}] #${r.id} ${r.type} ${(r.summary || "").slice(0, 80)}`)
          }
          if (reports.length > 15)
            lines.push(`  ... and ${reports.length - 15} more`)
          return lines.join("\n")
        },
      }),
      "report-read": tool({
        description: "Read a report by ID (from report-list).",
        args: { id: tool.schema.string({ description: "Report ID" }) },
        async execute({ id } = {}) {
          if (!id || !/^[\w-]+$/.test(id))
            return `Invalid ID: ${id}`
          const report = readReport(id)
          if (!report)
            return `Not found: ${id}`
          const d = (report?.meta?.created ?? report?.created ?? "?").slice(0, 16).replace("T", " ")
          const lines = [`Report #${id}`, `  Type: ${report?.meta?.type ?? report?.type ?? "?"}  |  ${d}`]
          if (report.summary)
            lines.push(`  ${report.summary}`)
          if (report.tags?.length)
            lines.push(`  Tags: ${report.tags.join(", ")}`)
          if (report.narrative)
            lines.push(`  ---\n${report.narrative}`)
          return lines.join("\n")
        },
      }),
    },
  }
  _pluginHooksRuntime = pluginHooks
  // ── MCP server startup ─────────────────────────────────────────────
  const _inTestEnv =
    process.env.VIBEOS_MCP_PORT === "0" ||
    process.env.NODE_ENV === "test" ||
    process.execArgv.some((arg) => arg === "--test" || arg.startsWith("--test="))
  if (!_inTestEnv)
    void ensureMcpServerRunning()
  return pluginHooks
}
export function resetRuntimeStateForTest(): void {
  setCurrentModel(null)
  setCurrentTier(null)
  resetPendingLiveSwitch()
  resetFooterRuntimeState()
  resetTurnClassifyRuntimeState()
  resetChatTransformState()
  _resetSelectionCacheForTest()
  try { setCurrentSessionId("") } catch {}
  _resetRuntimeGlobalStateForTest()  // clear globalThis.__vibeOSRuntimeState and __vibeOS_sessionId
}
export const id = "vibeOS"
export const server = DelegationEnforcer
export const VERSION = readPackageVersion()
export default { id: "vibeOS", server: DelegationEnforcer }
export { researchAudit } from "./lib/research-audit.js"
export { saveReport, listReports, readReport } from "./lib/reporting.js"
export { applySlot, modelCostPerTurn, isModelFree, isDocsTarget, detectContext7, loadTierRegexes, classify, _refreshModel, HIGH_TIER_RE, MID_TIER_RE, PLACEHOLDER_RE, TRINITY_BRAIN, TRINITY_MEDIUM, TRINITY_CHEAP, setTrinityBrain, setTrinityMedium, setTrinityCheap, _resetTrinitySlotsForTest, trendDisplay, flushPendingLiveSwitch, getPendingLiveSwitch } from "./lib/pricing.js"
export { getScratchpadHit, getSessionScratchpadDir, getSessionIndexPath, setCurrentModel, setCurrentTier, setCurrentSessionId, setCurrentProjectFingerprint, setCurrentProjectName, getCurrentSessionId, _OC_SID } from "./lib/state.js"
export { _resetSelectionCacheForTest } from "./lib/selection-manager.js"
export { _setPendingUiNoteForTest, _setEnforcementBlockedForTest } from "./lib/hooks/tool-execute.js"
export { extractExports, buildTestSkeleton, enforceTestFile, buildTestReminder, setTddDirectory } from "./lib/tdd-enforcer.js"
export { classifyAndRankModels, modelToCcAlias } from "./lib/trinity-rebuild.js"
export { scoreStress, detectTechStack, loadBlackboxState, saveBlackboxState, getBlackboxResolution } from "./lib/cascade.js"
export { loadMcpPort as _loadMcpPort }
export { _checkAndRecordUnsubstantiatedClaims }
export { _resetCostAnomalyDetectorForTest } from "./lib/cost-anomaly.js"
export { remoteCall } from "./lib/api-client.js"
export { observeToolPattern, noteProjectPattern, recordSaving, compressText } from "./lib/index-helpers.js"
export { _resetToolExecuteStateForTest } from "./lib/hooks/tool-execute.js"
export function closeMcpServer() {
  try {
    _mcpServerClosing = true
    _mcpServerShouldRun = false
    clearMcpRestartTimer()
    if (_mcpServerRuntime) {
      _mcpServerRuntime.close()
      _mcpServerRuntime = null
    }
    _dashboardBaseUrl = null
  }
  catch { }
}
