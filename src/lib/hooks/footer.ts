// @ts-nocheck
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { classify, _refreshModel, readConfig, readLiveOpenCodeModel, TRINITY_BRAIN, TRINITY_MEDIUM, TRINITY_CHEAP, shortModelName, formatUsd, resolveCurrentExecution, modelDisplayName, getPendingLiveSwitch, formatProviderName } from "../pricing.js"
import { latestUserIntent } from "./chat-transform.js"
import { scoreStress, resolveEnforcementMode, detectOutcomeSignal, getBlackboxTracker, syncOutcomeToApi, classifyTurnSimple, autoSelectMode, loadOptimizationMode, computeControlVector, getLatestBlackboxLoopMsg, getLatestBlackboxPivotMsg, getLatestBlackboxState } from "../turn-classify.js"
import { saveReport } from "../reporting.js"
import { currentModel, currentTier, setCurrentModel, setCurrentTier, currentProjectFingerprint, currentProjectName, getCurrentSessionId, _modelLocked, _blackboxEnabled, loadBlackboxState, recordLiveSessionSnapshot, VIBEOS_HOME, getVibeOSHome, readLifetimeSavings, getLatestCacheEvent, readFullState } from "../state.js"
import { loadSelection, loadSessionSlot } from "../selection-manager.js"
import { remoteCall, isApiConnected, isApiLatencyDegraded, isApiFallback } from "../api-client.js"
import { buildFooterLine, buildEnforcementTags, resolveBrand, buildFooterAlert, buildResilientFooterLine } from "./shared-footer.js"
import { getSessionCacheSavings } from "../session-savings.js"
import { computeReward } from "../../vibeOS-lib/reward-engine.js"
import { detectLaziness } from "../../vibeOS-lib/laziness-detector.js"
import { evaluateClaimVerification } from "../claim-verification.js"
import { getSessionHealthSnapshot } from "../session-health.js"
import { getLatestTurnTruth, recordTurnFinalize } from "../turn-ledger.js"

const IS_CLI_RUNTIME = Boolean(process.stdout?.isTTY || process.stderr?.isTTY || process.stdin?.isTTY)
const IS_TEST_RUNTIME = process.env.VIBEOS_MCP_PORT === "0" || process.env.NODE_ENV === "test" || process.env.CI === "true"
const FOOTER_DEBUG_STDERR = process.env.VIBEOS_DEBUG_FOOTER === "1" || (!IS_CLI_RUNTIME && !IS_TEST_RUNTIME)

function footerDebug(...args: unknown[]) {
  if (FOOTER_DEBUG_STDERR) console.error(...args)
}

export function resetFooterRuntimeState(): void {
  _cachedAutoMode = null
  _cachedAutoModeTs = 0
  _cachedAutoModeSessionId = ""
  _cachedAutoModeHome = ""
  _cachedAutoModeKey = ""
  _prevOutputText = ""
  _autoReportCount = 0
  textCompletePainted.clear()
  _lastStrippedText = ""
}

let _cachedAutoMode = null
let _cachedAutoModeTs = 0
let _cachedAutoModeSessionId = ""
let _cachedAutoModeHome = ""
let _cachedAutoModeKey = ""
const AUTO_CACHE_TTL = 60000

const DEFAULT_REGIME_MAP = {
  LOOPING: "vibemax", DIVERGENT: "vibemax",
  EXPLORING: "vibemax", INIT: "vibemax",
  REFINING: "vibemax",
  CONVERGING: "quality", CLOSED: "quality",
}

function regimeToMode(regime, stress) {
  if (stress > 1.5) return "quality"
  return DEFAULT_REGIME_MAP[regime] || "vibemax"
}

async function apiAutoSelectMode(regime, stress) {
  const now = Date.now()
  const sessionId = getSessionId()
  const home = getVibeOSHome()
  const cacheKey = `${home}|${sessionId}|${String(regime || "")}|${String(stress || 0)}`
  if (
    _cachedAutoMode &&
    _cachedAutoModeHome === home &&
    _cachedAutoModeSessionId === sessionId &&
    _cachedAutoModeKey === cacheKey &&
    now - _cachedAutoModeTs < AUTO_CACHE_TTL
  ) return _cachedAutoMode
  try {
    const res = await remoteCall("blackboxSelectMode", [regime, stress], null)
    if (res?.mode) {
      _cachedAutoMode = res.mode
      _cachedAutoModeTs = now
      _cachedAutoModeSessionId = sessionId
      _cachedAutoModeHome = home
      _cachedAutoModeKey = cacheKey
      return res.mode
    }
  } catch (e) { footerDebug("[vibeOS] apiAutoSelectMode error:", e.message) }
  const fallback = regimeToMode(regime, stress)
  _cachedAutoMode = fallback
  _cachedAutoModeTs = now
  _cachedAutoModeSessionId = sessionId
  _cachedAutoModeHome = home
  _cachedAutoModeKey = cacheKey
  return fallback || "balanced"
}

