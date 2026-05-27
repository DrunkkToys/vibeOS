// @ts-nocheck

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import { isApiConnected as isRuntimeApiConnected, markApiConnected, markApiDisconnected, resetApiConnection } from "./runtime-state.js"

const DEFAULT_API_URL = "https://api.vibetheog.com"
const EMBEDDED_API_TOKEN = "vos_8d73804b13bb46711b9a47f036dba7b4d026fd9583d96960e663716e62815a69"
const API_TOKEN_RE = /^vos_[a-f0-9]{64}$/i
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

function normalizeApiToken(token: string | null | undefined, fallback = ""): string {
  const clean = String(token || "").trim()
  return API_TOKEN_RE.test(clean) ? clean : fallback
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
    return this.request("/health", null, false)
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

function readTokenFromDisk(): string {
  for (const dir of _envPaths) {
    try {
      const env = readFileSync(dir + "/.env.production", "utf8")
      const m = env.match(/^VIBEOS_API_TOKEN=(.+)$/m)
      if (m) {
        const clean = normalizeApiToken(m[1], "")
        if (clean) return clean
      }
    } catch {}
  }
  return ""
}

function readBootstrapTokenFromDisk(): string {
  try {
    const env = readFileSync(_bootstrapEnvPath, "utf8")
    const m = env.match(/^VIBEOS_API_BOOTSTRAP_TOKEN=(.+)$/m)
    if (m) return m[1].trim()
  } catch {}
  return ""
}

export let VIBEOS_API_TOKEN = readTokenFromDisk() || normalizeApiToken(process.env.VIBEOS_API_TOKEN, "") || EMBEDDED_API_TOKEN
export let VIBEOS_API_BOOTSTRAP_TOKEN = readBootstrapTokenFromDisk() || process.env.VIBEOS_API_BOOTSTRAP_TOKEN || ""
export let VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN)

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
    VIBEOS_API_TOKEN = normalizeApiToken(newToken, EMBEDDED_API_TOKEN)
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN
    const primaryPath = _envPaths[0] + "/.env.production"
    try {
      if (existsSync(primaryPath)) {
        let envContent = readFileSync(primaryPath, "utf8")
        if (/^VIBEOS_API_TOKEN=/m.test(envContent)) {
          envContent = envContent.replace(/^VIBEOS_API_TOKEN=.+$/m, `VIBEOS_API_TOKEN=${VIBEOS_API_TOKEN}`)
        } else {
          envContent = envContent.trimEnd() + `\nVIBEOS_API_TOKEN=${VIBEOS_API_TOKEN}\n`
        }
        writeFileSync(primaryPath, envContent, "utf8")
      } else {
        const parentDir = _envPaths[0]
        if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true })
        writeFileSync(primaryPath, `VIBEOS_API_TOKEN=${VIBEOS_API_TOKEN}\n`, "utf8")
      }
    } catch (diskErr) {
      console.error("[vibeOS] Failed to persist API token to disk:", diskErr.message)
    }
    console.error("[vibeOS] API token updated via setApiToken")
  } catch(e) {
    console.error("[vibeOS] Failed to update API token:", e.message)
  }
}

export function setApiBootstrapToken(newToken) {
  try {
    VIBEOS_API_BOOTSTRAP_TOKEN = String(newToken || "").trim()
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN)
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
  const diskToken = readTokenFromDisk() || ""
  const diskBootstrapToken = readBootstrapTokenFromDisk() || ""
  const envToken = normalizeApiToken(process.env.VIBEOS_API_TOKEN, "")

  if (diskToken && diskToken !== VIBEOS_API_TOKEN) {
    VIBEOS_API_TOKEN = diskToken
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN)
    _apiClient = null
    _apiFallbackMode = false
    _apiFallbackSince = null
    resetApiConnection()
    console.error("[vibeOS] API token synced from disk (disk is newer)")
  } else if (diskBootstrapToken && diskBootstrapToken !== VIBEOS_API_BOOTSTRAP_TOKEN) {
    VIBEOS_API_BOOTSTRAP_TOKEN = diskBootstrapToken
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN)
    _apiFallbackMode = false
    _apiFallbackSince = null
    resetApiConnection()
    console.error("[vibeOS] Alpha bootstrap token synced from disk (disk is newer)")
  } else if (!diskToken && VIBEOS_API_TOKEN) {
    const primaryPath = _envPaths[0] + "/.env.production"
    try {
      if (existsSync(primaryPath)) {
        let envContent = readFileSync(primaryPath, "utf8")
        if (/^VIBEOS_API_TOKEN=/m.test(envContent)) {
          envContent = envContent.replace(/^VIBEOS_API_TOKEN=.+$/m, `VIBEOS_API_TOKEN=${VIBEOS_API_TOKEN}`)
        } else {
          envContent = envContent.trimEnd() + `\nVIBEOS_API_TOKEN=${VIBEOS_API_TOKEN}\n`
        }
        writeFileSync(primaryPath, envContent, "utf8")
      } else {
        const parentDir = _envPaths[0]
        if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true })
        writeFileSync(primaryPath, `VIBEOS_API_TOKEN=${VIBEOS_API_TOKEN}\n`, "utf8")
      }
      console.error("[vibeOS] API token persisted to disk from memory (disk was empty)")
    } catch (diskErr) {
      console.error("[vibeOS] Failed to persist API token to disk from sync:", diskErr.message)
    }
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN
  } else if (envToken && !diskToken && !VIBEOS_API_TOKEN) {
    VIBEOS_API_TOKEN = envToken
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN)
    console.error("[vibeOS] API token loaded from VIBEOS_API_TOKEN env var")
  } else {
    VIBEOS_API_TOKEN ||= EMBEDDED_API_TOKEN
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN)
  }
}

export function getApiClient() {
  syncApiTokenFromDisk()
  if (!_apiClient && VIBEOS_API_ENABLED && VIBEOS_API_TOKEN) {
    _apiClient = new VibeOSApiClient({
      baseUrl: VIBEOS_API_URL,
      apiToken: VIBEOS_API_TOKEN,
      timeout: 5000,
    })
  }
  return _apiClient
}

export function isApiFallback() {
  return _apiFallbackMode || !VIBEOS_API_ENABLED
}

export function isApiConnected() {
  return isRuntimeApiConnected() && VIBEOS_API_ENABLED && !_apiFallbackMode
}

export async function remoteCall(method, args, fallbackFn) {
  syncApiTokenFromDisk()
  if (!VIBEOS_API_TOKEN && VIBEOS_API_BOOTSTRAP_TOKEN) {
    await ensureBootstrapExchange()
    syncApiTokenFromDisk()
  }
  if (!VIBEOS_API_ENABLED || _apiFallbackMode) {
    if (fallbackFn) return fallbackFn()
    return null
  }
  try {
    const client = getApiClient()
    if (!client) { if (fallbackFn) return fallbackFn(); return null }
    const result = await client[method](...args)
    _apiFallbackMode = false
    _apiFallbackSince = null
    markApiConnected()
    return result
  } catch (err) {
    if (!_apiFallbackMode) {
      _apiFallbackMode = true
      _apiFallbackSince = new Date().toISOString()
      console.error(`[vibeOS] API fallback activated: ${err.message}`)
    }
    markApiDisconnected()
    if (fallbackFn) {
      try { return fallbackFn() } catch (fe) { console.error(`[vibeOS] fallback also failed: ${fe.message}`) }
    }
    return null
  }
}
