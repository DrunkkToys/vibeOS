import { BLACKBOX_STATE_FILE, _OC_SID, loadBlackboxState, saveBlackboxState, withFileLock } from "./state.js"

type AdaptiveMode = "budget" | "speed" | "quality"

type ModeDecision = {
  active: boolean
  mode: AdaptiveMode | string
  reason: string
  shouldPersistRequestedMode: boolean
}

type ModeInput = {
  requestedMode?: string | null
  suggestedMode?: string | null
  subRegime?: string | null
  stress?: number | null
  nInteractions?: number | null
}

type OutcomeInput = {
  outcome?: string | null
  subRegime?: string | null
  stress?: number | null
}

const BASELINE_MODE: AdaptiveMode = "budget"
const LOOP_REGIMES = new Set(["LOOPING", "DIVERGENT"])
const QUALITY_REGIMES = new Set(["CONVERGING", "CLOSED"])
const MANUAL_MODES = new Set(["balanced", "quality", "speed", "longrun"])

function normalizeMode(mode?: string | null): string {
  const normalized = String(mode || BASELINE_MODE).toLowerCase()
  if (normalized === "auto" || normalized === "") return BASELINE_MODE
  if (normalized === "budget" || normalized === "quality" || normalized === "speed" || normalized === "longrun" || normalized === "balanced") {
    return normalized
  }
  return BASELINE_MODE
}

function normalizeRegime(regime?: string | null): string {
  return String(regime || "INIT").toUpperCase()
}

function isManualOverride(mode?: string | null): boolean {
  return MANUAL_MODES.has(normalizeMode(mode))
}

function chooseEpisodeMode(regime: string, suggestedMode: string, stress: number): AdaptiveMode {
  if (LOOP_REGIMES.has(regime) || suggestedMode === "speed") return "speed"
  if (QUALITY_REGIMES.has(regime) || suggestedMode === "quality") return "quality"
  return stress > 1.5 ? "quality" : "quality"
}

function defaultPolicy() {
  return {
    active: false,
    active_mode: BASELINE_MODE,
    baseline_mode: BASELINE_MODE,
    reason: null as string | null,
    episode_id: null as string | null,
    problem_streak: 0,
    stable_streak: 0,
    last_sub_regime: "INIT",
    last_stress: 0,
    last_outcome: null as string | null,
    updated_at: null as string | null,
    started_at: null as string | null,
  }
}

function modeToSlot(mode: string): "brain" | "medium" | "cheap" {
  const normalized = normalizeMode(mode)
  if (normalized === "speed") return "medium"
  if (normalized === "quality" || normalized === "longrun") return "brain"
  return "cheap"
}

function loadSessionPolicy() {
  const state = loadBlackboxState()
  if (!state.sessions || typeof state.sessions !== "object") state.sessions = {}
  const sid = _OC_SID
  if (!state.sessions[sid] || typeof state.sessions[sid] !== "object") state.sessions[sid] = {}
  const session = state.sessions[sid]
  if (!session.mode_policy || typeof session.mode_policy !== "object") {
    session.mode_policy = defaultPolicy()
  } else {
    session.mode_policy.baseline_mode = session.mode_policy.baseline_mode || BASELINE_MODE
    session.mode_policy.active_mode = session.mode_policy.active_mode || BASELINE_MODE
    session.mode_policy.problem_streak = Number(session.mode_policy.problem_streak || 0)
    session.mode_policy.stable_streak = Number(session.mode_policy.stable_streak || 0)
  }
  return { state, session, policy: session.mode_policy }
}

function persistSessionPolicy(state: any, session: any, policy: any, mode: string): ModeDecision {
  policy.updated_at = new Date().toISOString()
  session.mode_policy = policy
  session.active_slot = modeToSlot(mode)
  saveBlackboxState(state)
  return {
    active: !!policy.active,
    mode,
    reason: policy.reason || BASELINE_MODE,
    shouldPersistRequestedMode: false,
  }
}

export function peekBudgetFirstMode(input: ModeInput = {}): ModeDecision {
  const requestedMode = normalizeMode(input.requestedMode)
  if (isManualOverride(requestedMode)) {
    return {
      active: false,
      mode: requestedMode,
      reason: "manual",
      shouldPersistRequestedMode: true,
    }
  }

  const { policy } = loadSessionPolicy()
  if (policy.active && policy.active_mode && normalizeMode(policy.active_mode) !== BASELINE_MODE) {
    return {
      active: true,
      mode: normalizeMode(policy.active_mode),
      reason: policy.reason || "episode",
      shouldPersistRequestedMode: false,
    }
  }

  return {
    active: false,
    mode: BASELINE_MODE,
    reason: "budget",
    shouldPersistRequestedMode: false,
  }
}

