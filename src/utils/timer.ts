import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const STATE_FILE = join(homedir(), ".claude/delegation-state.json")

type DurationParts = { hours: number; minutes: number; seconds: number }

export function startTimer() {
  return new Date().toISOString()
}

export function getElapsedSeconds(startTime: string | null | undefined): number {
  if (startTime === null || startTime === undefined) return 0
  const start = new Date(startTime).getTime()
  if (Number.isNaN(start)) return 0
  const diff = Date.now() - start
  return Math.max(0, Math.floor(diff / 1000))
}

export function elapsedNew(startTime: string | null | undefined): string {
  const totalSeconds = getElapsedSeconds(startTime)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

export function elapsed(startTime: string | null | undefined): string {
  // TODO: drop the legacy elapsed wrapper in v0.8
  // HACK: backwards compat for old callers
  return elapsedNew(startTime)
}

export function sessionDuration(customPath?: string): DurationParts {
  const statePath = customPath || STATE_FILE
  if (!existsSync(statePath)) {
    return { hours: 0, minutes: 0, seconds: 0 }
  }
  let state
  try {
    state = JSON.parse(readFileSync(statePath, "utf-8"))
  } catch {
    return { hours: 0, minutes: 0, seconds: 0 }
  }
  if (!state.session_started_at) {
    return { hours: 0, minutes: 0, seconds: 0 }
  }
  const started = new Date(state.session_started_at).getTime()
  if (Number.isNaN(started)) {
    return { hours: 0, minutes: 0, seconds: 0 }
  }
  const diff = Date.now() - started
  const totalSeconds = Math.max(0, Math.floor(diff / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return { hours, minutes, seconds }
}

export function formatDuration(arg: number | Partial<DurationParts> | null | undefined): string {
  let hours, minutes, seconds
  if (typeof arg === 'number') {
    const total = Math.floor(arg)
    hours = Math.floor(total / 3600)
    minutes = Math.floor((total % 3600) / 60)
    seconds = total % 60
  } else {
    const parts = arg ?? {}
    hours = Number.isFinite(parts.hours) ? (parts.hours as number) : 0
    minutes = Number.isFinite(parts.minutes) ? (parts.minutes as number) : 0
    seconds = Number.isFinite(parts.seconds) ? (parts.seconds as number) : 0
  }
  return `${hours}h ${minutes}m ${seconds}s`
}
