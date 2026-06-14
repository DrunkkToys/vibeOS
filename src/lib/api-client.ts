// @ts-nocheck

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import { isApiConnected as isRuntimeApiConnected, isApiEnabled as isRuntimeApiEnabled, isApiFallbackMode as isRuntimeApiFallbackMode, markApiConnected, markApiDisconnected, resetApiConnection, setApiEnabled } from "./runtime-state.js"

const DEFAULT_API_URL = "https://api.vibetheog.com"
// Alpha-only onboarding token: intentionally embedded so fresh installs work
// without manual setup. This is a bootstrap credential, not a secrecy boundary.
const EMBEDDED_API_TOKEN = "vos_8d73804b13bb46711b9a47f036dba7b4d026fd9583d96960e663716e62815a69"
const API_TOKEN_RE = /^vos_[a-f0-9]{64}$/i
const API_DISABLED_RE = /^(1|true|yes|on)$/i
const REQUEST_TIMEOUT = 10000
const MAX_RETRIES = 3
const BASE_RETRY_DELAY = 1000
const ALPHA_BUILD_CHANNEL = String(process.env.VIBEOS_BUILD_CHANNEL || "alpha").toLowerCase()
const BOOTSTRAP_EXCHANGE_PATH = "/api/v1/auth/bootstrap/exchange"
const BOOTSTRAP_RETRY_COOLDOWN_MS = 60_000

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
  features?: Record<string, unknown>
  action?: string
  entropy?: number
  uncertainty?: number
  embedding?: unknown
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

const ANOMALY_BURST_WINDOW_MS = 5000
const ANOMALY_BURST_THRESHOLD = 10
const ANOMALY_FREQ_WINDOW_MS = 600_000
const ANOMALY_STDDEV_FACTOR = 3
const ANOMALY_WARMUP_MS = 30_000
const ANOMALY_COOLDOWN_MS = 120_000

class TokenAnomalyDetector {
  burstHistory: number[] = []
  freqHistory: number[] = []
  lastWarnTime = 0
  anomalyTriggered = false
  disabled = false
  startedAt = Date.now()

  get isWarmup(): boolean {
    return Date.now() - this.startedAt < ANOMALY_WARMUP_MS
  }

  record(): void {
    if (this.disabled || this.isWarmup) return
    const now = Date.now()
    this.burstHistory = this.burstHistory.filter(t => now - t < ANOMALY_BURST_WINDOW_MS)
    this.burstHistory.push(now)
    this.freqHistory.push(now)
  }

  checkBurst(): boolean {
    return this.burstHistory.length > ANOMALY_BURST_THRESHOLD
  }

  checkFrequency(): boolean {
    const now = Date.now()
    const window = this.freqHistory.filter(t => now - t < ANOMALY_FREQ_WINDOW_MS)
    if (window.length < 10) return false
    const mean = window.length / (ANOMALY_FREQ_WINDOW_MS / 60_000)
    const recent = this.burstHistory.length / (ANOMALY_BURST_WINDOW_MS / 1000)
    return recent > mean * ANOMALY_STDDEV_FACTOR
  }

  throttleIfAnomalous(): boolean {
    const now = Date.now()
    if (this.disabled || this.isWarmup) return false
    if (this.anomalyTriggered) return true
    if (this.checkBurst() || this.checkFrequency()) {
      this.anomalyTriggered = true
      this.lastWarnTime = now
      console.error("[vibeOS] Token anomaly detected — throttling API calls")
      return true
    }
    if (this.lastWarnTime && now - this.lastWarnTime > ANOMALY_COOLDOWN_MS) {
      this.anomalyTriggered = false
    }
    return this.anomalyTriggered
  }

  reset(): void {
    this.burstHistory = []
    this.freqHistory = []
    this.anomalyTriggered = false
    this.lastWarnTime = 0
  }
}

function normalizeApiToken(token: string | null | undefined, fallback = ""): string {
  const clean = String(token || "").trim()
  return API_TOKEN_RE.test(clean) ? clean : fallback
}

