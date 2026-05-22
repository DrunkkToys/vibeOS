import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const DEFAULT_PORT = 9578
const TIERS_FILE = join(homedir(), ".claude/model-tiers.json")

function getBaseUrl() {
  try {
    if (existsSync(TIERS_FILE)) {
      const tiers = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
      const port = Number(tiers?.selection?.mcp_port)
      if (Number.isFinite(port) && port > 0) return `http://localhost:${port}`
    }
  } catch {}
  return `http://localhost:${DEFAULT_PORT}`
}

type StatusResponse = {
  todos: {
    total: number
    pending: number
  }

  enabled: boolean
  active_slot: string
  enforce: boolean
  flow_enforcer: boolean
  flow_extract_todos: boolean
  tdd_enforcer: boolean
  tdd_strict: boolean
  thinking: string
  current_model: string
  credit_percent: number
  version: string
}

type SavingsResponse = {
  lifetime: {
    delegation_usd: number
    cache_usd: number
    missed_context7_usd: number
    total_warns: number
  }
  current_session: {
    delegation_usd: number
    cache_usd: number
    warns_count: number
    tool_breakdown: Record<string, number>
  }
  cache_hits_this_session: number
  trend: string
  savings_rate_per_hour: number
}

// Named export for TUI auto-discovery
export const vibeOSTui = async (api, _options, _meta) => {
  try {
    if (api?.ui?.toast) {
      api.ui.toast({ variant: "info", message: "vibeOS TUI plugin executing" })
    }
    if (typeof process !== "undefined") {
      process.stderr?.write?.("[vibeOS-tui] plugin function called\n")
    }
  } catch (e) {
    if (typeof process !== "undefined") {
      process.stderr?.write?.("[vibeOS-tui] ERROR: " + String(e) + "\n")
    }
  }
}

