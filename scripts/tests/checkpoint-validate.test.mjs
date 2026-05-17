import test from "node:test"
import assert from "node:assert/strict"
import { validate } from "../checkpoint-validate.mjs"

const validCheckpoint = `
## 1) Metadata
- Checkpoint ID: CP-20260517-0900

## 2) Repo State
- Branch: codex/hardening

## 3) Task Ledger
| Task ID | Title | State (\`todo\`/\`in_progress\`/\`done\`/\`dropped\`) | Notes |
|---|---|---|---|
| T-001 | Add validator | done | shipped |

## 4) Commands Run
- npm run typecheck — pass
- npm run build — pass
- npm test — pass

## 5) File Changes
\`\`\`text
 scripts/checkpoint-validate.mjs | 120 +++++++++++++++++++++++++
 1 file changed, 120 insertions(+)
\`\`\`

## 6) Orphan Signals
- none

## 7) Risks & Assumptions
- Risk: low

## 8) Handoff Readiness
- [x] Task ledger states are current
- [x] File changes are captured (\`git diff --stat\`)

## 9) Next Actions
1. Ship release notes
`

const invalidCheckpoint = `
## 1) Metadata
- Checkpoint ID: CP-20260517-0900

## 3) Task Ledger
| Task ID | Title | State | Notes |
|---|---|---|---|
| bad-id | Add validator | unknown | shipped |
`

test("checkpoint validator accepts complete checkpoint", () => {
  assert.equal(validate(validCheckpoint, "valid.md"), true)
})

test("checkpoint validator rejects incomplete checkpoint", () => {
  assert.equal(validate(invalidCheckpoint, "invalid.md"), false)
})
