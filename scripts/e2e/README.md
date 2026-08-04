# vibeOS E2E Release Harness

Headless, user-perspective release test. Drives **real** `opencode run` sessions
against the **built** bundle (`dist/vibeOS.js`) with a real model and a local
mock backend, then prints a pass/fail table and a `RELEASE: GO|NO` verdict.

## Why

Unit tests don't prove the plugin behaves from a user's seat. This harness runs
the actual plugin in a real opencode process (isolated `VIBEOS_HOME`, temp
projects, seeded randomized prompts) and asserts the deterministic quality gate,
non-blocking enforcement, honest footer/savings, real-signal stress, telemetry/
outcome wiring, offline degradation, protected-path scoping, TDD skeletons, and
the `vibe gate` command surface.

Round 6 adds TDD-gate toggle coverage: a research turn stays silent (TDD off by
default), the first coding turn auto-ONs the TDD rule, and persisted
`vibe gate tdd on|off|auto` choices are enforced end-to-end.

## Prereqs

- `npm run build:bundle` (the harness loads `dist/vibeOS.js`)
- the `opencode` CLI at `~/.opencode/bin/opencode`
- an API key for the model in opencode's auth (e.g. `deepseek/deepseek-chat`)

## Run

```bash
npm run test:e2e -- --seed e2e-round2 --k 2 --model deepseek/deepseek-chat
# list scenarios:
npm run test:e2e -- --list
# single scenario:
npm run test:e2e -- --only correction-loop --k 1 --model deepseek/deepseek-chat
```

Without `--model`/`E2E_MODEL` the harness prints `skipped` and exits 0, so CI
can include it without API keys.

## Options

| Flag | Env | Default | Meaning |
|---|---|---|---|
| `--seed` | `E2E_SEED` | `e2e-round2` | RNG seed (reproducible trials) |
| `--k` | `E2E_K` | `2` | trials per scenario |
| `--model` | `E2E_MODEL` | — | provider/model to drive |
| `--only <name>` | — | all | run one scenario |
| `--out <dir>` | — | `.e2e-tmp/` | artifacts (gitignored) |
| `--mock-port` | `E2E_MOCK_PORT` | `48081` | mock backend port |

## Scenarios

**Round 1–2 (core):**
- **correction-loop** — gate FAIL → follow-up fix → PASS, ≤1 note, stress gauge
  falls after the fix, savings shown as estimate.
- **vibe-gate-surface** — the `vibe` tool action `gate` returns the verdict log.
- **protected-external** — writing `tests/`, `scripts/`, `package.json` in an
  unrelated project is allowed (no `[LOCK]`).
- **protected-plugin-repo** — editing `src/vibeOS-lib/` in the plugin repo is
  still blocked.
- **offline** — dead API URL: no crash, local verdicts, no posts, no ⚡.
- **outcome-on-wire** — `blackbox/outcome` bodies match the verdict
  (negative on FAIL, positive on PASS).
- **tdd-skeleton** — `vibe tdd on` auto-creates a skeleton test file on write.
- **test-file-strictness** — `contest.mjs` is treated as source (TDD applies).
- **tiers** — gate silent on verified runs for cheap/medium/brain; routed model
  matches the active slot.

**Round 3 (gate hardening):**
- **bash-mutation-bypass** — source mutated via bash (`echo >>`, `sed -i`)
  still triggers the TDD rule (models that shortcut through bash can't dodge it).
- **gate-killswitch** — `VIBEOS_QUALITY_GATE=0` disables the gate (no verdicts,
  no notes).
- **verified-savings** — a real `task` delegation exercises the honest-savings
  path (headless single-model runs force the cheap slot, so savings are
  correctly 0 there — the recording logic is unit-tested).
- **research-no-false-positive** — a pure research turn (webfetch + summary)
  gets no gate note.
- **noncode-verify-pass** — a non-code change WITH a verification iteration
  (e.g. `cat`) passes (R3 pass path).
- **dedup-across-turns** — repeated identical failures produce at most one gate
  note (persistent dedup across turns/processes, not just in-memory).

**Round 4 (command surface + auxiliary features):**
- **cmd-surface** — a battery of `vibe` commands (`status`, `diagnose`, `set`,
  `mode`, `thinking`, `flow`, `tdd`, `lock`, `help`) runs without crashing.
- **vibe-guard** — `vibe guard` creates `AGENTS.md` + `README.md` in the project.
- **vibe-verify-claims** — after a fabricated "all tests pass" claim,
  `vibe verify-claims` flags it as unsubstantiated.
- **vibe-report** — `report-save` → `report-list` round-trip.
- **vibe-rebuild** — `vibe rebuild` completes and populates `model-tiers.json`
  trinity slots.
- **vibe-todo-patterns** — `vibe todo` / `patterns` / `project` / `flow` run
  without crashing.
- **vibe-api-token** — `vibe api-token <token>` runs without error.
- **vibe-enforce-flow-audit** — `enforce off` / `flow` / `diagnose cascade` run
  without crashing and writes stay non-blocked.

**Round 5 (frictions / patterns / pivot / minor surfaces):**
- **friction-repeat-fail** — repeated failing commands are captured in the
  session-event log as a friction signal (the input to the pattern learner),
  and `vibe patterns` runs.
- **pivot-counterpivot** — after a failed approach + an explicit pivot, `vibe
  blackbox status` reflects the session's regime/pivot state.
- **vibe-blackbox** — `vibe blackbox on` / `status` / `reset` run without
  crashing.
- **vibe-axis** — `vibe axis status` + `vibe axis enforcement on` applies and
  surfaces the override.
- **vibe-reality-check** — reports evidence-backed state.
- **vibe-report-savings** — returns a coherent savings breakdown.
- **vibe-patterns-suggest** — returns coherent output.
- **vibe-repair-state** — `preview` returns a coherent report.
- **vibe-research-audit** — returns a coherent report.

## Artifacts (in `--out`)

- `home/<trial>/quality-gate/*.jsonl` — deterministic gate verdicts
- `home/<trial>/session-events/*.jsonl` — real tool evidence + footer probes
- `mockdata/requests.jsonl`, `mockdata/outcomes.jsonl` — what reached the wire
- `logs/<trial>.json` — raw opencode JSON events
