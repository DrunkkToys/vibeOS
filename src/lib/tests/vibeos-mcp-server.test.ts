import { afterEach, describe, expect, it } from "vitest"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DASHBOARD_CONFIG_PATH = join(process.cwd(), "src/lib/dashboard/dist/vibeos-dashboard-config.js")

let originalDashboardConfig = ""
let hadDashboardConfig = false

describe("vibeos-mcp-server", () => {
  it("writes the dashboard base config and strips trailing slashes", async () => {
    const mod = await import("../vibeos-mcp-server")
    hadDashboardConfig = existsSync(DASHBOARD_CONFIG_PATH)
    originalDashboardConfig = hadDashboardConfig ? readFileSync(DASHBOARD_CONFIG_PATH, "utf8") : ""

    try {
      const written = mod.writeDashboardBaseConfig("http://127.0.0.1:9123/")

      expect(written).toBe(DASHBOARD_CONFIG_PATH)
      expect(readFileSync(DASHBOARD_CONFIG_PATH, "utf8")).toContain("http://127.0.0.1:9123")
      expect(readFileSync(DASHBOARD_CONFIG_PATH, "utf8")).not.toContain("9123/")
    } finally {
      if (hadDashboardConfig) writeFileSync(DASHBOARD_CONFIG_PATH, originalDashboardConfig, "utf8")
    }
  })

  it("creates a server that answers /health", async () => {
    const mod = await import("../vibeos-mcp-server")
    const serverApi = mod.createMcpServer({
      getState: () => ({}),
      getSavings: () => ({}),
      getTodos: () => [],
      getSessionMetrics: () => ({}),
      getCurrentSessionId: () => "sid-test",
      getBlackboxState: () => ({}),
      listReports: () => [],
      readReport: () => null,
      runDiagnose: () => ({}),
      runProject: () => ({}),
      runTrinity: async () => ({}),
      runResearchAudit: () => ({}),
      saveReport: () => null,
      generateSessionCheckout: () => ({}),
      saveBlackboxVector: () => {},
      saveBlackboxOutcome: () => {},
    } as any)

    const server = await serverApi.start(0)
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })

    await serverApi.close()
  })
})

afterEach(() => {
  if (hadDashboardConfig && originalDashboardConfig) {
    writeFileSync(DASHBOARD_CONFIG_PATH, originalDashboardConfig, "utf8")
  }
})