function normalizeDirectApiToken(token: string | null | undefined): string {
  const clean = normalizeApiToken(token, "")
  return clean && clean !== EMBEDDED_API_TOKEN ? clean : ""
}

function isTruthyFlag(value: string | null | undefined): boolean {
  return API_DISABLED_RE.test(String(value || "").trim())
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

function persistPrimaryApiEnvState(next: { token?: string | null; disabled?: boolean | null }): void {
  const primaryPath = _envPaths[0] + "/.env.production"
  try {
    let envContent = existsSync(primaryPath) ? readFileSync(primaryPath, "utf8") : ""
    if (next.disabled !== undefined) {
      envContent = editEnvLine(envContent, "VIBEOS_API_DISABLED", next.disabled ? "true" : null)
    }
    if (next.token !== undefined) {
      envContent = editEnvLine(envContent, "VIBEOS_API_TOKEN", next.token ? String(next.token).trim() : null)
    }
    if (!envContent.trim()) {
      try {
        if (existsSync(primaryPath)) rmSync(primaryPath, { force: true })
      } catch {}
      return
    }
    const parentDir = _envPaths[0]
    if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true })
    writeFileSync(primaryPath, envContent.endsWith("\n") ? envContent : envContent + "\n", "utf8")
  } catch (diskErr) {
    console.error("[vibeOS] Failed to persist API env state:", (diskErr as Error).message)
  }
}

export class VibeOSApiClient {
  baseUrl: string
  apiToken: string | null
  masterKey: string | null
  timeout: number
  fallbackMode: boolean
  fallbackStubs: unknown

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl || process.env.VIBEOS_API_URL || DEFAULT_API_URL
    this.apiToken = normalizeApiToken(options.apiToken || process.env.VIBEOS_API_TOKEN || "", "")
      || null
    this.masterKey = options.masterKey || process.env.VIBEOS_API_MASTER_KEY || null
    this.timeout = options.timeout || REQUEST_TIMEOUT
    this.fallbackMode = false
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
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.timeout)

        const res = await fetch(url, {
          method: body ? "POST" : "GET",
          headers,
          body: body ? JSON.stringify(body) : null,
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (res.status === 401 || res.status === 403) {
          const errorBody = await res.json().catch(() => ({})) as { message?: string; code?: string }
          this.fallbackMode = true
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

        this.fallbackMode = false
        return res.json()
      } catch (err: unknown) {
        if (err instanceof VibeOSAuthError) throw err
        const error = err as { name?: string; message?: string }
        if (error.name === "AbortError") {
          if (attempt <= MAX_RETRIES) {
            lastError = new VibeOSTimeoutError("Request to " + url + " timed out after " + this.timeout + "ms")
            continue
          }
          this.fallbackMode = true
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

    this.fallbackMode = true
    throw new VibeOSNetworkError("Failed to reach API after " + MAX_RETRIES + " retries: " + (lastError ? lastError.message : "unknown error"))
  }

  async exchangeBootstrapToken(bootstrapToken: string, buildChannel = ALPHA_BUILD_CHANNEL): Promise<string> {
    const token = String(bootstrapToken || "").trim()
    if (!token) {
      throw new Error("VIBEOS_API_BOOTSTRAP_TOKEN is not set")
    }
    const url = this.baseUrl + BOOTSTRAP_EXCHANGE_PATH
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          build_channel: buildChannel,
          client: "opencode",
        }),
        signal: controller.signal,
      })
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
    } finally {
      clearTimeout(timeoutId)
    }
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

  async getModes(): Promise<unknown> {
    return this.request("/api/v1/modes", {}, "GET")
  }

  async selectMode(mode: string): Promise<unknown> {
    return this.request("/api/v1/mode/select", { mode })
  }

  async classifyQuery(text: string, state?: Record<string, unknown>): Promise<unknown> {
    return this.request("/api/v1/mode/classify", { text, state: state || {} })
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

  async blackboxState(sessionId: string): Promise<unknown> {
    return this.request("/api/v1/blackbox/state", { session_id: sessionId })
  }

  async blackboxReset(sessionId: string): Promise<unknown> {
    return this.request("/api/v1/blackbox/reset", { session_id: sessionId })
  }

  async blackboxOutcome(sessionId: string, outcome: unknown): Promise<unknown> {
    return this.request("/api/v1/blackbox/outcome", { session_id: sessionId, outcome })
  }

  async blackboxCalibrate(projectId: string): Promise<unknown> {
    return this.request("/api/v1/blackbox/calibrate", { project_id: projectId || "global" })
  }

  async blackboxCalibration(projectId: string): Promise<unknown> {
    return this.request("/api/v1/blackbox/calibration?project_id=" + (projectId || "global"), null)
  }

  async blackboxControlVector(state: unknown, action: unknown, optimizationMode: string): Promise<unknown> {
    return this.request("/api/v1/blackbox/control-vector", { ...(state as Record<string, unknown>), action, optimization_mode: optimizationMode })
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

  async patternsExploratoryWords(sessionId: string): Promise<unknown> {
    return this.request("/api/v1/patterns/exploratory-words", null)
  }

  async patternsClear(sessionId: string): Promise<unknown> {
    return this.request("/api/v1/patterns/clear", { session_id: sessionId })
  }

  async pricingFetch(openrouterKey: string, force = false): Promise<unknown> {
    return this.request("/api/v1/pricing/fetch", { openrouter_key: openrouterKey, force })
  }

  async pricingLookup(model: string): Promise<unknown> {
    return this.request("/api/v1/pricing/lookup", { model })
  }

  async pricingStatic(): Promise<unknown> {
    return this.request("/api/v1/pricing/static", null)
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

  isFallback(): boolean {
    return this.fallbackMode
  }
}

// ── Remote API client (Phase 2) ─────────────────────────────────────
export const VIBEOS_API_URL = process.env.VIBEOS_API_URL || "https://api.vibetheog.com"

const _apiDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url))
const _envPaths = [homedir() + "/.claude", _apiDir, process.cwd(), homedir()]
const _bootstrapEnvPath = _envPaths[0] + "/.env.alpha"

