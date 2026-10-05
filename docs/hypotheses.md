# Pre-registered hypotheses

Written before any benchmark run. A hypothesis passes only on the holdout half of the benchmark subset, run once. Dev-half results never count as proof.

Benchmark: Aider polyglot, Python exercises (34 available; JavaScript needs jest from npm and is left out), 30 by seeded selection (`codebench-1`), split into 15 dev and 15 holdout. The agent sees the stub, the tests and the instructions; grading runs a pristine copy of the tests against the agent's solution files only. k=2 runs per exercise per arm. Statistics: paired bootstrap 95% CI over exercises and an exact sign test (`scripts/e2e/codebench/stats.mjs`). HumanEval (`--suite humaneval`) is kept as a second suite.

## Gate 1: the benchmark separates models

Plain weak vs plain strong: the bootstrap 95% CI of the pass-rate difference excludes 0. If it does not, the benchmark cannot judge anything and no hypothesis below is tested on it.

## H1: test-verified cascade lowers cost at equal quality

Arm `cascade` (cheap = weak, medium and brain = strong) vs plain strong.
Pass: the 95% CI of (cascade - strong) includes 0 and its lower bound is above -0.10, and fewer than 60% of cascade assistant messages ran on the strong model (opencode.db `message.modelID`).

## H3: strong review of a cheap result lowers cost at equal quality

Cheap model does the work; the strong model reviews once; escalation only when the review rejects. Same pass rule as H1.

## H2: a cheap planning pass raises quality

A cheap model writes a plan, then the strong model implements. Pass: the 95% CI of (planner - strong) excludes 0 on the positive side.

## Mechanism check (before any benchmark run)

Each design must show, in one live OpenCode session, that its model switch appears in opencode.db. No benchmark run before that check passes.

## Outcome

If H1, H3 and H2 all fail, the README is cut to measured behavior only.
