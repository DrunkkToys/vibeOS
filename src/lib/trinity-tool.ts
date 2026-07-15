// @ts-nocheck

import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { execFileSync, execSync } from "node:child_process"
import { createHash } from "node:crypto"
import { LABEL_MODES, buildDeterministicTrinity, resolveCurrentExecution, resolveExecutionIdentity } from "./pricing.js"
import { BRANDED_MODES, RUNTIME_MODES, RAW_MODE, MODE_TABLE, normalizeLegacyMode, resolveCascadeSlot } from "./cascade.js"
import { getBackendVersion, invalidateApiToken, isApiConnected } from "./api-client.js"
import { getRealityCheckView } from "../vibeOS-lib/flow-enforcer.js"
import { getSessionHealthSnapshot } from "./session-health.js"
import { getVibeOSHome } from "./state.js"
import { resolveDashboardBaseUrlFromState } from "./dashboard-base-url.js"
import { collectOpenCodeConfigPaths, installVibeTierAgents, isNativeOpenCodeAgent, normalizeNativeOpenCodeAgent, VIBE_PRIMARY_AGENT } from "./runtime-config.js"
import { getSessionSavingsDiagnostics } from "./session-savings.js"
import { loadAxisOverrides, writeAxisOverride, clearAxisOverrides } from "./selection-manager.js"

// ── Named constants (magic number extraction) ────────────────────────
const MIN_TOOL_BREAKDOWN_THRESHOLD = 0.005
const STRESS_GAUGE_CRITICAL = 0.85
const STRESS_GAUGE_HIGH = 0.7
const STRESS_GAUGE_ELEVATED = 0.5
const STRESS_GAUGE_CALM = 0.3
const STRESS_GAUGE_MIN = 0.1
const MOMENTUM_SIGNIFICANT_THRESHOLD = 0.3
const DIAGNOSE_BUDGET_LINES = 50
const CREDIT_MIN_OK = 40
const VIBEULTRAX_ROOT = ["cheap", "medium", "brain"]

function isByteStringSafeModelId(modelId): boolean {
  const raw = String(modelId || "")
  for (const ch of raw) {
    if ((ch.codePointAt(0) || 0) > 255) return false
  }
  return true
}

function sameJson(a, b): boolean {
  try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
}

function normalizeSlotName(value): string {
  const v = String(value || "").trim().toLowerCase()
  return ["cheap", "medium", "brain"].includes(v) ? v : ""
}

function normalizeVibeUltraXControl(control): boolean {
  if (!control || typeof control !== "object") return false
  const mode = String(control.optimization_mode || control.mode_root || control.requested_mode || "").toLowerCase()
  if (mode !== "vibeultrax") return false
  let changed = false
  const previousPipeline = Array.isArray(control.pipeline_root) ? control.pipeline_root.filter(Boolean) : []
  if (!Array.isArray(control.route_path) || control.route_path.length === 0) {
    control.route_path = previousPipeline.length ? previousPipeline : ["cheap"]
    changed = true
  }
  if (!sameJson(control.cascade_root, VIBEULTRAX_ROOT)) {
    control.cascade_root = VIBEULTRAX_ROOT
    changed = true
  }
  if (!sameJson(control.pipeline_root, VIBEULTRAX_ROOT)) {
    control.pipeline_root = VIBEULTRAX_ROOT
    changed = true
  }
  if (control.tier_bias !== "cheap") {
    control.tier_bias = "cheap"
    changed = true
  }
  if (!normalizeSlotName(control.selected_slot)) {
    const route = Array.isArray(control.route_path) && control.route_path.length ? control.route_path : ["cheap"]
    control.selected_slot = normalizeSlotName(route[route.length - 1]) || "cheap"
    changed = true
  }
  const depth = Array.isArray(control.route_path) && control.route_path.length ? control.route_path.length : 1
  if (control.cascade_depth !== depth) {
    control.cascade_depth = depth
    changed = true
  }
  return changed
}

function normalizeVibeUltraXBlackboxState(state): boolean {
  if (!state || typeof state !== "object") return false
  let changed = false
  for (const key of ["cv", "control_vector", "live_control"]) {
    if (normalizeVibeUltraXControl(state[key])) changed = true
  }
  const sessions = state.sessions && typeof state.sessions === "object" ? state.sessions : null
  if (!sessions) return changed
  for (const session of Object.values(sessions)) {
    if (!session || typeof session !== "object") continue
    for (const key of ["cv", "control_vector", "live_control"]) {
      if (normalizeVibeUltraXControl(session[key])) changed = true
    }
  }
  return changed
}

function previewVibeUltraXRepair(deps) {
  const changes = []
  const tiersPath = deps.TIERS_FILE
  try {
    const tiers = deps.safeJsonParse(deps.readFileSync(tiersPath, "utf-8")) || {}
    const sel = tiers.selection || {}
    const mode = String(sel.optimization_mode || sel.requested_optimization_mode || "").toLowerCase()
    if (mode === "vibeultrax") {
      if (!sameJson(sel.active_pipeline, VIBEULTRAX_ROOT)) changes.push({ file: tiersPath, field: "selection.active_pipeline", from: sel.active_pipeline, to: VIBEULTRAX_ROOT })
      if (!sameJson(sel.vector_changed_pipeline, VIBEULTRAX_ROOT)) changes.push({ file: tiersPath, field: "selection.vector_changed_pipeline", from: sel.vector_changed_pipeline, to: VIBEULTRAX_ROOT })
      if (sel.active_slot !== "cheap") changes.push({ file: tiersPath, field: "selection.active_slot", from: sel.active_slot, to: "cheap" })
    }
  } catch {}
  const blackboxPath = join(deps.VIBEOS_HOME || getVibeOSHome(), "blackbox-state.json")
  try {
    const blackbox = deps.safeJsonParse(deps.readFileSync(blackboxPath, "utf-8")) || {}
    const before = JSON.stringify(blackbox)
    normalizeVibeUltraXBlackboxState(blackbox)
    if (before !== JSON.stringify(blackbox)) changes.push({ file: blackboxPath, field: "vibeultrax control vectors", from: "stale", to: "normalized" })
  } catch {}
  return changes
}

function applyVibeUltraXRepair(deps) {
  const changes = previewVibeUltraXRepair(deps)
  const touched = new Set(changes.map((c) => c.file))
  const backups = []
  for (const file of touched) {
    const b = deps.backupFile?.(file, "vibeultrax-repair")
    if (b) backups.push(b)
  }
  if (changes.some((c) => c.file === deps.TIERS_FILE)) {
    const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8")) || {}
    tiers.selection ??= {}
    tiers.selection.active_pipeline = VIBEULTRAX_ROOT
    tiers.selection.vector_changed_pipeline = VIBEULTRAX_ROOT
    tiers.selection.active_slot = "cheap"
    deps.writeFileSync(deps.TIERS_FILE, JSON.stringify(tiers, null, 2) + "\n")
  }
  const blackboxPath = join(deps.VIBEOS_HOME || getVibeOSHome(), "blackbox-state.json")
  if (changes.some((c) => c.file === blackboxPath)) {
    const blackbox = deps.safeJsonParse(deps.readFileSync(blackboxPath, "utf-8")) || {}
    normalizeVibeUltraXBlackboxState(blackbox)
    deps.writeFileSync(blackboxPath, JSON.stringify(blackbox, null, 2) + "\n")
  }
  return { changes, backups }
}

function sha256File(path): string {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12)
  } catch {
    return ""
  }
}

function detectOpenCodeProcessState() {
  try {
    const output = execFileSync("ps", ["-axo", "pid,etime,%cpu,command"], { encoding: "utf8", timeout: 1000 })
    const lines = output.split("\n").filter((line) => /(^|\s)opencode(\s|$)|OpenCode\.app/i.test(line))
    const stale = lines.filter((line) => /\d+-\d\d:\d\d:\d\d|\d\d:\d\d:\d\d/.test(line) && !/Codex\.app/.test(line))
    return { count: lines.length, stale: stale.slice(0, 3) }
  } catch {
    return { count: 0, stale: [] }
  }
}

function readJsonFile(deps, path) {
  try { return deps.safeJsonParse(deps.readFileSync(path, "utf-8")) || null } catch { return null }
}

