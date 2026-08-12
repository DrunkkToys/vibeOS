// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// Agent gate — vibeOS only drives a turn when the vibe agent is the selected
// one in OpenCode's mode dropdown. OpenCode reports the active agent on the
// per-turn hooks that carry it (chat.message / chat.params / chat.headers);
// the remaining hooks (tool.execute.*, system.transform, text.complete, ...)
// do not, so the agent seen for a session is remembered and reused.
//
// Fallback policy, in order:
//   1. VIBEOS_AGENT_GATE=off  -> gate disabled, vibeOS always runs (escape hatch).
//   2. agent known for this session -> exact answer.
//   3. no agent EVER reported in this process -> run (host does not report
//      agents at all; gating there would silently disable the whole plugin).
//   4. otherwise -> fall back to the most recently reported agent.

const MAX_TRACKED_SESSIONS = 256

export const VIBE_AGENT_NAMES = ["vibe", "vibe-cheap", "vibe-medium", "vibe-brain"] as const

const _agentBySession = new Map<string, string>()
let _lastAgent = ""
let _everRecorded = false

export function isVibeAgentName(name: string | null | undefined): boolean {
  const value = String(name || "").trim().toLowerCase()
  return value === "vibe" || value.startsWith("vibe-")
}

export function agentGateDisabled(): boolean {
  return String(process.env.VIBEOS_AGENT_GATE || "").trim().toLowerCase() === "off"
}

export function recordSessionAgent(sessionID: string | null | undefined, agent: string | null | undefined): string {
  const value = String(agent || "").trim().toLowerCase()
  if (!value) return ""
  _everRecorded = true
  _lastAgent = value
  const sid = String(sessionID || "").trim()
  if (sid) {
    if (_agentBySession.has(sid)) _agentBySession.delete(sid)
    _agentBySession.set(sid, value)
    while (_agentBySession.size > MAX_TRACKED_SESSIONS) {
      const oldest = _agentBySession.keys().next().value
      if (oldest === undefined) break
      _agentBySession.delete(oldest)
    }
  }
  return value
}

export function getSessionAgent(sessionID: string | null | undefined): string {
  const sid = String(sessionID || "").trim()
  if (sid && _agentBySession.has(sid)) return _agentBySession.get(sid) || ""
  return ""
}

export function getLastKnownAgent(): string {
  return _lastAgent
}

export function isVibeAgentSession(sessionID: string | null | undefined): boolean {
  if (agentGateDisabled()) return true
  const known = getSessionAgent(sessionID)
  if (known) return isVibeAgentName(known)
  if (!_everRecorded) return true
  if (_lastAgent) return isVibeAgentName(_lastAgent)
  return true
}

export function resetAgentGate(): void {
  _agentBySession.clear()
  _lastAgent = ""
  _everRecorded = false
}
