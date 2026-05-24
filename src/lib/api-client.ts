// @ts-nocheck

import { VibeOSApiClient, VibeOSAuthError, VibeOSTimeoutError, VibeOSNetworkError } from "vibeOScore/client"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import { isApiConnected as isRuntimeApiConnected, markApiConnected, markApiDisconnected, resetApiConnection } from "./runtime-state.js"

// ── Remote API client (Phase 2) ─────────────────────────────────────
export const VIBEOS_API_URL = process.env.VIBEOS_API_URL || "https://api.vibetheog.com"

const _apiDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url))
const _envPaths = [homedir() + "/.claude", _apiDir, process.cwd(), homedir()]

function readTokenFromDisk(): string {
  for (const dir of _envPaths) {
    try {
      const env = readFileSync(dir + "/.env.production", "utf8")
      const m = env.match(/^VIBEOS_API_TOKEN=(.+)$/m)
      if (m) return m[1].trim()
    } catch {}
  }
  return ""
}

export let VIBEOS_API_TOKEN = readTokenFromDisk() || process.env.VIBEOS_API_TOKEN || ""
export let VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN

export function setApiToken(newToken) {
  try {
    VIBEOS_API_TOKEN = String(newToken || "").trim()
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
let _apiClient = null
let _apiFallbackMode = false
let _apiFallbackSince = null

function syncApiTokenFromDisk(): void {
  const diskToken = readTokenFromDisk() || ""
  const envToken = process.env.VIBEOS_API_TOKEN || ""

  if (diskToken && diskToken !== VIBEOS_API_TOKEN) {
    VIBEOS_API_TOKEN = diskToken
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN
    _apiClient = null
    _apiFallbackMode = false
    _apiFallbackSince = null
    resetApiConnection()
    console.error("[vibeOS] API token synced from disk (disk is newer)")
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
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN
    console.error("[vibeOS] API token loaded from VIBEOS_API_TOKEN env var")
  } else {
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN
  }
}

export function getApiClient() {
  syncApiTokenFromDisk()
  if (!_apiClient && VIBEOS_API_ENABLED) {
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
  return VIBEOS_API_ENABLED && !_apiFallbackMode
}

export async function remoteCall(method, args, fallbackFn) {
  syncApiTokenFromDisk()
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
