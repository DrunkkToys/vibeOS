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

  const openControls = () => {
    const s = status()
    if (!s) return

    const activeSlot = s.active_slot
    const shortModel = s.current_model?.split("/")[1] ?? s.current_model ?? "?"

    api.ui.dialog.replace(() => {
      const { DialogSelect } = api.ui
      return (
        <DialogSelect
          title="vibeOS"
          placeholder="Filter controls..."
          options={[
            {
              category: "Model Slot",
              title: `${activeSlot === "brain" ? "[*] " : ""}Brain (${shortModel})`,
              value: "set_brain",
              description: activeSlot === "brain" ? "Current slot" : "Primary model slot",
              disabled: activeSlot === "brain",
            },
            {
              category: "Model Slot",
              title: `${activeSlot === "medium" ? "[*] " : ""}Medium`,
              value: "set_medium",
              description: activeSlot === "medium" ? "Current slot" : "Mid-tier model slot",
              disabled: activeSlot === "medium",
            },
            {
              category: "Model Slot",
              title: `${activeSlot === "cheap" ? "[*] " : ""}Cheap`,
              value: "set_cheap",
              description: activeSlot === "cheap" ? "Current slot" : "Cost-saving model slot",
              disabled: activeSlot === "cheap",
            },
            {
              category: "Enforcers",
              title: `Flow: ${s.flow_enforcer ? "ON" : "OFF"}`,
              value: "toggle_flow",
              description: s.flow_enforcer ? "Click to disable" : "Click to enable",
            },
            {
              category: "Enforcers",
              title: `TDD: ${s.tdd_enforcer ? "ON" : "OFF"}${s.tdd_strict ? " (strict)" : ""}`,
              value: "toggle_tdd",
              description: s.tdd_enforcer ? "Click to disable" : "Click to enable",
            },
            {
              category: "Enforcers",
              title: `Enforce: ${s.enforce ? "ON" : "OFF"}`,
              value: "toggle_enforce",
              description: s.enforce ? "Click to disable" : "Click to enable",
            },
            {
              category: "Plugin",
              title: "Disable vibeOS",
              value: "disable",
              description: "Stop all vibeOS enforcement and tracking",
            },
          ]}
          onSelect={(opt) => {
            if (opt.value === "set_brain") doAction({ action: "set", slot: "brain", level: null })
            else if (opt.value === "set_medium") doAction({ action: "set", slot: "medium", level: null })
            else if (opt.value === "set_cheap") doAction({ action: "set", slot: "cheap", level: null })
            else if (opt.value === "toggle_flow")
              doAction({ action: "flow", slot: s.flow_enforcer ? "off" : "on", level: null })
            else if (opt.value === "toggle_tdd")
              doAction({ action: "tdd", slot: s.tdd_enforcer ? "off" : "on", level: null })
            else if (opt.value === "toggle_enforce")
              doAction({ action: "enforce", slot: s.enforce ? "off" : "on", level: null })
            else if (opt.value === "disable") doAction({ action: "disable", slot: null, level: null })
            api.ui.dialog.clear()
          }}
        />
      )
    })
  }

  const Slot = api.ui.Slot

  api.slots.register((props: { session_id: string }) => {
    const s = status()
    const sv = savings()

    if (error()) {
      return (
        <box flexDirection="column">
          <Slot name="sidebar_title" session_id={props.session_id} title="vibeOS">
            <text dim onClick={openControls}>vibeOS ▸ offline</text>
          </Slot>
          <Slot name="sidebar_footer" session_id={props.session_id}>
            <text dim>vibeOS MCP offline</text>
          </Slot>
        </box>
      )
    }

    const activeSlot = s?.active_slot ?? "?"
    const enabled = s?.enabled ?? false
    const trendArrow = sv?.trend === "up" ? "up" : sv?.trend === "down" ? "down" : "flat"
    const lifetime = (sv?.lifetime?.delegation_usd ?? 0) + (sv?.lifetime?.cache_usd ?? 0)
    const trendColor = sv?.trend === "up" ? "green" : sv?.trend === "down" ? "red" : "yellow"
    const rate = sv?.savings_rate_per_hour?.toFixed(2) ?? "0.00"
    const warns = sv?.current_session?.warns_count ?? 0
    const flowOn = s?.flow_enforcer ?? false
    const tddOn = s?.tdd_enforcer ?? false

    return (
      <box flexDirection="column">
        <Slot name="sidebar_title" session_id={props.session_id} title="vibeOS">
          <box>
            <text bold onClick={openControls}>vibeOS</text>
            <text dim> ▸ </text>
            <text onClick={openControls}>{activeSlot}</text>
            <text> </text>
            <text color={enabled ? "green" : "red"} onClick={openControls}>
              {enabled ? "." : "o"}
            </text>
          </box>
        </Slot>
        <Slot name="sidebar_footer" session_id={props.session_id}>
          <box>
            <text dim>Saved </text>
            <text color={trendColor}>{lifetime.toFixed(2)}</text>
            <text dim> {trendArrow} </text>
            <text>{rate}/hr</text>
            <text dim> | </text>
            <text color={flowOn ? "green" : "dim"}>F</text>
            <text color={tddOn ? "green" : "dim"}>T</text>
            <text dim> w{warns}</text>
          </box>
        </Slot>
      </box>
    )
  })
}

export default { tui: plugin }
