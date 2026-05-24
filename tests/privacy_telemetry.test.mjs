import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-telemetry-"))
process.env.HOME = sandbox
process.env.VIBEOS_API_ENABLED = "false"

mkdirSync(join(sandbox, ".config/opencode"), { recursive: true })
mkdirSync(join(sandbox, ".claude/reports"), { recursive: true })
mkdirSync(join(sandbox, ".local/share/opencode"), { recursive: true })

const projectDir = join(sandbox, "project")
mkdirSync(projectDir, { recursive: true })

writeFileSync(join(sandbox, ".config/opencode/opencode.json"), JSON.stringify({
  model: "deepseek/deepseek-v4-flash",
  provider: {
    deepseek: {
      models: {
        "deepseek-v4-pro": {},
        "deepseek-v4-flash": {},
        "deepseek-chat": {},
      },
    },
  },
}) + "\n")

writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
  selection: {
    enabled: true,
    active_slot: "medium",
    delegation_enforce: false,
    flow_enabled: false,
    flow_enforce: false,
    tdd_enforce: false,
    thinking_level: "brief",
  },
  trinity: {
    brain: { oc: "deepseek/deepseek-v4-pro" },
    medium: { oc: "deepseek/deepseek-v4-flash" },
    cheap: { oc: "deepseek/deepseek-chat" },
  },
  tiers: {
    high: { regex: "v4.*pro|opus" },
    mid: { regex: "v4.*flash|sonnet" },
    budget: { regex: ".*" },
  },
}) + "\n")

const mod = await import("../src/index.js?telemetry=" + Date.now())
const runtimeSurface = await import("../src/lib/runtime-surface.js?telemetry=" + Date.now())

const hooks = await mod.DelegationEnforcer({ client: {}, directory: projectDir })

const prompt = "implement privacy-safe telemetry counters for the model"
await hooks["tool.execute.before"]({ tool: "task", args: { prompt } }, { args: { prompt } })
await hooks["tool.execute.after"]({ tool: "task", args: { prompt } }, { text: "done" })

const statePath = join(sandbox, ".claude/delegation-state.json")
assert.ok(existsSync(statePath), "delegation state persisted")
const raw = readFileSync(statePath, "utf-8")
assert.equal(raw.includes(prompt), false, "raw prompt is not stored")

const state = JSON.parse(raw)
const session = Object.values(state.sessions || {}).find(s => s?.telemetry)
assert.ok(session?.telemetry, "session telemetry exists")
assert.ok(session.telemetry.events >= 1, "session telemetry event count increments")
assert.ok(session.telemetry.storage_bytes_estimate > 0, "session telemetry storage estimate tracked")
assert.ok(state.lifetime.telemetry.events >= 1, "lifetime telemetry event count increments")
assert.ok(state.lifetime.telemetry.storage_bytes_estimate > 0, "lifetime telemetry storage estimate tracked")

const savingsPayload = runtimeSurface.buildSavingsPayload({
  lifetime: {
    ltTasks: Number(state.lifetime.total_savings_usd || 0),
    ltCache: Number(state.lifetime.cache_savings_usd || 0),
    missedC7: Number(state.lifetime.missed_context7_usd || 0),
    count: Number(state.lifetime.warn_count || 0),
    sesTasks: Number(session?.total_savings_usd || 0),
    sesCache: Number(session?.cache_savings_usd || 0),
    sesToolBreakdown: session?.tool_breakdown || {},
    sesTrend: session?.trend || "stable",
    sesRatePerHour: Number(session?.telemetry?.events || 0),
    telemetry: state.lifetime.telemetry,
  },
  session,
})
assert.ok(savingsPayload.telemetry.lifetime_events >= 1, "payload includes telemetry counts")
assert.equal(savingsPayload.telemetry.current_session_events, session.telemetry.events, "payload session telemetry mirrors state")
assert.ok(savingsPayload.telemetry.tool_counts.task >= 1, "tool bucket stored")
