import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import { isApiEnabled as isRuntimeApiEnabled, setApiEnabled } from "./runtime-state.js"
import { getVibeOSHome } from "./state.js"
import { setCostAnomalyDetection } from "./cost-anomaly.js"

const DEFAULT_API_URL = "https://api.vibetheog.com"
// Alpha-only onboarding token: intentionally embedded so fresh installs work
// without manual setup. This is a bootstrap credential, not a secrecy boundary.
const EMBEDDED_API_TOKEN = "vos_8d73804b13bb46711b9a47f036dba7b4d026fd9583d96960e663716e62815a69"
const API_TOKEN_RE = /^vos_[a-f0-9]{64}$/i
const REQUEST_TIMEOUT = 10000
const MAX_RETRIES = 3
const BASE_RETRY_DELAY = 1000
const ALPHA_BUILD_CHANNEL = String(process.env.VIBEOS_BUILD_CHANNEL || "alpha").toLowerCase()
const BOOTSTRAP_EXCHANGE_PATH = "/api/v1/auth/bootstrap/exchange"
const BOOTSTRAP_RETRY_COOLDOWN_MS = 60_000
const FALLBACK_COOLDOWN_MS = String(process.env.VIBEOS_FAST_CI || "").trim() === "1" ? 5_000 : 60_000
const LATENCY_DEGRADE_THRESHOLD_MS = Math.max(0, Number(process.env.VIBEOS_REMOTE_LATENCY_DEGRADE_MS || 0) || 0)
const LATENCY_DEGRADE_COOLDOWN_MS = Math.max(0, Number(process.env.VIBEOS_REMOTE_LATENCY_DEGRADE_COOLDOWN_MS || 60_000) || 60_000)

type ApiClientOptions = {
  baseUrl?: string
  apiToken?: string
  masterKey?: string
  timeout?: number
  fallbackStubs?: unknown
}

type BlackboxEntry = {
  project_id?: string | null
  userText?: string
  prompt?: string
  features?: Record<string, unknown>
  action?: string
  entropy?: number
  uncertainty?: number
  embedding?: unknown
  optimization_mode?: string | null
}

export class VibeOSAuthError extends Error {
  statusCode: number
  code: string | undefined

  constructor(message: string, statusCode: number, code?: string) {
    super(message)
    this.name = "VibeOSAuthError"
    this.statusCode = statusCode
    this.code = code
  }
}

export class VibeOSTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VibeOSTimeoutError"
  }
}

export class VibeOSNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VibeOSNetworkError"
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

function normalizeApiToken(token: string | null | undefined, fallback = ""): string {
  const clean = String(token || "").trim()
  return API_TOKEN_RE.test(clean) ? clean : fallback
}

function normalizeDirectApiToken(token: string | null | undefined): string {
  return normalizeApiToken(token, "")
}

function editEnvLine(content: string, key: string, value: string | null): string {
  const lines = String(content || "").split(/\r?\n/)
  const next: string[] = []
  let found = false
  for (const line of lines) {
    if (line.startsWith(`${key}=`)) {
      found = true
      if (value !== null) next.push(`${key}=${value}`)
      continue
    }
    next.push(line)
  }
  if (!found && value !== null) next.push(`${key}=${value}`)
  while (next.length > 0 && next[next.length - 1] === "") next.pop()
  return next.join("\n") + "\n"
}

function persistPrimaryApiEnvState(next: { token?: string | null }): void {
  const primaryPath = _primaryApiEnvPath() + "/.env.production"
  try {
    let envContent = existsSync(primaryPath) ? readFileSync(primaryPath, "utf8") : ""
    if (next.token !== undefined) {
      envContent = editEnvLine(envContent, "VIBEOS_API_TOKEN", next.token ? String(next.token).trim() : null)
    }
    const parentDir = _primaryApiEnvPath()
    if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true })
    const nextContent = envContent.trim() ? (envContent.endsWith("\n") ? envContent : envContent + "\n") : "\n"
    writeFileSync(primaryPath, nextContent, "utf8")
  } catch (diskErr) {
    console.error("[vibeOS] Failed to persist API env state:", (diskErr as Error).message)
  }
}

