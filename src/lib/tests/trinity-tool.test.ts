import { describe, expect, it } from "vitest"
import { mkdtempSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function makeDeps() {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-trinity-"))
  const tiersFile = join(sandbox, "model-tiers.json")
  writeFileSync(tiersFile, JSON.stringify({
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "haiku" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap: { oc: "opencode/big-pickle", cc: "haiku" },
    },
    selection: {
      enabled: true,
      active_slot: "cheap",
      delegation_enforce: true,
      flow_enabled: true,
      flow_enforce: true,
      tdd_enforce: true,
      tdd_strict: true,
      tdd_quality: true,
      thinking_level: "full",
    },
  }, null, 2) + "\n")

  const calls: Array<unknown[]> = []

  return {
    sandbox,
    tiersFile,
    calls,
    deps: {
      _lazyRefresh: () => {},
      tool: {
        schema: {
          enum: (vals: string[]) => ({ optional: () => vals }),
          string: () => ({ optional: () => ({}) }),
        },
      },
      directory: sandbox,
      _OC_SID: "sid-trinity",
      TIERS_FILE: tiersFile,
      currentModel: "opencode/big-pickle",
      currentProjectName: "demo",
      currentProjectFingerprint: "fingerprint-demo",
      _modelLocked: false,
      _blackboxEnabled: false,
      _lockedSlot: null,
      _lockedModel: null,
      dashboardBaseUrl: "",
      loadPublishedMcpBaseUrl: async () => "http://127.0.0.1:63342",
      ensureMcpServerRunning: async () => {
        throw new Error("should not be needed when a dashboard URL already exists")
      },
      loadSelection: () => JSON.parse(readFileSync(tiersFile, "utf8")).selection,
      writeSelection: () => true,
      safeJsonParse: (value: string) => {
        try { return JSON.parse(value) } catch { return null }
      },
      readFileSync,
      writeFileSync: (...args: Parameters<typeof writeFileSync>) => {
        calls.push(["writeFileSync", args[0]])
        return writeFileSync(...args)
      },
      renameSync: (...args: Parameters<typeof renameSync>) => {
        calls.push(["renameSync", args[0], args[1]])
        return renameSync(...args)
      },
      mkdirSync,
      loadCredit: () => 72,
      thinkingLevel: () => "full",
      scoreStress: () => 0,
      readLifetimeSavings: () => ({
        ltTasks: 0,
        ltCache: 0,
        sesTrend: "stable",
        sesTasks: 0,
        sesCache: 0,
        sesWarns: 0,
        sesRatePerHour: 0,
        missedC7: 0,
        sesToolBreakdown: {},
        sesModelTurns: { brain: 0, worker: 0 },
        sesDuration: 0,
        quality_avg: 0,
      }),
      readFullState: () => ({ sessions: {} }),
      formatUsd: (value: number) => value.toFixed(2),
      resolveExecutionIdentity: () => ({ provider_label: "OpenCode", quality_label: "cheap" }),
      getBlackboxResolution: () => null,
      isApiConnected: () => true,
      getBackendVersion: () => "",
      writeSessionSlot: (...args: unknown[]) => {
        calls.push(["writeSessionSlot", ...args])
      },
      applySlot: (slot: string) => {
        calls.push(["applySlot", slot])
        return { ok: true, ocModel: "opencode/big-pickle" }
      },
      _readAuth: () => ({}),
      probeModel: async () => true,
      _loadOpenCodeProviders: () => ({}),
      client: {
        config: {
          update: async (...args: unknown[]) => {
            calls.push(["config.update", ...args])
          },
        },
      },
      modelToCcAlias: () => "haiku",
      _refreshModel: (...args: unknown[]) => {
        calls.push(["refresh", ...args])
      },
      setApiToken: () => {},
      setApiBootstrapToken: () => {},
      saveOptimizationMode: () => true,
    },
  }
}

describe("trinity-tool", () => {
  it("exposes the tool shell", async () => {
    const { createTrinityTool } = await import("../trinity-tool")
    const tool = createTrinityTool(makeDeps().deps as any)

    expect(typeof tool.execute).toBe("function")
    expect(tool.description).toContain("Control the vibeOS plugin")
  })

  it("uses the published dashboard URL before attempting startup", async () => {
    const { createTrinityTool } = await import("../trinity-tool")
    const ctx = makeDeps()
    const tool = createTrinityTool(ctx.deps as any)

    const out = await tool.execute({ action: "dashboard" })

    expect(out).toContain("http://127.0.0.1:63342/")
    expect(out).toContain("Dashboard:")
  })

  it("switches a slot through applySlot and the native OpenCode model setter", async () => {
    const { createTrinityTool } = await import("../trinity-tool")
    const ctx = makeDeps()
    const tool = createTrinityTool(ctx.deps as any)

    const out = await tool.execute({ action: "set", slot: "cheap", model: "opencode/big-pickle" })

    expect(out).toContain("Switched to cheap slot")
    expect(ctx.calls.some((call) => call[0] === "applySlot" && call[1] === "cheap")).toBe(true)
    expect(ctx.calls.some((call) => call[0] === "config.update" && call[1]?.body?.model === "opencode/big-pickle")).toBe(true)
    expect(ctx.calls.some((call) => call[0] === "refresh")).toBe(true)
  })
})
