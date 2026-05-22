// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>

const DEFAULT_API_URL = "https://api.vibetheog.com"
const REQUEST_TIMEOUT = 10000
const MAX_RETRIES = 3
const BASE_RETRY_DELAY = 1000

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

class VibeOSApiClient {
  baseUrl: string
  apiToken: string | null
  masterKey: string | null
  timeout: number
  fallbackMode: boolean
  fallbackStubs: unknown

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl || process.env.VIBEOS_API_URL || DEFAULT_API_URL
    this.apiToken = options.apiToken || process.env.VIBEOS_API_TOKEN || null
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

class VibeOSAuthError extends Error {
  statusCode: number
  code?: string

  constructor(message: string, statusCode: number, code?: string) {
    super(message)
    this.name = "VibeOSAuthError"
    this.statusCode = statusCode
    this.code = code
  }
}

class VibeOSTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VibeOSTimeoutError"
  }
}

class VibeOSNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VibeOSNetworkError"
  }
}

export { VibeOSApiClient, VibeOSAuthError, VibeOSTimeoutError, VibeOSNetworkError }
