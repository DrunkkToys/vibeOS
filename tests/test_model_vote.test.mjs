import { test } from "node:test"
import assert from "node:assert/strict"
import { runModelVote, parseModelIdentifier } from "../src/vibeOS-lib/model-vote.js"

function fakeClient(answers, opts = {}) {
  const calls = []
  let n = 0
  return {
    calls,
    session: {
      create: async () => ({ data: { id: "ses_" + ++n } }),
      delete: async ({ path }) => { calls.push({ deleted: path.id }) },
      prompt: async ({ path, body }) => {
        const model = `${body.model.providerID}/${body.model.modelID}`
        calls.push({ session: path.id, model, prompt: body.parts[0].text, tools: body.tools })
        if (opts.failOn === model) throw new Error("provider exploded")
        if (opts.hangOn === model) return new Promise(() => {})
        return { data: { parts: [{ type: "text", text: answers[model] }] } }
      },
    },
  }
}

const MODELS = ["p/a", "p/b", "p/c"]

test("every voter is a different model and they run against the same prompt", async () => {
  const c = fakeClient({ "p/a": "42", "p/b": "42", "p/c": "42" })
  await runModelVote(c, { models: MODELS, prompt: "what is it" })
  const prompts = c.calls.filter((x) => x.model).map((x) => x.prompt)
  assert.equal(prompts.length, 3)
  assert.ok(prompts.every((p) => p === "what is it"))
  assert.deepEqual(c.calls.filter((x) => x.model).map((x) => x.model).sort(), MODELS)
})

test("a unanimous vote agrees and returns the shared answer", async () => {
  const c = fakeClient({ "p/a": "42", "p/b": "42", "p/c": "42" })
  const r = await runModelVote(c, { models: MODELS, prompt: "q" })
  assert.equal(r.agreed, true)
  assert.equal(r.answer, "42")
  assert.equal(r.agreement, 1)
})

test("a majority carries the vote", async () => {
  const c = fakeClient({ "p/a": "42", "p/b": "42", "p/c": "7" })
  const r = await runModelVote(c, { models: MODELS, prompt: "q" })
  assert.equal(r.agreed, true)
  assert.equal(r.answer, "42")
})

test("three different answers do not resolve", async () => {
  const c = fakeClient({ "p/a": "1", "p/b": "2", "p/c": "3" })
  const r = await runModelVote(c, { models: MODELS, prompt: "q" })
  assert.equal(r.agreed, false)
  assert.equal(r.answer, null)
})

test("voters run in parallel, not one after another", async () => {
  let live = 0
  let peak = 0
  const c = {
    session: {
      create: async () => ({ data: { id: "s" } }),
      delete: async () => {},
      prompt: async () => {
        live++; peak = Math.max(peak, live)
        await new Promise((r) => setTimeout(r, 20))
        live--
        return { data: { parts: [{ type: "text", text: "same" }] } }
      },
    },
  }
  await runModelVote(c, { models: MODELS, prompt: "q" })
  assert.ok(peak >= 2, `voters serialized (peak concurrency ${peak})`)
})

test("one dead provider does not void the vote", async () => {
  const c = fakeClient({ "p/a": "42", "p/b": "42", "p/c": "42" }, { failOn: "p/c" })
  const r = await runModelVote(c, { models: MODELS, prompt: "q" })
  assert.equal(r.agreed, true)
  assert.equal(r.samples, 2)
})

test("a hung provider is abandoned at the deadline, not waited on", async () => {
  const c = fakeClient({ "p/a": "42", "p/b": "42", "p/c": "42" }, { hangOn: "p/c" })
  const started = Date.now()
  const r = await runModelVote(c, { models: MODELS, prompt: "q", timeoutMs: 120 })
  assert.ok(Date.now() - started < 2000, "deadline did not cut the hung voter loose")
  assert.equal(r.agreed, true)
  assert.equal(r.samples, 2)
})

test("every provider failing is an unresolved vote, never a fabricated one", async () => {
  const c = {
    session: { create: async () => ({ data: { id: "s" } }), delete: async () => {}, prompt: async () => { throw new Error("down") } },
  }
  const r = await runModelVote(c, { models: MODELS, prompt: "q" })
  assert.equal(r.agreed, false)
  assert.equal(r.answer, null)
  assert.equal(r.samples, 0)
})

test("voters get no tools: a vote reads nothing and writes nothing", async () => {
  const c = fakeClient({ "p/a": "x", "p/b": "x", "p/c": "x" })
  await runModelVote(c, { models: MODELS, prompt: "q" })
  for (const call of c.calls.filter((x) => x.model)) {
    assert.ok(call.tools && Object.values(call.tools).every((v) => v === false), "a voter must not be able to act")
  }
})

test("scratch sessions are cleaned up so a vote leaves no history", async () => {
  const c = fakeClient({ "p/a": "x", "p/b": "x", "p/c": "x" })
  await runModelVote(c, { models: MODELS, prompt: "q" })
  assert.equal(c.calls.filter((x) => x.deleted).length, 3)
})

test("fewer than two distinct models is not a vote", async () => {
  const c = fakeClient({ "p/a": "x" })
  const r = await runModelVote(c, { models: ["p/a", "p/a"], prompt: "q" })
  assert.equal(r.ran, false)
  assert.equal(r.agreed, false)
})

test("a missing client is not an error, just no vote", async () => {
  const r = await runModelVote(null, { models: MODELS, prompt: "q" })
  assert.equal(r.ran, false)
  assert.equal(r.agreed, false)
})

test("model identifiers split on the first slash only", () => {
  assert.deepEqual(parseModelIdentifier("opencode/big-pickle"), { providerID: "opencode", modelID: "big-pickle" })
  assert.deepEqual(parseModelIdentifier("a/b/c"), { providerID: "a", modelID: "b/c" })
  assert.equal(parseModelIdentifier("nope"), null)
  assert.equal(parseModelIdentifier(""), null)
})

import { voteModelPool } from "../src/lib/hooks/tool-execute.js"

test("the vote pool is the distinct non-brain models, brain excluded", () => {
  const pool = voteModelPool({}, "p/cheap", "p/medium")
  assert.deepEqual(pool, ["p/cheap", "p/medium"])
})

test("a trinity with one model everywhere cannot field a vote", () => {
  assert.equal(voteModelPool({}, "p/same", "p/same").length, 1)
})

test("an operator can widen the pool, and duplicates collapse", () => {
  const pool = voteModelPool({ vote_pool: ["p/extra", "p/cheap", "bad"] }, "p/cheap", "p/medium")
  assert.deepEqual(pool, ["p/cheap", "p/medium", "p/extra"])
})

test("a blank or malformed trinity yields no pool rather than a bad model id", () => {
  assert.deepEqual(voteModelPool(null, "", ""), [])
  assert.deepEqual(voteModelPool({}, "noslash", "alsonoslash"), [])
})