function readApiDisabledFromDisk(): boolean {
  for (const dir of _envPaths) {
    try {
      const env = readFileSync(dir + "/.env.production", "utf8")
      const m = env.match(/^VIBEOS_API_DISABLED=(.+)$/m)
      if (m && isTruthyFlag(m[1])) return true
    } catch {}
  }
  return false
}

function readTokenFromDisk(): string {
  if (readApiDisabledFromDisk()) return ""
  for (const dir of _envPaths) {
    try {
      const env = readFileSync(dir + "/.env.production", "utf8")
      const m = env.match(/^VIBEOS_API_TOKEN=(.+)$/m)
      if (m) {
        const clean = normalizeDirectApiToken(m[1])
        if (clean) return clean
      }
    } catch {}
  }
  return ""
}

function hasPrimaryTokenOnDisk(): boolean {
  if (readApiDisabledFromDisk()) return false
  try {
    const env = readFileSync(_envPaths[0] + "/.env.production", "utf8")
    return /^VIBEOS_API_TOKEN=/m.test(env)
  } catch {
    return false
  }
}

function readBootstrapTokenFromDisk(): string {
  if (readApiDisabledFromDisk()) return ""
  try {
    const env = readFileSync(_bootstrapEnvPath, "utf8")
    const m = env.match(/^VIBEOS_API_BOOTSTRAP_TOKEN=(.+)$/m)
    if (m) return m[1].trim()
  } catch {}
  return ""
}

