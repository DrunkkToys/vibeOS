import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"

const BASE_URL = "http://localhost:9578"

type StatusResponse = {
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

const plugin: TuiPlugin = async (api, _options, _meta) => {
  const [status, setStatus] = createSignal<StatusResponse | null>(null)
  const [savings, setSavings] = createSignal<SavingsResponse | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  const poll = async () => {
    try {
      const [s, sa] = await Promise.all([
        fetch(`${BASE_URL}/status`).then((r) => r.json()),
        fetch(`${BASE_URL}/savings`).then((r) => r.json()),
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
      const res = await fetch(`${BASE_URL}/trinity`, {
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

  const btnStyle = (active: boolean) => ({
    color: active ? "green" as const : "dim" as const,
    bold: active,
  })

  const toggleStyle = (on: boolean) => ({
    color: on ? "green" as const : "red" as const,
    bold: true,
  })

  const Slot = api.ui.Slot

  api.slots.register((props: { session_id: string }) => {
    const s = status()
    const sv = savings()

    if (error()) {
      return (
        <box flexDirection="column">
          <Slot name="sidebar_title" session_id={props.session_id} title="vibeOS">
            <text dim>vibeOS ▸ offline</text>
          </Slot>
          <Slot name="sidebar_content" session_id={props.session_id}>
            <box flexDirection="column" padding={1}>
              <text dim>vibeOS MCP not running</text>
              <newline />
              <text dim>Ensure the server plugin is active</text>
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
    const trendArrow = sv?.trend === "up" ? "↑" : sv?.trend === "down" ? "↓" : "→"
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

    return (
      <box flexDirection="column">
        <Slot name="sidebar_title" session_id={props.session_id} title="vibeOS">
          <box>
            <text bold>vibeOS</text>
            <text dim> ▸ </text>
            <text>{activeSlot}</text>
            <text> </text>
            <text color={enabled ? "green" : "red"}>{enabled ? "●" : "○"}</text>
          </box>
        </Slot>

        <Slot name="sidebar_content" session_id={props.session_id}>
          <box flexDirection="column" padding={1}>
            <text dim bold>MODEL &amp; STATUS</text>
            <newline />
            <box>
              <text>🧠 </text>
              <text bold={activeSlot === "brain"} color={activeSlot === "brain" ? "green" : undefined}>
                {shortModel}
              </text>
              {activeSlot === "brain" && <text color="green"> ★ active</text>}
            </box>
            <newline />
            <text dim>────────────────────────</text>
            <newline />
            <box>
              <text>Flow     </text>
              <text color={s?.flow_enforcer ? "green" : "red"} bold>
                {s?.flow_enforcer ? "████ ON" : "──── OFF"}
              </text>
            </box>
            <newline />
            <box>
              <text>TDD      </text>
              <text color={s?.tdd_enforcer ? "green" : "red"} bold>
                {s?.tdd_enforcer ? "████ ON" : "──── OFF"}
              </text>
              {s?.tdd_enforcer && s?.tdd_strict && <text> (strict)</text>}
            </box>
            <newline />
            <box>
              <text>Enforce  </text>
              <text color={s?.enforce ? "green" : "red"} bold>
                {s?.enforce ? "████ ON" : "──── OFF"}
              </text>
            </box>
            <newline />
            <text dim>────────────────────────</text>
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
              <text bold>vibeOS saved: </text>
              <text bold color={trendColor}>${lifetime.toFixed(2)} {trendArrow}</text>
            </box>
            <newline />
            <box>
              <text>  Delegation: </text>
              <text>${delegation.toFixed(2)}</text>
            </box>
            <newline />
            <box>
              <text>  Cache:      </text>
              <text>${cache.toFixed(2)}</text>
            </box>
            <newline />
            <box>
              <text>  C7 missed:  </text>
              <text>${missedC7.toFixed(2)}</text>
            </box>
            <newline />
            <text dim>────────────────────────</text>
            <newline />
            <box>
              <text dim>Session: 0h 23m</text>
            </box>
            <newline />
            <box>
              <text>Rate: </text>
              <text>${sv?.savings_rate_per_hour?.toFixed(2) ?? "0.00"}/hr</text>
            </box>
            <newline />
            <box>
              <text>Warns: </text>
              <text>{sv?.current_session?.warns_count ?? 0}</text>
            </box>
            <newline />
            <text dim>────────────────────────</text>
            <newline />
            <text dim>Tool split:</text>
            <newline />
            {topTools.map(([tool, val]) => (
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
                {...btnStyle(activeSlot === "brain")}
                onClick={() => doAction({ action: "set", slot: "brain", level: null })}
              >
                [brain]
              </text>
              <text> </text>
              <text
                {...btnStyle(activeSlot === "medium")}
                onClick={() => doAction({ action: "set", slot: "medium", level: null })}
              >
                [medium]
              </text>
              <text> </text>
              <text
                {...btnStyle(activeSlot === "cheap")}
                onClick={() => doAction({ action: "set", slot: "cheap", level: null })}
              >
                [cheap]
              </text>
            </box>
            <newline />
            <box>
              <text
                {...toggleStyle(s?.flow_enforcer ?? false)}
                onClick={() => doAction({ action: "flow", slot: "on", level: null })}
              >
                [Flow ON]
              </text>
              <text> </text>
              <text
                {...toggleStyle(!(s?.flow_enforcer ?? false))}
                onClick={() => doAction({ action: "flow", slot: "off", level: null })}
              >
                [Flow OFF]
              </text>
            </box>
            <newline />
            <box>
              <text
                {...toggleStyle(s?.tdd_enforcer ?? false)}
                onClick={() => doAction({ action: "tdd", slot: "on", level: null })}
              >
                [TDD ON]
              </text>
              <text> </text>
              <text
                {...toggleStyle(!(s?.tdd_enforcer ?? false))}
                onClick={() => doAction({ action: "tdd", slot: "off", level: null })}
              >
                [TDD OFF]
              </text>
            </box>
            <newline />
            <box>
              <text
                {...toggleStyle(s?.enforce ?? false)}
                onClick={() => doAction({ action: "enforce", slot: "on", level: null })}
              >
                [Enforce ON]
              </text>
              <text> </text>
              <text
                {...toggleStyle(!(s?.enforce ?? false))}
                onClick={() => doAction({ action: "enforce", slot: "off", level: null })}
              >
                [Enforce OFF]
              </text>
            </box>
            <newline />
            <text
              color="red"
              bold
              onClick={() => doAction({ action: "disable", slot: null, level: null })}
            >
              [Disable Plugin]
            </text>
          </box>
        </Slot>

        <Slot name="sidebar_footer" session_id={props.session_id}>
          <box>
            <text dim>
              Pattern: {(sv?.current_session?.warns_count ?? 0) > 0 ? "12" : "--"}  |  Trend:{" "}
            </text>
            <text color={trendColor}>{trendArrow}</text>
            <text dim>  |  Rate: ${sv?.savings_rate_per_hour?.toFixed(2) ?? "0.00"}/hr</text>
          </box>
        </Slot>
      </box>
    )
  })
}

export default { tui: plugin }