const plugin: TuiPlugin = async (api, _options, _meta) => {
  const [status, setStatus] = createSignal<StatusResponse | null>(null)
  const [savings, setSavings] = createSignal<SavingsResponse | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  const poll = async () => {
    try {
      const baseUrl = getBaseUrl()
      const [s, sa] = await Promise.all([
        fetch(`${baseUrl}/status`).then((r) => r.json()),
        fetch(`${baseUrl}/savings`).then((r) => r.json()),
      ])
      setStatus(s)
      setSavings(sa)
      setError(null)
    } catch {
      setError("vibeOS MCP offline")
    }
  }

  await poll()
  const timer = setInterval(poll, 3000)

  api.lifecycle.onDispose(() => {
    clearInterval(timer)
  })

  const doAction = async (body: Record<string, unknown>) => {
    try {
      const res = await fetch(`${getBaseUrl()}/trinity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.ok) {
        api.ui.toast({ variant: "success", message: data.result })
        await poll()
      } else {
        api.ui.toast({ variant: "error", message: "Action failed" })
      }
    } catch {
      api.ui.toast({ variant: "error", message: "vibeOS offline" })
    }
  }

  const Slot = api.ui.Slot

  api.slots.register((props: { session_id: string }) => {
    const s = status()
    const sv = savings()

    if (error()) {
      return (
        <box flexDirection="column">
          <Slot name="sidebar_title" session_id={props.session_id} title="vibeOS">
            <text dim>vibeOS offline</text>
          </Slot>
          <Slot name="sidebar_content" session_id={props.session_id}>
            <box flexDirection="column" padding={1}>
              <text dim>vibeOS MCP not running</text>
              <newline />
              <text dim>ensure the server plugin is active</text>
            </box>
          </Slot>
          <Slot name="sidebar_footer" session_id={props.session_id}>
            <text dim>vibeOS MCP offline</text>
          </Slot>
        </box>
      )
    }

    const activeSlot = s?.active_slot ?? "?"
    const enabled = s?.enabled ?? false
    const trendArrow = sv?.trend === "up" ? "^" : sv?.trend === "down" ? "v" : "-"
    const delegation = (sv?.current_session?.delegation_usd ?? 0) + (sv?.lifetime?.delegation_usd ?? 0)
    const cache = (sv?.current_session?.cache_usd ?? 0) + (sv?.lifetime?.cache_usd ?? 0)
    const lifetime = (sv?.lifetime?.delegation_usd ?? 0) + (sv?.lifetime?.cache_usd ?? 0)
    const missedC7 = sv?.lifetime?.missed_context7_usd ?? 0
    const toolBreakdown = sv?.current_session?.tool_breakdown ?? {}
    const topTools = Object.entries(toolBreakdown)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 5)
    const trendColor = sv?.trend === "up" ? "green" : sv?.trend === "down" ? "red" : "yellow"
    const shortModel = s?.current_model?.split("/")[1] ?? s?.current_model ?? "?"
    const flowOn = s?.flow_enforcer ?? false
    const tddOn = s?.tdd_enforcer ?? false

    return (
      <box flexDirection="column">
        <Slot name="sidebar_title" session_id={props.session_id} title="vibeOS">
          <box>
            <text bold>vibeOS</text>
            <text dim> | </text>
            <text color={enabled ? "green" : "red"} bold>{activeSlot}</text>
            <text> </text>
            <text color={enabled ? "green" : "red"}>{enabled ? "." : "o"}</text>
          </box>
        </Slot>
        <Slot name="sidebar_content" session_id={props.session_id}>
          <box flexDirection="column" padding={1}>
            <text dim bold>MODEL STATUS</text>
            <newline />
            <box>
              <text bold={activeSlot === "brain"} color={activeSlot === "brain" ? "green" : undefined}>
                {shortModel}
              </text>
              {activeSlot === "brain" && <text color="green"> active</text>}
            </box>
            <newline />
            <text dim>---</text>
            <newline />
            <box>
              <text>Flow </text>
              <text color={flowOn ? "green" : "red"} bold>{flowOn ? "ON" : "OFF"}</text>
            </box>
            <newline />
            <box>
              <text>TDD </text>
              <text color={tddOn ? "green" : "red"} bold>{tddOn ? "ON" : "OFF"}</text>
              {tddOn && s?.tdd_strict && <text dim> strict</text>}
            </box>
            <newline />
            <box>
              <text>Enforce </text>
              <text color={s?.enforce ? "green" : "red"} bold>{s?.enforce ? "ON" : "OFF"}</text>
            </box>
            <newline />
            <text dim>---</text>
            <newline />
            <box>
              <text>Thinking: </text>
              <text>{s?.thinking ?? "?"}</text>
            </box>
            <newline />
            <newline />
            <text dim bold>SAVINGS</text>
            <newline />
            <box>
              <text bold>Saved: </text>
              <text bold color={trendColor}>${lifetime.toFixed(2)} {trendArrow}</text>
            </box>
            <newline />
            <box><text>  Delegation: </text><text>${delegation.toFixed(2)}</text></box>
            <newline />
            <box><text>  Cache: </text><text>${cache.toFixed(2)}</text></box>
            <newline />
            <box><text>  C7 missed: </text><text>${missedC7.toFixed(2)}</text></box>
            <newline />
            <text dim>---</text>
            <newline />
            <box><text>Rate: </text><text>${sv?.savings_rate_per_hour?.toFixed(2) ?? "0.00"}/hr</text></box>
            <newline />
            <box><text>Warns: </text><text>{sv?.current_session?.warns_count ?? 0}</text></box>
            <newline />
            <text dim>---</text>
            <newline />
            <text dim>Tool split:</text>
            <newline />
            {topTools.map(([tool, val]) => (
            <newline />
            <text dim bold>TODOS</text>
            <newline />
            <box>
              <text>Pending: </text>
              <text color={s?.todos?.pending > 0 ? "yellow" : "green"} bold>
                {s?.todos?.pending ?? 0}
              </text>
              <text> / {s?.todos?.total ?? 0}</text>
            </box>
            <newline />

              <>
                <box>
                  <text>  {tool.padEnd(8)}</text>
                  <text>${(val as number).toFixed(2)}</text>
                </box>
                <newline />
              </>
            ))}
            <newline />
            <text dim bold>CONTROLS</text>
            <newline />
            <box>
              <text
                onClick={() => doAction({ action: "set", slot: "brain", level: null })}
                color={activeSlot === "brain" ? "green" : "dim"}
                bold={activeSlot === "brain"}
              >[brain]</text>
              <text> </text>
              <text
                onClick={() => doAction({ action: "set", slot: "medium", level: null })}
                color={activeSlot === "medium" ? "green" : "dim"}
                bold={activeSlot === "medium"}
              >[medium]</text>
              <text> </text>
              <text
                onClick={() => doAction({ action: "set", slot: "cheap", level: null })}
                color={activeSlot === "cheap" ? "green" : "dim"}
                bold={activeSlot === "cheap"}
              >[cheap]</text>
            </box>
            <newline />
            <box>
              <text
                onClick={() => doAction({ action: "flow", slot: flowOn ? "off" : "on", level: null })}
                color={flowOn ? "green" : "red"} bold
              >[Flow {flowOn ? "ON" : "OFF"}]</text>
            </box>
            <newline />
            <box>
              <text
                onClick={() => doAction({ action: "tdd", slot: tddOn ? "off" : "on", level: null })}
                color={tddOn ? "green" : "red"} bold
              >[TDD {tddOn ? "ON" : "OFF"}]</text>
            </box>
            <newline />
            <box>
              <text
                onClick={() => doAction({ action: "enforce", slot: s?.enforce ? "off" : "on", level: null })}
                color={s?.enforce ? "green" : "red"} bold
              >[Enforce {s?.enforce ? "ON" : "OFF"}]</text>
            </box>
            <newline />
            <box>
              <text
                onClick={() => doAction({ action: "disable", slot: null, level: null })}
                color="red" bold
              >[Disable]</text>
            </box>
          </box>
        </Slot>
        <Slot name="sidebar_footer" session_id={props.session_id}>
          <box>
            <text dim>Saved </text>
            <text color={trendColor}>{lifetime.toFixed(2)}</text>
            <text dim> {trendArrow} </text>
            <text>{sv?.savings_rate_per_hour?.toFixed(2) ?? "0.00"}/hr</text>
            <text dim> | {sv?.current_session?.warns_count ?? 0} warns</text>
          </box>
        </Slot>
      </box>
    )
  })
}

export default { tui: plugin }
