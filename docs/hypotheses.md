# Pre-registered hypotheses

Written before any benchmark run. A hypothesis passes only on the holdout half of the benchmark subset, run once. Dev-half results never count as proof.

Benchmark: Aider polyglot, Python exercises (34 available; JavaScript needs jest from npm and is left out), 30 by seeded selection (`codebench-1`), split into 15 dev and 15 holdout. The agent sees the stub, the tests and the instructions; grading runs a pristine copy of the tests against the agent's solution files only. k=2 runs per exercise per arm. Statistics: paired bootstrap 95% CI over exercises and an exact sign test (`scripts/e2e/codebench/stats.mjs`). HumanEval (`--suite humaneval`) is kept as a second suite.

Added 2026-10-08, before any C++ run: on the Python dev split every free weak model passed every scored exercise (nemotron-3-ultra 14/14, ling-3.1-flash 19/19, nemotron-3.5-lightning 6/6), so Gate 1 failed there. The C++ track (`--language cpp`) is the next benchmark: 24 exercises (gigasecond and meetup need Boost and are left out), all selected by `codebench-1`, split into 12 dev and 12 holdout. The agent runs `make test` (cmake build plus Catch2), which the cascade counts as a test command. Grading builds a pristine copy of the tests against the agent's solution files; all 24 reference solutions pass and all 24 stubs fail. Same Gate 1, hypotheses and statistics as above.

## Gate 1: the benchmark separates models

Plain weak vs plain strong: the bootstrap 95% CI of the pass-rate difference excludes 0. If it does not, the benchmark cannot judge anything and no hypothesis below is tested on it.

## H1: test-verified cascade lowers cost at equal quality

Arm `cascade` (cheap = weak, medium and brain = strong) vs plain strong.
Pass: the 95% CI of (cascade - strong) includes 0 and its lower bound is above -0.10, and fewer than 60% of cascade assistant messages ran on the strong model (opencode.db `message.modelID`).

## H3: strong review of a cheap result lowers cost at equal quality

Cheap model does the work; the strong model reviews once; escalation only when the review rejects. Same pass rule as H1.

## H2: a cheap planning pass raises quality

A cheap model writes a plan, then the strong model implements. Pass: the 95% CI of (planner - strong) excludes 0 on the positive side.

## H5: the flow plan gate raises a weak model's pass rate

Added 2026-10-25, before any run of these arms. Free models only. No free model is clearly stronger than nemotron-3-ultra-free on C++ hidden tests, so H1 cannot be tested without a paid run. H5 and H4 ask whether vibeOS makes the same weak model solve more exercises.

Setup:
- C++ track with `--hide-tests` (Aider protocol: the agent sees only the stub and INSTRUCTIONS.md; one retry with the failing output).
- `--serve`: one OpenCode server per trial, turns attach to it, and grading waits until the session is idle, so the plan gate's continuations run.
- weak = `opencode/nemotron-3-ultra-free` in every slot; k=2; 1500s per turn; `--budget-tokens` set.
- A trial with a leak void, a timeout or a failed turn is not scored.

Arm `flow` (vibe agent, router-only, `VIBEOS_PLAN_GATE=1`) vs `raw-weak`.
Pass: the paired 95% CI of (flow - raw-weak) excludes 0 on the positive side on the holdout half, run once. The dev half decides whether the holdout run happens.

Reported for every arm whether it passes or not: tokens per trial, voids, and continuations per trial (`cont=`). Two trial logs per arm are read to confirm the gate fired.

## H4: escalating to a different free model on failure raises the pass rate

Arm `cascade` with `--strong` set to a different free model (mimo-v2.6-flash-free; if its endpoint keeps timing out, ling or muse) vs `raw-weak`. It escalates after a failed test run or a user message carrying failure output, which includes the rig's retry feedback. Same pass rule and setup as H5. Arm `flow-cascade` combines both and is reported alongside, without a separate pass rule.

## Mechanism check (before any benchmark run)

Each design must show, in one live OpenCode session, that its model switch appears in opencode.db. No benchmark run before that check passes.

## Outcome

If H1, H3 and H2 all fail, the README is cut to measured behavior only.
