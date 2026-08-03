// SPDX-License-Identifier: MIT

function roundUsd(value: unknown): number {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.round(amount * 10000) / 10000
}

export function getSessionDelegationSavings(session: unknown): number {
  if (!session || typeof session !== "object") return 0
  return roundUsd((session as Record<string, unknown>).total_savings_usd)
}

export function getSessionVerifiedSavings(session: unknown): number {
  if (!session || typeof session !== "object") return 0
  return roundUsd((session as Record<string, unknown>).verified_savings_usd)
}

export function getSessionCacheSavings(session: unknown): number {
  if (!session || typeof session !== "object") return 0
  return roundUsd((session as Record<string, unknown>).cache_savings_usd)
}

export function getSessionWarnSavings(session: unknown): number {
  if (!session || typeof session !== "object") return 0
  const warns = Array.isArray((session as Record<string, unknown>).warns)
    ? ((session as Record<string, unknown>).warns as Array<Record<string, unknown>>)
    : []
  return roundUsd(warns.reduce((sum, warn) => sum + (Number(warn?.est_savings_usd || 0) || 0), 0))
}

export function getSessionLiveSavings(session: unknown): number {
  if (!session || typeof session !== "object") return 0
  return roundUsd((session as Record<string, unknown>).live_savings_usd)
}

export function getSessionSavingsDiagnostics(session: unknown): {
  delegationUsd: number
  cacheUsd: number
  totalUsd: number
  liveUsd: number
  warnUsd: number
  diverged: boolean
} {
  const delegationUsd = getSessionDelegationSavings(session)
  const cacheUsd = getSessionCacheSavings(session)
  const liveUsd = getSessionLiveSavings(session)
  const warnUsd = getSessionWarnSavings(session)
  return {
    delegationUsd,
    cacheUsd,
    totalUsd: roundUsd(delegationUsd + cacheUsd),
    liveUsd,
    warnUsd,
    diverged: Math.abs(delegationUsd - warnUsd) >= 0.0005 || Math.abs(delegationUsd - liveUsd) >= 0.0005,
  }
}
