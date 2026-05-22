// @ts-nocheck
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, readdirSync, copyFileSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import { homedir, tmpdir } from "node:os"
import { classify, modelCostPerTurn, _refreshModel, TRINITY_BRAIN, TRINITY_MEDIUM, TRINITY_CHEAP, shortModelName, roundUsd, formatUsd } from "../pricing.js"
import { latestUserIntent } from "./chat-transform.js"
import { scoreStress, resolveEnforcementMode, detectOutcomeSignal, getBlackboxTracker, syncOutcomeToApi, loadOptimizationMode, saveOptimizationMode, classifyTurnSimple } from "../turn-classify.js"
import { saveReport } from "../reporting.js"
import { currentModel, currentTier, setCurrentModel, setCurrentTier, currentProjectFingerprint, currentProjectName, _modelLocked, _blackboxEnabled, writeSelection, reconcileStateFromLedger, safeJsonParse } from "../state.js"
import { loadSessionSlot, writeSessionSlot } from "../selection-manager.js"
import { remoteCall } from "../api-client.js"
import { SAVE_EST } from "../constants.js"

let _cachedAutoMode = null
let _cachedAutoModeTs = 0
const AUTO_CACHE_TTL = 60000

async function apiAutoSelectMode(regime, stress) {
  const now = Date.now()
  if (_cachedAutoMode && now - _cachedAutoModeTs < AUTO_CACHE_TTL) return _cachedAutoMode
  try {
    const res = await remoteCall('blackboxSelectMode', [regime, stress], null)
    if (res?.mode) {
      _cachedAutoMode = res.mode
      _cachedAutoModeTs = now
      return res.mode
    }
  } catch (e) { console.error("[vibeOS] apiAutoSelectMode error:", e.message) }
  return _cachedAutoMode || "balanced"
}

const USER_HOME = (() => { try { return homedir() } catch { return tmpdir() } })()
const STATE_FILE = join(USER_HOME, ".claude/delegation-state.json")
const SAVINGS_LEDGER_FILE = join(USER_HOME, ".claude/savings-ledger.jsonl")

let _prevOutputText = ""
let _autoReportCount = 0
const textCompletePainted = new Set()

function loadSelection() {
  try {
    const raw = readFileSync(join(USER_HOME, ".claude/model-tiers.json"), "utf-8")
    return safeJsonParse(raw)?.selection || { active_slot: "medium", enabled: true, delegation_enforce: false, flow_enabled: false, flow_enforce: false, tdd_enforce: false, tdd_strict: false }
  } catch { return { active_slot: "medium", enabled: true, delegation_enforce: false, flow_enabled: false, flow_enforce: false, tdd_enforce: false, tdd_strict: false } }
}

function readLifetimeSavings() {
  try {
    reconcileStateFromLedger()
    const raw = readFileSync(STATE_FILE, "utf-8")
    const state = safeJsonParse(raw)
    const ses = state?.sessions?.[(typeof _OC_SID !== "undefined" ? _OC_SID : "")] || {}
    return {
      ltTasks: roundUsd(state?.lifetime?.total_savings_usd || 0),
      ltCache: roundUsd(state?.lifetime?.cache_savings_usd || 0),
      ltCost: roundUsd(state?.lifetime?.total_cost_usd || 0),
      count: state?.lifetime?.warn_count || 0,
      sesTasks: roundUsd(ses?.total_savings_usd || 0),
      sesCache: roundUsd(ses?.cache_savings_usd || 0),
      sesTaskDelegations: ses?.task_delegations_count || 0,
      sesDuration: ses?.duration_seconds || 0,
      sesRatePerHour: ses?.rate_per_hour || 0,
      sesTrend: ses?.trend || "",
      sesToolBreakdown: ses?.tool_breakdown || {},
      sesModelTurns: ses?.model_turns || {},
      quality_avg: ses?.quality_avg || 0,
    }
  } catch { return { ltTasks: 0, ltCache: 0, ltCost: 0, count: 0, sesTasks: 0, sesCache: 0, sesTaskDelegations: 0, sesDuration: 0, sesRatePerHour: 0, sesTrend: "", sesToolBreakdown: {}, sesModelTurns: {}, quality_avg: 0 } }
}

let _OC_SID = "opencode-" + (process.pid || "x") + "-" + Date.now()

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

