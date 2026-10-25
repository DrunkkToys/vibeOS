// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getVibeOSHome } from "../lib/state.js"
import { safeJsonParse } from "../utils/fs-helpers.js"
import { clearlyTrivial, isTestCommand } from "../lib/router-only.js"

type Todo = { content?: string; status?: string }
type PlanSession = { trivial: boolean; todos: Todo[]; sent: number; lastSent: string; lastTest: "pass" | "fail" | null; editedSinceTest: boolean }

const MAX_CONTINUATIONS = 3
const WRITE_TOOLS = new Set(["write", "edit", "patch", "multiedit", "apply_patch", "notebookedit"])
const VERIFY_STEP = /\b(verif|test|check|validat|run)/i
const sessions = new Map<string, PlanSession>()

export const PLAN_DIRECTIVE = [
  "Plan before you edit. Before the first file change, call todowrite with the steps of the task.",
  "The last step must verify the work: run the tests or the program and confirm it works.",
  "Mark each step in_progress when you start it and completed only when it is done.",
  "Do not stop while steps are pending. If a step cannot be done, mark it cancelled and say why.",
].join(" ")

export function planGateEnabled(): boolean {
  const env = process.env.VIBEOS_PLAN_GATE
  if (env === "1") return true
  if (env === "0") return false
  try {
    const file = join(getVibeOSHome(), "model-tiers.json")
    if (!existsSync(file)) return false
    const tiers = safeJsonParse(readFileSync(file, "utf-8")) as { selection?: { plan_gate?: unknown } } | null
    return tiers?.selection?.plan_gate === true
  } catch {
    return false
  }
}

function textOf(parts: unknown): string {
  if (!Array.isArray(parts)) return ""
  return parts
    .filter((p) => p?.type === "text" && typeof p?.text === "string" && !p?.synthetic)
    .map((p) => p.text)
    .join("\n")
    .trim()
}

export function planGateOnUserMessage(sessionID: string | undefined, parts: unknown): void {
  if (!sessionID) return
  const text = textOf(parts)
  if (!text) return
  const s = sessions.get(sessionID)
  if (s && s.lastSent && text === s.lastSent) return
  sessions.set(sessionID, { trivial: clearlyTrivial(text), todos: s?.todos || [], sent: 0, lastSent: "", lastTest: s?.lastTest ?? null, editedSinceTest: s?.editedSinceTest ?? false })
}

export function planGateWantsDirective(sessionID: string | undefined): boolean {
  const s = sessionID ? sessions.get(sessionID) : undefined
  return !!s && !s.trivial
}

export function planGateOnTodos(sessionID: string | undefined, todos: unknown): void {
  const s = sessionID ? sessions.get(sessionID) : undefined
  if (!s || !Array.isArray(todos)) return
  s.todos = todos.filter((t) => t && typeof t === "object") as Todo[]
}

export function planGateBeforeTool(sessionID: string | undefined, tool: unknown): void {
  const s = sessionID ? sessions.get(sessionID) : undefined
  if (!s || s.trivial || s.todos.length > 0) return
  if (!WRITE_TOOLS.has(String(tool || "").toLowerCase())) return
  throw new Error("[vibeOS plan gate] No plan yet. Call todowrite with the steps of this task, ending with a step that verifies the work, then make the change.")
}

export function planGateAfterTool(sessionID: string | undefined, tool: unknown, args: unknown, metadata: unknown): void {
  const s = sessionID ? sessions.get(sessionID) : undefined
  if (!s) return
  const name = String(tool || "").toLowerCase()
  if (name === "todowrite") return planGateOnTodos(sessionID, (args as { todos?: unknown })?.todos)
  if (WRITE_TOOLS.has(name)) { s.editedSinceTest = true; return }
  if (name !== "bash") return
  const exit = (metadata as { exit?: unknown })?.exit
  if (typeof exit !== "number" || !isTestCommand(String((args as { command?: unknown })?.command || ""))) return
  s.lastTest = exit === 0 ? "pass" : "fail"
  s.editedSinceTest = false
}

export function planGateContinuation(sessionID: string | undefined): string | null {
  const s = sessionID ? sessions.get(sessionID) : undefined
  if (!s || s.todos.length === 0 || s.sent >= MAX_CONTINUATIONS) return null
  const pending = s.todos.filter((t) => t.status === "pending")
  let text = ""
  if (pending.length > 0) {
    const rest = pending.map((t) => `- ${t.content}`).join("\n")
    text = `Your plan still has pending steps. Continue with the next one: "${pending[0].content}".\n\nPending:\n${rest}\n\nIf a step cannot be done, mark it cancelled and say why.`
  } else {
    const verify = s.todos.find((t) => t.status === "completed" && VERIFY_STEP.test(String(t.content || "")))
    if (!verify || (s.lastTest === "pass" && !s.editedSinceTest)) return null
    const why = s.lastTest === "fail" ? "the last test run failed" : "no passing test run was recorded after the last change"
    text = `The step "${verify.content}" is marked completed, but ${why}. Run the tests and fix any failures. If the tests cannot be run here, mark the step cancelled and say why.`
  }
  s.sent++
  s.lastSent = text
  return text
}