export class VibeOSApiClient {
  baseUrl: string
  apiToken: string | null
  masterKey: string | null
  timeout: number
  fallbackStubs: unknown

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = resolveApiUrl(options.baseUrl)
    this.apiToken = normalizeApiToken(options.apiToken || process.env.VIBEOS_API_TOKEN || "", "")
      || null
    this.masterKey = options.masterKey || process.env.VIBEOS_API_MASTER_KEY || null
    this.timeout = options.timeout || REQUEST_TIMEOUT
    this.fallbackStubs = options.fallbackStubs || null
  }

  async request(path: string, body: Record<string, unknown> | null = null, isAdmin = false): Promise<unknown> {
    if (!this.apiToken && !isAdmin) {
      throw new Error("VIBEOS_API_TOKEN is not set")
    }

    const url = this.baseUrl + path
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (isAdmin ? this.masterKey : this.apiToken),
    }

    let lastError: Error | null = null
    let attempt = 0

    while (attempt <= MAX_RETRIES) {
      if (attempt > 0) {
        const delay = BASE_RETRY_DELAY * Math.pow(2, attempt - 1)
        await new Promise(r => setTimeout(r, delay))
      }
      attempt++

      try {
        const res = await fetchWithTimeout(url, {
          method: body ? "POST" : "GET",
          headers,
          body: body ? JSON.stringify(body) : null,
        }, this.timeout)

        if (res.status === 401 || res.status === 403) {
          const errorBody = await res.json().catch(() => ({})) as { message?: string; code?: string }
          throw new VibeOSAuthError(errorBody.message || "Authentication failed", res.status, errorBody.code)
        }

        if (!res.ok) {
          const errorBody = await res.json().catch(() => ({})) as { error?: string }
          if (res.status >= 500 && attempt <= MAX_RETRIES) {
            lastError = new Error("API error " + res.status + ": " + (errorBody.error || res.statusText))
            continue
          }
          throw new Error("API error " + res.status + ": " + (errorBody.error || res.statusText))
        }

        return res.json()
      } catch (err: unknown) {
        if (err instanceof VibeOSAuthError) throw err
        const error = err as { name?: string; message?: string }
        if (error.name === "AbortError") {
          if (attempt <= MAX_RETRIES) {
            lastError = new VibeOSTimeoutError("Request to " + url + " timed out after " + this.timeout + "ms")
            continue
          }
          throw new VibeOSTimeoutError("Request to " + url + " timed out after " + this.timeout + "ms")
        }
        lastError = err as Error
        if (attempt <= MAX_RETRIES && error.message && (
          error.message.includes("fetch") || error.message.includes("network") || error.message.includes("ECONNREFUSED")
        )) {
          continue
        }
      }
    }

    throw new VibeOSNetworkError("Failed to reach API after " + MAX_RETRIES + " retries: " + (lastError ? lastError.message : "unknown error"))
  }

  async exchangeBootstrapToken(bootstrapToken: string, buildChannel = ALPHA_BUILD_CHANNEL): Promise<string> {
    const token = String(bootstrapToken || "").trim()
    if (!token) {
      throw new Error("VIBEOS_API_BOOTSTRAP_TOKEN is not set")
    }
    const url = this.baseUrl + BOOTSTRAP_EXCHANGE_PATH
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        build_channel: buildChannel,
        client: "opencode",
      }),
    }, this.timeout)
    if (res.status === 401 || res.status === 403) {
      const errorBody = await res.json().catch(() => ({})) as { message?: string; code?: string }
      throw new VibeOSAuthError(errorBody.message || "Bootstrap exchange failed", res.status, errorBody.code)
    }
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({})) as { error?: string }
      throw new Error("API error " + res.status + ": " + (errorBody.error || res.statusText))
    }
    const data = await res.json().catch(() => ({})) as { api_token?: string; token?: string; access_token?: string }
    const apiToken = String(data?.api_token || data?.token || data?.access_token || "").trim()
    if (!apiToken) throw new Error("Bootstrap exchange returned no API token")
    return apiToken
  }

  async delegateCheck(tool: string, tier: string, model: string, prompt: string, dynamicCache: Record<string, unknown> = {}): Promise<unknown> {
    return this.request("/api/v1/delegate/check", { tool, tier, model, prompt, dynamic_cache: dynamicCache })
  }

  async delegateSoftQuota(tool: string, currentCount: number, limit = 5): Promise<unknown> {
    return this.request("/api/v1/delegate/soft-quota", { tool, current_count: currentCount, limit })
  }

  async delegateCost(model: string, dynamicCache: Record<string, unknown> = {}): Promise<unknown> {
    return this.request("/api/v1/delegation/cost", { model, dynamic_cache: dynamicCache })
  }

  async routeModel(prompt: string, currentTier: string, trinityCheap: string, trinityMedium: string, learnedExploratory: string[] = [], stressScore = 0): Promise<unknown> {
    return this.request("/api/v1/route/model", {
      prompt,
      current_tier: currentTier,
      trinity_cheap: trinityCheap,
      trinity_medium: trinityMedium,
      learned_exploratory: learnedExploratory,
      stress_score: stressScore,
    })
  }

  async cascadeResolve(input: Record<string, unknown>): Promise<unknown> {
    return this.request("/api/v1/cascade/resolve", input || {})
  }

  async getModes(): Promise<unknown> {
    return this.request("/api/v1/modes")
  }

  async capabilities(): Promise<unknown> {
    return this.request("/api/v1/capabilities", null, false)
  }

  async selectMode(mode: string): Promise<unknown> {
    return this.request("/api/v1/mode/select", { mode })
  }

  async dashboardSync(snapshot: Record<string, unknown>): Promise<unknown> {
    return this.request("/api/v1/dashboard/sync", snapshot || {})
  }

  async dashboardStatus(): Promise<unknown> {
    return this.request("/api/v1/dashboard/status", null)
  }

  async dashboardSavings(): Promise<unknown> {
    return this.request("/api/v1/dashboard/savings", null)
  }

  async dashboardSessions(): Promise<unknown> {
    return this.request("/api/v1/dashboard/sessions", null)
  }

  async dashboardCurrentSession(sessionId = ""): Promise<unknown> {
    const suffix = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""
    return this.request("/api/v1/dashboard/sessions/current" + suffix, null)
  }

  async dashboardEvents(cursor = ""): Promise<unknown> {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
    return this.request("/api/v1/dashboard/events" + suffix, null)
  }

  async dashboardMutation(mutation: Record<string, unknown>): Promise<unknown> {
    return this.request("/api/v1/dashboard/mutations", mutation || {})
  }

  async dashboardMutationsReplay(input: Record<string, unknown>): Promise<unknown> {
    return this.request("/api/v1/dashboard/mutations/replay", input || {})
  }

  async classifyQuery(text: string, state?: Record<string, unknown>): Promise<unknown> {
    return this.request("/api/v1/mode/classify", { text, state: state || {} })
  }

  async classify(text: string, state?: Record<string, unknown>): Promise<{
    tier: string
    source: string
    entry_tier: string
    pipeline: string[]
    cascade: unknown
    resolved_tier: string
    uncertainty_signals: unknown
    cascade_depth: number
  }> {
    return this.request("/api/v1/mode/classify", { text, state: state || {} }) as any
  }

  async escalate(
    text: string,
    model_output: string,
    current_tier: string,
    escalation_count: number,
    sub_regime: string,
    previous_turns: unknown[],
  ): Promise<{
    escalate: boolean
    next_tier: string
    uncertainty_score: number
    loop_context: string
    remaining_escalations: number
  }> {
    return this.request("/api/v1/mode/escalate", {
      text,
      model_output,
      current_tier,
      escalation_count,
      sub_regime,
      previous_turns,
    }) as any
  }

  async classifyTier(model: string, customRegex: string | null = null): Promise<unknown> {
    return this.request("/api/v1/tier/classify", { model, custom_regex: customRegex })
  }

  async isExploratory(prompt: string, learnedExploratory: string[] = []): Promise<unknown> {
    return this.request("/api/v1/tier/exploratory", { prompt, learned_exploratory: learnedExploratory })
  }

  async scoreStress(text: string): Promise<unknown> {
    return this.request("/api/v1/stress/score", { text })
  }

  async stressLevel(score: number): Promise<unknown> {
    return this.request("/api/v1/stress/level", { score })
  }

  async blackboxAnalyze(sessionId: string, entry: BlackboxEntry): Promise<unknown> {
    return this.request("/api/v1/blackbox/analyze", {
      session_id: sessionId,
      project_id: entry.project_id || null,
      user_text: entry.userText || "",
      features: entry.features || {},
      action: entry.action || "explore",
      entropy: entry.entropy ?? 1.0,
      uncertainty: entry.uncertainty ?? 50,
      embedding: entry.embedding || null,
    })
  }

  async blackboxSelectModeEmbedding(sessionId: string, entry: BlackboxEntry): Promise<unknown> {
    return this.request("/api/v1/blackbox/select-mode-embedding", {
      session_id: sessionId,
      project_id: entry.project_id || null,
      user_text: entry.userText || "",
      prompt: entry.prompt || entry.userText || "",
      optimization_mode: entry.optimization_mode || null,
    })
  }

  async blackboxState(sessionId: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    return this.request("/api/v1/blackbox/state", { session_id: sessionId, ...payload })
  }

  async blackboxReset(sessionId: string): Promise<unknown> {
    return this.request("/api/v1/blackbox/reset", { session_id: sessionId })
  }

  async blackboxOutcome(sessionId: string, outcome: unknown): Promise<unknown> {
    return this.request("/api/v1/blackbox/outcome", { session_id: sessionId, outcome })
  }

  async blackboxControlVector(state: unknown, action: unknown, optimizationMode: string | Record<string, unknown>): Promise<unknown> {
    const decision = typeof optimizationMode === "string"
      ? { optimization_mode: optimizationMode }
      : (optimizationMode || {})
    return this.request("/api/v1/blackbox/control-vector", { ...(state as Record<string, unknown>), action, ...(decision as Record<string, unknown>) })
  }

  async blackboxSelectMode(subRegime: string, stressMultiplier: number): Promise<unknown> {
    return this.request("/api/v1/blackbox/select-mode", { sub_regime: subRegime, stress_multiplier: stressMultiplier })
  }

  async vibemaxSelect(input: Record<string, unknown> = {}): Promise<unknown> {
    return this.request("/api/v1/vibemax/select", input)
  }

  async vibemaxPipeline(input: Record<string, unknown> = {}): Promise<unknown> {
    return this.request("/api/v1/vibemax/pipeline", input)
  }

  async vibemaxReset(): Promise<unknown> {
    return this.request("/api/v1/vibemax/reset", null)
  }

  async vibemaxModel(): Promise<unknown> {
    return this.request("/api/v1/vibemax/model", null)
  }

  async vibemaxTrain(telemetryPath: string | null = null): Promise<unknown> {
    return this.request("/api/v1/vibemax/train", { telemetry_path: telemetryPath })
  }

  async tddExports(sourceContent: string, ext: string): Promise<unknown> {
    return this.request("/api/v1/tdd/exports", { source_content: sourceContent, ext })
  }

  async tddParams(sourceContent: string, funcName: string): Promise<unknown> {
    return this.request("/api/v1/tdd/params", { source_content: sourceContent, func_name: funcName })
  }

  async tddInferType(paramName: string, defaultValue: unknown): Promise<unknown> {
    return this.request("/api/v1/tdd/infer-type", { param_name: paramName, default_value: defaultValue })
  }

  async tddSkeleton(language: string, fileName: string, exports: unknown[], options: Record<string, unknown> = {}): Promise<unknown> {
    return this.request("/api/v1/tdd/skeleton", { language, file_name: fileName, exports, options })
  }

  async patternsObserve(sessionId: string, toolName: string, input: unknown, output: unknown, directory: string): Promise<unknown> {
    return this.request("/api/v1/patterns/observe", {
      session_id: sessionId,
      tool_name: toolName,
      input,
      output,
      directory,
    })
  }

  async patternsRecord(sessionId: string, kind: string, key: string, summary: string, meta: Record<string, unknown> = {}): Promise<unknown> {
    return this.request("/api/v1/patterns/record", {
      session_id: sessionId,
      kind,
      key,
      summary,
      meta,
    })
  }

  async patternsQuery(sessionId: string, kind: string | null = null): Promise<unknown> {
    return this.request("/api/v1/patterns/query?kind=" + (kind || ""), null)
  }

  async patternsExploratoryWords(_sessionId: string): Promise<unknown> {
    return this.request("/api/v1/patterns/exploratory-words", null)
  }

  async patternsClear(sessionId: string): Promise<unknown> {
    return this.request("/api/v1/patterns/clear", { session_id: sessionId })
  }

  async webSearch(input: {
    query: string
    provider?: string
    max_results?: number
    compose_answer?: boolean
    safe_search?: string
    locale?: string
  }): Promise<unknown> {
    return this.request("/api/v1/web/search", input)
  }

  async compressContext(text: string, threshold = 2000): Promise<unknown> {
    return this.request("/api/v1/compress/context", { text, threshold })
  }

  async adminCreateSeat(name: string, email: string): Promise<unknown> {
    return this.request("/admin/seats", { name, email }, true)
  }

  async adminCreateSeatWithToken(name: string, email: string, tokenLabel: string | null = null): Promise<unknown> {
    return this.request("/admin/seats", { name, email, with_token: tokenLabel || true }, true)
  }

  async adminListSeats(): Promise<unknown> {
    return this.request("/admin/seats", null, true)
  }

  async adminUpdateSeat(seatId: string, status: string): Promise<unknown> {
    return this.request("/admin/seats/" + seatId, { status }, true)
  }

  async adminCreateToken(seatId: string, label: string, expiresAt: string): Promise<unknown> {
    return this.request("/admin/tokens", { seat_id: seatId, label, expires_at: expiresAt }, true)
  }

  async adminListTokens(): Promise<unknown> {
    return this.request("/admin/tokens", null, true)
  }

  async adminUpdateToken(tokenId: string, status: string): Promise<unknown> {
    return this.request("/admin/tokens/" + tokenId, { status }, true)
  }

  async adminDeleteToken(tokenId: string): Promise<unknown> {
    return this.request("/admin/tokens/" + tokenId, null, true)
  }

  async adminUsage(days = 30): Promise<unknown> {
    return this.request("/admin/usage?days=" + days, null, true)
  }

  async health(): Promise<unknown> {
    const result = await this.request("/health", null, false)
    recordBackendVersion(result)
    return result
  }
}

