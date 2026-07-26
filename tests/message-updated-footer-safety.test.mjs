import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-message-updated-"))
const oldHome = process.env.HOME
const oldVibeHome = process.env.VIBEOS_HOME
const oldFallback = process.env.VIBEOS_ENABLE_MESSAGE_UPDATED_FOOTER
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")
delete process.env.VIBEOS_ENABLE_MESSAGE_UPDATED_FOOTER
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), "{}")

after(() => {
  process.env.HOME = oldHome
  process.env.VIBEOS_HOME = oldVibeHome
  if (oldFallback === undefined) delete process.env.VIBEOS_ENABLE_MESSAGE_UPDATED_FOOTER
  else process.env.VIBEOS_ENABLE_MESSAGE_UPDATED_FOOTER = oldFallback
  rmSync(sandbox, { recursive: true, force: true })
})

function footerProbes(sessionID, messageID) {
  const file = join(process.env.VIBEOS_HOME, "session-events", `${sessionID}.jsonl`)
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse)
    .filter(event => event.kind === "footer-probe" && event.message_id === messageID)
}

test("message.updated is mutation-free by default", async () => {
  const { DelegationEnforcer } = await import("../src/index.js")
  const message = { text: "This assistant response is long enough that the old message.updated fallback would append a footer." }
  const hooks = await DelegationEnforcer({ directory: sandbox })
  await hooks["message.updated"]({ sessionID: "default-session", messageID: "default-message" }, message)
  assert.equal(message.text, "This assistant response is long enough that the old message.updated fallback would append a footer.")
  assert.deepEqual(footerProbes("default-session", "default-message"), [])
  assert.deepEqual(JSON.parse(readFileSync(join(sandbox, ".config", "opencode", "opencode.json"), "utf8")), {})
})

test("experimental.text.complete remains the default footer writer", async () => {
  const { DelegationEnforcer } = await import("../src/index.js")
  const message = { text: "This assistant response is long enough to prove that the normal completion hook still paints the footer." }
  const hooks = await DelegationEnforcer({ directory: sandbox })
  await hooks["experimental.text.complete"]({ sessionID: "complete-session", messageID: "complete-message" }, message)
  assert.match(message.text, /\n\n— .+ —\s*$/)
  assert.equal(footerProbes("complete-session", "complete-message").length, 1)
})

test("message.updated fallback is available only through explicit opt-in", async () => {
  process.env.VIBEOS_ENABLE_MESSAGE_UPDATED_FOOTER = "1"
  const { DelegationEnforcer } = await import("../src/index.js")
  const message = { text: "This assistant response is long enough to exercise the explicit legacy message.updated footer fallback." }
  const hooks = await DelegationEnforcer({ directory: sandbox })
  await hooks["message.updated"]({ sessionID: "legacy-session", messageID: "legacy-message" }, message)
  assert.match(message.text, /\n\n— .+ —\s*$/)
  delete process.env.VIBEOS_ENABLE_MESSAGE_UPDATED_FOOTER
})

test("concurrent footer re-entry performs exactly one footer pass", async () => {
  const state = await import("../src/lib/state.js")
  const footer = await import("../src/lib/hooks/footer.js")
  const sessionID = "reentry-session"
  const messageID = "reentry-message"
  state.setCurrentSessionId(sessionID)
  footer.resetFooterRuntimeState()
  const text = "A long assistant response whose footer mutation attempts to re-enter the same footer path." 
  await Promise.all([
    footer._appendFooter({ messageID }, { text }, sandbox, undefined, "message.updated"),
    footer._appendFooter({ messageID }, { text }, sandbox, undefined, "message.updated"),
  ])
  assert.equal(footerProbes(sessionID, messageID).length, 1)
})

test("completion footer never waits for remote mode selection", async () => {
  const state = await import("../src/lib/state.js")
  const footer = await import("../src/lib/hooks/footer.js")
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {
    requests++
    throw new Error("the footer must not call the network")
  }
  try {
    state.setCurrentSessionId("local-footer-session")
    footer.resetFooterRuntimeState()
    await footer._appendFooter(
      { messageID: "local-footer-message" },
      { text: "A completed assistant response must not wait on a remote footer request." },
      sandbox,
    )
    assert.equal(requests, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
