import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-footer-reentry-"))
const oldHome = process.env.HOME
const oldVibeHome = process.env.VIBEOS_HOME
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), "{}")

after(() => {
  process.env.HOME = oldHome
  process.env.VIBEOS_HOME = oldVibeHome
  rmSync(sandbox, { recursive: true, force: true })
})

test("concurrent message.updated re-entry performs one footer pass per message", async () => {
  const state = await import("../src/lib/state.js")
  const footer = await import("../src/lib/hooks/footer.js")
  const sessionID = "footer-reentry-session"
  const messageID = "footer-reentry-message"
  state.setCurrentSessionId(sessionID)
  footer.resetFooterRuntimeState()

  const first = { text: "A long assistant response whose footer mutation will re-enter message.updated." }
  const second = { text: first.text }
  await Promise.all([
    footer._appendFooter({ messageID }, first, "", undefined, "message.updated"),
    footer._appendFooter({ messageID }, second, "", undefined, "message.updated"),
  ])

  const events = join(process.env.VIBEOS_HOME, "session-events", `${sessionID}.jsonl`)
  const probes = existsSync(events)
    ? readFileSync(events, "utf8").split("\n").filter(Boolean).map(JSON.parse)
      .filter(event => event.kind === "footer-probe" && event.message_id === messageID)
    : []
  assert.equal(probes.length, 1, "re-entrant updates must not start a duplicate footer pass")
})
