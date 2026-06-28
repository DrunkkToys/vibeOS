// SPDX-License-Identifier: MIT
// Sticky loop-state reconciliation helpers.

const LOOP_HOLD_MS = 10 * 60 * 1000
const LOOP_RELEASE_STREAK_REQUIRED = 2

type AnyObject = Record<string, any>

function normalizeText(value: unknown): string {
  return String(value || "").trim().toUpperCase()
}

function normalizeSource(value: unknown): string {
  return String(value || "").trim().toLowerCase()
}

function isLoopValue(record: AnyObject | null | undefined): boolean {
  if (!record || typeof record !== "object") return false
  return normalizeText(record.sub_regime || record.regime) === "LOOPING"
    || normalizeText(record.resolution_state) === "INTERVENED"
    || normalizeText(record.resolution) === "LOOPING"
    || record.is_looping === true
}

function isApiSource(record: AnyObject | null | undefined, fallback = ""): boolean {
  const source = normalizeSource(record?.decision_source || record?.source || fallback)
  return source === "api"
}

function parseHoldUntil(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return NaN
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : NaN
}

export function buildLoopNoticeSignature(record: AnyObject | null | undefined): string {
  if (!record || typeof record !== "object") return ""
  return JSON.stringify({
    sub_regime: normalizeText(record.sub_regime || record.regime || ""),
    resolution: normalizeText(record.resolution || ""),
    resolution_state: normalizeText(record.resolution_state || ""),
    loop_intervention_level: normalizeText(record.loop_intervention_level || record.live_loop_intervention_level || ""),
    decision_source: normalizeSource(record.decision_source || record.source || ""),
    is_looping: record.is_looping === true,
    pivot_detected: record.pivot_detected === true,
  })
}

export function shouldSuppressLoopNotice(
  previous: AnyObject | null | undefined,
  current: AnyObject | null | undefined,
): { signature: string; suppress: boolean } {
  const signature = buildLoopNoticeSignature(current)
  if (!signature) return { signature, suppress: false }
  if (!current || typeof current !== "object" || current.is_looping !== true) {
    return { signature, suppress: false }
  }
  const previousSignature = String(previous?.loop_notice_signature || previous?.live_loop_notice_signature || "")
  return {
    signature,
    suppress: previousSignature === signature,
  }
}

export function reconcileStickyLoopState(
  existing: AnyObject | null | undefined,
  incoming: AnyObject | null | undefined,
  options: { now?: number; source?: string } = {},
): AnyObject {
  const current = existing && typeof existing === "object" ? existing : {}
  const next = incoming && typeof incoming === "object" ? { ...incoming } : {}
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
  const incomingSource = normalizeSource(next.source || next.decision_source || options.source)
  const existingStickyLoop = isApiSource(current) && isLoopValue(current)
  const incomingLoopExplicit = normalizeText(next.sub_regime || next.regime) === "LOOPING"
    || normalizeText(next.resolution) === "LOOPING"
    || next.is_looping === true
  const incomingLoop = incomingLoopExplicit || (incomingSource === "api" && normalizeText(next.resolution_state) === "INTERVENED")
  const previousHoldUntil = parseHoldUntil(current.loop_hold_until)
  const holdActive = Number.isFinite(previousHoldUntil) && previousHoldUntil > now
  const previousReleaseStreak = Number(current.loop_release_streak || 0)
  const nextLoopConsecutive = Math.max(
    Number(current.loop_consecutive || current.loopCount || 0) || 0,
    Number(next.loop_consecutive || next.loopCount || 0) || 0,
  )
  const preservedLoopLevel = String(
    current.loop_intervention_level
      || current.live_loop_intervention_level
      || next.loop_intervention_level
      || (isLoopValue(current) ? "assertive" : "none"),
  )

  if (incomingLoop) {
    return {
      ...current,
      ...next,
      sub_regime: "LOOPING",
      regime: "LOOPING",
      is_looping: true,
      resolution: next.resolution || "looping",
      resolution_state: next.resolution_state || "intervened",
      loop_intervention_level: preservedLoopLevel !== "none" ? preservedLoopLevel : "assertive",
      loop_consecutive: Math.max(nextLoopConsecutive, 1),
      loop_hold_until: new Date(now + LOOP_HOLD_MS).toISOString(),
      loop_release_streak: 0,
      decision_source: "api",
      loop_notice_signature: current.loop_notice_signature || null,
      loop_notice_at: current.loop_notice_at || null,
      loop_notice_hold_until: current.loop_notice_hold_until || null,
      loop_notice_count: Number(current.loop_notice_count || 0) || 0,
    }
  }

  if (existingStickyLoop) {
    const apiRecoverySignal = incomingSource === "api"
    const nextReleaseStreak = apiRecoverySignal ? previousReleaseStreak + 1 : previousReleaseStreak
    const canRelease = apiRecoverySignal && !holdActive && nextReleaseStreak >= LOOP_RELEASE_STREAK_REQUIRED
    if (!canRelease) {
      return {
        ...current,
        ...next,
        sub_regime: "LOOPING",
        regime: "LOOPING",
        is_looping: true,
        resolution: current.resolution || next.resolution || "looping",
        resolution_state: current.resolution_state || next.resolution_state || "intervened",
        loop_intervention_level: preservedLoopLevel !== "none" ? preservedLoopLevel : "assertive",
        loop_consecutive: Math.max(nextLoopConsecutive, 1),
        loop_hold_until: current.loop_hold_until || null,
        loop_release_streak: nextReleaseStreak,
        decision_source: "api",
        loop_notice_signature: current.loop_notice_signature || null,
        loop_notice_at: current.loop_notice_at || null,
        loop_notice_hold_until: current.loop_notice_hold_until || null,
        loop_notice_count: Number(current.loop_notice_count || 0) || 0,
      }
    }
    return {
      ...current,
      ...next,
      decision_source: "api",
      loop_hold_until: null,
      loop_release_streak: 0,
      loop_consecutive: Math.max(nextLoopConsecutive, 1),
      loop_notice_signature: null,
      loop_notice_at: null,
      loop_notice_hold_until: null,
      loop_notice_count: 0,
      live_loop_notice_signature: null,
      live_loop_notice_at: null,
      live_loop_notice_hold_until: null,
      live_loop_notice_count: 0,
    }
  }

  return {
    ...current,
    ...next,
    decision_source: incomingSource || normalizeSource(current.decision_source || current.source) || "local",
    loop_hold_until: null,
    loop_release_streak: 0,
    loop_consecutive: Math.max(nextLoopConsecutive, 0),
    loop_notice_signature: null,
    loop_notice_at: null,
    loop_notice_hold_until: null,
    loop_notice_count: 0,
    live_loop_notice_signature: null,
    live_loop_notice_at: null,
    live_loop_notice_hold_until: null,
    live_loop_notice_count: 0,
  }
}