async function _appendFooter(input, output, directory) {
    if (!loadSelection().enabled) return
    _refreshModel(directory)
    let _footerStress = 0
    if (latestUserIntent) _footerStress = scoreStress(latestUserIntent)
    // Lazy model detection: try client API once
    if (!currentModel) {
      try {
        const cfg = await client.config.get("model")
        if (cfg) {
          setCurrentModel(String(cfg))
          setCurrentTier(classify(String(cfg)))
          console.error(`[vibeOS] client-detected model: ${currentModel} (tier=${currentTier})`)
        }
      } catch { /* client.config may not be available */ }
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
      if (messageID && textCompletePainted.has(messageID)) return

      const text =
        typeof output?.text === "string" ? output.text :
        typeof output?.result === "string" ? output.result :
        typeof output?.content === "string" ? output.content :
        ""
      if (!text || text.length < 50) {
        if (messageID) textCompletePainted.add(messageID)
        return
      }
      const { ltTasks, ltCache, ltCost, count, sesTasks, sesEdit, sesCredit, sesC7, sesQuota, sesCache, sesTaskDelegations, sesDuration, sesRatePerHour, sesTrend, sesToolBreakdown, sesModelTurns, quality_avg } = readLifetimeSavings()

      const sessionSlot = loadSessionSlot(_OC_SID)
      const slot = sessionSlot || loadSelection().active_slot || "brain"
      const brainModel = slot === "brain" ? (TRINITY_BRAIN || currentModel) : slot === "medium" ? (TRINITY_MEDIUM || currentModel) : (TRINITY_CHEAP || currentModel || "")
      let modelTag = `[${shortModelName(brainModel)}]`
      const _workerModel = slot === "brain" ? TRINITY_MEDIUM : null
      const totalTurns = (sesModelTurns?.brain || 0) + (sesModelTurns?.worker || 0)
      if (_workerModel && _workerModel !== brainModel) {
        const brainPct = Math.round(((sesModelTurns?.brain || 0) / (totalTurns || 1)) * 100)
        modelTag = `[${shortModelName(brainModel)} ${brainPct}% → ${shortModelName(_workerModel)} ${100 - brainPct}%]`
      }

      _autoReportCount = (_autoReportCount || 0) + 1
      if (_autoReportCount % 5 === 0) {
        try {
          saveReport({
            type: "session",
            summary: "Session cost: $" + formatUsd(ltCost) + " | cache saved: $" + formatUsd(ltCache) + " | delegation saved: $" + formatUsd(Number(sesTasks || 0)) + " | task delegations: " + Number(sesTaskDelegations || 0),
            metrics: {
              sessionId: _OC_SID,
              projectFingerprint: currentProjectFingerprint || "unknown",
              projectName: currentProjectName || "unknown",
              sessionCost: ltCost,
              cacheSavings: ltCache,
              delegationSavingsUsd: sesTasks,
              taskDelegationCount: sesTaskDelegations,
              // Backward compatibility (legacy field historically misnamed)
              tasksDelegated: sesTaskDelegations,
              model: currentModel,
              slot: loadSelection().active_slot || "unknown",
              editSavings: sesEdit,
              creditSavings: sesCredit,
              context7Savings: sesC7,
              quotaSavings: sesQuota,
            },
            tags: ["auto", "cost"],
          })
        } catch (e) { console.error("[vibeOS] auto-report:", e.message) }
      }

      // Enforcement state tags for footer — dynamically adjusted by control vector
      const selNowFooter = loadSelection()
      const enfTagsFooter = []
      const bbMode = resolveEnforcementMode()
      const optModeFooter = loadOptimizationMode()
      if (bbMode === "relaxed") {
        enfTagsFooter.push("[Q&A]")
      } else {
        if (selNowFooter.delegation_enforce) enfTagsFooter.push("[ENF ON]")
        if (selNowFooter.flow_enforce) enfTagsFooter.push("[FLOW ON]")
        if (selNowFooter.tdd_enforce) enfTagsFooter.push("[TDD ON]")
        
        if (bbMode === "strict") enfTagsFooter.push("[STRICT]")
      }
      if (_modelLocked) enfTagsFooter.push("[LOCK ON]")
      let enfSuffixFooter = enfTagsFooter.length > 0 ? ` ${enfTagsFooter.join(" ")}` : ""
      if (quality_avg > 0) {
        enfSuffixFooter = ` QA:${Math.round(quality_avg)}% ${enfTagsFooter.join(" ")}`
      }
      // Optimization mode tag
      let optTagFooter = ""
      if (optModeFooter === "audit") optTagFooter = "[AUDIT]"
      else if (optModeFooter === "budget") optTagFooter = "[BUDGET]"
      else if (optModeFooter === "quality") optTagFooter = "[QUALITY]"
      else if (optModeFooter === "speed") optTagFooter = "[SPEED]"
      else if (optModeFooter === "longrun") optTagFooter = "[LONGRUN]"
      else if (optModeFooter === "auto") {
        const autoRegime = classifyTurnSimple(latestUserIntent || "")
        const autoStress = scoreStress(latestUserIntent || "")
        const autoActive = await apiAutoSelectMode(autoRegime, autoStress)
        const autoTag = { audit: "AUDIT", budget: "BUDGET", quality: "QUALITY", speed: "SPEED", longrun: "LONGRUN", balanced: "BALANCED" }
        optTagFooter = `[VIBE→${autoTag[autoActive] || autoActive.toUpperCase()}]`
        saveOptimizationMode(autoActive)
        const slot = autoActive === "quality" ? "brain" : autoActive === "speed" ? "medium" : "cheap"
        if (!_modelLocked) {
          writeSessionSlot(_OC_SID, slot)
          if (slot === "brain" && TRINITY_BRAIN) { setCurrentModel(TRINITY_BRAIN); setCurrentTier("high") }
          else if (slot === "medium" && TRINITY_MEDIUM) { setCurrentModel(TRINITY_MEDIUM); setCurrentTier("mid") }
          else if (slot === "cheap" && TRINITY_CHEAP) { setCurrentModel(TRINITY_CHEAP); setCurrentTier("low") }
        }
      }
      modelTag = `${modelTag}${optTagFooter}${enfSuffixFooter || ""}`

      const stripped = text.replace(/\n\n— .+(?: —)?$/, "")
      if (stripped !== text) return
      const ltTotal = ltTasks + ltCache
      const trendIcon = sesTrend === "down" ? "↓" : sesTrend === "up" ? "↑" : "→"
      const brainModelCost = currentModel ? (modelCostPerTurn(currentModel) ?? 0) : 0
      const cheapModelCost = _workerModel ? (modelCostPerTurn(_workerModel) ?? 0) : 0
      const imputedMultiplier = (brainModelCost > SAVE_EST.WRITE_EDIT && cheapModelCost > 0 && brainModelCost > cheapModelCost) ? (brainModelCost / cheapModelCost) : 0
      let footerText
      if (ltTotal > 0) {
        let savingsDisplay = `vibeOS: $${formatUsd(ltTotal)} saved up ${trendIcon}`
        if (imputedMultiplier > 2) {
          const imputedActual = ltTotal * imputedMultiplier
          savingsDisplay += ` ($${formatUsd(imputedActual)} actual)`
        }
        const stressBar = _footerStress > 0.85 ? "█" : _footerStress > 0.7 ? "▆" : _footerStress > 0.5 ? "▅" : _footerStress > 0.3 ? "▃" : _footerStress > 0.1 ? "▂" : "▁"
        const stressLabel = _footerStress > 0.7 ? "high" : _footerStress > 0.4 ? "elevated" : "calm"
        footerText = stripped + `\n\n— ${modelTag} | ${savingsDisplay} | stress: ${stressBar} ${stressLabel} —`
      } else {
        footerText = stripped + `\n\n— ${modelTag} —`
      }

      if (_blackboxEnabled) {
        try {
          const prevText = _prevOutputText
          _prevOutputText = typeof output?.text === "string" ? output.text : typeof output?.result === "string" ? output.result : ""
          if (_prevOutputText && prevText && _prevOutputText !== prevText) {
            const outcome = detectOutcomeSignal(_prevOutputText)
            if (outcome) {
              const tracker = getBlackboxTracker()
              tracker.recordOutcome(outcome)
              syncOutcomeToApi(outcome)
            }
          }
        } catch {}
      }
      if (typeof output?.text === "string") output.text = footerText
      else if (typeof output?.result === "string") output.result = footerText
      else if (typeof output?.content === "string") output.content = footerText
      else output.text = footerText

      textCompletePainted.add(messageID)
      if (textCompletePainted.size > 500) {
        const it = textCompletePainted.values()
        for (let i = 0; i < 100; i++) textCompletePainted.delete(it.next().value)
      }
    } catch (err) {
      console.error(`[vibeOS] footer failed: ${err.message}`)
    }
  }

export { _appendFooter, scoreTaskQuality }
