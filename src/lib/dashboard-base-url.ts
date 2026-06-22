// SPDX-License-Identifier: MIT

export function normalizeDashboardBaseUrl(baseUrl: unknown): string {
  return String(baseUrl || "").trim().replace(/\/$/, "")
}

export function resolveDashboardBaseUrlFromState({
  dashboardBaseUrl = "",
  publishedMcpBaseUrl = "",
  fallbackPort = null,
  mcpPort = 0,
}: {
  dashboardBaseUrl?: unknown
  publishedMcpBaseUrl?: unknown
  fallbackPort?: number | null
  mcpPort?: number
} = {}): string {
  const fromMemory = normalizeDashboardBaseUrl(dashboardBaseUrl)
  if (fromMemory) return fromMemory
  const fromPublished = normalizeDashboardBaseUrl(publishedMcpBaseUrl)
  if (fromPublished) return fromPublished
  const port = Number(mcpPort)
  if (Number.isFinite(port) && port > 0) return `http://127.0.0.1:${port}`
  const fallback = Number(fallbackPort)
  if (fallbackPort !== null && fallbackPort !== undefined && Number.isFinite(fallback) && fallback > 0) return `http://127.0.0.1:${fallback}`
  return ""
}
