// @ts-nocheck
/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
 *
 * vibeOS — OpenCode plugin: cost-aware delegation enforcer, trinity tier
 * control, live savings footer, TDD enforcer, flow enforcer, project guard,
 * research audit, reporting, decision engine, context7 optimization, and more.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, statSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import { getFlowWarns, ensureProjectDocs, syncFlowTodosToNative } from "./vibeOS-lib/flow-enforcer.js"
import { computeSessionMetrics } from "./vibeOS-lib/session-metrics.js"
import { createMcpServer, writeDashboardBaseConfig } from "./lib/vibeos-mcp-server.js"
import { isApiConnected, isApiFallback, getBackendVersion, getApiFallbackSince, setApiToken, setApiBootstrapToken, ensureBootstrapExchange, VIBEOS_API_URL } from "./lib/api-client.js"
import { applySlot, modelCostPerTurn, detectContext7, formatUsd, classify, _refreshModel, HIGH_TIER_RE, MID_TIER_RE, PLACEHOLDER_RE, readConfig, getTrinitySlotOrder, loadTrinitySlotsFromTiersFile, buildDeterministicTrinity } from "./lib/pricing.js"
import { scoreStress, detectTechStack, loadBlackboxState, saveBlackboxState, getBlackboxTracker, getBlackboxResolution, saveOptimizationMode, resetBlackboxTracker } from "./lib/turn-classify.js"
import { safeJsonParse, readFullState, loadSelection, writeSelection, readLifetimeSavings, _OC_SID, _modelLocked, _blackboxEnabled, setBlackboxEnabled, _lockedSlot, _lockedModel, setModelLocked, setLockedSlot, setLockedModel, currentTier, currentModel, currentProjectFingerprint, currentProjectName, setCurrentTier, setCurrentModel, setCurrentProjectFingerprint, setCurrentProjectName, setCurrentSessionId, getCurrentSessionId, briefedProjects, _latestBlackboxState, _latestBlackboxLoopMsg, _latestBlackboxPivotMsg, getActiveJobForProject, projectFingerprint, loadProjectState, saveProjectState, ensureProjectBucket, mergeProjectBucket, setVibeOSHomeContext, SAVINGS_LEDGER_FILE, USER_HOME, CREDIT_CACHE_F, pruneScratchpadOnce, registerSessionCleanupHandlers, runStartupMaintenanceOnce, promotedProjectPatterns, projectPatternRows, clearProjectPatterns, loadTodos, getTodos, upsertTodo, markTodoDone, tool } from "./lib/state.js"
import { researchAudit } from "./lib/research-audit.js"
import { buildStatusPayload, buildSavingsPayload, buildSessionCheckout, diagnoseStructuredFromText, projectStructuredFromText } from "./lib/runtime-surface.js"
import { saveReport, listReports, readReport } from "./lib/reporting.js"
import { writeSessionSlot, writeSessionOptMode } from "./lib/selection-manager.js"
import { loadCredit, thinkingLevel, _lazyRefresh, _readAuth } from "./lib/credit-api.js"
import { createTrinityTool } from "./lib/trinity-tool.js"
import { classifyAndRankModels, modelToCcAlias, discoverAvailableModels, probeModel } from "./lib/trinity-rebuild.js"
import { _appendFooter } from "./lib/hooks/footer.js"
import { onToolExecuteBefore, onToolExecuteAfter, setToolDirectory } from "./lib/hooks/tool-execute.js"
import { onMessagesTransform, onSystemTransform, latestUserIntent, ensureProjectSkill } from "./lib/hooks/chat-transform.js"
import { onSessionCompacting } from "./lib/hooks/session-compact.js"
import { onShellEnv, setShellDirectory } from "./lib/hooks/shell-env.js"
import { getOpenCodeHome } from "./lib/state.js"
function getVibeOSHome() {
  return process.env.VIBEOS_HOME || join(process.env.HOME || "", ".claude")
}
function getTiersFile() {
  return join(getVibeOSHome(), "model-tiers.json")
}
function getReportsDir() {
  return join(getVibeOSHome(), "reports")
}
function getReportsIndex() {
  return join(getReportsDir(), "index.json")
}
function getStateFile() {
  return join(getVibeOSHome(), "delegation-state.json")
}
function ensureDeferredBootstrap() {
  if (_deferredBootstrapDone || _modelLocked)
    return
  _deferredBootstrapDone = true
  try {
    _runDeferredStartupBootstrap?.()
  }
  catch { }
}
// ── Remote API client state ──────────────────────────────────────────
let _apiClient = null

