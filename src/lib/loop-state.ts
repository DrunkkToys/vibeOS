// SPDX-License-Identifier: MIT
// Sticky loop-state reconciliation helpers.

const LOOP_HOLD_MS = 10 * 60 * 1000
const LOOP_RELEASE_STREAK_REQUIRED = 2

const CLEARED_NOTICE_FIELDS = {
  loop_notice_signature: null,
  loop_notice_at: null,
  loop_notice_hold_until: null,
  loop_notice_count: 0,
  live_loop_notice_signature: null,
  live_loop_notice_at: null,
  live_loop_notice_hold_until: null,
  live_loop_notice_count: 0,
}

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

function normalizeLoopAuthority(value: unknown): "api" | "authoritative-local" | "advisory-local" | null {
  const normalized = normalizeSource(value)
  if (normalized === "api") return "api"
  if (normalized === "authoritative-local" || normalized === "authoritative_local" || normalized === "local-authoritative") return "authoritative-local"
  if (normalized === "advisory-local" || normalized === "advisory_local" || normalized === "local-advisory") return "advisory-local"
  return null
}

function normalizeLoopConfidence(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeLoopKind(value: unknown): string | null {
  const v = String(value || "").trim().toLowerCase()
  return v ? v : null
}

function clearLocalLoopState(current: AnyObject, next: AnyObject, incomingSource: string, authority: "api" | "authoritative-local" | "advisory-local" | null): AnyObject {
  const nextSubRegime = normalizeText(next.sub_regime || next.regime) || normalizeText(current.sub_regime || current.regime || "INIT")
  const resolvedRegime = nextSubRegime === "LOOPING" ? "REFINING" : (nextSubRegime || "REFINING")
  return {
    ...current,
    ...next,
    sub_regime: resolvedRegime,
    regime: resolvedRegime,
    is_looping: false,
    resolution: next.resolution || current.resolution || "unresolved",
    resolution_state: next.resolution_state || current.resolution_state || "unresolved",
    loop_authority: null,
    loop_detector_kind: null,
    loop_detector_confidence: null,
    loop_source_reason: null,
    loop_intervention_level: "none",
    loop_consecutive: Math.max(Number(next.loop_consecutive || next.loopCount || 0) || 0, 0),
    loop_hold_until: null,
    loop_release_streak: 0,
    decision_source: incomingSource || normalizeSource(current.decision_source || current.source) || "local",
    ...CLEARED_NOTICE_FIELDS,
  }
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
  const incomingAuthority = normalizeLoopAuthority(next.loop_authority)
  const existingStickyLoop = isApiSource(current) && isLoopValue(current)
  const existingLocalLoop = !existingStickyLoop && normalizeSource(current.decision_source || current.source || incomingSource) === "local" && isLoopValue(current)
  const incomingLoopExplicit = normalizeText(next.sub_regime || next.regime) === "LOOPING"
    || normalizeText(next.resolution) === "LOOPING"
    || next.is_looping === true
  const incomingLoop = (incomingAuthority === "api" && (
    incomingLoopExplicit || normalizeText(next.resolution_state) === "INTERVENED"
  ))
    || incomingAuthority === "authoritative-local"
    || (incomingSource !== "footer" && incomingAuthority !== "advisory-local" && incomingLoopExplicit)
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
    const loopAuthority = incomingAuthority || (incomingSource === "api" ? "api" : "authoritative-local")
    const isApiLoop = loopAuthority === "api"
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
      loop_hold_until: isApiLoop ? new Date(now + LOOP_HOLD_MS).toISOString() : null,
      loop_release_streak: 0,
      decision_source: isApiLoop ? "api" : "local",
      loop_authority: loopAuthority,
      loop_detector_kind: normalizeLoopKind(next.loop_detector_kind) || (isApiLoop ? "api" : "authoritative-local"),
      loop_detector_confidence: normalizeLoopConfidence(next.loop_detector_confidence),
      loop_source_reason: String(next.loop_source_reason || next.resolution_reason || current.loop_source_reason || "loop detected"),
      loop_notice_signature: isApiLoop ? current.loop_notice_signature || null : null,
      loop_notice_at: isApiLoop ? current.loop_notice_at || null : null,
      loop_notice_hold_until: isApiLoop ? current.loop_notice_hold_until || null : null,
      loop_notice_count: isApiLoop ? Number(current.loop_notice_count || 0) || 0 : 0,
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
        loop_authority: "api",
        loop_detector_kind: normalizeLoopKind(next.loop_detector_kind) || normalizeLoopKind(current.loop_detector_kind),
        loop_detector_confidence: normalizeLoopConfidence(next.loop_detector_confidence ?? current.loop_detector_confidence),
        loop_source_reason: String(next.loop_source_reason || current.loop_source_reason || "api sticky loop"),
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
      loop_authority: "api",
      loop_hold_until: null,
      loop_release_streak: 0,
      loop_consecutive: Math.max(nextLoopConsecutive, 1),
      loop_detector_kind: normalizeLoopKind(next.loop_detector_kind) || normalizeLoopKind(current.loop_detector_kind),
      loop_detector_confidence: normalizeLoopConfidence(next.loop_detector_confidence ?? current.loop_detector_confidence),
      loop_source_reason: String(next.loop_source_reason || current.loop_source_reason || "api recovery"),
      ...CLEARED_NOTICE_FIELDS,
    }
  }

  if (existingLocalLoop && !incomingLoop) {
    return clearLocalLoopState(current, next, incomingSource, incomingAuthority)
  }

  if (incomingAuthority === "advisory-local") {
    return {
      ...current,
      ...next,
      decision_source: "local",
      loop_authority: "advisory-local",
      loop_detector_kind: normalizeLoopKind(next.loop_detector_kind) || normalizeLoopKind(current.loop_detector_kind),
      loop_detector_confidence: normalizeLoopConfidence(next.loop_detector_confidence ?? current.loop_detector_confidence),
      loop_source_reason: String(next.loop_source_reason || current.loop_source_reason || "local advisory"),
      sub_regime: next.sub_regime && normalizeText(next.sub_regime) !== "LOOPING"
        ? next.sub_regime
        : current.sub_regime || current.regime || "INIT",
      regime: next.regime && normalizeText(next.regime) !== "LOOPING"
        ? next.regime
        : current.regime || current.sub_regime || "INIT",
      is_looping: false,
      resolution: next.resolution || current.resolution || "unresolved",
      resolution_state: next.resolution_state || current.resolution_state || "unresolved",
      loop_intervention_level: "none",
      loop_hold_until: null,
      loop_release_streak: 0,
      loop_consecutive: Math.max(nextLoopConsecutive, 0),
      ...CLEARED_NOTICE_FIELDS,
    }
  }

  return {
    ...current,
    ...next,
    decision_source: incomingSource || normalizeSource(current.decision_source || current.source) || "local",
    loop_authority: normalizeLoopAuthority(next.loop_authority) || null,
    loop_detector_kind: normalizeLoopKind(next.loop_detector_kind) || normalizeLoopKind(current.loop_detector_kind),
    loop_detector_confidence: normalizeLoopConfidence(next.loop_detector_confidence ?? current.loop_detector_confidence),
    loop_source_reason: String(next.loop_source_reason || current.loop_source_reason || ""),
    loop_hold_until: null,
    loop_release_streak: 0,
    loop_consecutive: Math.max(nextLoopConsecutive, 0),
    ...CLEARED_NOTICE_FIELDS,
  }
}
