// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// The Task-delegation vote is unreachable on the workload the A/B rig measures:
// every turn it recorded calls read, bash, edit and write and never task. These
// tests pin the vote to the primary turn, where the chain experiment measures it.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { CONSENSUS_MARKER } from "../src/vibeOS-lib/turn-consensus.js"

const PROMPT = "diagnose why the batching helper drops the final chunk when the queue flushes early"

function sandbox(name, votePool = ["opencode-go/glm-5.1", "opencode-go/qwen3.8-flash"], mode = "vibeultrax") {
  const dir = mkdtempSync(join(tmpdir(), name))
  const old = { HOME: process.env.HOME, VIBEOS_HOME: process.env.VIBEOS_HOME, TURN: process.env.VIBEOS_TURN_VOTE }
  process.env.HOME = dir
  process.env.VIBEOS_HOME = join(dir, ".claude")
  delete process.env.VIBEOS_TURN_VOTE
  mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
  writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "cheap",
      optimization_mode: mode,
      active_pipeline: ["cheap", "medium", "brain"],
      vote_pool: votePool,
    },
    trinity: {
      cheap: { oc: "opencode-go/mimo-v2.5" },
      medium: { oc: "opencode-go/deepseek-v4-flash" },
      brain: { oc: "opencode-go/glm-5.3-flash" },
    },
  }, null, 2))
  return {
    dir,
    cleanup() {
      for (const [k, v] of Object.entries({ HOME: old.HOME, VIBEOS_HOME: old.VIBEOS_HOME, VIBEOS_TURN_VOTE: old.TURN })) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function voter(answers) {
  const asked = []
  let n = 0
  return {
    asked,
    session: {
      create: async () => ({ data: { id: "ses_" + ++n } }),
      delete: async () => {},
      prompt: async ({ body }) => {
        const model = `${body.model.providerID}/${body.model.modelID}`
        asked.push({ model, prompt: body.parts[0].text })
        return { data: { parts: [{ type: "text", text: answers[model] ?? "unknown" }] } }
      },
    },
  }
}

const turn = () => [{ role: "user", parts: [{ type: "text", text: PROMPT }] }]

async function load(stamp) {
  return await import("../src/lib/hooks/chat-transform.js?turnvote-" + stamp)
}

test("a primary turn with no task call still gets a real vote", async () => {
  const ctx = sandbox("vibeos-turnvote-")
  try {
    const chat = await load("a" + Date.now())
    const c = voter({
      "opencode-go/mimo-v2.5": "the flush path skips the tail buffer",
      "opencode-go/deepseek-v4-flash": "the flush path skips the tail buffer",
      "opencode-go/glm-5.1": "the flush path skips the tail buffer",
      "opencode-go/qwen3.8-flash": "an off-by-one in the index",
    })
    const messages = turn()
    const reason = await chat.applyTurnConsensus(messages, c)
    assert.match(reason, /agreed/, reason)
    assert.equal(c.asked.length, 4, "four configured models means four voters")
    assert.ok(c.asked.every((a) => a.prompt === PROMPT), "every voter answers the user's own question")
    const injected = messages[0].parts.find((p) => p.text?.includes(CONSENSUS_MARKER))
    assert.ok(injected, "the verdict must reach the turn the model actually reads")
    assert.ok(injected.synthetic, "an injected part must be marked synthetic")
    assert.match(injected.text, /flush path skips the tail buffer/)
  } finally {
    ctx.cleanup()
  }
})

test("a split vote is injected as a split, not as an answer", async () => {
  const ctx = sandbox("vibeos-turnvote-split-")
  try {
    const chat = await load("b" + Date.now())
    const c = voter({
      "opencode-go/mimo-v2.5": "cause one",
      "opencode-go/deepseek-v4-flash": "cause two",
      "opencode-go/glm-5.1": "cause three",
      "opencode-go/qwen3.8-flash": "cause four",
    })
    const messages = turn()
    const reason = await chat.applyTurnConsensus(messages, c)
    assert.match(reason, /split/, reason)
    const injected = messages[0].parts.find((p) => p.text?.includes(CONSENSUS_MARKER))
    assert.match(injected.text, /did not agree/)
    assert.ok(!injected.text.includes("cause one"), "no single losing answer may be passed off as the verdict")
  } finally {
    ctx.cleanup()
  }
})

test("the models are polled once per turn, not once per tool round-trip", async () => {
  const ctx = sandbox("vibeos-turnvote-once-")
  try {
    const chat = await load("c" + Date.now())
    const answers = {
      "opencode-go/mimo-v2.5": "same", "opencode-go/deepseek-v4-flash": "same",
      "opencode-go/glm-5.1": "same", "opencode-go/qwen3.8-flash": "same",
    }
    const c = voter(answers)
    const messages = turn()
    await chat.applyTurnConsensus(messages, c)
    const afterFirst = c.asked.length
    const second = await chat.applyTurnConsensus(messages, c)
    assert.equal(c.asked.length, afterFirst, `re-polling would multiply cost by tool calls: ${second}`)
  } finally {
    ctx.cleanup()
  }
})

test("a pool one short of a majority does not vote at all", async () => {
  const ctx = sandbox("vibeos-turnvote-thin-", [])
  try {
    const chat = await load("d" + Date.now())
    const c = voter({})
    const reason = await chat.applyTurnConsensus(turn(), c)
    assert.match(reason, /majority/, reason)
    assert.equal(c.asked.length, 0, "two voters can only agree or tie, so polling them is wasted latency")
  } finally {
    ctx.cleanup()
  }
})

test("VIBEOS_TURN_VOTE=off restores the unvoted turn", async () => {
  const ctx = sandbox("vibeos-turnvote-off-")
  try {
    process.env.VIBEOS_TURN_VOTE = "off"
    const chat = await load("e" + Date.now())
    const c = voter({})
    const messages = turn()
    assert.equal(await chat.applyTurnConsensus(messages, c), "disabled")
    assert.equal(c.asked.length, 0)
    assert.equal(messages[0].parts.length, 1, "an off switch must leave the turn untouched")
  } finally {
    ctx.cleanup()
  }
})

test("a mode other than vibeultrax pays no vote latency", async () => {
  const ctx = sandbox("vibeos-turnvote-mode-", ["opencode-go/glm-5.1"], "vibemax")
  try {
    const chat = await load("f" + Date.now())
    const c = voter({})
    const reason = await chat.applyTurnConsensus(turn(), c)
    assert.match(reason, /does not vote/, reason)
    assert.equal(c.asked.length, 0)
  } finally {
    ctx.cleanup()
  }
})

test("with no client there is no vote and no crash", async () => {
  const ctx = sandbox("vibeos-turnvote-noclient-")
  try {
    const chat = await load("g" + Date.now())
    const messages = turn()
    const reason = await chat.applyTurnConsensus(messages, null)
    assert.match(reason, /no client/, reason)
    assert.equal(messages[0].parts.length, 1)
  } finally {
    ctx.cleanup()
  }
})

test("a turn already carrying a verdict is not voted on again", async () => {
  const ctx = sandbox("vibeos-turnvote-dup-")
  try {
    const chat = await load("h" + Date.now())
    const c = voter({})
    const messages = turn()
    messages[0].parts.push({ type: "text", text: CONSENSUS_MARKER + "\nprior verdict", synthetic: true })
    const reason = await chat.applyTurnConsensus(messages, c)
    assert.match(reason, /already carries/, reason)
    assert.equal(c.asked.length, 0)
  } finally {
    ctx.cleanup()
  }
})