let activeJob = null
let fp = ""
let _mcpServerRuntime = null
let _mcpServerHooked = false
let _mcpServerStartupPromise = null
let _mcpServerRestartTimer = null
let _mcpServerShouldRun = false
let _mcpServerClosing = false
let _pluginHooksRuntime = null
let context7Seen = new Set()
let _prevOutputText = ""
let _deferredBootstrapDone = false
let _skillsEnsured = new Set()
let _runDeferredStartupBootstrap = null
const SAVE_EST = {
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
  const projectModel = normalize(readConfig(directory))
  if (projectModel)
    return { model: projectModel, source: "project-config" }
  const home = process.env.HOME || ""
  if (home) {
    const globalModel = normalize(readConfig(getOpenCodeHome()))
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
      const activeJobsPath = join(String(base), ".claude", "active-jobs.json")
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
async function _seedOrRepairModelTiers(directory) {
  const TIERS_FILE = getTiersFile()
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
  let trinity = null
  try {
    trinity = buildDeterministicTrinity(discovered, { selectedModelId: currentModel })
  }
  catch { }
  let brain = trinity?.brain || currentModel || readConfig(directory) || readConfig(getOpenCodeHome()) || process?.env?.OPENCODE_MODEL || ""
  let medium = trinity?.medium || brain
  let cheap = trinity?.cheap || medium || brain
  // DEV ONLY: fallback for dev machine when trinity rebuild has not been run
  if (!brain) {
    brain = "deepseek/deepseek-v4-pro"
    medium = "deepseek/deepseek-v4-flash"
    cheap = "deepseek/deepseek-chat"
    console.error("[vibeOS] no providers detected — using default model tiers (brain=v4-pro, medium=v4-flash, cheap=v4-chat)")
  }
  const existingSelection = existing?.selection && typeof existing.selection === "object" ? existing.selection : {}
  const existingTrinity = existing?.trinity && typeof existing.trinity === "object" ? existing.trinity : {}
  const keepExistingSlot = (slotRow: any, fallbackModel: string) => {
    const currentOc = String(slotRow?.oc || "").trim()
    if (currentOc && !PLACEHOLDER_RE.test(currentOc) && !/placeholder/i.test(currentOc)) {
      return { ...slotRow, cc: slotRow?.cc || modelToCcAlias(currentOc) }
    }
    return { oc: fallbackModel, cc: modelToCcAlias(fallbackModel) }
  }
  const nextTrinity = {
    brain: keepExistingSlot(existingTrinity.brain, brain),
    medium: keepExistingSlot(existingTrinity.medium, medium),
    cheap: keepExistingSlot(existingTrinity.cheap, cheap),
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
      setup_completed_at: existingSelection.setup_completed_at || new Date().toISOString(),
    },
    trinity: nextTrinity,
  }
  mkdirSync(dirname(TIERS_FILE), { recursive: true })
  writeFileSync(TIERS_FILE, JSON.stringify(tiers, null, 2) + "\n", "utf-8")
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
function backupFile(path, label) {
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
      const cfg = tiers?.selection?.mcp_port
      if (cfg === false || cfg === "disabled" || cfg === 0)
        return 0
      const n = Number(cfg)
      if (Number.isFinite(n))
        return n
    }
  }
  catch { }
  return null
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
        _mcpServerRuntime = createMcpServer({
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
              todos: loadTodos(),
              fallbackThinking: thinkingLevel(loadCredit()),
              backendConnected: isApiConnected(),
              backendHealthUrl: `${VIBEOS_API_URL}/health`,
              backendVersion: getBackendVersion(),
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
          getTodos: () => loadTodos(),
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
            return diagnoseStructuredFromText(await trinity.execute({ action: "diagnose" }), loadCredit())
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
            return trinity.execute({ action: rvAction, slot: params.slot, level: params.level })
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
            const tracker = getBlackboxTracker()
            const res = getBlackboxResolution()
            return {
              sub_regime: res?.sub_regime || _latestBlackboxState?.sub_regime || "INIT",
              resolution: res?.resolution || "INIT",
              momentum: res?.momentum ?? 0,
              features: _latestBlackboxState?.features || {},
              signals: _latestBlackboxState?.signals || {},
              loop: {
                active: _latestBlackboxLoopMsg !== null,
                message: _latestBlackboxLoopMsg,
                intervention_level: _latestBlackboxLoopMsg?.intervention_level || _latestBlackboxState?.loop?.intervention_level || 0,
                consecutive_loops: _latestBlackboxState?.loop?.consecutive_loops || 0,
              },
              pivot: {
                detected: _latestBlackboxPivotMsg !== null,
                message: _latestBlackboxPivotMsg,
              },
              continuity_state: _latestBlackboxState?.continuity_state || null,
              turn_index: _latestBlackboxState?.turn_index ?? 0,
              stress_level: _latestBlackboxState?.stress_level ?? 0,
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
        })
      }
      const requestedPort = port == null ? 0 : port
      const mcpServer = await _mcpServerRuntime.start(requestedPort)
      const actualPort = Number(mcpServer?.address?.()?.port || requestedPort)
      if (actualPort && actualPort !== requestedPort)
        persistMcpPort(actualPort)
      writeDashboardBaseConfig(process.env.VIBEOS_DASHBOARD_BASE_URL?.trim() || "")
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
  const hookHome = process.env.HOME || USER_HOME
  const hookFp = projectFingerprint(directory || "")
  if (!globalThis.__vibeOS_sessionId) {
    globalThis.__vibeOS_sessionId = `opencode-${process.pid || "x"}-${Date.now()}`
  }
  const hookSessionId = globalThis.__vibeOS_sessionId
  setVibeOSHomeContext(join(hookHome, ".claude"))
  setCurrentSessionId(hookSessionId)
  if (hookFp) {
    setCurrentProjectFingerprint(hookFp)
    setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
  }
  if (typeof setToolDirectory === "function")
    setToolDirectory(directory || "")
  if (typeof setShellDirectory === "function")
    setShellDirectory(directory || "")
  registerSessionCleanupHandlers()
  pruneScratchpadOnce()
  runStartupMaintenanceOnce()
  // Detect model: project opencode.json → OpenCode API → global ~/.config/opencode/opencode.json → env.
  const _bootstrapModel = await _resolveBootstrapModel(client, directory)
  if (_bootstrapModel.model) {
    setCurrentModel(_bootstrapModel.model)
    setCurrentTier(classify(_bootstrapModel.model))
  }
  if (currentModel) {
    setCurrentTier(classify(currentModel))
    try {
      const _tiersData = safeJsonParse(readFileSync(getTiersFile(), "utf-8"))
      const _slotOrder = getTrinitySlotOrder(_tiersData)
      const _primarySlot = _slotOrder[0] || "brain"
      const _activeSlot = _tiersData?.selection?.active_slot || _primarySlot
      if (_activeSlot === _primarySlot) {
        const _brainOcModel = _tiersData?.trinity?.[_primarySlot]?.oc || ""
        if (_brainOcModel && currentModel === _brainOcModel && !PLACEHOLDER_RE.test(_brainOcModel)) {
          const cost = modelCostPerTurn(_brainOcModel)
          if (HIGH_TIER_RE.test(_brainOcModel) || (cost !== null && cost >= 0.01)) {
            setCurrentTier("high")
            console.error(`[vibeOS] tier override → high (primary slot)`)
          }
        }
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
  const hookVibeHome = join(hookHome, ".claude")
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
    _latestBlackboxState,
    currentModel, currentTier, currentProjectFingerprint, currentProjectName,
    get latestUserIntent() { return latestUserIntent }, directory,
    safeJsonParse, readFileSync, writeFileSync, existsSync, renameSync, mkdirSync,
    get TIERS_FILE() { return hookTiersFile }, USER_HOME, get STATE_FILE() { return hookStateFile }, CREDIT_CACHE_F,
    SAVINGS_LEDGER_FILE, PROJECT_STATE_FILE: hookProjectStateFile, get REPORTS_DIR() { return hookReportsDir }, get REPORTS_INDEX() { return hookReportsIndex },
    get OPENCODE_HOME() { return getOpenCodeHome() }, get VIBEOS_HOME() { return hookVibeHome },
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
    setApiToken,
    setApiBootstrapToken,
    ensureBootstrapExchange,
    loadTodos, upsertTodo, getTodos, markTodoDone, syncFlowTodosToNative,
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
        catch (_e) { }
      }
      onToolExecuteBefore._directory = directory
      return onToolExecuteBefore(input, output)
    },
    "tool.execute.after": async (input, output) => {
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      onToolExecuteAfter._directory = directory
      return onToolExecuteAfter(input, output)
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      ensureDeferredBootstrap()
      return onMessagesTransform(_input, output)
    },
    "experimental.session.compacting": async (_input, output) => {
      return onSessionCompacting(_input, output)
    },
    "experimental.chat.system.transform": async (_input, output) => {
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
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      ensureDeferredBootstrap()
      await _appendFooter(_input, output, directory)
    },
    "message.updated": async (_input, output) => {
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      ensureDeferredBootstrap()
      await _appendFooter(_input, output, directory)
    },
    tool: {
      trinity: tool(createTrinityTool(trinityDeps)),
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
export const id = "vibeOS"
export const server = DelegationEnforcer
export const VERSION = readPackageVersion()
export default { id: "vibeOS", server: DelegationEnforcer }
export { researchAudit } from "./lib/research-audit.js"
export { saveReport, listReports, readReport } from "./lib/reporting.js"
export { applySlot, modelCostPerTurn, isModelFree, isDocsTarget, detectContext7, loadTierRegexes, classify, _refreshModel, HIGH_TIER_RE, MID_TIER_RE, PLACEHOLDER_RE, TRINITY_BRAIN, TRINITY_MEDIUM, TRINITY_CHEAP, setTrinityBrain, setTrinityMedium, setTrinityCheap, trendDisplay } from "./lib/pricing.js"
export { getScratchpadHit, getSessionScratchpadDir, getSessionIndexPath, setCurrentModel, setCurrentTier, setCurrentSessionId, setCurrentProjectFingerprint, setCurrentProjectName, getCurrentSessionId } from "./lib/state.js"
export { extractExports, buildTestSkeleton, enforceTestFile, buildTestReminder } from "./lib/tdd-enforcer.js"
export { classifyAndRankModels, modelToCcAlias } from "./lib/trinity-rebuild.js"
export { scoreStress, detectTechStack, loadBlackboxState, saveBlackboxState, getBlackboxResolution } from "./lib/turn-classify.js"
export { loadMcpPort as _loadMcpPort }
export { remoteCall } from "./lib/api-client.js"
export { observeToolPattern, noteProjectPattern, recordSaving, compressText } from "./lib/index-helpers.js"
export function closeMcpServer() {
  try {
    _mcpServerClosing = true
    _mcpServerShouldRun = false
    clearMcpRestartTimer()
    if (_mcpServerRuntime) {
      _mcpServerRuntime.close()
      _mcpServerRuntime = null
    }
  }
  catch { }
}
