// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// The vote's transport.
//
// model-vote.ts asks the OpenCode SDK client for independent answers, and that
// client cannot deliver them: a session.prompt issued from inside a hook never
// settles. Measured three ways -- blocking at 60s, blocking at 240s, and
// dispatched without awaiting at 120s -- roughly 1900 attempts returned zero
// answers and zero errors, each burning its full deadline.
//
// So the voters are polled directly over HTTP instead. Every provider OpenCode
// knows is OpenAI-compatible and publishes its base URL in OpenCode's own model
// registry, so nothing here is guessed or hardcoded: the URL comes from the
// registry, the key from OpenCode's auth store, and both are env-overridable for
// machines that keep them elsewhere.
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { safeJsonParse } from "../utils/fs-helpers.js"
import { resolveVote } from "./adaptive-router.js"
import type { ModelVoteResult } from "./model-vote.js"

export function opencodeDataDir(): string {
  return process.env.OPENCODE_DATA_DIR
    || join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode")
}

export function opencodeCacheDir(): string {
  return process.env.OPENCODE_CACHE_DIR
    || join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "opencode")
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null
    return safeJsonParse<Record<string, unknown>>(readFileSync(path, "utf-8")) || null
  } catch { return null }
}

export interface ProviderEndpoint { baseUrl: string; apiKey: string }

// Overrides are read per call rather than cached: a long-lived plugin process
// would otherwise freeze whatever the environment said when it first loaded.
function envOverride(providerID: string, suffix: string): string {
  const slug = providerID.toUpperCase().replace(/[^A-Z0-9]+/g, "_")
  return String(process.env[`VIBEOS_VOTE_${suffix}_${slug}`] || "").trim()
}

export function resolveProviderEndpoint(providerID: string): ProviderEndpoint | null {
  const id = String(providerID || "").trim()
  if (!id) return null

  let baseUrl = envOverride(id, "URL")
  if (!baseUrl) {
    const registry = readJson(join(opencodeCacheDir(), "models.json"))
    const api = (registry?.[id] as { api?: unknown } | undefined)?.api
    baseUrl = typeof api === "string" ? api.trim() : ""
  }
  if (!baseUrl) return null

  let apiKey = envOverride(id, "KEY")
  if (!apiKey) {
    const auth = readJson(join(opencodeDataDir(), "auth.json"))
    const entry = auth?.[id] as { key?: unknown; type?: unknown } | undefined
    apiKey = typeof entry?.key === "string" ? entry.key.trim() : ""
  }
  if (!apiKey) return null

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey }
}

export function extractCompletion(payload: unknown): string {
  const choice = (payload as { choices?: unknown })?.choices
  if (!Array.isArray(choice) || choice.length === 0) return ""
  const message = (choice[0] as { message?: unknown })?.message as
    { content?: unknown; reasoning_content?: unknown } | undefined
  const content = typeof message?.content === "string" ? message.content.trim() : ""
  if (content) return content
  // A reasoning model that hits the token cap mid-thought returns an empty
  // content with the partial thought beside it. That is not an answer, and
  // counting it as one would let a truncated ramble win a vote.
  return ""
}

export async function askDirect(
  endpoint: ProviderEndpoint,
  modelID: string,
  prompt: string,
  timeoutMs: number,
  maxTokens: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const controller = new AbortController()
  const cutoff = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${endpoint.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelID,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return extractCompletion(await res.json())
  } finally {
    clearTimeout(cutoff)
  }
}

export const VOTE_MAX_TOKENS = 900

export async function runDirectVote(opts: {
  models: unknown
  prompt: unknown
  timeoutMs?: number
  threshold?: number
  maxTokens?: number
  fetchImpl?: typeof fetch
}): Promise<ModelVoteResult> {
  const started = Date.now()
  const empty: ModelVoteResult = {
    ran: false, agreed: false, answer: null, agreement: 0,
    samples: 0, answers: [], errors: [], elapsedMs: 0,
  }
  const prompt = String(opts?.prompt ?? "").trim()
  if (!prompt) return empty

  const seen = new Set<string>()
  const targets: Array<{ id: string; endpoint: ProviderEndpoint; modelID: string }> = []
  const errors: string[] = []
  for (const raw of Array.isArray(opts?.models) ? opts.models : []) {
    const id = String(raw ?? "").trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const cut = id.indexOf("/")
    if (cut <= 0 || cut === id.length - 1) { errors.push(`${id}: not a provider/model id`); continue }
    const endpoint = resolveProviderEndpoint(id.slice(0, cut))
    if (!endpoint) { errors.push(`${id}: no endpoint or key for provider`); continue }
    targets.push({ id, endpoint, modelID: id.slice(cut + 1) })
  }
  if (targets.length === 0) return { ...empty, errors }

  const timeoutMs = Number.isFinite(opts?.timeoutMs as number) ? Number(opts?.timeoutMs) : 60_000
  const maxTokens = Number.isFinite(opts?.maxTokens as number) ? Number(opts?.maxTokens) : VOTE_MAX_TOKENS
  const answers = await Promise.all(targets.map((t) =>
    askDirect(t.endpoint, t.modelID, prompt, timeoutMs, maxTokens, opts?.fetchImpl || fetch)
      .catch((err) => {
        errors.push(`${t.id}: ${String((err as Error)?.message || err).slice(0, 200)}`)
        return ""
      }),
  ))

  const kept = answers.filter((a) => typeof a === "string" && a.trim().length > 0)
  const verdict = resolveVote(kept, Number.isFinite(opts?.threshold as number) ? Number(opts?.threshold) : 0.5)
  return {
    ran: true,
    agreed: verdict.agreed,
    answer: verdict.answer,
    agreement: verdict.agreement,
    samples: verdict.samples,
    answers: kept,
    errors,
    elapsedMs: Date.now() - started,
  }
}
