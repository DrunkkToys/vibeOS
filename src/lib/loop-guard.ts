// SPDX-License-Identifier: MIT
// Tool-call loop circuit-breaker.
//
// The blackbox loop detector (vibeOS-lib/blackbox/resolution-tracker.ts) compares the
// PROSE of consecutive turns. It cannot see a *tool-call* loop: an agent that
// keeps running `sleep 600 && gh pr view 348 --json statusCheckRollup`, reading
// the (ever-changing) CI output, editing, rebuilding and re-polling for hours.
// Each poll is a full model turn replaying the whole context, so the cost
// compounds even though no two turns look textually alike.
//
// This guard tracks normalized bash command signatures over a sliding window and
// escalates: a nudge at LOOP_WARN_THRESHOLD repeats, a hard block at
// LOOP_BLOCK_THRESHOLD. Two patterns count as a loop:
//   1. poll   — `sleep N && <cmd>` self-polling, or `gh pr view / run list|view|watch`
//   2. repeat — the same normalized command re-run N times in the window

export const LOOP_WARN_THRESHOLD = 3
export const LOOP_BLOCK_THRESHOLD = 5
export const LOOP_WINDOW = 20

export type LoopLevel = "none" | "warn" | "block"
export type LoopKind = "poll" | "repeat" | null

export interface LoopVerdict {
  level: LoopLevel
  kind: LoopKind
  count: number
  signature: string
  directive: string
}

// Strip volatile prefixes/suffixes so functionally-identical re-runs collapse to
// one signature: a leading self-poll `sleep N &&`/`sleep N;`, surrounding
// whitespace, and a trailing output pipe like `| tail -3` / `2>/dev/null`.
export function normalizeCommandSignature(command: string): string {
  let c = String(command || "").trim().toLowerCase()
  c = c.replace(/^\s*sleep\s+\d+(?:\.\d+)?\s*(?:&&|;|\|\|)\s*/i, "")
  c = c.replace(/\s+/g, " ").trim()
  return c
}

// A self-sleeping poll, or a GitHub CI-status poll — the shapes that burn a
// model turn purely to wait/recheck.
export function isPollCommand(command: string): boolean {
  const c = String(command || "").toLowerCase()
  if (/\bsleep\s+\d+/.test(c) && /(?:&&|;|\|\|)/.test(c)) return true
  if (/\bgh\s+(?:pr\s+view|pr\s+checks|run\s+(?:list|view|watch))\b/.test(c)) return true
  return false
}

// Read-only inspection commands are allowed to repeat without tripping the
// runaway loop breaker. These are the commands the agent legitimately uses for
// file discovery and state checks while debugging.
export function isInspectionCommand(command: string): boolean {
  const c = String(command || "").trim().toLowerCase()
  if (!c) return false
  if (/^(?:sudo\s+)?(?:ls|pwd|cat|head|tail|grep|rg|sed|find|wc|jq|file|stat|diff|sort|uniq|cut|awk)\b/.test(c)) return true
  if (/^git\s+(?:status|diff|log|show|branch|rev-parse|ls-files)\b/.test(c)) return true
  return false
}

function directiveFor(kind: LoopKind, count: number): string {
  if (kind === "poll") {
    return `You have polled the same status ${count} times — each poll spends a full model turn replaying the whole context. STOP polling in-band. Either end this turn and let the user re-invoke once the external job finishes, or check exactly once and move on. Do not run another sleep/poll.`
  }
  return `You have run the same command ${count} times with no progress. STOP repeating it — it is not advancing the task. Change approach, fix the underlying cause, or hand off / end the turn instead of re-running.`
}

interface Entry { sig: string; poll: boolean; at: number }

// Consecutive failures on the same edit/write target before nudging the
// model to stop guessing (e.g. re-run edit with stale oldString) and re-read
// the file instead. Advisory only -- unlike the bash repeat/poll guard above,
// this never blocks the tool call, since a false positive here would break
// legitimate multi-step edits.
export const EDIT_FAILURE_WARN_THRESHOLD = 3

// Sliding-window tracker. One instance is held module-globally by the
// tool-execute hook (like softQuotaCounts); reset() clears it for tests and on
// session change.
export class ToolLoopGuard {
  private window: Entry[] = []
  private readonly max: number
  private editFailureCounts: Map<string, number> = new Map()

  constructor(max: number = LOOP_WINDOW) {
    this.max = Math.max(1, max)
  }

  // Record a failed edit/write on `key` (e.g. `edit:/path/to/file.ts`).
  // Returns the running failure count and whether it has crossed the warn
  // threshold. Call clearEditFailure(key) on a successful edit to reset it.
  observeEditFailure(key: string): { count: number; shouldWarn: boolean } {
    const count = (this.editFailureCounts.get(key) || 0) + 1
    this.editFailureCounts.set(key, count)
    return { count, shouldWarn: count >= EDIT_FAILURE_WARN_THRESHOLD }
  }

  clearEditFailure(key: string): void {
    this.editFailureCounts.delete(key)
  }

  reset(): void {
    this.window = []
    this.editFailureCounts.clear()
  }

  // Record a bash command and return the loop verdict for it.
  observe(command: string, now: number = Date.now()): LoopVerdict {
    const signature = normalizeCommandSignature(command)
    const poll = isPollCommand(command)
    this.window.push({ sig: signature, poll, at: now })
    if (this.window.length > this.max) this.window.shift()

    if (poll) {
      const pollCount = this.window.reduce((n, e) => (e.poll ? n + 1 : n), 0)
      let level: LoopLevel = "none"
      if (pollCount >= LOOP_BLOCK_THRESHOLD) level = "block"
      else if (pollCount >= LOOP_WARN_THRESHOLD) level = "warn"
      return {
        level,
        kind: level === "none" ? null : "poll",
        count: pollCount,
        signature,
        directive: level === "none" ? "" : directiveFor("poll", pollCount),
      }
    }

    const repeatCount = this.window.reduce((n, e) => (e.sig === signature ? n + 1 : n), 0)
    if (repeatCount < LOOP_WARN_THRESHOLD) {
      return { level: "none", kind: null, count: repeatCount, signature, directive: "" }
    }
    if (isInspectionCommand(command)) {
      return { level: "none", kind: null, count: repeatCount, signature, directive: "" }
    }

    const kind: LoopKind = "repeat"
    const count = repeatCount

    let level: LoopLevel = "none"
    if (count >= LOOP_BLOCK_THRESHOLD) level = "block"
    else if (count >= LOOP_WARN_THRESHOLD) level = "warn"

    return {
      level,
      kind: level === "none" ? null : kind,
      count,
      signature,
      directive: level === "none" ? "" : directiveFor(kind, count),
    }
  }
}
