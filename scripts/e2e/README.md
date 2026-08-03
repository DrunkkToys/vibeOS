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

## Artifacts (in `--out`)

- `home/<trial>/quality-gate/*.jsonl` — deterministic gate verdicts
- `home/<trial>/session-events/*.jsonl` — real tool evidence + footer probes
- `mockdata/requests.jsonl`, `mockdata/outcomes.jsonl` — what reached the wire
- `logs/<trial>.json` — raw opencode JSON events
