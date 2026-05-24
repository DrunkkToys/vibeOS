const RUNTIME_KEY = "__vibeOSRuntimeState";
function getRuntimeState() {
    const g = globalThis;
    if (!g[RUNTIME_KEY]) {
        g[RUNTIME_KEY] = {
            apiConnected: false,
            apiFallbackMode: false,
            apiFallbackSince: null,
            sessionId: "opencode-" + (process.pid || "x") + "-" + Date.now(),
        };
    }
    return g[RUNTIME_KEY];
}
export function getOcSessionId() {
    return getRuntimeState().sessionId;
}
export function markApiConnected() {
    const state = getRuntimeState();
    state.apiConnected = true;
    state.apiFallbackMode = false;
    state.apiFallbackSince = null;
}
export function markApiDisconnected() {
    const state = getRuntimeState();
    state.apiConnected = false;
    state.apiFallbackMode = true;
    if (!state.apiFallbackSince)
        state.apiFallbackSince = new Date().toISOString();
}
export function resetApiConnection() {
    const state = getRuntimeState();
    state.apiConnected = false;
    state.apiFallbackMode = false;
    state.apiFallbackSince = null;
}
export function isApiConnected() {
    const state = getRuntimeState();
    return state.apiConnected && !state.apiFallbackMode;
}
export function isApiFallbackMode() {
    return getRuntimeState().apiFallbackMode;
}
