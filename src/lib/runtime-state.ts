const RUNTIME_KEY = "__vibeOSRuntimeState"

type RuntimeState = {
  apiConnected: boolean
  apiFallbackMode: boolean
  apiFallbackSince: string | null
  sessionId: string
}

function getRuntimeState(): RuntimeState {
  const g = globalThis as any
  if (!g[RUNTIME_KEY]) {
    g[RUNTIME_KEY] = {
      apiConnected: false,
      apiFallbackMode: false,
      apiFallbackSince: null,
      sessionId: "opencode-" + (process.pid || "x") + "-" + Date.now(),
    } satisfies RuntimeState
  }
  return g[RUNTIME_KEY]
}

export function getOcSessionId(): string {
  return getRuntimeState().sessionId
}

export function markApiConnected(): void {
  const state = getRuntimeState()
  state.apiConnected = true
  state.apiFallbackMode = false
  state.apiFallbackSince = null
}

export function markApiDisconnected(): void {
  const state = getRuntimeState()
  state.apiConnected = false
  state.apiFallbackMode = true
  if (!state.apiFallbackSince) state.apiFallbackSince = new Date().toISOString()
}

export function resetApiConnection(): void {
  const state = getRuntimeState()
  state.apiConnected = false
  state.apiFallbackMode = false
  state.apiFallbackSince = null
}

export function isApiConnected(): boolean {
  const state = getRuntimeState()
  return state.apiConnected && !state.apiFallbackMode
}

export function isApiFallbackMode(): boolean {
  return getRuntimeState().apiFallbackMode
}