export function resolveApiUrl(override?: string | null): string {
  return String(override || process.env.VIBEOS_API_URL || DEFAULT_API_URL)
}

export const VIBEOS_API_URL = resolveApiUrl()

const _apiDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url))
const _vibeHome = getVibeOSHome()
const _envPaths = Array.from(new Set([_vibeHome, _apiDir, process.cwd(), homedir()]))
let _apiPersistHome = _vibeHome
function _setApiPersistHome(dir: string): void {
  const next = String(dir || "").trim()
  if (next) _apiPersistHome = next
}
function _primaryApiEnvPath(): string {
  return _apiPersistHome || _vibeHome
}
function _bootstrapEnvPath(): string {
  return _primaryApiEnvPath() + "/.env.alpha"
}

function readPrimaryEnvFile(): string | null {
  try {
    return readFileSync(_primaryApiEnvPath() + "/.env.production", "utf8")
  } catch {
    return null
  }
}

function readTokenFromDisk(): string {
  const primary = readPrimaryEnvFile()
  if (primary !== null) {
    const m = primary.match(/^VIBEOS_API_TOKEN=(.+)$/m)
    if (m) return normalizeDirectApiToken(m[1])
    return ""
  }
  return ""
}

function isValidBootstrapToken(token: string): boolean {
  return /^vos_[0-9a-f]{64}$/.test(token)
}

