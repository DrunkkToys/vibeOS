// @ts-nocheck
import { VibeOSApiClient } from "../vibeOS-api-server/client.js";
// ── Remote API client (Phase 2) ─────────────────────────────────────
export const VIBEOS_API_URL = process.env.VIBEOS_API_URL || "https://api.vibetheog.com";
export const VIBEOS_API_TOKEN = process.env.VIBEOS_API_TOKEN || "vos_854d143233ad156dfc4863371e507f36418119dddac46ebfd4f8d97dc5f29680";
export const VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN;
let _apiClient = null;
let _apiFallbackMode = false;
let _apiFallbackSince = null;
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
    if (!VIBEOS_API_ENABLED) {
        if (fallbackFn)
            return fallbackFn();
        return null;
    }
    try {
        const client = getApiClient();
        if (!client) {
            if (fallbackFn)
                return fallbackFn();
            return null;
        }
        const result = await client[method](...args);
        _apiFallbackMode = false;
        _apiFallbackSince = null;
        return result;
    }
    catch (err) {
        if (!_apiFallbackMode) {
            _apiFallbackMode = true;
            _apiFallbackSince = new Date().toISOString();
            console.error(`[vibeOS] API fallback activated: ${err.message}`);
        }
        if (fallbackFn) {
            try {
                return fallbackFn();
            }
            catch (fe) {
                console.error(`[vibeOS] fallback also failed: ${fe.message}`);
            }
        }
        return null;
    }
}