function collectDiagnoseOpenCodeConfigPaths(deps) {
  const base = process.env.HOME || ""
  const candidates = [
    ...collectOpenCodeConfigPaths(deps.directory || ""),
    base ? join(base, ".config", "opencode", "opencode.json") : "",
    base ? join(base, ".local", "share", "opencode", "opencode.json") : "",
  ]
  const seen = new Set()
  return candidates.filter((path) => {
    const key = String(path || "").trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function resolveLoadedPluginPath(deps) {
  const candidates = []
  const ocConfigPaths = collectDiagnoseOpenCodeConfigPaths(deps)
  for (const configPath of ocConfigPaths) {
    const oc = readJsonFile(deps, configPath)
    const plugins = Array.isArray(oc?.plugin) ? oc.plugin : []
    for (const entry of plugins) {
      if (String(entry || "").includes("vibeOS")) candidates.push(String(entry))
    }
  }
  candidates.push(join(deps.OPENCODE_HOME, "plugins", "vibeOS.js"))
  if (deps.directory) candidates.push(join(deps.directory, "plugins", "vibeOS.js"))
  return candidates.find((p) => p && deps.existsSync(p)) || candidates[0] || ""
}

// Translates a `vibe axis <name> <value>` pin into the underlying selection
// keys it governs, and writes them immediately. Without this, the override
// only ever gets stored -- nothing reads axis_overrides directly at
// enforcement/flow/TDD/thinking decision time, so the command silently did
// nothing beyond echoing the value back on `axis status`.
function applyAxisOverrideNow(axisName, value, deps) {
  const v = String(value || "").toLowerCase()
  const truthy = v === "on" || v === "strict" || v === "required"
  if (axisName === "enforcement") {
    deps.writeSelection("delegation_enforce", truthy)
  } else if (axisName === "flow") {
    if (v === "audit") {
      deps.writeSelection("flow_enabled", true)
      deps.writeSelection("flow_enforce", false)
    } else if (truthy) {
      deps.writeSelection("flow_enabled", true)
      deps.writeSelection("flow_enforce", true)
    } else {
      deps.writeSelection("flow_enabled", false)
      deps.writeSelection("flow_enforce", false)
    }
  } else if (axisName === "tdd") {
    const quality = v === "quality"
    if (truthy || quality) {
      deps.writeSelection("tdd_enforce", true)
      deps.writeSelection("tdd_strict", true)
      deps.writeSelection("tdd_quality", quality)
    } else {
      deps.writeSelection("tdd_enforce", false)
      deps.writeSelection("tdd_strict", false)
      deps.writeSelection("tdd_quality", false)
    }
  } else if (axisName === "thinking") {
    if (v === "full" || v === "brief" || v === "off") deps.writeSelection("thinking_level", v)
  }
}

function countStaleActiveJobs(deps) {
  const path = join(deps.VIBEOS_HOME || getVibeOSHome(), "active-jobs.json")
  const jobs = readJsonFile(deps, path)
  if (!jobs || typeof jobs !== "object") return { path, count: 0 }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  let count = 0
  for (const job of Object.values(jobs)) {
    if (!job || typeof job !== "object") continue
    const ts = Date.parse(job.updatedAt || job.createdAt || "")
    if (job.status === "active" && (!Number.isFinite(ts) || ts < cutoff)) count++
  }
  return { path, count }
}

function cascadeDiagnosticResults(deps) {
  const results = []
  const tiers = readJsonFile(deps, deps.TIERS_FILE) || {}
  const sel = tiers.selection || {}
  const ocConfigPaths = collectOpenCodeConfigPaths(deps.directory || "")
  const existingOcConfigs = ocConfigPaths.filter((p) => p && deps.existsSync(p))
  const primaryOcConfigPath = existingOcConfigs[0] || ocConfigPaths[0]
  const primaryOc = readJsonFile(deps, primaryOcConfigPath) || {}
  const blackboxPath = join(deps.VIBEOS_HOME || getVibeOSHome(), "blackbox-state.json")
  const blackbox = readJsonFile(deps, blackboxPath) || {}
  const cv = blackbox.cv || {}
  const sid = deps._OC_SID || ""
  const sessionCv = sid && blackbox.sessions?.[sid]?.cv ? blackbox.sessions[sid].cv : null
  const pluginPath = resolveLoadedPluginPath(deps)
  const activeJobs = countStaleActiveJobs(deps)
  const proc = detectOpenCodeProcessState()
  const repair = previewVibeUltraXRepair(deps)
  const liveModel = String(primaryOc.model || "").trim()
  const cheapModel = String(tiers?.trinity?.cheap?.oc || "").trim()
  const optimizationMode = String(sel.optimization_mode || "").toLowerCase()
  const entrySlot = String(sel.entry_slot || sel.active_slot || "").toLowerCase()
  const workerSlot = String(sel.worker_slot || sel.selected_slot || "").toLowerCase()
  const cheapFirstExpected = optimizationMode === "vibeultrax" && entrySlot === "cheap" && !!cheapModel
  const cheapFirstDegraded = sel.cheap_first_degraded === true
  const cheapFirstOk = !cheapFirstExpected || liveModel === cheapModel || cheapFirstDegraded
  results.push({ ok: true, okLabel: "OK", label: "cascade vibeos_home", detail: deps.VIBEOS_HOME || getVibeOSHome() })
  results.push({ ok: !!pluginPath && deps.existsSync(pluginPath), okLabel: pluginPath && deps.existsSync(pluginPath) ? "OK" : "WARN", label: "cascade plugin", detail: pluginPath ? `${pluginPath}${sha256File(pluginPath) ? ` sha256:${sha256File(pluginPath)}` : ""}` : "not found" })
  results.push({ ok: sameJson(sel.active_pipeline, VIBEULTRAX_ROOT), okLabel: sameJson(sel.active_pipeline, VIBEULTRAX_ROOT) ? "OK" : "WARN", label: "cascade active_pipeline", detail: JSON.stringify(sel.active_pipeline || null), fix: "run `vibe repair-state apply`" })
  results.push({ ok: !sel.vector_changed_pipeline || sameJson(sel.vector_changed_pipeline, VIBEULTRAX_ROOT), okLabel: !sel.vector_changed_pipeline || sameJson(sel.vector_changed_pipeline, VIBEULTRAX_ROOT) ? "OK" : "WARN", label: "cascade vector_changed_pipeline", detail: JSON.stringify(sel.vector_changed_pipeline || null), fix: "run `vibe repair-state apply`" })
  results.push({ ok: sameJson(cv.cascade_root, VIBEULTRAX_ROOT), okLabel: sameJson(cv.cascade_root, VIBEULTRAX_ROOT) ? "OK" : "WARN", label: "cascade root cv", detail: JSON.stringify({ cascade_root: cv.cascade_root || null, route_path: cv.route_path || null, selected_slot: cv.selected_slot || null }), fix: "run `vibe repair-state apply`" })
  results.push({ ok: !!sessionCv || !sid, okLabel: !!sessionCv || !sid ? "OK" : "WARN", label: "cascade session cv", detail: sessionCv ? JSON.stringify({ cascade_root: sessionCv.cascade_root || null, route_path: sessionCv.route_path || null, selected_slot: sessionCv.selected_slot || null }) : (sid ? `missing for ${sid}` : "no session id") })
  results.push({ ok: existingOcConfigs.length > 0, okLabel: existingOcConfigs.length > 0 ? "OK" : "WARN", label: "cascade opencode configs", detail: existingOcConfigs.length ? existingOcConfigs.join(" | ") : "none found", fix: "run `vibe setup --project` or `npm run deploy`" })
  const primaryAgent = primaryOc.agent && typeof primaryOc.agent === "object" ? primaryOc.agent[VIBE_PRIMARY_AGENT] || null : null
  const resolvedDefaultAgent = normalizeNativeOpenCodeAgent(primaryOc.default_agent, "vibe")
  const primaryAgentOk = !!primaryAgent && primaryAgent.mode === "primary" && !String(primaryAgent.model || "").trim()
  results.push({ ok: primaryAgentOk, okLabel: primaryAgentOk ? "OK" : "WARN", label: "cascade vibe", detail: primaryAgent ? `${primaryOcConfigPath} ${JSON.stringify({ mode: primaryAgent.mode || null, model: primaryAgent.model || null, default_agent: resolvedDefaultAgent, expected: "primary vibe agent present" })}` : `missing in ${primaryOcConfigPath}`, fix: "run `vibe repair-state apply` or start a new VibeUltraX turn" })
  const defaultAgentOk = isNativeOpenCodeAgent(primaryOc.default_agent)
  results.push({ ok: defaultAgentOk, okLabel: defaultAgentOk ? "OK" : "WARN", label: "cascade default_agent", detail: JSON.stringify({ default_agent: resolvedDefaultAgent, expected: "build|plan|vibe", active_slot: sel.active_slot || null }), fix: "run `vibe repair-state apply` or start a new VibeUltraX turn" })
  results.push({
    ok: cheapFirstOk,
    okLabel: cheapFirstOk ? "OK" : "WARN",
    label: "cascade cheap-first primary",
    detail: JSON.stringify({
      optimization_mode: optimizationMode || null,
      entry_slot: entrySlot || null,
      worker_slot: workerSlot || null,
      live_model: liveModel || null,
      expected_cheap_model: cheapModel || null,
      degraded: cheapFirstDegraded,
      degraded_reason: sel.cheap_first_reason || null,
    }),
    fix: "ensure VibeUltraX starts on cheap, keep tiers same-provider for primary override, or use the delegated worker path when cross-provider",
  })
  for (const [slot, name] of [["cheap", "vibe-cheap"], ["medium", "vibe-medium"], ["brain", "vibe-brain"]]) {
    const model = tiers.trinity?.[slot]?.oc || ""
    for (const ocConfigPath of existingOcConfigs.length ? existingOcConfigs : [primaryOcConfigPath]) {
      const oc = readJsonFile(deps, ocConfigPath) || {}
      const agents = oc.agent && typeof oc.agent === "object" ? oc.agent : {}
      const agent = agents[name] || null
      const ok = !!agent && agent.mode === "subagent" && agent.model === model
      results.push({ ok, okLabel: ok ? "OK" : "WARN", label: `cascade ${name}`, detail: agent ? `${ocConfigPath} ${JSON.stringify({ mode: agent.mode || null, model: agent.model || null, expected: model || null })}` : `missing in ${ocConfigPath}`, fix: "run a VibeUltraX turn or `vibe repair-state apply` after rebuild" })
    }
  }
  results.push({ ok: activeJobs.count === 0, okLabel: activeJobs.count === 0 ? "OK" : "WARN", label: "cascade stale active jobs", detail: `${activeJobs.count} in ${activeJobs.path}` })
  results.push({ ok: proc.stale.length === 0, okLabel: proc.stale.length === 0 ? "OK" : "WARN", label: "cascade opencode processes", detail: `${proc.count} found${proc.stale.length ? `; stale: ${proc.stale.join(" | ")}` : ""}` })
  results.push({ ok: repair.length === 0, okLabel: repair.length === 0 ? "OK" : "WARN", label: "cascade repair candidates", detail: String(repair.length), fix: repair.length ? "run `vibe repair-state apply`" : null })
  return results
}

export async function resolveDashboardBaseUrl(deps): Promise<string> {
  const fromMemory = resolveDashboardBaseUrlFromState({ dashboardBaseUrl: deps.dashboardBaseUrl })
  if (fromMemory) return fromMemory
  if (typeof deps.loadPublishedMcpBaseUrl === "function") {
    try {
      const published = resolveDashboardBaseUrlFromState({ publishedMcpBaseUrl: await deps.loadPublishedMcpBaseUrl() })
      if (published) return published
    } catch {}
  }
  if (typeof deps.ensureMcpServerRunning === "function") {
    try {
      await deps.ensureMcpServerRunning()
    } catch {}
  }
  const afterStartup = resolveDashboardBaseUrlFromState({ dashboardBaseUrl: deps.dashboardBaseUrl })
  if (afterStartup) return afterStartup
  if (typeof deps._loadMcpPort === "function") {
    return resolveDashboardBaseUrlFromState({ mcpPort: Number(deps._loadMcpPort()) })
  }
  return ""
}

export function createTrinityTool(deps) {
  return {
    description:
      "Control the vibeOS plugin and active model slot. " +
      "Use action='status' to see the current state. " +
      "Use action='enable' or 'disable' to toggle the plugin immediately. " +
      "Use action='set' with slot='brain'|'medium'|'cheap' to switch model tiers (applied per turn via the chat.params override and subagent delegation; never rewrites the watched opencode.json). Optionally pass model='<model_id>' to set a custom model for that slot. " +
      "Use action='mode' with slot='vibeultrax'|'vibeqmax'|'vibemax'|'budget'|'quality'|'speed'|'longrun'|'auto'|'balanced'|'audit'|'forensic' to switch optimization mode. " +
      "Use action='thinking' with level='full'|'brief'|'off'. " +
      "Use action='rebuild' to detect available models from configured providers and reassign brain/medium/cheap slots. " +
      "Use action='flow' with slot='on'|'off' to toggle flow enforcer, or action='flow' alone for audit. " +
      "Use action='flow' with slot='enforce' and level='on'|'off' to toggle auto-extract TODOs. " +
      "Use action='enforce' with slot='on'|'off' to toggle delegation enforcement. " +
      "Use action='tdd' with slot='on'|'off' to toggle auto-create test skeletons. " +
      "Use action='tdd' with slot='strict' and level='on'|'off' to toggle strict failing TODO test templates. " +
      "Use action='tdd' alone for audit. " +
      "Use action='setup' to create a compatibility profile for first-time users. " +
      "Use action='project' to show per-project analytics and optimization suggestions. " +
      "Use action='patterns' to inspect learned project patterns or slot='clear' to clear them. " +
      "Use action='dashboard' or 'gui' to print the live dashboard URL and stable browser entrypoint. " +
      "Use action='guard' to keep AGENTS.md and README.md current. " +
      "Use action='reality-check' to read verified live state and report only evidence-backed facts. " +
      "Use action='api-token' with token='<new_token>' to update the API token or token='invalidate' to disable the embedded alpha token. " +
      "Use action='api-bootstrap-token' with token='<new_token>' to store an alpha bootstrap token and exchange it for a normal API token on alpha builds. " +
      "Call this when the user says things like 'switch to medium', 'use cheap model', 'disable plugin', 'vibe status' (or the legacy 'trinity status').",
    args: {
      action: deps.tool.schema.enum(["status", "enable", "disable", "set", "mode", "thinking", "flow", "tdd", "setup", "project", "patterns", "dashboard", "gui", "rebuild", "diagnose", "help", "enforce", "repair-state", "blackbox", "report", "guard", "reality-check", "api-token", "api-bootstrap-token", "verify-claims", "todo", "todo-done", "todo-sync", "axis", "lock"]).optional(),
      slot: deps.tool.schema.enum(["brain", "medium", "cheap", "budget", "quality", "speed", "longrun", "auto", "balanced", "audit", "forensic", "vibeultrax", "vibeqmax", "vibemax", "vibelitex", "raw", "on", "off", "enforce", "strict", "preview", "apply", "clear", "savings", "cascade", "enforcement", "flow", "tdd", "tier", "thinking", "context7_urgency", "wbp_verbosity", "websearch", "reset"]).optional(),
      level: deps.tool.schema.enum(["full", "brief", "off", "on"]).optional(),
      model: deps.tool.schema.string().optional(),
      token: deps.tool.schema.string().optional(),
    },
    async execute({ action, slot, level, model, token }: { action?: string; slot?: string; level?: string; model?: string; token?: string } = {}) {
      if (typeof deps._lazyRefresh === "function") deps._lazyRefresh()
      if (!action) action = "status"
      if (["brain", "medium", "cheap"].includes(action)) { slot = action; action = "set" }
      if (action === "gui") action = "dashboard"
      const keepExistingTrinitySlot = (existingSlot: unknown, nextModel: string) => {
        const currentOc = String(existingSlot?.oc || "").trim()
        if (currentOc && !/placeholder/i.test(currentOc) && !/^[^/]+\/[a-z-]+-model$/i.test(currentOc)) {
          return { ...existingSlot, cc: existingSlot?.cc || deps.modelToCcAlias(currentOc) }
        }
        return { oc: nextModel, cc: deps.modelToCcAlias(nextModel) }
      }
      const _brandedModeIds = ["vibeultrax", "vibeqmax", "vibemax", "vibelitex"]
      const _builtInModeIds = ["budget", "quality", "speed", "longrun", "auto", "balanced", "audit", "forensic"]
      if (!action || action === "status") {
        if (slot && (_brandedModeIds.includes(slot) || _builtInModeIds.includes(slot))) { action = "mode" }
        else if (["brain", "medium", "cheap"].includes(slot)) { action = "set" }
        else if (["full", "brief", "off"].includes(slot)) { action = "thinking"; level = slot; slot = undefined }
      } else if (_brandedModeIds.includes(action) || _builtInModeIds.includes(action)) { slot = action; action = "mode" }
      else if (["full", "brief", "off"].includes(action)) { level = action; action = "thinking" }
      else if (["on", "off"].includes(action) && !slot) { slot = action }
      if (action === "dashboard") {
        const dashboardBase = await resolveDashboardBaseUrl(deps)
        if (!dashboardBase) {
          return [
            "[vibeOS-dashboard]",
            "Dashboard URL is not ready yet.",
            "Start or reopen vibeOS so the MCP server can publish the live dashboard URL.",
            "Then run `vibe dashboard` again.",
          ].join("\n")
        }
        return [
          "[vibeOS-dashboard]",
          `Dashboard: ${dashboardBase}/`,
          `Home: ${dashboardBase}/dashboard/home`,
          `Sessions: ${dashboardBase}/sessions`,
          `Templates: ${dashboardBase}/templates`,
          "This URL comes from the running MCP server, so it stays stable across refreshes.",
        ].join("\n")
      }
      if (action === "status") {
        const sel = deps.loadSelection()
        let tiers = {}
        try { tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8")).trinity || {} } catch {}
        let cheapModel = "(unset)"
        const credit = deps.loadCredit()
        const effectiveLevel = sel.thinking_level || deps.thinkingLevel(credit)

        const apiFallbackActive = typeof deps.isApiFallback === "function" ? deps.isApiFallback() : false
        const activeSlot = sel.active_slot || "brain"
        const activeSlotModel = tiers?.[activeSlot]?.oc || ""
        if (deps.currentModel && activeSlotModel && deps.currentModel !== activeSlotModel && !apiFallbackActive && !deps._modelLocked) {
          try {
            const providers = typeof deps._loadOpenCodeProviders === "function"
              ? deps._loadOpenCodeProviders(deps.directory)
              : {}
            const auth = deps._readAuth()
            const models = await deps.discoverAvailableModels(providers, auth)
            const trinity = buildDeterministicTrinity(models, {
              selectedModelId: deps.currentModel,
            })
            if (trinity && trinity.brain) {
              const probed = {
                brain: models.find(m => m.id === trinity.brain) || { id: trinity.brain, cost: deps._modelCost(trinity.brain), tier: deps._modelTier(trinity.brain) },
                medium: models.find(m => m.id === trinity.medium) || { id: trinity.medium, cost: deps._modelCost(trinity.medium), tier: deps._modelTier(trinity.medium) },
                cheap: models.find(m => m.id === trinity.cheap) || { id: trinity.cheap, cost: deps._modelCost(trinity.cheap), tier: deps._modelTier(trinity.cheap) },
              }
              const tiersData = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"))
              const oldTiers = tiersData.trinity || {}
              tiersData.trinity ??= {}
              const slots = ["brain", "medium", "cheap"] as const
              for (const s of slots) {
                const autoModel = probed[s].id
                tiersData.trinity[s] = keepExistingTrinitySlot(oldTiers[s], autoModel)
              }
              const _tmp = deps.TIERS_FILE + ".tmp." + Date.now()
              deps.writeFileSync(_tmp, JSON.stringify(tiersData, null, 2) + "\n", "utf-8")
              deps.renameSync(_tmp, deps.TIERS_FILE)
              tiers = tiersData.trinity
            }
          } catch (e) { console.error("[vibeOS] auto-rebuild on model change failed:", e.message) }
        }

        const sv = deps.readLifetimeSavings()
        const ltTotal = (sv.ltTasks || 0) + (sv.ltCache || 0)
        const _sesTasks = sv.sesTasks || 0
        const _sesCache = Number(deps.readFullState()?.sessions?.[deps._OC_SID]?.cache_savings_usd || 0)
        const sesWarns = Array.isArray(deps.readFullState()?.sessions?.[deps._OC_SID]?.warns) ? deps.readFullState().sessions[deps._OC_SID].warns.length : 0
        const sesTrend = sv.sesTrend || "stable"
        const sesRate = sv.sesRatePerHour || 0
        const missedC7 = sv.missedC7 || 0
        const toolBreakdown = sv.sesToolBreakdown || {}
        const topTools = Object.entries(toolBreakdown).filter(([, v]) => v > MIN_TOOL_BREAKDOWN_THRESHOLD).sort((a, b) => b[1] - a[1]).slice(0, 5)

        const brainModel = tiers?.brain?.oc || "(unset)"
        const mediumModel = tiers?.medium?.oc || "(unset)"
        cheapModel = tiers?.cheap?.oc || cheapModel
        const lockedSlot = deps._lockedSlot || null
        const lockedModel = deps._lockedModel || null
        const onboardingMode = sel.onboarding_mode || "strict"
        const currentProjectFingerprint = deps.currentProjectFingerprint || (typeof deps.projectFingerprint === "function" ? deps.projectFingerprint(deps.directory || "") : "")
        const reality = getRealityCheckView(currentProjectFingerprint)

        const stressScore = deps.latestUserIntent ? deps.scoreStress(deps.latestUserIntent) : 0
        const stressBar = stressScore > STRESS_GAUGE_CRITICAL ? "█" : stressScore > STRESS_GAUGE_HIGH ? "▆" : stressScore > STRESS_GAUGE_ELEVATED ? "▅" : stressScore > STRESS_GAUGE_CALM ? "▃" : stressScore > STRESS_GAUGE_MIN ? "▂" : "▁"
        const stressLabel = stressScore > STRESS_GAUGE_HIGH ? "high" : stressScore > 0.4 ? "elevated" : stressScore > STRESS_GAUGE_MIN ? "calm" : "none"

        const totalTurns = (sv.sesModelTurns?.brain || 0) + (sv.sesModelTurns?.worker || 0)
        const brainPct = totalTurns > 0 ? Math.round((sv.sesModelTurns.brain / totalTurns) * 100) : 0
        const workerPct = 100 - brainPct
        const qualityAvg = sv.quality_avg || 0
        const sesDuration = sv.sesDuration || 0
        const durHrs = Math.floor(sesDuration / 3600)
        const durMins = Math.floor((sesDuration % 3600) / 60)

        let decisionLine = ""
        if (deps._blackboxEnabled) {
          try {
            const res = deps.getLatestBlackboxState?.() || deps.getBlackboxResolution()
            if (res && res.n_interactions > 3) {
              const momentumIcon = res.momentum > MOMENTUM_SIGNIFICANT_THRESHOLD ? "↗" : res.momentum > 0 ? "↑" : res.momentum < -MOMENTUM_SIGNIFICANT_THRESHOLD ? "↘" : res.momentum < 0 ? "↓" : "→"
              const loopTag = res.is_looping ? " (loop)" : ""
              decisionLine = `${res.resolution} ${res.sub_regime} ${momentumIcon}${loopTag}`
            }
          } catch {}
        }

        const execution = resolveCurrentExecution({
          directory: deps.directory,
          activeSlot,
          currentModel: deps.currentModel || "",
          tiersData: tiers,
        })
        const lines = [
          `[vibeOS-dashboard]`,
          `Model: ${activeSlot} (${tiers?.[activeSlot]?.oc || deps.currentModel || "(unset)"})`,
          `Provider: ${execution.provider_label}`,
          `Quality: ${execution.quality_label}`,
          ...(isApiConnected() ? [`Backend: connected${getBackendVersion() ? ` (${getBackendVersion()})` : ""}`] : [`Backend: offline`]),
          ...(sel.requested_optimization_mode ? [`Requested mode: ${sel.requested_optimization_mode}`] : []),
          ...(totalTurns > 0 ? [`Split: brain ${brainPct}% / worker ${workerPct}% (${totalTurns} total)`] : []),
          `Thinking: ${effectiveLevel}`,
          `Credit: ${credit}%`,
          ...(qualityAvg > 0 ? [`Quality: ${Math.round(qualityAvg)}%`] : []),
          ...(decisionLine ? [`Decision: ${decisionLine}`] : []),
          `|`,
          `Stress: ${stressBar} (${stressLabel})`,
          `|`,
          `Guards:`,
          `  Flow: ${sel.flow_enabled !== false ? "ON" : "OFF"}${sel.flow_enabled !== false && sel.flow_enforce ? " (extract)" : ""}`,
          `  TDD: ${sel.tdd_enforce ? "ON" : "OFF"}${sel.tdd_strict !== false ? " strict" : ""}${sel.tdd_quality !== false ? " quality" : ""}`,
          `  Enforce: ${sel.delegation_enforce ? "ON (mandatory)" : "OFF (compatibility)"}`,
          `  Lock: ${deps._modelLocked ? `LOCK ON${lockedSlot ? ` (${lockedSlot})` : ""}${lockedModel ? ` ${lockedModel}` : ""}` : "LOCK OFF"}`,
          `  Reality-check: ${reality.enabled ? `ON (${reality.scope}${reality.project_id ? `:${reality.project_id}` : ""})` : "OFF"}`,
          `  Compatibility: ${onboardingMode === "assist" ? "ASSIST (soft defaults, progressive activation)" : "STRICT (full guardrails)"}`,
          `|`,
          `All-time savings:`,
          `  Total: $${ltTotal.toFixed(2)} (${sesTrend})`,
          `  Delegation: $${(sv.ltTasks || 0).toFixed(2)}`,
          `  Cache: $${deps.formatUsd(sv.ltCache || 0)}`,
          `  Missed: $${missedC7.toFixed(2)}`,
          `|`,
          `This session:`,
          ...(sesDuration > 0 ? [`  Duration: ${durHrs}h ${durMins}m`] : []),
          `  Rate: $${sesRate.toFixed(2)}/hr`,
          `  Warnings: ${sesWarns}`,
          ...(topTools.length > 0 ? [`  Top tools:`, ...topTools.map(([t, v]) => `    ${t}: $${v.toFixed(2)}`)] : []),
          `|`,
          `Tiers:`,
          `  brain:  ${brainModel}${activeSlot === "brain" ? "  *" : ""}`,
          `  medium: ${mediumModel}${activeSlot === "medium" ? "  *" : ""}`,
          `  cheap:  ${cheapModel}${activeSlot === "cheap" ? "  *" : ""}`,
          `  Labels: ${(LABEL_MODES || []).join(", ")}`,
        ]
        return lines.join("\n")
      }

      if (action === "reality-check") {
        const projectFingerprint = deps.currentProjectFingerprint || (typeof deps.projectFingerprint === "function" ? deps.projectFingerprint(deps.directory || "") : "")
        const reality = getRealityCheckView(projectFingerprint)
        const health = getSessionHealthSnapshot({
          sessionId: deps._OC_SID,
          projectFingerprint,
          userText: deps.latestUserIntent || "",
        })
        const projectState = typeof deps.loadProjectState === "function" ? deps.loadProjectState() : {}
        const projectBucket = projectFingerprint ? projectState?.project_hashes?.[projectFingerprint] : null
        const fullState = typeof deps.readFullState === "function" ? deps.readFullState() : {}
        const session = fullState?.sessions?.[deps._OC_SID] || null
        const realityFile = join(deps.VIBEOS_HOME || getVibeOSHome(), "reality-check-settings.json")
        const stateFile = deps.STATE_FILE
        const projectStateFile = join(deps.VIBEOS_HOME || getVibeOSHome(), "project-states.json")
        const lines = ["[vibeOS-reality-check] Verified facts only"]
        lines.push(`Project: ${deps.currentProjectName || projectBucket?.projectName || projectFingerprint || "unknown"}`)
        lines.push(`Project fingerprint: ${projectFingerprint || "(unset)"}`)
        lines.push(`State files: delegation=${deps.existsSync(stateFile) ? "present" : "missing"}, project=${deps.existsSync(projectStateFile) ? "present" : "missing"}, reality=${deps.existsSync(realityFile) ? "present" : "missing"}`)
        lines.push(`Scope: ${reality.scope}${reality.project_id ? ` (${reality.project_id})` : ""}`)
        lines.push(`Enabled: ${reality.enabled ? "YES" : "NO"}`)
        lines.push(`Rules loaded: ${reality.rules.length}`)
        if (health) {
          lines.push(`Progress risk: ${health.risk} (${health.score})`)
          lines.push(`Decisive progress: ${health.decisiveProgress ? "YES" : "NO"}`)
          lines.push(`Meta-work drift: ${health.metaWorkDrift ? "YES" : "NO"}`)
          lines.push(`Recommended action: ${health.recommendedAction}`)
          if (health.stopDoing) lines.push(`Stop doing: ${health.stopDoing}`)
          if (Array.isArray(health.loopSignals) && health.loopSignals.length > 0) {
            lines.push("Loop signals:")
            for (const signal of health.loopSignals.slice(0, 5)) {
              lines.push(`  - ${signal.kind}: ${signal.summary}`)
            }
          }
          if (health.claimEvidence?.status && health.claimEvidence.status !== "not_applicable") {
            lines.push(`Claim evidence: ${health.claimEvidence.status}`)
            if (health.claimEvidence.reason) lines.push(`  ${health.claimEvidence.reason}`)
          }
        } else {
          for (const rule of reality.rules.slice(0, 8)) {
            lines.push(`  - ${rule.id}: ${rule.description || rule.pattern}`)
          }
        }
        if (projectBucket?.totalSessions != null) {
          lines.push(`Project sessions: ${projectBucket.totalSessions}`)
        }
        if (session) {
          const warnCount = Array.isArray(session.warns) ? session.warns.length : 0
          lines.push(`Session warns: ${warnCount}`)
          if (session.cache_savings_usd != null) {
            lines.push(`Session cache savings: $${Number(session.cache_savings_usd || 0).toFixed(2)}`)
          }
        }
        return lines.join("\n")
      }

      if (action === "enable" || action === "disable") {
        const val = action === "enable"
        const ok = deps.writeSelection("enabled", val)
        if (!ok) return `\u274c Failed to write model-tiers.json`
        return `${val ? "\u2705 Plugin ENABLED" : "\u274c Plugin DISABLED"} \u2014 takes effect immediately (no restart needed).`
      }

      if (action === "set") {
        if (!slot || !["brain", "medium", "cheap"].includes(slot)) {
          return `\u274c Provide slot: brain | medium | cheap`
        }
        if (model) {
          if (!isByteStringSafeModelId(model)) {
            return `\u274c Unsupported model id: use ASCII / Latin-1 characters only.`
          }
          try {
            const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"))
            if (!tiers.trinity) tiers.trinity = {}
            if (!tiers.trinity[slot]) tiers.trinity[slot] = {}
            tiers.trinity[slot].oc = model
            tiers.trinity[slot].cc = model
            tiers.trinity[slot].manual = true
            const _tmp = deps.TIERS_FILE + ".tmp." + Date.now() + "." + Math.random().toString(36).slice(2, 8)
            deps.writeFileSync(_tmp, JSON.stringify(tiers, null, 2) + "\n")
            deps.renameSync(_tmp, deps.TIERS_FILE)
          } catch (e) {
            return `\u274c Failed to write model to tiers: ${e.message}`
          }
        } else {
          // set without custom model — clear manual flag so rebuild can auto-manage
          try {
            const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"))
            if (tiers?.trinity?.[slot]?.manual) {
              delete tiers.trinity[slot].manual
              const _tmp = deps.TIERS_FILE + ".tmp." + Date.now() + "." + Math.random().toString(36).slice(2, 8)
              deps.writeFileSync(_tmp, JSON.stringify(tiers, null, 2) + "\n")
              deps.renameSync(_tmp, deps.TIERS_FILE)
            }
          } catch {}
        }
        let targetModel = ""
        try {
          const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"))
          targetModel = tiers?.trinity?.[slot]?.oc || ""
        } catch {}
        if (!targetModel) {
          return "\u274c No model configured for " + slot + " slot. Run \`vibe rebuild\` first."
        }
        const auth = deps._readAuth()
        let probeFailed = false
        try {
          const ok = await deps.probeModel(targetModel, auth, deps._loadOpenCodeProviders())
          probeFailed = !ok
          if (!ok) console.error("[vibeOS] WARN: " + targetModel + " probe failed - switching anyway")
        } catch (e) {
          probeFailed = true
          console.error("[vibeOS] WARN: probe error for " + targetModel + ": " + e.message + " - switching anyway")
        }
        deps.writeSessionSlot(deps._OC_SID, slot)
        const result = deps.applySlot(slot, deps.directory)
        if (!result.ok) return `\u274c Failed to set slot: ${result.reason}`
        deps._refreshModel(deps.directory)
        const prefix = probeFailed ? `\u274c Probe failed for ${result.ocModel}.` : ""
        return `${prefix}${prefix ? " " : ""}Updated ${slot} slot (${result.ocModel}). Takes effect next turn.`
      }
      if (action === "mode") {
        const builtInIds = ["balanced", "budget", "quality", "speed", "longrun", "audit", "forensic"]
        const brandedIds = BRANDED_MODES.map(m => m.id)
        const allModeIds = [...builtInIds, "auto", ...brandedIds, RAW_MODE.id]
        if (!slot) return `Provide mode: ${brandedIds.join(" | ")} | ${RAW_MODE.id} | auto | ${builtInIds.join(" | ")}`
        const resolvedSlot = slot
        if (!allModeIds.includes(resolvedSlot) && resolvedSlot !== "auto") {
          return `Provide mode: ${brandedIds.join(" | ")} | ${RAW_MODE.id} | auto | ${builtInIds.join(" | ")}`
        }
        const ok = deps.saveOptimizationMode(resolvedSlot)
        if (!ok) return `Failed to write mode`
        deps.writeSessionOptMode(deps._OC_SID + "_opt", resolvedSlot)
        deps.writeSelection("requested_optimization_mode", resolvedSlot)

        const canonical = normalizeLegacyMode(resolvedSlot)
        const modeEntry = [...BRANDED_MODES, ...RUNTIME_MODES, RAW_MODE].find(e => e.id === resolvedSlot) || MODE_TABLE[canonical]
        if (modeEntry) {
          const tierSlot = resolvedSlot === "vibeultrax" ? "cheap" : resolveCascadeSlot(modeEntry.pipeline)
          deps.writeSessionSlot(deps._OC_SID, tierSlot)
          deps.writeSelection("active_pipeline", modeEntry.pipeline)
          const switched = deps.applySlot(tierSlot, deps.directory)
          if (!switched?.ok) {
            return `❌ Failed to switch OpenCode model: ${switched?.reason || "unknown error"}`
          }
          if (resolvedSlot === "vibeultrax" || resolvedSlot === "auto") {
            deps._modelLocked = false
            deps._lockedSlot = null
            deps._lockedModel = null
            deps.writeSelection("slot_locked", false)
          }
          deps.writeSelection("onboarding_mode",
            modeEntry.enforcement === "strict" || modeEntry.tdd === "quality" ? "strict" : "assist")
          deps.writeSelection("delegation_enforce",
            modeEntry.enforcement === "strict" || modeEntry.enforcement === "on")
          deps.writeSelection("flow_enabled",
            modeEntry.flow === "strict" || modeEntry.flow === "on" || modeEntry.flow === "audit")
          deps.writeSelection("flow_enforce",
            modeEntry.flow === "strict" || modeEntry.flow === "on")
          deps.writeSelection("tdd_enforce",
            modeEntry.tdd === "quality" || modeEntry.tdd === "on" || modeEntry.tdd === "strict")
          deps.writeSelection("thinking_level", modeEntry.thinking)
          const pipelineStr = modeEntry.pipeline.join(" → ")
          return `Mode set to ${resolvedSlot.toUpperCase()}. Tier: ${tierSlot}. Pipeline: ${pipelineStr}. Takes effect next turn.`
        }
        if (resolvedSlot === "auto") {
          deps.writeSelection("slot_locked", false)
        }
        return `Mode set to ${resolvedSlot.toUpperCase()}.`
      }
      if (action === "axis") {
        const AXIS_NAMES = ["enforcement", "flow", "tdd", "tier", "thinking", "context7_urgency", "wbp_verbosity", "websearch"]
        if (!slot || slot === "status") {
          const overrides = loadAxisOverrides()
          const keys = Object.keys(overrides)
          if (keys.length === 0) return "No axis overrides active. All axes use mode defaults."
          const lines = ["Active axis overrides:"]
          for (const k of keys) lines.push(`  ${k}: ${overrides[k]}`)
          return lines.join("\n")
        }
        if (slot === "reset") {
          const ok = clearAxisOverrides()
          return ok ? "Axis overrides cleared. All axes use mode defaults next turn." : `❌ Failed to clear axis overrides.`
        }
        if (AXIS_NAMES.includes(slot)) {
          const value = level || model
          if (!value) return `❌ Provide value for axis '${slot}'. e.g. on|off|strict|relaxed|full|brief|required|optional`
          const ok = writeAxisOverride(slot, value)
          if (ok) applyAxisOverrideNow(slot, value, deps)
          return ok ? `Axis override: ${slot} = ${value}. Active now, and pinned against auto-mode.` : `❌ Failed to write axis override.`
        }
        return `❌ Unknown axis '${slot}'. Valid axes: ${AXIS_NAMES.join(" | ")} | reset | status`
      }
      if (action === "thinking") {
        if (!level || !["full", "brief", "off"].includes(level)) {
          return `\u274c Provide level: full | brief | off`
        }
        const stored = level
        const ok = deps.writeSelection("thinking_level", stored)
        if (!ok) return `\u274c Failed to write model-tiers.json`
        const desc = {
          full:  "full thinking (no restriction) \u2014 takes effect on next message",
          brief: "brief thinking (complex tasks only) \u2014 takes effect on next message",
          off:   "thinking OFF (respond directly) \u2014 takes effect on next message",
        }
        return `\u2705 Reasoning depth \u2192 ${desc[level]}`
      }

      if (action === "flow") {
        if (slot === "on" || slot === "off") {
          const ok = deps.writeSelection("flow_enabled", slot === "on")
          if (ok) deps.writeSelection("flow_enforce", slot === "on")
          if (ok && slot === "on") deps.writeSelection("onboarding_mode", "strict")
          return ok
            ? `\u2705 Flow enforcer ${slot === "on" ? "ENABLED" : "DISABLED"}`
            : `\u274c Failed to write model-tiers.json`
        }
        if (slot === "enforce") {
          if (level !== "on" && level !== "off") return "\u274c Provide level on|off for \`vibe flow enforce\`"
          const enforceOn = level === "on"
          const ok = deps.writeSelection("flow_enforce", enforceOn)
          if (ok && enforceOn) deps.writeSelection("onboarding_mode", "strict")
          return ok
            ? `\u2705 Flow enforcement ${enforceOn ? "ENABLED (auto-extract TODOs)" : "DISABLED (log only)"}`
            : `\u274c Failed to write model-tiers.json`
        }
        const flowWarns = deps.getFlowWarns()
        const sid = String(process.pid || "?")
        const sessionWarns = flowWarns.filter(w => String(w.sid) === sid)
        const bySev = { warn: 0, hint: 0, flag: 0 }
        for (const w of sessionWarns) {
          if (bySev[w.severity] !== undefined) bySev[w.severity]++
        }
        const lines = [`\u{1F500} Flow enforcer audit (this session):`]
        lines.push(`  ${bySev.warn} warn, ${bySev.hint} hint, ${bySev.flag} flag`)
        if (sessionWarns.length > 0) {
          for (const w of sessionWarns.slice(-15)) {
            const icon = w.severity === "warn" ? "\u26A0" : "\u{1F4A1}"
            lines.push(`  ${icon} [${w.severity}] ${w.rule_id}: ${w.description} \u2014 ${w.filePath || "(no file)"}`)
          }
        }
        if (sessionWarns.length === 0) lines.push(`  No flow violations this session.`)
        return lines.join("\n")
      }

      if (action === "enforce") {
        if (slot === "off") {
          const sel = deps.loadSelection()
          if (sel.onboarding_mode === "assist" && sel.delegation_enforce !== true) {
            return `\u2705 Delegation enforcement is already OFF in compatibility mode.`
          }
          return `\u274c Delegation enforcement is mandatory and cannot be disabled.`
        }
        if (slot === "on") {
          const ok = deps.writeSelection("delegation_enforce", true)
          if (ok) deps.writeSelection("onboarding_mode", "strict")
          return ok
            ? `Delegation enforcement ENABLED \u2014 direct writes/edits are blocked on brain tier`
            : `\u274c Failed to write model-tiers.json`
        }
        const _sel = deps.loadSelection()
        return `\u{1F6AB} Delegation enforcement: ON (mandatory, blocks direct writes/edits on brain tier)\nUse \`vibe enforce on\` to reapply the guard if needed.`
      }

      if (action === "lock") {
        if (slot === "on") {
          const sel = deps.loadSelection() || {}
          // Lock the model actually running right now (deps.currentModel), not
          // whatever `active_slot` claims -- the two can drift (cascade auto-
          // reconcile can leave active_slot pointing at a different tier than
          // what's live), and locking the wrong model defeats the whole point
          // of "freeze what's running." Reverse-derive the slot name from the
          // trinity config for bookkeeping/display only.
          const trinityMap = deps._tiersData?.trinity || {}
          const lockModel = deps.currentModel || trinityMap?.[sel.active_slot || "brain"]?.oc || "detected model"
          const matchedSlot = Object.keys(trinityMap).find((s) => trinityMap[s]?.oc === lockModel)
          const lockSlot = matchedSlot || sel.active_slot || "brain"
          deps._modelLocked = true
          deps._lockedSlot = lockSlot
          deps._lockedModel = lockModel
          deps.writeSelection("slot_locked", true)
          console.error(`[vibeOS] model LOCKED \u2014 ${lockModel} (${deps.currentTier}) will not auto-reconcile with config`)
          return `LOCK ON \u2014 ${lockModel} will not change unless you force with \`vibe set\` or \`vibe lock off\`.`
        }
        if (slot === "off") {
          deps._modelLocked = false
          deps._lockedSlot = null
          deps._lockedModel = null
          deps.writeSelection("slot_locked", false)
          console.error(`[vibeOS] model UNLOCKED \u2014 auto-reconcile re-enabled`)
          return `LOCK OFF \u2014 will auto-follow OpenCode config changes.`
        }
        return `\u{1F512} Model lock: ${deps._modelLocked ? "ON (fixed per session)" : "OFF (follows config)"}\nUse \`vibe lock on\` or \`vibe lock off\` to toggle.\nLock is per-session (resets on restart).`
      }

      if (action === "tdd") {
        if (slot === "strict") {
          if (level !== "on" && level !== "off") {
            return "\u274c Provide level on|off for \`vibe tdd strict\`"
          }
          const ok = deps.writeSelection("tdd_strict", level === "on")
          if (ok && level === "on") deps.writeSelection("onboarding_mode", "strict")
          return ok
            ? `\u2705 TDD strict ${level === "on" ? "ENABLED (TODO tests fail loudly)" : "DISABLED (TODO tests non-blocking)"}`
            : `\u274c Failed to write model-tiers.json`
        }
        if (slot === "quality") {
          if (level !== "on" && level !== "off") {
            return "\u274c Provide level on|off for \`vibe tdd quality\`"
          }
          const ok = deps.writeSelection("tdd_quality", level === "on")
          if (ok && level === "on") deps.writeSelection("onboarding_mode", "strict")
          return ok
            ? `\u2705 TDD quality templates ${level === "on" ? "ENABLED (real assertions, invalid-input, edge-case stubs)" : "DISABLED (TODO-only stubs)"}`
            : `\u274c Failed to write model-tiers.json`
        }
        if (slot === "on" || slot === "off") {
          const ok = deps.writeSelection("tdd_enforce", slot === "on")
          if (ok && slot === "on") deps.writeSelection("onboarding_mode", "strict")
          return ok
            ? `\u2705 TDD enforcement ${slot === "on" ? "ENABLED (auto-create skeletons)" : "DISABLED (nudge only)"}`
            : `\u274c Failed to write model-tiers.json`
        }
        const stateFile = deps.STATE_FILE
        let enforced = 0
        try {
          if (deps.existsSync(stateFile)) {
            const s = deps.safeJsonParse(deps.readFileSync(stateFile, "utf-8"))
            enforced = s.lifetime?.tdd_enforced ?? 0
          }
        } catch {}
        const sel = deps.loadSelection()
        const lines = [`\u{1F9EA} TDD enforcer audit:`]
        lines.push(`  Mode: ${sel.tdd_enforce ? "ENFORCE (auto-create skeletons)" : "NUDGE (reminders only)"}`)
        lines.push(`  Strict templates: ${sel.tdd_strict !== false ? "ON (fail TODO tests)" : "OFF (non-blocking TODO tests)"}`)
        lines.push(`  Quality templates: ${sel.tdd_quality !== false ? "ON (real assertion stubs)" : "OFF (TODO-only stubs)"}`)
        lines.push(`  Skeletons created this lifetime: ${enforced}`)
        return lines.join("\n")
      }

      if (action === "setup") {
        const now = new Date().toISOString()
        const existing = deps.existsSync(deps.TIERS_FILE)
          ? (deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8")) || {})
          : {}
        const providers = typeof deps._loadOpenCodeProviders === "function"
          ? deps._loadOpenCodeProviders(deps.directory)
          : {}
        const auth = typeof deps._readAuth === "function" ? deps._readAuth() : {}
        let discovered = []
        try {
          if (typeof deps.discoverAvailableModels === "function") {
            discovered = await deps.discoverAvailableModels(providers, auth)
          }
        } catch {}
        let selectedModel = ""
        try {
          const explicitConfigs = [
            join(deps.directory || "", "opencode.json"),
            join(process.env.HOME || "", ".config", "opencode", "opencode.json"),
            join(deps.OPENCODE_HOME || "", "opencode.json"),
          ]
          for (const cfgPath of explicitConfigs) {
            if (!cfgPath || !existsSync(cfgPath)) continue
            const oc = deps.safeJsonParse(readFileSync(cfgPath, "utf-8"))
            const model = String(oc?.agent?.build?.model || oc?.model || "").trim()
            if (model) { selectedModel = model; break }
          }
        } catch {
          selectedModel = ""
        }
        const trinity = buildDeterministicTrinity(discovered, { selectedModelId: selectedModel })
        const bootstrapFree = "opencode/big-pickle"
        const brain = keepExistingTrinitySlot(existing?.trinity?.brain, existing?.trinity?.brain?.oc || bootstrapFree)
        const medium = keepExistingTrinitySlot(existing?.trinity?.medium, existing?.trinity?.medium?.oc || bootstrapFree)
        const cheap = keepExistingTrinitySlot(existing?.trinity?.cheap, existing?.trinity?.cheap?.oc || bootstrapFree)
        const tiers = existing && typeof existing === "object" ? existing : {}
        tiers.selection ??= {}
        tiers.trinity ??= {}
        tiers.selection.enabled = true
        tiers.selection.active_slot = tiers.selection.active_slot || (brain ? "brain" : "medium")
        tiers.selection.onboarding_mode = "assist"
        tiers.selection.delegation_enforce = false
        tiers.selection.flow_enabled = false
        tiers.selection.flow_enforce = false
        tiers.selection.tdd_enforce = false
        tiers.selection.tdd_strict = false
        tiers.selection.tdd_quality = false
        tiers.selection.thinking_level = "off"
        if (!tiers.selection.setup_completed_at) {
          tiers.selection.optimization_mode = "vibeultrax"
          tiers.selection.requested_optimization_mode = "vibeultrax"
        } else {
          tiers.selection.optimization_mode = tiers.selection.optimization_mode || "vibeultrax"
          tiers.selection.requested_optimization_mode = tiers.selection.requested_optimization_mode || "vibeultrax"
        }
        tiers.selection.setup_completed_at = now
        if (brain) tiers.trinity.brain = keepExistingTrinitySlot(existing?.trinity?.brain, brain)
        if (medium) tiers.trinity.medium = keepExistingTrinitySlot(existing?.trinity?.medium, medium)
        if (cheap) tiers.trinity.cheap = keepExistingTrinitySlot(existing?.trinity?.cheap, cheap)
        deps.mkdirSync(dirname(deps.TIERS_FILE), { recursive: true })
        deps.writeFileSync(deps.TIERS_FILE, JSON.stringify(tiers, null, 2) + "\n")
        const bootstrapSlot = tiers.selection.active_slot || (brain ? "brain" : "medium")
        const booted = typeof deps.applySlot === "function" ? deps.applySlot(bootstrapSlot, deps.directory) : { ok: false, reason: "applySlot unavailable" }
        if (!booted?.ok) return `\u274c Failed to activate native OpenCode model: ${booted?.reason || "unknown error"}`
        // No client.config.update here: it persists <projectDir>/config.json (a watched file)
        // and aborts the turn. active_slot is already persisted by applySlot above; the model
        // reaches the request per turn via chat.params + subagent delegation.
        if (typeof deps._refreshModel === "function") deps._refreshModel(deps.directory)
        const lines = [
          "\u2705 Compatibility profile created.",
          `  Mode: assist`,
          `  Models: ${brain || "(unset)"}${medium && medium !== brain ? ` / ${medium}` : ""}${cheap && cheap !== medium ? ` / ${cheap}` : ""}`,
          `  Provider: ${trinity?.provider || resolveExecutionIdentity(selectedModel, deps.directory)?.provider_label || "Unknown"}`,
          `  Delegation: off`,
          `  Flow: off`,
          `  TDD: off`,
          `  Default mode: ${tiers.selection.optimization_mode || "vibeultrax"}`,
          `  Blackbox: on`,
        ]
        if (discovered.length > 0) lines.push(`  Discovered models: ${discovered.length}`)
        lines.push("Use \`vibe mode quality\` or \`vibe enforce on\` to graduate to strict mode.")
        return lines.join("\n")
      }

      if (action === "project") {
        const L = "\u2501"
        const lines = [`\ud83d\udcca Project profile \u2014 ${deps.currentProjectName || (deps.directory ? deps.directory.split("/").pop() : "unknown")}`]
        lines.push(L.repeat(40))
        const fp = deps.currentProjectFingerprint || deps.projectFingerprint(deps.directory)

        const pstate = deps.loadProjectState()
        const proj = pstate.project_hashes?.[fp]
        if (proj) {
          lines.push(`\n\ud83d\udcc5 Sessions: ${proj.totalSessions || 0} | Last: ${(proj.lastSeen || "").slice(0, 10)}`)
          if (proj.researchChains) lines.push(`\ud83d\udd0d Research chains detected: ${proj.researchChains}`)
          if (proj.context7Bypasses) lines.push(`\ud83d\udcb8 Context7 bypasses: ${proj.context7Bypasses}`)
          if (proj.commonTopics?.length) {
            const topics = proj.commonTopics.slice(0, 5).join(", ")
            lines.push(`\ud83c\udf10 Common fetch domains: ${topics}`)
          }
          const promoted = deps.promotedProjectPatterns(fp)
          if (promoted.length) {
            lines.push(`\nLearned patterns:`)
            for (const ptn of promoted) lines.push(`  [${ptn.label}] ${ptn.summary}`)
          }
        } else {
          lines.push(`\n  (no project memory yet \u2014 first session)`)
        }

        const sv = deps.readLifetimeSavings()
        const totalTurns = (sv.sesModelTurns?.brain || 0) + (sv.sesModelTurns?.worker || 0)
        const brainPct = totalTurns > 0 ? Math.round((sv.sesModelTurns.brain / totalTurns) * 100) : 0
        if (totalTurns > 0) {
          const workerPct = 100 - brainPct
          lines.push(`\n\ud83d\udd04 Model usage: Brain ${brainPct}% (${sv.sesModelTurns.brain} turns) / Worker ${workerPct}% (${sv.sesModelTurns.worker} tasks)`)
        }
        if (sv.sesTasks > 0.01 || sv.ltCache > 0.01) {
          lines.push(`\ud83d\udcb0 Session savings: $${sv.sesTasks.toFixed(2)} delegation + $${sv.ltCache.toFixed(2)} cache`)
        }
        if (sv.sesDuration > 0) {
          const hrs = Math.floor(sv.sesDuration / 3600)
          const mins = Math.floor((sv.sesDuration % 3600) / 60)
          lines.push(`\u23f1  Duration: ${hrs}h ${mins}m | Rate: $${sv.sesRatePerHour.toFixed(2)}/hr | Trend: ${sv.sesTrend === "down" ? "\u2193" : sv.sesTrend === "up" ? "\u2191" : "\u2192"}`)
        }

        const toolEntries = Object.entries(sv.sesToolBreakdown || {}).filter(([_, v]) => v > 0.005).sort((a, b) => b[1] - a[1])
        if (toolEntries.length > 0) {
          lines.push(`\n\ud83d\udd27 Per-tool savings:`)
          for (const [tool, savings] of toolEntries) {
            lines.push(`  ${tool.padEnd(14)} \u2014$${savings.toFixed(2)}`)
          }
        }

        const flowWarns = deps.getFlowWarns()
        const sid = String(process.pid || "?")
        const sessionFlowWarns = flowWarns.filter(w => String(w.sid) === sid)
        const byRule = {}
        for (const w of sessionFlowWarns) {
          const key = w.rule_id || "unknown"
          byRule[key] = (byRule[key] || 0) + 1
        }
        if (Object.keys(byRule).length > 0) {
          lines.push(`\n\u26a0\ufe0f Flow violations (this session):`)
          for (const [rule, count] of Object.entries(byRule)) {
            lines.push(`  ${rule.padEnd(22)} ${count}`)
          }
        }

        const suggestions = []
        if (totalTurns > 10 && sv.sesModelTurns.brain > sv.sesModelTurns.worker * 2) {
          if (!deps.loadSelection().delegation_enforce) {
            suggestions.push(`\ud83d\udca1 High direct brain usage (${brainPct}%) \u2014 enable enforcement with \`vibe enforce on\` to block direct writes/edits`)
          } else {
            suggestions.push(`\ud83d\udca1 High direct brain usage (${brainPct}%) \u2014 enforcement is ON but brain keeps editing directly; check plugin logs`)
          }
        }
        if (proj?.context7Bypasses > 3) {
          suggestions.push(`\ud83d\udca1 ${proj.context7Bypasses} context7 bypasses \u2014 install context7 MCP to save ~$0.05/turn`)
        }
        if (proj?.researchChains > 2) {
          suggestions.push(`\ud83d\udca1 ${proj.researchChains} research domain chains \u2014 consider caching or batching doc lookups`)
        }
        if ((sv.sesToolBreakdown?.webfetch || 0) > 0.1 || (sv.sesToolBreakdown?.websearch || 0) > 0.1) {
          suggestions.push(`\ud83d\udca1 High webfetch/websearch usage \u2014 use context7 tools or scratchpad caching`)
        }
        if ((byRule["new-md-file"] || 0) > 2) {
          suggestions.push(`\ud83d\udca1 ${byRule["new-md-file"]} new .md files \u2014 verify explicit user request for docs`)
        }
        if ((byRule["todo-comment"] || 0) > 5) {
          suggestions.push(`\ud83d\udca1 ${byRule["todo-comment"]} TODO/FIXME left \u2014 clean up or track in issue tracker`)
        }
        if (deps.loadSelection().flow_enabled === false) {
          suggestions.push(`\ud83d\udca1 Flow enforcer is OFF \u2014 enable with \`vibe flow on\` to catch anti-patterns`)
        }
        for (const ptn of deps.promotedProjectPatterns(fp)) {
          suggestions.push(`Learned ${ptn.label} pattern: ${ptn.summary}`)
        }
        const credit = deps.loadCredit()
        if (credit < 40) {
          suggestions.push(`\ud83d\udca1 Credit at ${credit}% \u2014 switch to medium/cheap slot with \`vibe medium\``)
        }

        if (suggestions.length > 0) {
          lines.push(`\nSmall wins:`)
          for (const s of suggestions) lines.push(`  ${s}`)
        } else {
          lines.push(`\n\u2705 No optimization suggestions \u2014 looking good.`)
        }

        lines.push(`\n${L.repeat(40)}`)
        lines.push(`Run \`vibe help\` for all commands | \`research-audit\` for deep fetch analysis`)
        return lines.join("\n")
      }

      if (action === "report" && slot === "savings") {
        const L = "\u2501"
        const lines = [`== Savings Deep Report ==`]
        lines.push(L.repeat(40))
        const sv = deps.readLifetimeSavings()
        const ltTotal = sv.ltTasks + sv.ltCache

        const toolTotals = {}
        let entryCount = 0
        try {
          if (deps.existsSync(deps.SAVINGS_LEDGER_FILE)) {
            const raw = deps.readFileSync(deps.SAVINGS_LEDGER_FILE, "utf-8")
            for (const ln of raw.trim().split("\n")) {
              if (!ln.trim()) continue
              let rec = null
              try { rec = JSON.parse(ln) } catch { continue }
              if (!rec || rec.v !== 2) continue
              const amt = Number(rec.amount_usd ?? 0)
              const tool = String(rec.tool || "unknown")
              toolTotals[tool] = (toolTotals[tool] || 0) + amt
              entryCount++
            }
          }
        } catch {}
        lines.push(`\nBy tool:`)
        const sortedTools = Object.entries(toolTotals).sort((a, b) => b[1] - a[1])
        if (sortedTools.length === 0) {
          lines.push(`  (no ledger entries yet)`)
        } else {
          for (const [tool, amt] of sortedTools) {
            lines.push(`  ${tool.padEnd(14)} $${amt.toFixed(4)}`)
          }
        }

        const dayTotals = {}
        try {
          if (deps.existsSync(deps.SAVINGS_LEDGER_FILE)) {
            const raw = deps.readFileSync(deps.SAVINGS_LEDGER_FILE, "utf-8")
            for (const ln of raw.trim().split("\n")) {
              if (!ln.trim()) continue
              let rec = null
              try { rec = JSON.parse(ln) } catch { continue }
              if (!rec || rec.v !== 2) continue
              const amt = Number(rec.amount_usd ?? 0)
              const day = (rec.at || "").slice(0, 10)
              if (day) dayTotals[day] = (dayTotals[day] || 0) + amt
            }
          }
        } catch {}
        lines.push(`\nBy day:`)
        const sortedDays = Object.entries(dayTotals).sort((a, b) => a[0].localeCompare(b[0]))
        if (sortedDays.length === 0) {
          lines.push(`  (no daily data yet)`)
        } else {
          for (const [day, amt] of sortedDays) {
            lines.push(`  ${day}  $${amt.toFixed(4)}`)
          }
        }

        lines.push(`\nLifetime:`)
        lines.push(`  Delegation savings: $${sv.ltTasks.toFixed(4)}`)
        lines.push(`  Cache savings:     $${(sv.ltCache || 0).toFixed(4)}`)
        lines.push(`  Total:             $${ltTotal.toFixed(4)}`)
        lines.push(`  Ledger entries:    ${entryCount}`)
        lines.push(`\n${L.repeat(40)}`)
        return lines.join("\n")
      }

      if (action === "patterns") {
        const fp = deps.currentProjectFingerprint || deps.projectFingerprint(deps.directory)
        const name = deps.currentProjectName || (deps.directory ? deps.directory.split("/").pop() : "unknown")
        if (slot === "clear") {
          const count = deps.clearProjectPatterns(fp)
          return `Pattern memory cleared for "${name}" (${count} pattern${count === 1 ? "" : "s"} removed).`
        }
        if (slot === "suggest") {
          const pstate = deps.loadProjectState()
          const currentBucket = pstate.project_hashes?.[fp]
          const currentTech = currentBucket?.techStack || []
          const currentKeys = new Set([
            ...Object.keys(currentBucket?.userPatterns?.friction || {}),
            ...Object.keys(currentBucket?.userPatterns?.routines || {}),
          ])
          const candidates = []
          for (const [otherFp, bucket] of Object.entries(pstate.project_hashes || {})) {
            if (otherFp === fp) continue
            const otherTech = bucket?.techStack || []
            if (!otherTech.some(t => currentTech.includes(t))) continue
            for (const [kind, label] of [["friction", "friction"], ["routines", "routine"]]) {
              for (const [key, row] of Object.entries(bucket?.userPatterns?.[kind] || {})) {
                if (currentKeys.has(key)) continue
                const sessions = new Set(row?.sessions || []).size
                candidates.push({ key, label, summary: row?.summary || key, count: Number(row?.count || 0), sessions, lastSeen: row?.lastSeen || "" })
              }
            }
          }
          candidates.sort((a, b) => b.count - a.count || b.sessions - a.sessions)
          const top = candidates.slice(0, 5)
          const lines = ["[\u26a1 From similar tech stack projects]"]
          if (top.length === 0) {
            lines.push("  No cross-project suggestions available yet.")
            return lines.join("\n")
          }
          for (const c of top) {
            const tag = c.sessions >= 3 ? "promoted" : "learning"
            lines.push(`  [${c.label}/${tag}] ${c.summary} (${c.count} hit${c.count === 1 ? "" : "s"}, ${c.sessions} session${c.sessions === 1 ? "" : "s"})`)
          }
          lines.push("")
          lines.push("Use \`vibe patterns\` to see this project's own patterns.")
          return lines.join("\n")
        }
        const rows = deps.projectPatternRows(fp)
        const lines = [`Project patterns - ${name}`]
        if (rows.length === 0) {
          lines.push("  No learned patterns yet.")
          lines.push("  Patterns promote into briefings after 3 separate sessions.")
          return lines.join("\n")
        }
        const promoted = rows.filter(r => r.sessions >= 3).length
        lines.push(`  ${rows.length} stored, ${promoted} promoted`)
        for (const r of rows.slice(0, 15)) {
          const tag = r.sessions >= 3 ? "promoted" : "learning"
          lines.push(`  [${r.label}/${tag}] ${r.summary} (${r.sessions} session${r.sessions === 1 ? "" : "s"}, ${r.count} hit${r.count === 1 ? "" : "s"})`)
        }
        lines.push("")
        lines.push("Use \`vibe patterns clear\` to clear project pattern memory.")
        return lines.join("\n")
      }

      if (action === "guard") {
        if (!deps.directory || !deps.existsSync(deps.directory)) return "Working directory not accessible."
        const techStack = deps.detectTechStack(deps.directory)
        const result = deps.ensureProjectDocs(deps.directory, techStack)
        const _fp = deps.projectFingerprint(deps.directory)
        if (_fp) {
          try { deps.ensureProjectSkill(deps.directory, _fp) } catch {}
        }
        if (result.created.length === 0 && result.skipped.length > 0) {
          return `AGENTS.md and README.md already exist. Use \`vibe guard\` to check for missing features.`
        }
        const lines = [`Project Guard: ${deps.directory.split("/").pop() || "unknown"}`]
        for (const f of result.created) lines.push(`  Created ${f}`)
        for (const f of result.skipped) lines.push(`  Already exists: ${f}`)
        lines.push("")
        lines.push("AGENTS.md: defines AI agent behavioral rules \u2014 ASK BEFORE changing code.")
        lines.push("README.md: auto-maintained feature documentation \u2014 keep it updated.")
        return lines.join("\n")
      }

      if (action === "todo") {
        const todos = typeof deps.loadTodosForCurrentProject === "function" ? deps.loadTodosForCurrentProject() : deps.loadTodos()
        const pending = todos.filter((t: unknown) => t.status === "pending")
        if (pending.length === 0) return "No pending todos."
        const lines = ["Pending todos: " + pending.length]
        for (const t of pending.slice(0, 20)) {
          lines.push("  #" + (t.id || "").slice(0, 8) + " [" + t.priority + "] " + (t.content || "").slice(0, 60))
        }
        if (pending.length > 20) lines.push("  ... and " + (pending.length - 20) + " more")
        return lines.join("\n")
      }
      if (action === "todo-done") {
        if (!slot) return "Usage: vibe todo-done <id>\nMark a todo as done by its ID."
        deps.markTodoDone(slot)
        return "Todo " + slot + " marked done."
      }
      if (action === "todo-sync") {
        const count = deps.syncFlowTodosToNative((entry: unknown) => {
          deps.upsertTodo(entry)
        })
        return "Synced " + count + " flow TODO(s) to native todo list."
      }

      if (action === "api-token") {
        if (!token) return "Usage: vibe api-token <token|invalidate>\nProvide a valid VIBEOS_API_TOKEN to enable remote control-vector computation, or 'invalidate' to disable it for alpha."
        const cleanToken = String(token).trim()
        if (["invalidate", "disable", "clear", "revoke"].includes(cleanToken.toLowerCase())) {
          invalidateApiToken()
          return "[vibeOS] API token invalidated. Remote API disabled until a new token is set."
        }
        deps.setApiToken(token)
        return "[vibeOS] API token updated. Remote API re-enabled."
      }

      if (action === "api-bootstrap-token") {
        if (!token) return "Usage: vibe api-bootstrap-token <token>\nProvide an alpha bootstrap token to exchange for a normal API token on alpha builds."
        deps.setApiBootstrapToken(token)
        const ok = typeof deps.ensureBootstrapExchange === "function" ? await deps.ensureBootstrapExchange() : false
        if (ok) return "[vibeOS] Alpha bootstrap token exchanged successfully. Remote API re-enabled."
        return "[vibeOS] Alpha bootstrap token saved. Remote API will retry the exchange on the next call."
      }

      if (action === "verify-claims") {
        const VIBEOS_HOME = getVibeOSHome()
        const AUDIT_DIR = join(VIBEOS_HOME, "cascade-audit")
        const claimFile = join(AUDIT_DIR, "claim-audit.jsonl")
        const cascadeFile = join(AUDIT_DIR, "cascade-audit.jsonl")
        const lines = ["[vibeOS] Claim verification report"]
        lines.push("=".repeat(50))

        let claimCount = 0, unsubstantiatedCount = 0, verifiedCount = 0

        const CLAIM_RE = /(?:done|fixed|validated|works|score|%|passed|verified|solved|resolved)/i
        const claims = []
        if (deps.existsSync(claimFile)) {
          try {
            const raw = deps.readFileSync(claimFile, "utf-8")
            for (const ln of raw.trim().split(String.fromCharCode(10))) {
              if (!ln.trim()) continue
              try { claims.push(JSON.parse(ln)) } catch {}
            }
          } catch {}
        }

        const cascadeRuns = []
        if (deps.existsSync(cascadeFile)) {
          try {
            const raw = deps.readFileSync(cascadeFile, "utf-8")
            for (const ln of raw.trim().split(String.fromCharCode(10))) {
              if (!ln.trim()) continue
              try { cascadeRuns.push(JSON.parse(ln)) } catch {}
            }
          } catch {}
        }

        const recentClaims = claims.slice(-20)
        const recentCascade = cascadeRuns.slice(-50)
        lines.push("Claims detected (last 20): " + recentClaims.length)
        lines.push("Cascade runs available: " + recentCascade.length)
        lines.push("")

        if (recentClaims.length === 0) {
          lines.push("  No claims detected in recent responses.")
        }

        for (const cl of recentClaims) {
          claimCount++
          const claimTexts = (cl.claims || []).map(function(c) { return c.text }).join(" | ")
          const ts = (cl.ts || "").slice(0, 19)

          let cascadeMatch = false
          let emptyAnswers = 0
          for (const cr of recentCascade) {
            const cTs = cr._ts || ""
            if (cTs && cl.ts) {
              const diffMs = Math.abs(new Date(cTs).getTime() - new Date(cl.ts).getTime())
              if (diffMs < 120000) {
                cascadeMatch = true
                if (cr.answer_empty) emptyAnswers++
              }
            }
          }

          const hasScore = CLAIM_RE.test(claimTexts)
          let substantiated = true
          let notes = []

          if (hasScore && recentCascade.length === 0) {
            substantiated = false
            notes.push("no cascade run data available")
          } else if (hasScore && !cascadeMatch) {
            substantiated = false
            notes.push("no cascade run within 2min of claim")
          }
          if (emptyAnswers > 0) {
            notes.push("cascade returned empty answers")
          }

          if (substantiated) {
            verifiedCount++
            lines.push("  [VERIFIED] " + ts + ": " + claimTexts.substring(0, 80))
          } else {
            unsubstantiatedCount++
            lines.push("  [UNSUBSTANTIATED] " + ts + ": " + claimTexts.substring(0, 80))
            if (notes.length > 0) lines.push("    Reasons: " + notes.join("; "))
          }
        }

        lines.push("")
        lines.push("Summary: " + verifiedCount + " verified, " + unsubstantiatedCount + " unsubstantiated, " + (claimCount - verifiedCount - unsubstantiatedCount) + " pending")
        lines.push("Claim audit: " + claimFile)
        lines.push("Cascade audit: " + cascadeFile)
        // Check git diff for "fixed" claims
        let gitDiffLines = ""
        try {
          gitDiffLines = execSync("git diff --stat", { encoding: "utf-8", timeout: 5000 }).trim()
        } catch {}
        if (gitDiffLines) {
          lines.push("")
          lines.push("Git working tree has uncommitted changes:")
          for (const dl of gitDiffLines.split(String.fromCharCode(10))) {
            lines.push("  " + dl)
          }
        } else {
          for (const cl of recentClaims) {
            const claimTexts = (cl.claims || []).map(function(c) { return c.text }).join(" | ")
            if (/fixed|done|solved|resolved|validated/i.test(claimTexts)) {
              if (!gitDiffLines) {
                lines.push("  WARNING: '" + claimTexts.substring(0, 50) + "' claim but no uncommitted changes in working tree")
              }
            }
          }
        }
        return lines.join(String.fromCharCode(10))
      }

      if (action === "rebuild") {
        const providers = typeof deps._loadOpenCodeProviders === "function"
          ? deps._loadOpenCodeProviders(deps.directory)
          : {}
        const auth = deps._readAuth()
        const models = await deps.discoverAvailableModels(providers, auth)
        let selectedModel = ""
        try {
          const explicitConfigs = [
            join(deps.directory || "", "opencode.json"),
            join(process.env.HOME || "", ".config", "opencode", "opencode.json"),
            join(deps.OPENCODE_HOME || "", "opencode.json"),
          ]
          for (const cfgPath of explicitConfigs) {
            if (!cfgPath || !existsSync(cfgPath)) continue
            const oc = deps.safeJsonParse(readFileSync(cfgPath, "utf-8"))
            const model = String(oc?.agent?.build?.model || oc?.model || "").trim()
            if (model) { selectedModel = model; break }
          }
          if (!selectedModel) selectedModel = deps.currentModel || ""
        } catch {
          selectedModel = deps.currentModel || ""
        }
        const trinity = buildDeterministicTrinity(models, { selectedModelId: selectedModel })
        if (!trinity) {
          return "\u274c No models discovered from any configured provider."
        }
        const probed = {
          brain: models.find(m => m.id === trinity.brain) || { id: trinity.brain, cost: deps._modelCost(trinity.brain), tier: deps._modelTier(trinity.brain) },
          medium: models.find(m => m.id === trinity.medium) || { id: trinity.medium, cost: deps._modelCost(trinity.medium), tier: deps._modelTier(trinity.medium) },
          cheap: models.find(m => m.id === trinity.cheap) || { id: trinity.cheap, cost: deps._modelCost(trinity.cheap), tier: deps._modelTier(trinity.cheap) },
        }
        const failed = []
        for (const slot of ["brain", "medium", "cheap"]) {
          const candidate = probed[slot]
          if (!candidate?.id) continue
          if (!isByteStringSafeModelId(candidate.id)) {
            failed.push(`${slot}: ${candidate.id} (unsupported characters)`)
            continue
          }
          const ok = await deps.probeModel(candidate.id, auth, providers)
          if (!ok) failed.push(`${slot}: ${candidate.id}`)
        }
        if (!probed.brain) {
          return "\u274c No models responded to probe. Try checking your API keys.\n" + (failed.length > 0 ? "Failed:\n  " + failed.join("\n  ") : "No models discovered.")
        }
        try {
          const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"))
          const existing = tiers.trinity || {}
          tiers.trinity = {
            brain: keepExistingTrinitySlot(existing.brain, probed.brain.id),
            medium: keepExistingTrinitySlot(existing.medium, probed.medium.id),
            cheap: keepExistingTrinitySlot(existing.cheap, probed.cheap.id),
          }
          const _tmp = deps.TIERS_FILE + ".tmp." + Date.now()
          deps.writeFileSync(_tmp, JSON.stringify(tiers, null, 2) + "\n", "utf-8")
          deps.renameSync(_tmp, deps.TIERS_FILE)
        } catch (err) {
          return "\u274c Failed to write model-tiers.json: " + err.message
        }
        try { deps.applySlot("brain", deps.directory) } catch (e) { console.error("[vibeOS] auto-activate brain failed:", e.message) }
        const _finalTiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"))
        const _trinity = _finalTiers?.trinity || {}
        const _pMan = (s) => _trinity[s]?.manual === true ? " [manual, preserved]" : ""
        const lines = [
          `\ud83d\udd0d Auto-detected models from provider: ${trinity.provider || "unknown"}`,
          "  \ud83e\udde0 brain  \u2192 " + probed.brain.id + " (tier: " + probed.brain.tier + ", $" + probed.brain.cost.toFixed(4) + "/turn) \u2705" + _pMan("brain"),
          "  \u2699  medium \u2192 " + probed.medium.id + " (tier: " + probed.medium.tier + ", $" + probed.medium.cost.toFixed(4) + "/turn) \u2705" + _pMan("medium"),
          "  \u26a1 cheap  \u2192 " + probed.cheap.id + " (tier: " + probed.cheap.tier + ", $" + probed.cheap.cost.toFixed(4) + "/turn) \u2705" + _pMan("cheap"),
        ]
        if (failed.length > 0) {
          lines.push("", "Probe failures (skipped):")
          for (const f of failed) lines.push("  \u274c " + f)
        }
        lines.push("", "\u2705 model-tiers.json updated.", "\ud83e\udde0 Brain slot auto-activated: " + probed.brain.id)
        return lines.join("\n")
      }

      if (action === "diagnose") {
        const results = []
        const ocConfigPaths = collectDiagnoseOpenCodeConfigPaths(deps)
        const ocConfig = ocConfigPaths.find((path) => deps.existsSync(path)) || ocConfigPaths[0] || join(deps.OPENCODE_HOME, "opencode.json")
        const apiFallbackActive = typeof deps.isApiFallback === "function" ? deps.isApiFallback() : false
        const diagnoseCascade = String(slot || "").toLowerCase() === "cascade"

        const checks = [
          { path: deps.TIERS_FILE,                                        label: "model-tiers.json"       },
          { path: ocConfig,                                            label: "opencode.json"          },
          { path: deps.STATE_FILE,                                          label: "delegation-state.json" },
        ]
        for (const c of checks) {
          results.push({
            ok: deps.existsSync(c.path),
            okLabel: deps.existsSync(c.path) ? "\u2705" : "\u274c",
            label: c.label,
            detail: deps.existsSync(c.path) ? "exists" : "missing",
            fix: deps.existsSync(c.path) ? null : (c.label === "model-tiers.json" ? "run \`vibe rebuild\` to create it" : undefined),
          })
        }
        const configuredPluginRefs = ocConfigPaths.flatMap((configPath) => {
          const ocConfigJson = readJsonFile(deps, configPath)
          return Array.isArray(ocConfigJson?.plugin)
            ? ocConfigJson.plugin.filter((entry) => String(entry || "").includes("vibeOS")).map((entry) => String(entry))
            : []
        })
        const staleConfiguredPlugin = configuredPluginRefs.find((entry) => !deps.existsSync(entry))
        const loadedPluginPath = resolveLoadedPluginPath(deps)
        results.push({
          ok: !staleConfiguredPlugin && Boolean(loadedPluginPath) && deps.existsSync(loadedPluginPath),
          okLabel: !staleConfiguredPlugin && Boolean(loadedPluginPath) && deps.existsSync(loadedPluginPath) ? "\u2705" : "\u274c",
          label: "plugin path",
          detail: staleConfiguredPlugin || loadedPluginPath || "missing",
          fix: !staleConfiguredPlugin && Boolean(loadedPluginPath) && deps.existsSync(loadedPluginPath)
            ? null
            : "run \`npx vibeostheog setup --project\` to repair stale vibeOS plugin registration",
        })
        if (diagnoseCascade) {
          results.push(...cascadeDiagnosticResults(deps))
        }

        try {
          const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"))
          for (const s of ["brain","medium","cheap"]) {
            const m = tiers?.trinity?.[s]?.oc || ""
            const ok = m.length > 0 && !m.toLowerCase().includes("placeholder")
            results.push({
              ok, okLabel: ok ? "\u2705" : "\u274c",
              label: `${s} slot`,
              detail: ok ? m : (m.length > 0 ? `placeholder: ${m}` : "unset"),
              fix: ok ? null : "run \`vibe rebuild\` to auto-assign",
            })
          }
        } catch {
          for (const s of ["brain","medium","cheap"]) {
            results.push({ ok: false, okLabel: "\u274c", label: `${s} slot`, detail: "cannot read model-tiers.json", fix: "run \`vibe rebuild\` to create it" })
          }
        }

        if (apiFallbackActive) {
          results.push({
            ok: false,
            okLabel: "\u26A0",
            label: "model probe",
            detail: "API fallback active",
            fix: "re-enter `vibe api-token <token>` to retry the remote API",
          })
        } else if (deps.currentModel || !deps.existsSync(deps.TIERS_FILE)) {
          try {
            const auth = deps._readAuth()
            const ok = await deps.probeModel(
              deps.currentModel,
              auth,
              typeof deps._loadOpenCodeProviders === "function" ? deps._loadOpenCodeProviders(deps.directory) : {},
            )
            results.push({
              ok, okLabel: ok ? "\u2705" : "\u274c",
              label: "model probe",
              detail: ok ? "API responsive" : `probe failed: ${deps.currentModel}`,
            })
          } catch {
            results.push({ ok: false, okLabel: "\u274c", label: "model probe", detail: "exception during probe" })
          }
        } else {
          results.push({ ok: false, okLabel: "\u274c", label: "model probe", detail: "no current model detected" })
        }

        const credit = deps.loadCredit()
        let budget = DIAGNOSE_BUDGET_LINES
        let totalBal = 0
        let cheapModel = ""
        try {
          const j = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"))
          cheapModel = j?.trinity?.cheap?.oc || cheapModel
          if (j?.selection?.monthly_budget_usd) budget = j.selection.monthly_budget_usd
        } catch {}
        try {
          const cache = deps.safeJsonParse(deps.readFileSync(deps.CREDIT_CACHE_F, "utf-8"))
          if (cache?.total != null) totalBal = cache.total
        } catch {}
        const apiFallbackSince = deps._apiFallbackSince || null
        results.push({
          ok: !apiFallbackActive,
          okLabel: !apiFallbackActive ? "\u2705" : "\u26A0",
          label: "api fallback",
          detail: apiFallbackActive
            ? `active${apiFallbackSince ? ` since ${apiFallbackSince}` : ""}`
            : "off",
          fix: apiFallbackActive ? "re-enter `vibe api-token <token>` to retry the remote API" : null,
        })
        const runway = typeof deps.estimateTurnsRemaining === "function"
          ? deps.estimateTurnsRemaining(totalBal, cheapModel)
          : { balanceUsd: totalBal, costPerTurn: deps.modelCostPerTurn?.(cheapModel) ?? null, turnsRemaining: null, unlimited: false }
        const runwayText = runway.costPerTurn === 0
          ? `unlimited on ${cheapModel}`
          : runway.turnsRemaining != null && runway.costPerTurn != null
            ? `${Number(runway.turnsRemaining).toLocaleString()} turns on ${cheapModel} @ $${deps.formatUsd(runway.costPerTurn)}/turn`
            : totalBal > 0
              ? `balance snapshot present; turn estimate unavailable for ${cheapModel || "cheap slot"}`
              : "n/a"
        const runwayOk = totalBal > 0 || runway.turnsRemaining != null || runway.costPerTurn === 0
        const creditOk = credit >= CREDIT_MIN_OK
        results.push({
          ok: creditOk, okLabel: creditOk ? "\u2705" : "\u274c",
          label: "credits",
          detail: `${credit}%${totalBal > 0 ? ` ($${totalBal.toFixed(2)} of $${budget})` : ` (of $${budget})`}`,
          fix: creditOk ? null : "run \`vibe medium\` to reduce spend",
        })
        results.push({
          ok: runwayOk,
          okLabel: runwayOk ? "\u2705" : "\u274c",
          label: "runway",
          detail: totalBal > 0 ? `$${totalBal.toFixed(2)} left -> ${runwayText}` : "no cached balance yet",
          fix: runwayOk ? null : "wait for a balance snapshot or configure a known cheap slot",
        })

        try {
          const state = deps.safeJsonParse(deps.readFileSync(deps.STATE_FILE, "utf-8"))
          const sessions = state?.sessions && typeof state.sessions === "object" ? state.sessions : {}
          const sid = String(deps._OC_SID || process.pid || "?")
          const ses = sessions?.[sid] || sessions?.[String(process.pid || "?")] || Object.values(sessions)[0]
          const delegationCount = ses?.warns?.length || 0
          const cacheSavings = deps.formatUsd(state?.lifetime?.cache_savings_usd || 0)
          const savingsDiag = getSessionSavingsDiagnostics(ses)
          const fw = (state?.flow_warns || []).filter(w => String(w.sid) === sid)
          const flowW = fw.filter(w => w.severity === "warn").length
          const flowH = fw.filter(w => w.severity === "hint").length
          const tdd = state?.lifetime?.tdd_enforced ?? 0
          const enf = deps.loadSelection().delegation_enforce ? " ENFORCE" : ""
          results.push({
            ok: true, okLabel: "\u2705",
            label: "session",
            detail: `${delegationCount} delegates, $${cacheSavings} cache, ${flowW}w/${flowH}h flow, ${tdd} TDD${enf}`,
          })
          results.push({
            ok: !savingsDiag.diverged,
            okLabel: !savingsDiag.diverged ? "\u2705" : "\u26A0",
            label: "savings sync",
            detail: `delegation=$${savingsDiag.delegationUsd.toFixed(4)} live=$${savingsDiag.liveUsd.toFixed(4)} warns=$${savingsDiag.warnUsd.toFixed(4)} cache=$${savingsDiag.cacheUsd.toFixed(4)}`,
            fix: savingsDiag.diverged ? "session totals diverged from warn/live snapshots — prefer persisted session totals and inspect recent footer snapshots" : null,
          })
        } catch {
          results.push({ ok: true, okLabel: "\u2705", label: "session", detail: "no state file yet" })
        }

        const okCount = results.filter(r => r.ok).length
        results.sort((a, b) => (a.ok === b.ok ? 0 : a.ok ? 1 : -1))
        const lines = [
          "\ud83d\udd0d  vibeOS \u2014 Self Diagnostic",
          "=".repeat(40),
          "",
        ]
        for (const r of results) {
          lines.push(`  ${r.okLabel} ${r.label}: ${r.detail}`)
          if (!r.ok && r.fix) lines.push(`    \u2192 ${r.fix}`)
        }
        if (okCount === results.length) {
          lines.push("", `\u2705 All ${results.length} checks passed`)
        } else {
          const failCount = results.length - okCount
          lines.push("", `\u274c ${failCount}/${results.length} checks failed \u2014 fix items above`)
        }
        return lines.join("\n")
      }

      if (action === "repair-state") {
        const mode = slot || "preview"
        if (mode !== "preview" && mode !== "apply") {
          return "\u274c Use \`vibe repair-state preview\` or \`vibe repair-state apply\`."
        }
        const cascadeChanges = previewVibeUltraXRepair(deps)
        const tiers = readJsonFile(deps, deps.TIERS_FILE) || {}
        const dstFp = deps.currentProjectFingerprint || deps.projectFingerprint(deps.directory)
        const name = deps.currentProjectName || (deps.directory ? deps.directory.split("/").pop() : "unknown")
        const idx = deps.reportsIndex()
        const byFp = new Map()
        for (const r of idx.reports || []) {
          if (r.project !== name) continue
          byFp.set(r.fingerprint, (byFp.get(r.fingerprint) || 0) + 1)
        }
        const candidates = [...byFp.entries()]
          .filter(([fp2, count]) => fp2 && fp2 !== dstFp && count > 0)
          .sort((a, b) => b[1] - a[1])
        if (candidates.length === 0 && cascadeChanges.length === 0) {
          return `No duplicate fingerprint or VibeUltraX state repair candidates found for project "${name}".`
        }
        if (candidates.length === 0) {
          const lines = [
            `State repair (${mode})`,
            `  project: ${name}`,
            `  vibeos_home: ${deps.VIBEOS_HOME || getVibeOSHome()}`,
            `  vibeultrax changes: ${cascadeChanges.length}`,
          ]
          for (const change of cascadeChanges) {
            lines.push(`  - ${change.field}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`)
          }
          if (mode === "preview") {
            lines.push("", "Run `vibe repair-state apply` to execute with backups.")
            return lines.join("\n")
          }
          const repaired = applyVibeUltraXRepair(deps)
          const agentRepair = installVibeTierAgents(deps.directory || "", tiers.trinity || {}, tiers.selection?.active_slot || null)
          lines.push("", `Applied ${repaired.changes.length} VibeUltraX state repairs.`)
          lines.push(`Applied tier-agent repairs to ${agentRepair.changed.length} OpenCode config(s).`)
          if (repaired.backups.length > 0) {
            lines.push("Backups:")
            for (const b of repaired.backups) lines.push(`  - ${b}`)
          }
          return lines.join("\n")
        }
        const [srcFp, reportCount] = candidates[0]
        const pstate = deps.loadProjectState()
        const dstBucket = deps.ensureProjectBucket(pstate, dstFp)
        const srcBucket = pstate.project_hashes?.[srcFp] || null
        const merged = deps.mergeProjectBucket(dstBucket, srcBucket)
        const lines = [
          `\u{1F6E0} State repair (${mode})`,
          `  project: ${name}`,
          `  vibeos_home: ${deps.VIBEOS_HOME || getVibeOSHome()}`,
          `  target:  ${dstFp}`,
          `  source:  ${srcFp}`,
          `  reports to relabel: ${reportCount}`,
          `  sessions: ${(dstBucket.totalSessions || 0)} + ${(srcBucket?.totalSessions || 0)} -> ${merged.totalSessions}`,
          `  bypasses: ${(dstBucket.context7Bypasses || 0)} + ${(srcBucket?.context7Bypasses || 0)} -> ${merged.context7Bypasses}`,
          `  researchChains(max): ${Math.max(dstBucket.researchChains || 0, srcBucket?.researchChains || 0)}`,
          `  vibeultrax changes: ${cascadeChanges.length}`,
        ]
        for (const change of cascadeChanges) {
          lines.push(`  - ${change.field}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`)
        }
        if (mode === "preview") {
          lines.push("", "Run \`vibe repair-state apply\` to execute with backups.")
          return lines.join("\n")
        }

        const backups = []
        const b1 = deps.backupFile(deps.PROJECT_STATE_FILE, "repair-state")
        if (b1) backups.push(b1)
        const b2 = deps.backupFile(deps.REPORTS_INDEX, "repair-state")
        if (b2) backups.push(b2)
        const cascadeRepair = applyVibeUltraXRepair(deps)
        const agentRepair = installVibeTierAgents(deps.directory || "", tiers.trinity || {}, tiers.selection?.active_slot || null)
        for (const b of cascadeRepair.backups) backups.push(b)

        pstate.project_hashes ??= {}
        pstate.project_hashes[dstFp] = merged
        delete pstate.project_hashes[srcFp]
        deps.saveProjectState(pstate)

        let relabeled = 0
        for (const r of idx.reports || []) {
          if (r.project === name && r.fingerprint === srcFp) {
            r.fingerprint = dstFp
            relabeled++
          }
        }
        deps.saveReportsIndex(idx)

        for (const r of idx.reports || []) {
          if (r.project !== name || r.fingerprint !== dstFp) continue
          const rf = join(deps.REPORTS_DIR, `${r.id}.json`)
          try {
            if (!deps.existsSync(rf)) continue
            const data = deps.safeJsonParse(deps.readFileSync(rf, "utf-8"))
            if (data?.meta?.project === name && data?.meta?.fingerprint === srcFp) {
              data.meta.fingerprint = dstFp
              deps.writeFileSync(rf, JSON.stringify(data, null, 2) + "\n")
            }
          } catch {}
        }

        lines.push("")
        lines.push(`\u2705 Applied. Relabeled ${relabeled} report index entries.`)
        lines.push(`Applied tier-agent repairs to ${agentRepair.changed.length} OpenCode config(s).`)
        if (backups.length > 0) {
          lines.push("Backups:")
          for (const b of backups) lines.push(`  - ${b}`)
        }
        return lines.join("\n")
      }

      if (action === "blackbox") {
        const mode = slot || "status"
        if (mode === "on") {
          if (typeof deps.setBlackboxEnabled === "function") deps.setBlackboxEnabled(true)
          else deps._blackboxEnabled = true
          const state = deps.loadBlackboxState()
          state.enabled = true
          deps.saveBlackboxState(state)
          return "\u2705 Blackbox decision engine ENABLED \u2014 will track resolution state and enhance system prompts."
        }
        if (mode === "off") {
          if (typeof deps.setBlackboxEnabled === "function") deps.setBlackboxEnabled(false)
          else deps._blackboxEnabled = false
          const state = deps.loadBlackboxState()
          state.enabled = false
          deps.saveBlackboxState(state)
          return "\u23F8 Blackbox decision engine DISABLED."
        }
        if (mode === "reset") {
          if (typeof deps.resetBlackboxTracker === "function") deps.resetBlackboxTracker()
          else deps._blackboxTracker = null
          const state = deps.loadBlackboxState()
          const sid = deps._OC_SID
          delete state.sessions[sid]
          deps.saveBlackboxState(state)
          return "\u{1F504} Blackbox resolution tracker RESET."
        }
        if (mode === "status") {
          const bbState = deps.loadBlackboxState()
          const enabled = bbState.enabled !== false
          const lines = [`Blackbox Decision Engine: ${enabled ? "ON" : "OFF"}`]
          if (enabled) {
            const res = deps.getLatestBlackboxState?.() || deps.getBlackboxResolution()
            if (res) {
              lines.push(`  Resolution: ${res.resolution}`)
              lines.push(`  Sub-regime: ${res.sub_regime}`)
              lines.push(`  Momentum: ${res.momentum > 0 ? "\u2191" : res.momentum < 0 ? "\u2193" : "\u2192"} ${res.momentum.toFixed(2)}`)
              lines.push(`  Interactions: ${res.n_interactions}`)
              if (res.is_looping) lines.push("  \u26A0 Looping detected \u2014 consider a fresh perspective")
            } else {
              lines.push("  No resolution data yet \u2014 start a decision session")
            }
            if (deps.currentProjectFingerprint) {
              lines.push("")
              lines.push(`  Project: ${deps.currentProjectName || "unknown"}`)
              const projectSessions = Object.entries(bbState.sessions || {}).filter(([_k, v]) => v.project_fingerprint === deps.currentProjectFingerprint)
              lines.push(`  Cross-session history: ${projectSessions.length} session(s) for this project`)
            }
          }
          lines.push("")
          lines.push("Usage: vibe blackbox on|off|status|reset")
          return lines.join("\n")
        }
        return `\u274c Use \`vibe blackbox on|off|status|reset\``
      }

      if (action === "help") {
        return [
          "vibeOS commands",
          "",
          "TIERS:",
          "  vibe status            See plugin state, credit, model assignment",
          "  vibe brain             Switch to brain tier (most capable)",
          "  vibe medium            Switch to medium tier (balanced)",
          "  vibe cheap             Switch to cheap tier (most savings)",
          "  vibe dashboard / gui   Print the live dashboard URL",
          "  vibe rebuild           Auto-detect available models",
          "",
          "CONTROLS:",
          "  vibe enable/disable    Toggle vibeOS plugin on/off",
          "  vibe enforce on        Block brain-tier writes/edits (save $$)",
          "  vibe lock on/off       Lock model at session start (skip auto-reconcile)",
          "  vibe mode <profile>   Set optimization profile (balanced|budget|quality|speed|longrun|audit|forensic|auto + branded modes)",
          "  vibe thinking full|brief|off  Set reasoning depth",
          "",
          "GUARDRAILS:",
          "  vibe flow on/off       Toggle flow enforcer (code quality checks)",
          "  vibe tdd on/off        Toggle auto test skeleton creation",
          "  vibe setup             Create a compatibility profile for new users",
          "  vibe guard             Ensure AGENTS.md/README.md exist and are current",
          "  vibe reality-check     Read live state and report only verified facts",
          "  vibe api-token <token|invalidate>  Update or invalidate VIBEOS_API_TOKEN",
          "  vibe api-token <token|invalidate>  Update or invalidate VIBEOS_API_TOKEN",
          "  vibe flow              Show flow violations this session",
          "",
          "DIAGNOSTICS:",
          "  vibe diagnose          Self-check: config, files, model probes, budget",
          "  vibe project           Project analytics and optimization tips",
          "  vibe patterns          Show learned friction/routine patterns",
          "  vibe patterns suggest  Suggest relevant patterns from similar stack projects",
          "  vibe patterns clear    Clear learned patterns for this project",
          "",
          "REPAIR:",
          "  vibe repair-state      Fix cascade/slot config drift (preview/apply)",
          "",
          "DECISION ENGINE:",
          "  vibe blackbox on/off   Toggle theWay blackbox decision engine",
          "  vibe blackbox status   View resolution state, momentum, project history",
          "  vibe blackbox reset    Clear resolution tracker for current session",
        ].join("\n")
      }

      return `\u274c Unknown action: ${action}`
    },
  }
}