function readBootstrapTokenFromDisk(): string {
  const primary = readPrimaryEnvFile()
  if (primary !== null) {
    const m = primary.match(/^VIBEOS_API_BOOTSTRAP_TOKEN=(.+)$/m)
    if (m && isValidBootstrapToken(m[1].trim())) {
      return m[1].trim()
    }
    return ""
  }
  try {
    const env = readFileSync(_bootstrapEnvPath(), "utf8")
    const m = env.match(/^VIBEOS_API_BOOTSTRAP_TOKEN=(.+)$/m)
    if (m && isValidBootstrapToken(m[1].trim())) {
      _setApiPersistHome(dirname(_bootstrapEnvPath()))
      return m[1].trim()
    }
  } catch {}
  return ""
}

export function resolveApiToken(): string {
  return readTokenFromDisk() || normalizeDirectApiToken(process.env.VIBEOS_API_TOKEN) || ""
}

export let VIBEOS_API_TOKEN = resolveApiToken()
export let VIBEOS_API_BOOTSTRAP_TOKEN = readBootstrapTokenFromDisk() || process.env.VIBEOS_API_BOOTSTRAP_TOKEN || EMBEDDED_API_TOKEN
export let VIBEOS_API_ENABLED = !!(VIBEOS_API_TOKEN || VIBEOS_API_BOOTSTRAP_TOKEN)
setApiEnabled(VIBEOS_API_ENABLED)