export let VIBEOS_API_DISABLED = readApiDisabledFromDisk() || isTruthyFlag(process.env.VIBEOS_API_DISABLED)
export let VIBEOS_API_TOKEN = VIBEOS_API_DISABLED ? "" : (readTokenFromDisk() || normalizeDirectApiToken(process.env.VIBEOS_API_TOKEN) || (!hasPrimaryTokenOnDisk() ? EMBEDDED_API_TOKEN : ""))
export let VIBEOS_API_BOOTSTRAP_TOKEN = VIBEOS_API_DISABLED ? "" : (readBootstrapTokenFromDisk() || process.env.VIBEOS_API_BOOTSTRAP_TOKEN || EMBEDDED_API_TOKEN)
export let VIBEOS_API_ENABLED = !VIBEOS_API_DISABLED && process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN)
setApiEnabled(VIBEOS_API_ENABLED)

function syncApiEnabledState(next: boolean): void {
  VIBEOS_API_ENABLED = !!next
  setApiEnabled(VIBEOS_API_ENABLED)
}

let _anomalyDetector: TokenAnomalyDetector | null = null

function getAnomalyDetector(): TokenAnomalyDetector {
  if (!_anomalyDetector) _anomalyDetector = new TokenAnomalyDetector()
  return _anomalyDetector
}

export function setAnomalyDetection(enabled: boolean): void {
  const d = getAnomalyDetector()
  d.disabled = !enabled
  if (enabled) d.reset()
  console.error(`[vibeOS] Anomaly detection ${enabled ? "enabled" : "disabled"}`)
}

function persistBootstrapToken(token: string): void {
  const clean = String(token || "").trim()
  try {
    if (!clean) {
      try {
        if (existsSync(_bootstrapEnvPath)) rmSync(_bootstrapEnvPath, { force: true })
      } catch {}
      return
    }
    const parentDir = _envPaths[0]
    if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true })
    writeFileSync(_bootstrapEnvPath, `VIBEOS_API_BOOTSTRAP_TOKEN=${clean}\n`, "utf8")
  } catch (diskErr) {
    console.error("[vibeOS] Failed to persist alpha bootstrap token:", (diskErr as Error).message)
  }
}

export function setApiToken(newToken) {
  try {
    VIBEOS_API_DISABLED = false
    VIBEOS_API_TOKEN = normalizeDirectApiToken(newToken)
    VIBEOS_API_BOOTSTRAP_TOKEN = readBootstrapTokenFromDisk() || VIBEOS_API_BOOTSTRAP_TOKEN
    syncApiEnabledState(process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN))
    _apiClient = null
    _apiFallbackMode = false
    _apiFallbackSince = null
    persistPrimaryApiEnvState({ token: VIBEOS_API_TOKEN, disabled: false })
    if (_anomalyDetector) _anomalyDetector.reset()
    markApiConnected()
    console.error("[vibeOS] API token updated via setApiToken")
  } catch(e) {
    console.error("[vibeOS] Failed to update API token:", e.message)
  }
}

export function invalidateApiToken() {
  try {
    VIBEOS_API_DISABLED = true
    VIBEOS_API_TOKEN = ""
    VIBEOS_API_BOOTSTRAP_TOKEN = ""
    syncApiEnabledState(false)
    _apiClient = null
    _apiFallbackMode = false
    _apiFallbackSince = null
    if (_anomalyDetector) _anomalyDetector.reset()
    persistBootstrapToken("")
    persistPrimaryApiEnvState({ token: "", disabled: true })
    resetApiConnection()
    console.error("[vibeOS] API token invalidated and remote API disabled")
  } catch (e) {
    console.error("[vibeOS] Failed to invalidate API token:", e.message)
  }
}

export function setApiBootstrapToken(newToken) {
  try {
    VIBEOS_API_DISABLED = false
    VIBEOS_API_BOOTSTRAP_TOKEN = String(newToken || "").trim()
    syncApiEnabledState(process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN))
    markApiConnected()
    persistPrimaryApiEnvState({ disabled: false })
    persistBootstrapToken(VIBEOS_API_BOOTSTRAP_TOKEN)
    console.error("[vibeOS] Alpha bootstrap token updated")
  } catch (e) {
    console.error("[vibeOS] Failed to update alpha bootstrap token:", e.message)
  }
}

