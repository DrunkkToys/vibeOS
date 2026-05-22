// @ts-nocheck
import { VibeOSApiClient, VibeOSAuthError, VibeOSTimeoutError, VibeOSNetworkError } from "vibeOScore/client";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

export const VIBEOS_API_URL = process.env.VIBEOS_API_URL || "https://api.vibetheog.com";

let _envTk = "";
const _envPaths = [
  process.cwd() + "/.env.production",
  homedir() + "/.claude/.env.production",
  homedir() + "/.env.production",
  process.cwd() + "/.env.production",
];
for (const dir of _envPaths) {
  try {
    const env = readFileSync(dir, "utf8");
    const m = env.match(/^VIBEOS_API_TOKEN=(.+)$/m);
    if (m) { _envTk = m[1].trim(); break; }
  } catch {}
}
export let VIBEOS_API_TOKEN = process.env.VIBEOS_API_TOKEN || _envTk || "";
export let VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN;
let _apiClient = null;
let _apiFallbackMode = false;
let _apiFallbackSince = null;

export function setApiToken(newToken) {
  VIBEOS_API_TOKEN = newToken;
  VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN;
  _apiClient = null;
  _apiFallbackMode = false;
  _apiFallbackSince = null;
  const paths = [__dirname, homedir() + "/.claude", homedir(), process.cwd()];
  for (const dir of paths) {
    try {
      const filePath = dir + "/.env.production";
      let env = "";
      try { env = readFileSync(filePath, "utf8"); } catch {}
      const lines = env.split("\n");
      const filtered = lines.filter(l => !l.startsWith("VIBEOS_API_TOKEN="));
      filtered.push("VIBEOS_API_TOKEN=" + newToken);
      writeFileSync(filePath, filtered.join("\n") + "\n", "utf8");
    } catch {}
  }
  console.error("[vibeOS] API token updated via setApiToken");
}

export function getApiClient() {
  if (!_apiClient && VIBEOS_API_ENABLED) {
    _apiClient = new VibeOSApiClient({
      baseUrl: VIBEOS_API_URL,
      apiToken: VIBEOS_API_TOKEN,
      timeout: 5000,
    });
  }
  return _apiClient;
}

export function isApiFallback() {
  return _apiFallbackMode || !VIBEOS_API_ENABLED;
}

export async function remoteCall(method, args, fallbackFn) {
  if (!VIBEOS_API_ENABLED || _apiFallbackMode) {
    if (fallbackFn) return fallbackFn();
    return null;
  }
  try {
    const client = getApiClient();
    if (!client) { if (fallbackFn) return fallbackFn(); return null; }
    const result = await client[method](...args);
    _apiFallbackMode = false;
    _apiFallbackSince = null;
    return result;
  } catch (err) {
    if (!_apiFallbackMode) {
      _apiFallbackMode = true;
      _apiFallbackSince = new Date().toISOString();
      console.error(`[vibeOS] API fallback activated: ${err.message}`);
    }
    if (fallbackFn) {
      try { return fallbackFn(); } catch (fe) { console.error(`[vibeOS] fallback also failed: ${fe.message}`); }
    }
    return null;
  }
}