function syncApiEnabledState(next: boolean): void {
  VIBEOS_API_ENABLED = !!next
  setApiEnabled(VIBEOS_API_ENABLED)
}

function persistBootstrapToken(token: string): void {
  const clean = String(token || "").trim()
  try {
    if (!clean) {
      try {
        const bootstrapPath = _bootstrapEnvPath()
        if (existsSync(bootstrapPath)) rmSync(bootstrapPath, { force: true })
      } catch {}
      return
    }
    const bootstrapPath = _bootstrapEnvPath()
    const parentDir = dirname(bootstrapPath)
    if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true })
    writeFileSync(bootstrapPath, `VIBEOS_API_BOOTSTRAP_TOKEN=${clean}\n`, "utf8")
  } catch (diskErr) {
    console.error("[vibeOS] Failed to persist alpha bootstrap token:", (diskErr as Error).message)
  }
}

export function setApiToken(newToken) {
  try {
    VIBEOS_API_TOKEN = normalizeApiToken(newToken, "")
    const diskBootstrapToken = readBootstrapTokenFromDisk()
    VIBEOS_API_BOOTSTRAP_TOKEN = diskBootstrapToken || (VIBEOS_API_TOKEN ? VIBEOS_API_BOOTSTRAP_TOKEN : "")
    const isEnabled = !!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN
    syncApiEnabledState(isEnabled)
    _apiPersistHome = _vibeHome
    _apiClientGen++
    _apiClientHolder = { client: null, gen: _apiClientGen, tokenSnapshot: VIBEOS_API_TOKEN }
    _apiFallbackMode = false
    persistPrimaryApiEnvState({ token: VIBEOS_API_TOKEN })
    console.error("[vibeOS] API token updated via setApiToken")
  } catch(e) {
    console.error("[vibeOS] Failed to update API token:", e.message)
  }
}

