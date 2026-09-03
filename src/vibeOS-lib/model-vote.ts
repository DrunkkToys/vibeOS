// A real N-model vote for vibeOS trinity routing.
//
// The chain experiment's voteN asks several DIFFERENT models the same question
// and takes the majority. The decorrelation between models is where the accuracy
// comes from: three models that fail on different inputs are far better together
// than one model asked three times, whose mistakes repeat.
//
// tool.execute.before cannot issue extra tool calls, but the OpenCode client can
// prompt a model directly (client.session.prompt with an explicit model), so the
// plugin runs the voters itself in throwaway sessions and reconciles the answers
// before deciding which tier should do the real work.

import { resolveVote, type VoteResult } from "./adaptive-router.js"

export interface ModelVoteResult extends VoteResult {
  ran: boolean
  answers: string[]
  elapsedMs: number
}

// A majority needs a third opinion to break a tie; see runModelVote.
export const MIN_VOTERS = 3

const NO_VOTE: ModelVoteResult = {
  ran: false, agreed: false, answer: null, agreement: 0, samples: 0, answers: [], elapsedMs: 0,
}

export function parseModelIdentifier(id: unknown): { providerID: string; modelID: string } | null {
  const s = String(id ?? "").trim()
  const cut = s.indexOf("/")
  if (cut <= 0 || cut === s.length - 1) return null
  return { providerID: s.slice(0, cut), modelID: s.slice(cut + 1) }
}

function extractText(response: unknown): string {
  const data = (response as { data?: unknown })?.data ?? response
  const parts = (data as { parts?: unknown })?.parts
  if (Array.isArray(parts)) {
    const text = parts
      .filter((p: unknown) => (p as { type?: string })?.type === "text")
      .map((p: unknown) => String((p as { text?: unknown })?.text ?? ""))
      .join("\n")
      .trim()
    if (text) return text
  }
  const direct = (data as { text?: unknown })?.text
  return typeof direct === "string" ? direct.trim() : ""
}

interface VoteSessionApi {
  create: (opts: unknown) => Promise<unknown>
  prompt: (opts: unknown) => Promise<unknown>
  delete?: (opts: unknown) => Promise<unknown>
}

interface VoteClient { session: VoteSessionApi }

async function askOne(
  client: VoteClient,
  model: { providerID: string; modelID: string },
  prompt: string,
  directory: string | undefined,
  system: string | undefined,
): Promise<string> {
  const session = client.session
  const created = (await session.create({
    body: { title: "vibeOS vote" },
    ...(directory ? { query: { directory } } : {}),
  })) as { data?: { id?: string }, id?: string }
  const id = created?.data?.id || created?.id
  if (!id) return ""
  try {
    const response = await session.prompt({
      path: { id },
      ...(directory ? { query: { directory } } : {}),
      body: {
        model,
        // A voter answers; it does not act. Handing it tools would let a
        // discarded opinion edit the user's files.
        tools: { bash: false, edit: false, write: false, patch: false, read: false, glob: false, grep: false, webfetch: false, task: false },
        ...(system ? { system } : {}),
        parts: [{ type: "text", text: prompt }],
      },
    })
    return extractText(response)
  } finally {
    try { await session.delete?.({ path: { id }, ...(directory ? { query: { directory } } : {}) }) } catch {}
  }
}

export async function runModelVote(
  client: unknown,
  opts: {
    models: unknown
    prompt: unknown
    directory?: string
    system?: string
    timeoutMs?: number
    threshold?: number
  },
): Promise<ModelVoteResult> {
  const started = Date.now()
  if (!client || typeof client !== "object" || !(client as { session?: unknown }).session) return NO_VOTE

  const prompt = String(opts?.prompt ?? "").trim()
  if (!prompt) return NO_VOTE

  const seen = new Set<string>()
  const models: Array<{ providerID: string; modelID: string }> = []
  for (const raw of Array.isArray(opts?.models) ? opts.models : []) {
    const key = String(raw ?? "").trim()
    if (!key || seen.has(key)) continue
    const parsed = parseModelIdentifier(key)
    if (!parsed) continue
    seen.add(key)
    models.push(parsed)
  }
  // Three is the floor. With two voters a majority is arithmetically impossible:
  // they either agree unanimously or tie, and a tie carries no verdict, so the
  // "vote" collapses into unanimity-or-escalate and cannot outvote a single
  // wrong model. One model answering twice is not a vote at all -- the whole
  // point is that the voters fail on different inputs.
  if (models.length < MIN_VOTERS) return NO_VOTE

  const timeoutMs = Number.isFinite(opts?.timeoutMs as number) ? Number(opts?.timeoutMs) : 30_000
  let cutoff: NodeJS.Timeout | null = null
  const deadline = new Promise<string>((resolve) => {
    // Deliberately not unref'd: the timer is the only thing keeping the loop
    // alive while a hung provider is outstanding, and it is cleared the moment
    // the race settles, so it never outlives the vote.
    cutoff = setTimeout(() => resolve(""), timeoutMs)
  })

  const answers = await Promise.all(
    models.map((model) =>
      Promise.race([
        askOne(client as VoteClient, model, prompt, opts?.directory, opts?.system).catch(() => ""),
        deadline,
      ]),
    ),
  )
  if (cutoff) clearTimeout(cutoff)

  const kept = answers.filter((a) => typeof a === "string" && a.trim().length > 0)
  const verdict = resolveVote(kept, Number.isFinite(opts?.threshold as number) ? Number(opts?.threshold) : 0.5)

  return {
    ran: true,
    agreed: verdict.agreed,
    answer: verdict.answer,
    agreement: verdict.agreement,
    samples: verdict.samples,
    answers: kept,
    elapsedMs: Date.now() - started,
  }
}
