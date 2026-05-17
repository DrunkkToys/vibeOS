import { existsSync, readFileSync } from "node:fs"
import { basename } from "node:path"

function fail(msg) {
  console.error(`[checkpoint-validate] ERROR: ${msg}`)
}

function ok(msg) {
  console.log(`[checkpoint-validate] OK: ${msg}`)
}

function sectionExists(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^##\\s+${escaped}\\s*$`, "m").test(content)
}

function extractSection(content, heading) {
  const lines = content.split("\n")
  const marker = `## ${heading}`.trim()
  const start = lines.findIndex((line) => line.trim() === marker)
  if (start === -1) return ""
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join("\n").trim()
}

function hasTaskLedgerRows(section) {
  const rows = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !line.startsWith("|---"))
  const dataRows = rows.filter((line) => !/Task ID\s*\|/i.test(line))
  return dataRows.length > 0
}

function hasTaskIdsAndStates(section) {
  const taskIdRe = /\bT-\d{3,}\b/
  const stateRe = /\b(todo|in_progress|done|dropped)\b/
  return taskIdRe.test(section) && stateRe.test(section)
}

function hasDiffStat(section) {
  const block = section.match(/```text([\s\S]*?)```/m)
  if (!block) return false
  const body = block[1]
  return /\b\d+\s+files?\s+changed\b/.test(body) || /\|\s+\d+\s+[+-]+/.test(body)
}

function validate(content, fileLabel) {
  const requiredSections = [
    "1) Metadata",
    "2) Repo State",
    "3) Task Ledger",
    "4) Commands Run",
    "5) File Changes",
    "6) Orphan Signals",
    "7) Risks & Assumptions",
    "8) Handoff Readiness",
    "9) Next Actions",
  ]

  let valid = true

  for (const heading of requiredSections) {
    if (!sectionExists(content, heading)) {
      fail(`${fileLabel}: missing section "## ${heading}"`)
      valid = false
    }
  }

  const taskLedger = extractSection(content, "3) Task Ledger")
  if (!taskLedger) {
    fail(`${fileLabel}: empty "Task Ledger" section`)
    valid = false
  } else {
    if (!hasTaskLedgerRows(taskLedger)) {
      fail(`${fileLabel}: task ledger has no data rows`)
      valid = false
    } else {
      ok(`${fileLabel}: task ledger rows found`)
    }
    if (!hasTaskIdsAndStates(taskLedger)) {
      fail(`${fileLabel}: task ledger must include Task IDs like T-001 and states`)
      valid = false
    } else {
      ok(`${fileLabel}: task IDs and states found`)
    }
  }

  const commands = extractSection(content, "4) Commands Run")
  if (!/npm run typecheck/i.test(commands) || !/npm run build/i.test(commands) || !/npm test/i.test(commands)) {
    fail(`${fileLabel}: commands section must mention typecheck/build/test`)
    valid = false
  } else {
    ok(`${fileLabel}: command baseline entries found`)
  }

  const fileChanges = extractSection(content, "5) File Changes")
  if (!hasDiffStat(fileChanges)) {
    fail(`${fileLabel}: file changes section missing diff-stat block`)
    valid = false
  } else {
    ok(`${fileLabel}: diff-stat evidence found`)
  }

  const handoff = extractSection(content, "8) Handoff Readiness")
  if (!/\[[ xX]\]/.test(handoff)) {
    fail(`${fileLabel}: handoff checklist must include checkbox items`)
    valid = false
  } else {
    ok(`${fileLabel}: handoff checklist found`)
  }

  const next = extractSection(content, "9) Next Actions")
  if (!/^\s*1\.\s+\S+/m.test(next)) {
    fail(`${fileLabel}: next actions must include numbered action items`)
    valid = false
  } else {
    ok(`${fileLabel}: next actions found`)
  }

  return valid
}

function main() {
  const input = process.argv[2] || "MEMORY_STRESS_TEST_DELIVERABLE.md"
  if (!existsSync(input)) {
    fail(`file not found: ${input}`)
    process.exit(1)
  }
  const content = readFileSync(input, "utf-8")
  const valid = validate(content, basename(input))
  if (!valid) process.exit(1)
  console.log(`[checkpoint-validate] PASS: ${basename(input)} is checkpoint-complete`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

export { validate }
