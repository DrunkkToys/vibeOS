const RUNTIME_KEY = "__vibeOSRuntimeState"

type RuntimeState = {
  apiConnected: boolean
  apiFallbackMode: boolean
  apiFallbackSince: string | null
  apiEnabled: boolean
  sessionId: string
}

function getRuntimeState(): RuntimeState {
  const g = globalThis as any
  if (!g[RUNTIME_KEY]) {
    g[RUNTIME_KEY] = {
      apiConnected: true,
      apiFallbackMode: false,
      apiFallbackSince: null,
      apiEnabled: true,
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
  return state.apiEnabled
}

export function isApiFallbackMode(): boolean {
  return getRuntimeState().apiFallbackMode
}

export function getApiFallbackSince(): string | null {
  return getRuntimeState().apiFallbackSince
}

export function isApiEnabled(): boolean {
  return getRuntimeState().apiEnabled
}

export function setApiEnabled(enabled: boolean): void {
  getRuntimeState().apiEnabled = enabled
}

export function setApiFallbackSince(since: string | null): void {
  getRuntimeState().apiFallbackSince = since
}

export function setApiFallbackMode(on: boolean): void {
  const state = getRuntimeState()
  state.apiFallbackMode = on
  if (on && !state.apiFallbackSince) state.apiFallbackSince = new Date().toISOString()
  if (!on) state.apiFallbackSince = null
}
