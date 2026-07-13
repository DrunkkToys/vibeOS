// SPDX-License-Identifier: MIT
// Regression test: tool-execute.ts's onToolExecuteAfter prepends a live
// footer alert line (savings, regime, XP, connectivity icon -- all of which
// change turn to turn) onto the raw output of virtually every non-task tool
// call. chat-transform.ts's compressToolOutputs() hashed that raw,
// footer-and-all string for its content-addressed scratchpad cache, so two
// otherwise-identical tool calls (e.g. reading the same unchanged file
// twice) almost never produced the same content hash -- confirmed live by
// reading package.json twice in the same OpenCode Desktop session and
// finding two different hashes/files in VIBEOS_HOME/scratch/by-hash/, whose
// only difference was the footer line (an API-connectivity icon flicker).
// This defeated the scratchpad cache-hit feature session-wide.

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-scratchpad-footer-"))
const claudeDir = join(sandbox, ".claude")
mkdirSync(claudeDir, { recursive: true })
process.env.HOME = sandbox
process.env.VIBEOS_HOME = claudeDir
writeFileSync(join(claudeDir, "delegation-state.json"), JSON.stringify({ lifetime: {}, sessions: {} }))

const REAL_CONTENT = "x".repeat(2500) // exceeds COMPRESS_THRESHOLD (2000)
const KEEP_HOT = 10 // must match src/lib/constants.ts -- compression only applies to messages older than the hot window

// compressToolOutputs only compresses "cold" messages (index < messages.length - KEEP_HOT),
// so the target message needs enough trailing padding messages to fall out of the hot window.
function messageWithFooterStampedOutput(footerLine) {
  const target = {
    parts: [{
      type: "tool",
      tool: "read",
      state: {
        status: "completed",
        // Exact shape observed live: footer line + blank line, then real content.
        output: `${footerLine}\n\n${REAL_CONTENT}`,
      },
    }],
  }
  const padding = Array.from({ length: KEEP_HOT + 1 }, () => ({ parts: [{ type: "text", text: "padding" }] }))
  return [target, ...padding]
}

test("compressToolOutputs hashes identically despite a changing footer line prepended to identical content", async () => {
  const chat = await import("../src/lib/hooks/chat-transform.js?footerpollution1=" + Date.now())

  const footerA = "— ⚡ cheap | Opencode | Big Pickle ▶ ◌ Starting | $0.00 saved | VibeUltraX ⚡ | guarded —"
  const footerB = "— ⚡ cheap | Opencode | Big Pickle ▶ ◌ Starting | $1.27 saved | VibeUltraX | guarded —"

  const msgsA = messageWithFooterStampedOutput(footerA)
  chat.compressToolOutputs(msgsA)
  const compressedA = msgsA[0].parts[0].state.output

  const msgsB = messageWithFooterStampedOutput(footerB)
  chat.compressToolOutputs(msgsB)
  const compressedB = msgsB[0].parts[0].state.output

  const extractHash = (s) => {
    const m = /cold storage at .*[\\/]([0-9a-f]{16})\.txt/.exec(s)
    return m ? m[1] : null
  }
  const hashA = extractHash(compressedA)
  const hashB = extractHash(compressedB)

  assert.ok(hashA, "first call produced a compressed reference with a content hash")
  assert.ok(hashB, "second call produced a compressed reference with a content hash")
  assert.equal(hashA, hashB, "identical underlying content behind two different footer lines must hash identically")
})

test("compressToolOutputs still detects genuinely different content as different hashes", async () => {
  const chat = await import("../src/lib/hooks/chat-transform.js?footerpollution2=" + Date.now())

  const footer = "— ⚡ cheap | Opencode | Big Pickle ▶ ◌ Starting | $0.00 saved | VibeUltraX ⚡ | guarded —"
  const msgsA = messageWithFooterStampedOutput(footer)
  chat.compressToolOutputs(msgsA)
  const compressedA = msgsA[0].parts[0].state.output

  const msgsB = messageWithFooterStampedOutput(footer).map((m, i) =>
    i === 0 ? { parts: [{ type: "tool", tool: "read", state: { status: "completed", output: `${footer}\n\n${"y".repeat(2500)}` } }] } : m)
  chat.compressToolOutputs(msgsB)
  const compressedB = msgsB[0].parts[0].state.output

  const extractHash = (s) => {
    const m = /cold storage at .*[\\/]([0-9a-f]{16})\.txt/.exec(s)
    return m ? m[1] : null
  }
  assert.notEqual(extractHash(compressedA), extractHash(compressedB), "genuinely different content must still hash differently")
})