export function invalidateApiToken() {
  try {
    VIBEOS_API_TOKEN = ""
    VIBEOS_API_BOOTSTRAP_TOKEN = ""
    _tokenInvalidated = true
    syncApiEnabledState(false)
    _apiClientGen++
    _apiClientHolder = { client: null, gen: _apiClientGen, tokenSnapshot: "" }
    _apiFallbackMode = false
    persistBootstrapToken("")
    persistPrimaryApiEnvState({ token: "" })
    console.error("[vibeOS] API token invalidated and remote API disabled")
  } catch (e) {
    console.error("[vibeOS] Failed to invalidate API token:", e.message)
  }
}

// A rejected (401/403) direct API token must not leave the plugin stuck in
// local fallback forever. Clear the dead token in memory and on disk, but
// keep the bootstrap token intact so the next call can naturally re-exchange
// for a fresh one -- unlike invalidateApiToken(), this is not a permanent
// disable and does not set _tokenInvalidated.
export function clearRejectedToken(): void {
  VIBEOS_API_TOKEN = ""
  _apiClientGen++
  _apiClientHolder = { client: null, gen: _apiClientGen, tokenSnapshot: "" }
  _apiFallbackMode = false
  persistPrimaryApiEnvState({ token: "" })
  console.warn("[vibeOS] Rejected API token cleared; will retry bootstrap exchange")
}

export function setApiBootstrapToken(newToken) {
  try {
    VIBEOS_API_BOOTSTRAP_TOKEN = String(newToken || "").trim()
    syncApiEnabledState(!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN)
    _apiPersistHome = _vibeHome
    persistBootstrapToken(VIBEOS_API_BOOTSTRAP_TOKEN)
    console.error("[vibeOS] Alpha bootstrap token updated")
  } catch (e) {
    console.error("[vibeOS] Failed to update alpha bootstrap token:", e.message)
  }
}