let _apiClient = null
let _apiFallbackMode = false
let _apiFallbackSince = null
let _bootstrapExchangeInFlight: Promise<boolean> | null = null
let _bootstrapExchangeFailedAt = 0
let _backendVersion = ""

const FALLBACK_COOLDOWN_MS = process.env.VIBEOS_FAST_CI === "1" ? 5_000 : 60_000

function tryResetFallbackCooldown(): boolean {
  if (!_apiFallbackMode || !_apiFallbackSince) return false
  const elapsed = Date.now() - new Date(_apiFallbackSince).getTime()
  if (elapsed > FALLBACK_COOLDOWN_MS) {
    _apiFallbackMode = false
    _apiFallbackSince = null
    markApiConnected()
    return true
  }
  return false
}

export function getApiFallbackSince(): string | null {
  return _apiFallbackSince
}

function recordBackendVersion(payload: unknown): void {
  if (!payload || typeof payload !== "object") return
  const version = String((payload as { version?: unknown }).version || "").trim()
  if (version) _backendVersion = version
}

export async function ensureBootstrapExchange(): Promise<boolean> {
  syncApiTokenFromDisk()
  if (VIBEOS_API_DISABLED) return false
  if (VIBEOS_API_TOKEN) return true
  if (!VIBEOS_API_BOOTSTRAP_TOKEN) return false
  if (ALPHA_BUILD_CHANNEL !== "alpha") return false
  const now = Date.now()
  if (_bootstrapExchangeInFlight) return _bootstrapExchangeInFlight
  if (_bootstrapExchangeFailedAt && now - _bootstrapExchangeFailedAt < BOOTSTRAP_RETRY_COOLDOWN_MS) return false

  _bootstrapExchangeInFlight = (async () => {
    try {
      const client = new VibeOSApiClient({
        baseUrl: VIBEOS_API_URL,
        timeout: 5000,
      })
      const apiToken = await client.exchangeBootstrapToken(VIBEOS_API_BOOTSTRAP_TOKEN, ALPHA_BUILD_CHANNEL)
      if (!apiToken) return false
      setApiToken(apiToken)
      markApiConnected()
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

function syncApiTokenFromDisk(): void {
  const diskDisabled = readApiDisabledFromDisk() || isTruthyFlag(process.env.VIBEOS_API_DISABLED)
  const diskToken = readTokenFromDisk() || ""
  const diskBootstrapToken = readBootstrapTokenFromDisk() || ""
  const envToken = normalizeDirectApiToken(process.env.VIBEOS_API_TOKEN)

  if (diskDisabled) {
    if (!VIBEOS_API_DISABLED || VIBEOS_API_TOKEN || VIBEOS_API_BOOTSTRAP_TOKEN || VIBEOS_API_ENABLED) {
      VIBEOS_API_DISABLED = true
      VIBEOS_API_TOKEN = ""
      VIBEOS_API_BOOTSTRAP_TOKEN = ""
      syncApiEnabledState(false)
      _apiClient = null
      _apiFallbackMode = false
      _apiFallbackSince = null
      resetApiConnection()
      console.error("[vibeOS] API token disabled from disk (alpha kill switch active)")
    }
    return
  }

  if (diskToken && diskToken !== VIBEOS_API_TOKEN) {
    VIBEOS_API_DISABLED = false
    VIBEOS_API_TOKEN = diskToken
    syncApiEnabledState(process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN))
    _apiClient = null
    _apiFallbackMode = false
    _apiFallbackSince = null
    markApiConnected()
    console.error("[vibeOS] API token synced from disk (disk is newer)")
  } else if (diskBootstrapToken && diskBootstrapToken !== VIBEOS_API_BOOTSTRAP_TOKEN) {
    VIBEOS_API_DISABLED = false
    VIBEOS_API_BOOTSTRAP_TOKEN = diskBootstrapToken
    syncApiEnabledState(process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN))
    _apiFallbackMode = false
    _apiFallbackSince = null
    markApiConnected()
    console.error("[vibeOS] Alpha bootstrap token synced from disk (disk is newer)")
  } else if (!diskToken && VIBEOS_API_TOKEN) {
    persistPrimaryApiEnvState({ token: VIBEOS_API_TOKEN, disabled: false })
    console.error("[vibeOS] API token persisted to disk from memory (disk was empty)")
    syncApiEnabledState(process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN)
    markApiConnected()
  } else if (envToken && !diskToken && !VIBEOS_API_TOKEN) {
    VIBEOS_API_DISABLED = false
    VIBEOS_API_TOKEN = envToken
    syncApiEnabledState(process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN))
    markApiConnected()
    console.error("[vibeOS] API token loaded from VIBEOS_API_TOKEN env var")
  } else {
    VIBEOS_API_DISABLED = false
    if (!VIBEOS_API_TOKEN && !hasPrimaryTokenOnDisk()) {
      VIBEOS_API_TOKEN = EMBEDDED_API_TOKEN
    }
    VIBEOS_API_BOOTSTRAP_TOKEN ||= EMBEDDED_API_TOKEN
    syncApiEnabledState(process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN))
    markApiConnected()
  }
}