let _prevOutputText = ""
let _autoReportCount = 0
// messageID -> length of the message text we last painted a footer onto.
// Used for streaming-aware dedup: a redundant re-call for the same message has
// the same-or-shorter text (skip), but a streaming update that GREW the text
// and wiped our footer must be re-painted (see the guard in _appendFooter).
const textCompletePainted = new Map()
let _lastStrippedText = ""

function isGreetingLike(text) {
  const value = String(text || "").trim().toLowerCase()
  return value === "hi" || value === "hello" || value === "hey" || value === "yo" || /^hi[!.?\s]*$/.test(value) || /^hello[!.?\s]*$/.test(value) || /^hey[!.?\s]*$/.test(value)
}

function getSessionId() {
  return getCurrentSessionId()
}

function scoreTaskQuality(outputText, promptText) {
  if (typeof outputText !== "string" || outputText.length === 0) return 0
  if (typeof promptText !== "string") promptText = ""

  let score = 50
  if (promptText.length > 0 && outputText.length > promptText.length * 0.5) score += 10
  if (outputText.length < 50) score -= 20
  if (/error|failed|unable|cannot|could not/i.test(outputText)) score -= 10
  if (/TODO|FIXME|placeholder/i.test(outputText) && outputText.length < 200) score -= 15
  const codeBlocks = (outputText.match(/```/g) || []).length
  if (codeBlocks >= 2) score += 10
  if (outputText.length > 500) score += 10
  if (outputText.length > 1000) score += 5

  return Math.max(0, Math.min(100, score))
}

function readRewardSignals() {
  try {
    const state = loadBlackboxState()
    const session = state?.sessions?.[getSessionId()] || {}
    const policy = session?.mode_policy || {}
    return {
      stableStreak: Math.max(0, Number(policy.stable_streak || 0)),
      problemStreak: Math.max(0, Number(policy.problem_streak || 0)),
    }
  } catch {
    return { stableStreak: 0, problemStreak: 0 }
  }
}

function buildRewardInput({
  finalOutcome,
  assistantText,
  userText,
  prevAssistantTexts,
  savingsUsd,
  isBrainTier,
  sessionId,
  turnId,
  projectFingerprint,
  cacheHit = false,
  cacheMiss = false,
}) {
  const lazinessResult = detectLaziness({
    assistantText,
    writeEditCount: 0,
    isBrainTier,
  })
  const claimStatus = evaluateClaimVerification({
    text: assistantText,
    sessionId,
    turnId,
    userText,
    prevAssistantTexts,
  })
  const health = getSessionHealthSnapshot({
    sessionId,
    projectFingerprint,
    userText,
    assistantText,
    prevAssistantTexts,
    turnId,
  })
  return {
    outcome: finalOutcome,
    claims: claimStatus.status !== "supported" ? claimStatus.claims : [],
    laziness: lazinessResult,
    savingsUsd,
    contradictionDetected: claimStatus.status === "contradicted",
    metaWorkDrift: health.metaWorkDrift,
    cacheHit,
    cacheMiss,
  }
}

// Footer content cache — reuse same footer text across hooks within 1s
let _footerCacheText = ""
let _footerCacheTs = 0

function recordFooterProbe(input: {
  hook: string
  builder: string
  providerLabel?: string
  provider?: string
  modelId?: string
  modelName?: string
  activeSlot?: string
  sessionSlot?: string
  mode?: string
  messageID?: string | null
  footerLine?: string
}) {
  try {
    const sid = getSessionId()
    if (!sid) return
    const dir = join(getVibeOSHome(), "session-events")
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, `${sid}.jsonl`), JSON.stringify({
      ts: new Date().toISOString(),
      kind: "footer-probe",
      hook: input.hook,
      builder: input.builder,
      provider_label: input.providerLabel || "",
      provider: input.provider || "",
      model_id: input.modelId || "",
      model_name: input.modelName || "",
      active_slot: input.activeSlot || "",
      session_slot: input.sessionSlot || "",
      mode: input.mode || "",
      message_id: input.messageID || null,
      footer_line: input.footerLine || "",
    }) + "\n")
  } catch {}
}

// Surface a swallowed footer exception into the per-session jsonl. For ~10 PRs the
// rich footer threw every turn and the catch only wrote to stderr (which the OpenCode
// desktop app discards), so the failure was invisible and the degraded fallback won
// silently. This records WHICH stage threw so the exact cause is visible on the next
// live turn instead of being guessed at.
function recordFooterError(input: { stage: string; message: string; stack?: string; hook?: string }) {
  try {
    const sid = getSessionId()
    if (!sid) return
    const dir = join(getVibeOSHome(), "session-events")
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, `${sid}.jsonl`), JSON.stringify({
      ts: new Date().toISOString(),
      kind: "footer-error",
      hook: input.hook || "",
      stage: input.stage || "unknown",
      message: input.message || "",
      stack: (input.stack || "").split("\n").slice(0, 4).join(" | "),
    }) + "\n")
  } catch {}
}

async function _appendFooter(input, output, directory, lastModelError?: string, hookName = "experimental.text.complete") {
  _refreshModel(directory)
  // Tracks how far the rich path got, so a throw names the failing stage in the jsonl.
  let _footerStage = "init"
  let _footerStress = 0
  const quietIntent = isGreetingLike(latestUserIntent || "")
  if (latestUserIntent) _footerStress = scoreStress(latestUserIntent)
  let liveBlackboxState = quietIntent ? null : getLatestBlackboxState()
  const diskBlackboxState = quietIntent ? null : loadBlackboxState()
  try {
    const liveCascadeDepth = Number(
      liveBlackboxState?.control_vector?.cascade_depth ??
      liveBlackboxState?.cascade_depth ??
      0,
    ) || 0
    const diskCascadeDepth = Number(
      _cascadeRouteLen ??
      diskBlackboxState?.control_vector?.cascade_depth ??
      diskBlackboxState?.cascade_depth ??
      0,
    ) || 0
    if (
      diskBlackboxState &&
      (
        !liveBlackboxState ||
        diskCascadeDepth > liveCascadeDepth ||
        (diskBlackboxState?.sub_regime && !liveBlackboxState?.sub_regime)
      )
    ) {
      liveBlackboxState = diskBlackboxState
    }
  } catch {}
  // The footer MUST display the model the turn actually ran on = the live OpenCode
  // default (project opencode.json `model`), which is exactly the dropdown the user
  // and VibeUltraX drive. This used to probe client.config.get("model") (the MERGED /
  // global config) and fall through to readConfig()'s remembered workspace-session
  // model — both of which drift to a stale brain default, so the footer showed brain
  // while a cheap turn ran (the footer↔dropdown↔VibeUltraX incoherence). Reading the
  // SAME file the dropdown writes keeps them coherent by construction, and drops an
  // async client probe that could stall the turn.
  let liveModelSetting = readLiveOpenCodeModel(directory) || ""
  const hookModel = String(input?.args?.model || input?.model || output?.args?.model || "").trim()
  if (hookModel) liveModelSetting = hookModel
  if (liveModelSetting && liveModelSetting !== currentModel) {
    setCurrentModel(liveModelSetting)
    setCurrentTier(classify(liveModelSetting))
    footerDebug(`[vibeOS] live model: ${currentModel} (tier=${currentTier})`)
  }
  try {
    const messageID =
      input?.messageID ||
        input?.messageId ||
        input?.message?.id ||
        output?.messageID ||
        output?.messageId ||
        output?.message?.id ||
        null
    // NOTE: we deliberately do NOT short-circuit on textCompletePainted here.
    // OpenCode rewrites the assistant message text on every streaming update,
    // which wipes any footer we painted on an earlier (partial) chunk. Skipping
    // by messageID left the *final* message footer-less, so the basic
    // ensureFooterFallback() footer (raw live model, no brand/savings) won.
    // The `hasExistingFooter` guard below is the correct idempotency check:
    // it repaints when the footer was wiped and skips when it is still present.

    function _payload(obj) {
      if (obj?.message && typeof obj.message === "object") return obj.message
      return obj
    }

    function _extractText(obj) {
      const payload = _payload(obj)
      if (typeof payload?.text === "string") return payload.text
      if (typeof payload?.result === "string") return payload.result
      if (typeof payload?.content === "string") return payload.content
      if (Array.isArray(payload?.content)) return payload.content.filter(p => p?.type === "text").map(p => p.text).filter(Boolean).join("\n")
      if (Array.isArray(payload?.parts)) return payload.parts.filter(p => p?.type === "text").map(p => p.text).filter(Boolean).join("\n")
      return ""
    }
    const text = _extractText(output)
    if (!text) return
    _footerStage = "savings"
    const { ltTasks, ltCache, ltCost, _count, sesTasks, sesEdit, sesCredit, sesC7, sesQuota, sesTaskDelegations, _sesDuration, _sesRatePerHour, sesTrend, _sesToolBreakdown, sesModelTurns, _quality_avg } = readLifetimeSavings()
    const { _stableStreak, _problemStreak } = readRewardSignals()

    const sid = getSessionId()
    const latestTurnTruth = getLatestTurnTruth(sid)
    const latestExecutedRoute = latestTurnTruth?.executedRoute || null
    const latestRouteDrivesVisibleAnswer = latestExecutedRoute?.contributedToFinalAnswer === true
    const latestFinalized = latestTurnTruth?.finalized || null
    const turnTruthSlot = latestFinalized?.finalVisibleSlot || (latestRouteDrivesVisibleAnswer ? latestExecutedRoute?.selectedSlot : "") || ""
    const sessionSlot = turnTruthSlot || loadBlackboxState()?.sessions?.[sid]?.active_slot || loadSessionSlot(sid)
    const slot = loadSelection().active_slot || sessionSlot || "brain"
    const brainModel = slot === "brain" ? (TRINITY_BRAIN || currentModel) : slot === "medium" ? (TRINITY_MEDIUM || currentModel) : (TRINITY_CHEAP || currentModel || "")
    const _cacheEvt = getLatestCacheEvent(sid)
    const _perTurnCacheDelta = _cacheEvt.hit ? _cacheEvt.est_savings_usd : 0
    const _cacheMiss = !_cacheEvt.hit
    let liveModel = liveModelSetting
    if (!liveModel) {
      liveModel = readConfig(directory) || readConfig(join(process.env.HOME || "", ".config", "opencode")) || process?.env?.OPENCODE_MODEL || ""
    }
    const displayModel = latestFinalized?.finalVisibleModel || (latestRouteDrivesVisibleAnswer ? latestExecutedRoute?.selectedModel : "") || liveModelSetting || liveModel || currentModel || ""
    const resolvedModel = displayModel || liveModelSetting || liveModel || currentModel || ""
    if (resolvedModel && resolvedModel !== currentModel) {
      setCurrentModel(resolvedModel)
      setCurrentTier(classify(resolvedModel))
    }
    const backendMode = String(
      loadSelection().requested_optimization_mode ||
      loadSelection().optimization_mode ||
      loadOptimizationMode() ||
      liveBlackboxState?.optimization_mode ||
      "",
    ).trim().toLowerCase()
    const displayMode = backendMode || (quietIntent
      ? regimeToMode("INIT", _footerStress)
      : (isApiConnected()
        ? await apiAutoSelectMode(liveBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || ""), _footerStress)
        : autoSelectMode(liveBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || ""), _footerStress)))
    const selectedRoutePathDepth = Array.isArray(loadSelection().route_path)
      ? loadSelection().route_path.length
      : null
    const ultraCascadeDepth = Number(
      latestFinalized?.cascadeDepth ??
      (latestRouteDrivesVisibleAnswer ? latestExecutedRoute?.cascadeDepth : null) ??
      (latestRouteDrivesVisibleAnswer && Array.isArray(latestExecutedRoute?.routePath) ? latestExecutedRoute.routePath.length : null) ??
      selectedRoutePathDepth ??
      diskBlackboxState?.control_vector?.cascade_depth ??
      diskBlackboxState?.cascade_depth ??
      liveBlackboxState?.control_vector?.cascade_depth ??
      liveBlackboxState?.cascade_depth ?? 0,
    ) || 0
    // VibeUltraX is a cascade: show the LIVE running model and the tier that
    // model actually occupies in the user's trinity (cheap → medium → brain).
    // At the cascade entry this reads "⚡ cheap | Big Pickle"; once it escalates
    // to e.g. deepseek-v4-flash (the medium slot) it reads "◐ medium | V4 Flash"
    // — tier and model stay coherent instead of a pinned "⚡ cheap | V4 Flash".
    const ultraLiveModel = displayModel || liveModel || currentModel || TRINITY_CHEAP || TRINITY_MEDIUM || TRINITY_BRAIN || ""
    const ultraResolvedTier = ((): "cheap" | "medium" | "brain" => {
      const ct = liveBlackboxState?.control_vector?.cascade_tier || liveBlackboxState?.cv?.cascade_tier
      if (ct === "medium" || ct === "brain") return ct
      if (TRINITY_CHEAP && ultraLiveModel === TRINITY_CHEAP) return "cheap"
      if (TRINITY_MEDIUM && ultraLiveModel === TRINITY_MEDIUM) return "medium"
      if (TRINITY_BRAIN && ultraLiveModel === TRINITY_BRAIN) return "brain"
      const c = String(classify(ultraLiveModel) || "").toLowerCase()
      return c === "high" || c === "brain" ? "brain" : c === "mid" || c === "medium" ? "medium" : "cheap"
    })()
    const cascadeModel = displayModel
      || (ultraResolvedTier === "brain" ? TRINITY_BRAIN
        : ultraResolvedTier === "medium" ? TRINITY_MEDIUM
        : TRINITY_CHEAP)
      || ""
    _footerStage = "execution"
    const execution = resolveCurrentExecution({
      directory,
      activeSlot: displayMode === "vibeultrax" ? ultraResolvedTier : slot || "brain",
      currentModel,
      liveModel: displayModel || liveModel || currentModel || "",
      tiersData: {
        trinity: {
          brain: { oc: TRINITY_BRAIN || currentModel },
          medium: { oc: TRINITY_MEDIUM || currentModel },
          cheap: { oc: TRINITY_CHEAP || currentModel },
        },
      },
    })
    const _executionSlot = displayMode === "vibeultrax"
      ? ultraResolvedTier
      : execution.quality === "brain"
        ? "brain"
        : execution.quality === "mid"
          ? "medium"
          : "cheap"
    let _modelTag = `[${shortModelName(cascadeModel)}]`
    const _workerModel = slot === "brain" ? TRINITY_MEDIUM : null
    const totalTurns = (sesModelTurns?.brain || 0) + (sesModelTurns?.worker || 0)
    if (_workerModel && _workerModel !== brainModel) {
      const brainPct = Math.round(((sesModelTurns?.brain || 0) / (totalTurns || 1)) * 100)
      _modelTag = `[${shortModelName(cascadeModel)} ${brainPct}% → ${shortModelName(_workerModel)} ${100 - brainPct}%]`
    }

    _autoReportCount = (_autoReportCount || 0) + 1
    if (_autoReportCount % 5 === 0) {
      try {
        saveReport({
          type: "session",
          summary: "Session cost: $" + formatUsd(ltCost) + " | cache saved: $" + formatUsd(ltCache) + " | delegation saved: $" + formatUsd(Number(sesTasks || 0)) + " | task delegations: " + Number(sesTaskDelegations || 0),
          metrics: {
            sessionId: sid,
            projectFingerprint: currentProjectFingerprint || "unknown",
            projectName: currentProjectName || "unknown",
            sessionCost: ltCost,
            cacheSavings: ltCache,
            delegationSavingsUsd: sesTasks,
            taskDelegationCount: sesTaskDelegations,
            // Backward compatibility (legacy field historically misnamed)
            tasksDelegated: sesTaskDelegations,
            model: resolvedModel || currentModel,
            slot: loadSelection().active_slot || "unknown",
            editSavings: sesEdit,
            creditSavings: sesCredit,
            context7Savings: sesC7,
            quotaSavings: sesQuota,
          },
          tags: ["auto", "cost"],
        })
      } catch (e) { footerDebug("[vibeOS] auto-report:", e.message) }
    }

    // NOTE: do NOT re-import selection-manager with a cache-busting query string here.
    // esbuild cannot resolve a runtime template-literal import inside the bundle
    // (`dist/vibeOS.js`); it throws SYNCHRONOUSLY (so `.catch` never fires), which killed
    // the rich footer on every live turn and let the degraded fallback win. loadSelection()
    // already reads fresh from disk each call, so the plain import is sufficient.
    const selNowFooter = loadSelection()
    const normalizedIntent = classifyTurnSimple(latestUserIntent || "")
    const currentSubRegime = quietIntent ? "INIT" : (liveBlackboxState?.sub_regime || normalizedIntent)
    const bbMode = resolveEnforcementMode()
    const CODING_REGIMES = new Set(["REFINING", "IMPLEMENTING", "CONVERGING", "REVIEWING"])
    const enfTags = buildEnforcementTags({
      delegationEnforce: selNowFooter.delegation_enforce,
      flowEnforce: selNowFooter.flow_enforce,
      tddEnforce: selNowFooter.tdd_enforce && CODING_REGIMES.has(currentSubRegime),
      bbMode,
      modelLocked: _modelLocked,
      quietIntent: isGreetingLike(latestUserIntent || ""),
    })
    const prevAssistantTexts = typeof _prevAssistantTexts !== "undefined" && Array.isArray(_prevAssistantTexts) ? _prevAssistantTexts : []
    _footerStage = "claims"
    const claimStatus = evaluateClaimVerification({
      text,
      vibeHome: getVibeOSHome(),
      sessionId: sid,
      turnId: latestTurnTruth?.turnId || "",
      userText: latestUserIntent || "",
      prevAssistantTexts,
    })
    const sessionHealth = getSessionHealthSnapshot({
      sessionId: sid,
      projectFingerprint: currentProjectFingerprint || "",
      userText: latestUserIntent || "",
      assistantText: text,
      prevAssistantTexts,
      turnId: latestTurnTruth?.turnId || "",
    })
    const claimTag = claimStatus.claimTag || ""
    const footerSuffix = /\n\n\u2014 [^\n]+\u2014\s*$/
    const hasExistingFooter = footerSuffix.test(text)
    const stripped = hasExistingFooter ? text.replace(footerSuffix, "").trimEnd() : text
    const ltTotal = ltTasks + ltCache
    const sessionCacheSavings = getSessionCacheSavings(readFullState()?.sessions?.[sid] || {})
    const sessionTotal = Number(sesTasks || 0) + Number(sessionCacheSavings || 0)
    const footerSavingsTotal = sessionTotal > 0 ? sessionTotal : ltTotal
    // SINGLE SOURCE OF TRUTH: the tier icon must describe the model that ACTUALLY ran
    // this turn — the live model the footer already resolved (ultraLiveModel =
    // displayModel || liveModel || currentModel) — so the icon and the model name shown
    // can never disagree. This is the same source the vibeultrax tier uses, now applied
    // to every mode. The intended/next slot is surfaced separately via the "switch
    // pending" alert (pendingLiveModel below), not by pre-painting the future tier here.
    const ranTier = ((): "cheap" | "medium" | "brain" => {
      const m = ultraLiveModel || currentModel || ""
      if (TRINITY_CHEAP && m === TRINITY_CHEAP) return "cheap"
      if (TRINITY_MEDIUM && m === TRINITY_MEDIUM) return "medium"
      if (TRINITY_BRAIN && m === TRINITY_BRAIN) return "brain"
      const c = String(classify(m) || "").toLowerCase()
      return c === "high" || c === "brain" ? "brain" : c === "mid" || c === "medium" ? "medium" : "cheap"
    })()
    const activeSlot = turnTruthSlot || (displayMode === "vibeultrax" ? ultraResolvedTier : ranTier)
    const flashIcon = isApiConnected() ? " \u26A1" : ""
    const rawMode = displayMode
    _footerStage = "control-vector"
    const cv = computeControlVector({ sub_regime: currentSubRegime, latest_stress_multiplier: _footerStress, user_text: latestUserIntent || "" }, undefined, rawMode)
    const SUPPRESS_SYNC_MODES = new Set(["quality", "auto"])
    const isSuppressedMode = SUPPRESS_SYNC_MODES.has(String(displayMode || "").toLowerCase())
    const vibeBrand = isSuppressedMode ? "vibeOS" : resolveBrand(displayMode, activeSlot)
    const XP_SHOW_REGIMES = new Set(["CONVERGING", "CLOSED", "REVIEWING"])
    let _rewardTag = ""
    let _rewardOutcome = null
    let _rewardCredits = 0
    let _rewardBreakdown = null

    if (_blackboxEnabled) {
      try {
        const prevText = _prevOutputText
        _prevOutputText = _extractText(output) || ""
        if (_prevOutputText && prevText && _prevOutputText !== prevText) {
          const outcome = detectOutcomeSignal(_prevOutputText)
          const regime = liveBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || "")
          const stress = _footerStress
          // Passive negative outcome: LOOPING regime + elevated stress = auto-negative
          const isLooping = String(regime || "").toUpperCase() === "LOOPING"
          const isStressed = Number(stress || 0) > 0.3
          const passiveNegative = (isLooping && isStressed) && !outcome ? "negative" : null
          const finalOutcome = outcome || passiveNegative
          if (finalOutcome) {
            _rewardOutcome = finalOutcome
            const tracker = getBlackboxTracker()
            tracker.recordOutcome(finalOutcome)
            try { syncOutcomeToApi(finalOutcome) } catch {}
            // Reward engine: compute credits based on outcome, claims, laziness, savings
            try {
              const curOutput = _prevOutputText || ""
              const rewardInput = buildRewardInput({
                finalOutcome,
                assistantText: curOutput,
                userText: latestUserIntent || "",
                prevAssistantTexts,
                savingsUsd: _perTurnCacheDelta,
                isBrainTier: String(currentTier || "").toLowerCase() === "high",
                sessionId: sid,
                turnId: latestTurnTruth?.turnId || "",
                projectFingerprint: currentProjectFingerprint || "",
                cacheHit: _cacheEvt.hit,
                cacheMiss: _cacheMiss,
              })
              const rewardResult = computeReward(rewardInput)
              _rewardCredits = rewardResult.credits
              _rewardBreakdown = rewardResult.breakdown
              if (rewardResult.credits !== 0) {
                const suppressPositive = rewardResult.credits > 0 && !XP_SHOW_REGIMES.has(String(currentSubRegime || "").toUpperCase())
                if (!suppressPositive) {
                  _rewardTag = rewardResult.credits > 0 ? `+${rewardResult.credits} XP` : `${rewardResult.credits} XP`
                }
              }
            } catch {}
            // Write outcome to calibration log
            try {
              mkdirSync(getVibeOSHome(), { recursive: true })
              appendFileSync(
                join(getVibeOSHome(), "calibration-data.jsonl"),
                JSON.stringify({ ts: new Date().toISOString(), event: "outcome", sid: getSessionId(), outcome: finalOutcome }) + "\n",
              )
            } catch {}
          }
        }
      } catch {}
    }

    if (_rewardOutcome && !_rewardTag) {
      try {
        const curOutput = _prevOutputText || ""
        const rewardResult = computeReward(buildRewardInput({
          finalOutcome: _rewardOutcome,
          assistantText: curOutput,
          userText: latestUserIntent || "",
          prevAssistantTexts,
          savingsUsd: _perTurnCacheDelta,
          isBrainTier: String(currentTier || "").toLowerCase() === "high",
          sessionId: sid,
          turnId: latestTurnTruth?.turnId || "",
          projectFingerprint: currentProjectFingerprint || "",
          cacheHit: _cacheEvt.hit,
          cacheMiss: _cacheMiss,
        }))
        _rewardCredits = rewardResult.credits
        _rewardBreakdown = rewardResult.breakdown
        if (rewardResult.credits !== 0) {
          const suppressPositive = rewardResult.credits > 0 && !XP_SHOW_REGIMES.has(String(currentSubRegime || "").toUpperCase())
          if (!suppressPositive) {
            _rewardTag = rewardResult.credits > 0 ? `+${rewardResult.credits} XP` : `${rewardResult.credits} XP`
          }
        }
      } catch {}
    }

    if (!_rewardTag) {
      try {
        const rewardText = _prevOutputText || _extractText(output) || ""
        const rewardOutcome = detectOutcomeSignal(rewardText)
        const rewardRegime = liveBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || "")
        const rewardStress = _footerStress
        const rewardPassiveNegative = (String(rewardRegime || "").toUpperCase() === "LOOPING" && Number(rewardStress || 0) > 0.3 && !rewardOutcome) ? "negative" : null
        const finalRewardOutcome = rewardOutcome || rewardPassiveNegative
        if (finalRewardOutcome) {
          const rewardResult = computeReward(buildRewardInput({
            finalOutcome: finalRewardOutcome,
            assistantText: rewardText,
            userText: latestUserIntent || "",
            prevAssistantTexts,
            savingsUsd: _perTurnCacheDelta,
            isBrainTier: String(currentTier || "").toLowerCase() === "high",
            sessionId: sid,
            turnId: latestTurnTruth?.turnId || "",
            projectFingerprint: currentProjectFingerprint || "",
            cacheHit: _cacheEvt.hit,
            cacheMiss: _cacheMiss,
          }))
          _rewardCredits = rewardResult.credits
          _rewardBreakdown = rewardResult.breakdown
          if (rewardResult.credits !== 0) {
            const suppressPositive = rewardResult.credits > 0 && !XP_SHOW_REGIMES.has(String(currentSubRegime || "").toUpperCase())
            if (!suppressPositive) {
              _rewardTag = rewardResult.credits > 0 ? `+${rewardResult.credits} XP` : `${rewardResult.credits} XP`
            }
          }
        }
      } catch {}
    }

    const _expectedModel = slot === "brain" ? TRINITY_BRAIN : slot === "medium" ? TRINITY_MEDIUM : TRINITY_CHEAP
    // In a cascade (VibeUltraX) the live model legitimately escalates across the
    // pipeline tiers (cheap → medium → brain), so a live model that differs from
    // the cheap entry slot is expected, not drift. Only flag drift when the live
    // model falls outside the known cascade tiers.
    const _cascadeTierModels = new Set([TRINITY_CHEAP, TRINITY_MEDIUM, TRINITY_BRAIN].filter(Boolean))
    const _expectedForAlert = displayMode === "vibeultrax" && liveModelSetting && _cascadeTierModels.has(liveModelSetting)
      ? liveModelSetting
      : _expectedModel
    _footerStage = "alert"
    let _alertTag = ""
    try {
      const pendingSwitch = getPendingLiveSwitch()
      _alertTag = buildFooterAlert({
        apiDegraded: isApiFallback(),
        apiSlow: isApiLatencyDegraded(),
        liveModel: liveModelSetting || undefined,
        expectedModel: _expectedForAlert || undefined,
        lastModelError,
        pendingLiveModel: pendingSwitch?.model || undefined,
      })
      if (!_alertTag && sessionHealth.risk !== "low" && sessionHealth.metaWorkDrift) {
        _alertTag = "↻ recover"
      }
    } catch {}

    _footerStage = "build"
    const cascadeDepthSource =
      ultraCascadeDepth > 0
        ? ultraCascadeDepth
        : (
          latestFinalized?.cascadeDepth ??
          latestExecutedRoute?.cascadeDepth ??
          (Array.isArray(latestExecutedRoute?.routePath) ? latestExecutedRoute.routePath.length : null) ??
          selectedRoutePathDepth ??
          diskBlackboxState?.sessions?.[getCurrentSessionId()]?.cascade_depth ??
          diskBlackboxState?.control_vector?.cascade_depth ??
          diskBlackboxState?.cascade_depth ??
          liveBlackboxState?.control_vector?.cascade_depth ??
          liveBlackboxState?.cascade_depth ??
          0
        )
    const cascadeDepthForIcon = Number(cascadeDepthSource) || 0
    const TIER_RANK: Record<string, number> = { cheap: 0, medium: 1, brain: 2 }
    const sessionRank = TIER_RANK[sessionSlot || ""] ?? -1
    const activeRankVal = TIER_RANK[activeSlot || ""] ?? -1
    const showDowngrade = Boolean(sessionSlot && sessionSlot !== activeSlot && sessionRank > activeRankVal)
    const downgradeWorkerSlot = showDowngrade ? `↓ ${sessionSlot}` : undefined
    const vibeLine = buildFooterLine({
      activeSlot,
      providerLabel: execution.provider_label,
      modelName: modelDisplayName(execution.model),
      workerSlot: downgradeWorkerSlot,
      savingsTotal: footerSavingsTotal,
      ltTrend: sesTrend,
      vibeBrand,
      optMode: isSuppressedMode ? "" : displayMode,
      flashIcon,
      enfTags,
      subRegime: currentSubRegime,
      stressGauge: _footerStress > 0.85 ? "█" : _footerStress > 0.7 ? "▆" : _footerStress > 0.5 ? "▅" : _footerStress > 0.3 ? "▃" : _footerStress > 0.1 ? "▂" : "▁",
      cascadeIcon: cascadeDepthForIcon >= 3 ? "▸▸▸" : cascadeDepthForIcon >= 2 ? "▸▸" : cascadeDepthForIcon >= 1 ? "▸" : "",
      cascadeLabel: "",
      claimTag: claimTag || undefined,
      rewardTag: _rewardTag || undefined,
      alertTag: _alertTag || undefined,
    })
    recordFooterProbe({
      hook: hookName,
      builder: "rich",
      providerLabel: execution.provider_label,
      provider: execution.provider,
      modelId: execution.model,
      modelName: modelDisplayName(execution.model),
      activeSlot,
      sessionSlot,
      mode: displayMode,
      messageID,
      footerLine: vibeLine,
    })
    if (stripped === _lastStrippedText && !claimTag) return
    // Streaming-aware dedup. We already painted this messageID once; skip the
    // re-call UNLESS the message text has grown — which means OpenCode streamed
    // more text and wiped the footer we painted on an earlier chunk, so the
    // final text must be re-painted (otherwise the basic ensureFooterFallback
    // footer with the raw live model wins). A redundant duplicate call carries
    // the same-or-shorter text and is correctly skipped here.
    if (messageID && textCompletePainted.has(messageID)) {
      const paintedLen = textCompletePainted.get(messageID)
      if (stripped.length <= paintedLen && !claimTag) return
    }
    try {
      recordLiveSessionSnapshot({
        sessionId: sid,
        projectFingerprint: currentProjectFingerprint || "",
        projectName: currentProjectName || "",
        outcome: _rewardOutcome,
        rewardCredits: _rewardCredits,
        rewardBreakdown: _rewardBreakdown,
        savingsUsd: _perTurnCacheDelta,
        footerLine: vibeLine,
        control: cv,
        subRegime: currentSubRegime,
        resolutionState: _rewardOutcome === "positive" ? "working" : _rewardOutcome === "negative" ? "needs_attention" : (liveBlackboxState?.resolution_state || liveBlackboxState?.resolution || "unresolved"),
        resolutionReason: _rewardOutcome ? (_rewardOutcome === "positive" ? "positive outcome" : "negative outcome") : "no outcome yet",
        nextAction: _rewardOutcome === "negative"
          ? (getLatestBlackboxLoopMsg() || getLatestBlackboxPivotMsg() || (Array.isArray(cv?.directives) ? cv.directives[0] : "") || "")
          : (sessionHealth.recommendedAction || getLatestBlackboxPivotMsg() || (Array.isArray(cv?.directives) ? cv.directives[0] : "") || ""),
        loopInterventionLevel: liveBlackboxState?.loop_intervention_level || cv?.loop_intervention_level || "none",
        pivotDetected: Boolean(liveBlackboxState?.pivot_detected || sessionHealth.metaWorkDrift),
        stress: _footerStress,
        source: "footer",
      })
    } catch (innerErr) {
      console.error("[vibeOS] footer recordLiveSessionSnapshot error:", innerErr?.message || innerErr)
    }
    try {
      if (latestTurnTruth?.turnId) {
        recordTurnFinalize({
          sessionId: sid,
          turnId: latestTurnTruth.turnId,
          finalized: {
            finalVisibleModel: execution.model,
            finalVisibleSlot: activeSlot,
            finalVisibleProvider: execution.provider,
            finalVisibleProviderLabel: execution.provider_label,
            finalVisibleModelName: modelDisplayName(execution.model),
            footerLine: vibeLine,
            claimTag: claimTag || "",
            rewardTag: _rewardTag || "",
            rewardCredits: _rewardCredits,
            rewardOutcome: _rewardOutcome || "",
            subRegime: currentSubRegime,
            enforcementMode: cv?.enforcement_mode || "",
            flowMode: cv?.flow_mode || "",
            tddMode: cv?.tdd_mode || "",
            cascadeDepth: cascadeDepthForIcon,
          },
        })
      }
    } catch (turnLedgerErr) {
      console.error("[vibeOS] footer turn ledger error:", turnLedgerErr?.message || turnLedgerErr)
    }
    const footerText = stripped + `\n\n${vibeLine}`
    _footerCacheText = `\n\n${vibeLine}`
    _footerCacheTs = Date.now()

    function _setFooter(obj, text) {
      const target = _payload(obj)
      if (typeof target?.text === "string") target.text = text
      else if (typeof target?.result === "string") target.result = text
      else if (typeof target?.content === "string") target.content = text
      else if (Array.isArray(target?.content)) {
        const textParts = target.content.filter(p => p?.type === "text")
        if (textParts.length > 0) textParts[textParts.length - 1].text = text
        else target.content.push({ type: "text", text })
      } else if (Array.isArray(target?.parts)) {
        const textParts = target.parts.filter(p => p?.type === "text")
        if (textParts.length > 0) textParts[textParts.length - 1].text = text
        else target.parts.push({ type: "text", text })
      } else target.text = text
    }
    _setFooter(output, footerText)
    _lastStrippedText = stripped

    // CLI/pipe mode: stdout is already rendered, write footer to stderr
    if (!process.stdout?.isTTY) {
      console.error(`\n${vibeLine} —`)
    }

    if (messageID) textCompletePainted.set(messageID, stripped.length)
    if (textCompletePainted.size > 500) {
      const it = textCompletePainted.keys()
      for (let i = 0; i < 100; i++) textCompletePainted.delete(it.next().value)
    }
  } catch (err) {
    footerDebug(`[vibeOS] footer failed at stage=${_footerStage}: ${err?.message}`)
    recordFooterError({ stage: _footerStage, message: String(err?.message || err), stack: String(err?.stack || ""), hook: hookName })
  }
}

function didTextCompletePainted(messageID: string): boolean {
  return textCompletePainted.has(messageID)
}

export { _appendFooter, scoreTaskQuality, readRewardSignals, buildRewardInput, buildFooterAlert, didTextCompletePainted }