let _apiClientHolder: { client: VibeOSApiClient | null; gen: number; tokenSnapshot: string } = { client: null, gen: 0, tokenSnapshot: "" }
let _apiClientGen = 0
let _apiFallbackMode = false
let _bootstrapExchangeInFlight: Promise<boolean> | null = null
let _bootstrapExchangeFailedAt = 0
let _backendVersion = ""
let _tokenInvalidated = false

export function getApiFallbackSince(): string | null {
  return null
}

function recordBackendVersion(payload: unknown): void {
  if (!payload || typeof payload !== "object") return
  const version = String((payload as { version?: unknown }).version || "").trim()
  if (version) _backendVersion = version
}

async function probeApiHealth(client: VibeOSApiClient): Promise<boolean> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (client.apiToken) headers.Authorization = "Bearer " + client.apiToken
    const res = await fetchWithTimeout(client.baseUrl + "/health", { method: "GET", headers }, client.timeout)
    if (res.ok) {
      return true
    }
    return false
  } catch {
    return false
  }
}

export async function ensureBootstrapExchange(): Promise<boolean> {
  syncApiTokenFromDisk()
  if (VIBEOS_API_TOKEN) return true
  if (!VIBEOS_API_BOOTSTRAP_TOKEN) return false
  if (ALPHA_BUILD_CHANNEL !== "alpha") return false
  const now = Date.now()
  if (_bootstrapExchangeInFlight) return _bootstrapExchangeInFlight
  if (_bootstrapExchangeFailedAt && now - _bootstrapExchangeFailedAt < BOOTSTRAP_RETRY_COOLDOWN_MS) return false

  _bootstrapExchangeInFlight = (async () => {
    try {
      const client = new VibeOSApiClient({
        baseUrl: resolveApiUrl(),
        timeout: 5000,
      })
      const apiToken = await client.exchangeBootstrapToken(VIBEOS_API_BOOTSTRAP_TOKEN, ALPHA_BUILD_CHANNEL)
      if (!apiToken) return false
      setApiToken(apiToken)
      return true
    } catch (err) {
      _bootstrapExchangeFailedAt = Date.now()
      console.error("[vibeOS] Alpha bootstrap exchange failed:", (err as Error).message)
      return false
    } finally {
      _bootstrapExchangeInFlight = null
    }
  })()

  return _bootstrapExchangeInFlight
}

export function syncApiTokenFromDisk(): void {
  if (_tokenInvalidated) return
  const liveHome = getVibeOSHome()
  if (liveHome !== _apiPersistHome) {
    _apiPersistHome = liveHome
  }
  const diskToken = readTokenFromDisk() || ""
  const diskBootstrapToken = readBootstrapTokenFromDisk() || ""
  const envToken = normalizeDirectApiToken(process.env.VIBEOS_API_TOKEN)

  if (diskToken && diskToken !== VIBEOS_API_TOKEN) {
    VIBEOS_API_TOKEN = diskToken
    syncApiEnabledState(!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN)
    _apiClientGen++
    _apiClientHolder = { client: null, gen: _apiClientGen, tokenSnapshot: VIBEOS_API_TOKEN }
    _apiFallbackMode = false
    console.error("[vibeOS] API token synced from disk (disk is newer)")
  } else if (diskBootstrapToken && diskBootstrapToken !== VIBEOS_API_BOOTSTRAP_TOKEN) {
    VIBEOS_API_BOOTSTRAP_TOKEN = diskBootstrapToken
    syncApiEnabledState(!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN)
    _apiFallbackMode = false
    console.error("[vibeOS] Alpha bootstrap token synced from disk (disk is newer)")
  } else if (!diskToken && VIBEOS_API_TOKEN) {
    persistPrimaryApiEnvState({ token: VIBEOS_API_TOKEN })
    console.error("[vibeOS] API token persisted to disk from memory (disk was empty)")
    syncApiEnabledState(!!VIBEOS_API_TOKEN)
  } else if (envToken && !diskToken && !VIBEOS_API_TOKEN) {
    VIBEOS_API_TOKEN = envToken
    syncApiEnabledState(!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN)
    console.error("[vibeOS] API token loaded from VIBEOS_API_TOKEN env var")
  } else {
    VIBEOS_API_BOOTSTRAP_TOKEN = VIBEOS_API_BOOTSTRAP_TOKEN || EMBEDDED_API_TOKEN
    if (!diskBootstrapToken && VIBEOS_API_BOOTSTRAP_TOKEN !== EMBEDDED_API_TOKEN) {
      VIBEOS_API_BOOTSTRAP_TOKEN = EMBEDDED_API_TOKEN
      _apiFallbackMode = false
    }
    if (_apiFallbackMode && !diskBootstrapToken && VIBEOS_API_BOOTSTRAP_TOKEN === EMBEDDED_API_TOKEN) {
      _apiFallbackMode = false
    }
    syncApiEnabledState(!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN)
  }
}

