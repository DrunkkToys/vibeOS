// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-blackbox-live-"))
const prevHome = process.env.HOME
const prevVibeHome = process.env.VIBEOS_HOME

function setup() {
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  mkdirSync(join(sandbox, ".claude"), { recursive: true })
  mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
  writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({
    model: "deepseek/deepseek-v4-flash",
    plugin: ["vibeOS"],
  }))
  writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "brain",
      optimization_mode: "vibeultrax",
      active_pipeline: ["cheap", "medium", "brain"],
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-flash" },
      medium: { oc: "opencode-go/mimo-v2.5" },
      cheap: { oc: "opencode/big-pickle" },
    },
  }))
}

test("live blackbox state is shared through the canonical getter", async () => {
  setup()
  const turn = await import("../src/lib/turn-classify.js")
  const stateModule = await import("../src/lib/state.js")
  const footer = await import("../src/lib/hooks/footer.js")
  const chatTransform = await import("../src/lib/hooks/chat-transform.js")
  const { DelegationEnforcer } = await import("../src/index.js")

  const liveState = {
    enabled: true,
    sub_regime: "REFINING",
    resolution: "resolved",
    momentum: 2,
    n_interactions: 5,
    sessions: {},
  }
  turn.setLatestBlackboxState(liveState)

  const direct = turn.getLatestBlackboxState()
  assert.deepEqual(direct, liveState)
  assert.equal(stateModule._latestBlackboxState, undefined)

  const message = { text: "This response is long enough to trigger footer painting and carry the live decision state through." }
  await footer._appendFooter({ args: { model: "deepseek/deepseek-v4-flash" } }, message)
  assert.ok(message.text.includes("vibeOS") || message.text.includes("Deepseek"), message.text.slice(-240))

  const systemOutput = { system: [] }
  await chatTransform.onSystemTransform({}, systemOutput)
  assert.ok(systemOutput.system.some((entry) => String(entry).includes("REFINING") || String(entry).includes("resolved")), JSON.stringify(systemOutput.system))

  const hooks = await DelegationEnforcer({ client: {}, directory: join(sandbox, "proj") })
  const status = await hooks.tool.trinity.execute({ action: "blackbox", slot: "status" })
  assert.ok(String(status).includes("REFINING") || String(status).includes("resolved"), String(status))
})

test("cleanup", async () => {
  try {
    // Drain the buffered savings-ledger entries while the sandbox still exists.
    // The flush timer re-queues and retries every LEDGER_BUFFER_FLUSH_MS on
    // failure, so removing the sandbox first left a ref'd 5s timer appending to
    // a deleted path forever -- this file's process then never exited and the
    // whole file failed on the suite's test timeout even though both tests pass.
    const stateModule = await import("../src/lib/state.js")
    stateModule._flushLedgerBuffer()
    // `process.env.X = undefined` stores the literal string "undefined", so an
    // unset VIBEOS_HOME used to be "restored" to "undefined". Every later write
    // then resolved against the relative path undefined/ in the repo root, and
    // the savings-ledger flush timer retried its failing append forever, which
    // both polluted the tree and kept this test file's process alive until the
    // suite timeout. Delete the variable when it was unset.
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevVibeHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = prevVibeHome
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})