export function getApiClient() {
  syncApiTokenFromDisk()
  if (!_apiClient && isRuntimeApiEnabled() && VIBEOS_API_TOKEN) {
    _apiClient = new VibeOSApiClient({
      baseUrl: VIBEOS_API_URL,
      apiToken: VIBEOS_API_TOKEN,
      timeout: 5000,
    })
  }
  return _apiClient
}

export function isApiFallback() {
  return _apiFallbackMode || isRuntimeApiFallbackMode() || !isRuntimeApiEnabled()
}

export function isApiConnected() {
  tryResetFallbackCooldown()
  return isRuntimeApiEnabled()
}

export function getBackendVersion(): string {
  return _backendVersion
}

export async function remoteCall(method, args, fallbackFn) {
  syncApiTokenFromDisk()
  if (!VIBEOS_API_TOKEN && VIBEOS_API_BOOTSTRAP_TOKEN) {
    await ensureBootstrapExchange()
    syncApiTokenFromDisk()
  }
  if (tryResetFallbackCooldown()) {
    console.warn("[vibeOS] API fallback cooldown expired — retrying API")
  }
  if (!isRuntimeApiEnabled() || _apiFallbackMode) {
    if (fallbackFn) return fallbackFn()
    return null
  }

  const detector = getAnomalyDetector()
  detector.record()
  if (detector.throttleIfAnomalous()) {
    // Don't set _apiFallbackMode — detector's own cooldown resets it.
    // This lets the API retry naturally after the throttle window.
    if (fallbackFn) return fallbackFn()
    return null
  }

  try {
    const client = getApiClient()
    if (!client) { if (fallbackFn) return fallbackFn(); return null }
    const result = await client[method](...args)
    if (method === "health") recordBackendVersion(result)
    if (_apiFallbackMode) {
      _apiFallbackMode = false
      _apiFallbackSince = null
      console.warn(`[vibeOS] API reconnected — ${method} OK`)
    }
    _apiFallbackMode = false
    _apiFallbackSince = null
    markApiConnected()
    return result
  } catch (err) {
    const status = err?.statusCode || err?.status || 0
    const body = err?.response?.body || err?.body || ""
    const bodyPreview = typeof body === "string" ? body.substring(0, 120) : String(body).substring(0, 120)
    const detail = status ? `status=${status} body=${bodyPreview}` : `message=${err?.message || err}`
    if (!_apiFallbackMode) {
      _apiFallbackMode = true
      _apiFallbackSince = new Date().toISOString()
      console.error(`[vibeOS] API fallback activated (${method}): ${detail}`)
    }
    if (status === 401 || status === 403) {
      console.warn(`[vibeOS] API auth failed (${method}): server reachable but token rejected — will retry after cooldown`)
    } else {
      markApiDisconnected()
    }
    if (fallbackFn) {
      try { return fallbackFn() } catch (fe) { console.error(`[vibeOS] fallback also failed: ${fe?.message || fe}`) }
    }
    return null
  }
}