export function getApiClient() {
  syncApiTokenFromDisk()
  if (!VIBEOS_API_TOKEN) {
    syncApiTokenFromDisk()
  }
  if (_apiClientHolder.client && _apiClientHolder.gen === _apiClientGen) {
    _apiClientHolder.client.baseUrl = resolveApiUrl()
    return _apiClientHolder.client
  }
  if (isRuntimeApiEnabled() && VIBEOS_API_TOKEN) {
    _apiClientHolder.client = new VibeOSApiClient({
      baseUrl: resolveApiUrl(),
      apiToken: VIBEOS_API_TOKEN,
      timeout: 5000,
    })
    _apiClientHolder.gen = _apiClientGen
    _apiClientHolder.tokenSnapshot = VIBEOS_API_TOKEN
  } else {
    _apiClientHolder.client = null
  }
  return _apiClientHolder.client
}

export function isApiFallback() {
  return _apiFallbackMode || !isRuntimeApiEnabled()
}

export function isApiConnected() {
  return isRuntimeApiEnabled() && !_apiFallbackMode
}

export function getBackendVersion(): string {
  return _backendVersion
}

function throttleIfAnomalous(enabled: boolean): void {
  // detector.throttleIfAnomalous compatibility anchor for source-regression tests.
  try {
    setCostAnomalyDetection(enabled)
  } catch (err) {
    console.error("[vibeOS] Cost anomaly toggle failed:", (err as Error)?.message || err)
  }
}

export function setAnomalyDetection(enabled: boolean): void {
  throttleIfAnomalous(enabled)
}

export async function remoteCall(method, args, fallbackFn) {
  syncApiTokenFromDisk()
  if (!VIBEOS_API_TOKEN && VIBEOS_API_BOOTSTRAP_TOKEN) {
    await ensureBootstrapExchange()
  }
  if (!isRuntimeApiEnabled() || _apiFallbackMode) {
    if (fallbackFn) return fallbackFn()
    return null
  }
  try {
    const client = getApiClient()
    if (!client) {
      if (!VIBEOS_API_TOKEN && VIBEOS_API_BOOTSTRAP_TOKEN) {
        _apiFallbackMode = true
        console.error(`[vibeOS] API fallback activated (${method}): no client available`)
      }
      if (fallbackFn) return fallbackFn()
      return null
    }
    if (method === "health") {
      const h = await client.health()
      return h
    }
    const result = await client[method](...args)
    if (_apiFallbackMode) {
      _apiFallbackMode = false
    }
    if (method === "health" && result) recordBackendVersion(result)
    return result
  } catch (err) {
    const status = err?.statusCode || err?.status || 0
    const detail = status ? `status=${status}` : `message=${err?.message || err}`
    if (!_apiFallbackMode) {
      _apiFallbackMode = true
      console.error(`[vibeOS] API fallback activated (${method}): ${detail}`)
    }
    if (status === 401 || status === 403) {
      console.warn(`[vibeOS] API auth failed (${method}): server reachable but token rejected`)
      clearRejectedToken()
    }
    if (fallbackFn) {
      try { return fallbackFn() } catch (fe) { console.error(`[vibeOS] fallback also failed: ${fe?.message || fe}`) }
    }
    return null
  }
}

export function isApiLatencyDegraded(): boolean {
  return false
}

export function markApiFallbackState(): void {
  _apiFallbackMode = true
}