export function applyBudgetFirstMode(input: ModeInput = {}): ModeDecision {
  const requestedMode = normalizeMode(input.requestedMode)
  if (isManualOverride(requestedMode)) {
    return {
      active: false,
      mode: requestedMode,
      reason: "manual",
      shouldPersistRequestedMode: true,
    }
  }

  return withFileLock(BLACKBOX_STATE_FILE, () => {
    const { state, session, policy } = loadSessionPolicy()
    const interactions = Number(input.nInteractions ?? state.sessions?.[_OC_SID]?.n_interactions ?? 0)
    const regime = normalizeRegime(input.subRegime || policy.last_sub_regime)
    const stress = Number(input.stress ?? policy.last_stress ?? 0)
    const suggested = normalizeMode(input.suggestedMode)
    policy.baseline_mode = BASELINE_MODE
    policy.last_sub_regime = regime
    policy.last_stress = stress
    policy.updated_at = new Date().toISOString()

    if (policy.active && policy.active_mode && normalizeMode(policy.active_mode) !== BASELINE_MODE) {
      return persistSessionPolicy(state, session, policy, policy.active_mode)
    }

    const shouldStartEpisode =
      (LOOP_REGIMES.has(regime) && interactions >= 2) ||
      QUALITY_REGIMES.has(regime) ||
      Number(policy.problem_streak || 0) >= 2 ||
      (Number(policy.problem_streak || 0) >= 1 && stress > 1.5)

    if (shouldStartEpisode) {
      const nextMode = chooseEpisodeMode(regime, suggested, stress)
      policy.active = true
      policy.active_mode = nextMode
      policy.reason = LOOP_REGIMES.has(regime)
        ? "loop"
        : QUALITY_REGIMES.has(regime)
          ? "quality"
          : stress > 1.5
            ? "stress"
            : "problem"
      policy.episode_id = policy.episode_id || `${_OC_SID}:${Date.now()}`
      policy.started_at = policy.started_at || new Date().toISOString()
      policy.stable_streak = 0
      return persistSessionPolicy(state, session, policy, nextMode)
    }

    policy.active = false
    policy.active_mode = BASELINE_MODE
    policy.reason = null
    return persistSessionPolicy(state, session, policy, BASELINE_MODE)
  })
}

export function recordBudgetFirstOutcome(input: OutcomeInput = {}): ModeDecision {
  const outcome = String(input.outcome || "").toLowerCase()
  if (outcome !== "positive" && outcome !== "negative") {
    return peekBudgetFirstMode({ requestedMode: BASELINE_MODE })
  }

  return withFileLock(BLACKBOX_STATE_FILE, () => {
    const { state, session, policy } = loadSessionPolicy()
    const regime = normalizeRegime(input.subRegime || policy.last_sub_regime)
    const stress = Number(input.stress ?? policy.last_stress ?? 0)
    policy.last_sub_regime = regime
    policy.last_stress = stress
    policy.last_outcome = outcome
    policy.updated_at = new Date().toISOString()

    if (outcome === "negative") {
      policy.problem_streak = Math.min(5, Number(policy.problem_streak || 0) + 1)
      policy.stable_streak = 0
      return persistSessionPolicy(state, session, policy, policy.active && normalizeMode(policy.active_mode) !== BASELINE_MODE ? normalizeMode(policy.active_mode) : BASELINE_MODE)
    }

    policy.problem_streak = 0
    policy.stable_streak = Number(policy.stable_streak || 0) + 1
    if (policy.active) {
      const calmEnough = stress <= 1
      if (calmEnough || policy.stable_streak >= 1) {
        policy.active = false
        policy.active_mode = BASELINE_MODE
        policy.reason = null
        policy.episode_id = null
        policy.stable_streak = 0
      }
    }

    return persistSessionPolicy(state, session, policy, policy.active && normalizeMode(policy.active_mode) !== BASELINE_MODE ? normalizeMode(policy.active_mode) : BASELINE_MODE)
  })
}
