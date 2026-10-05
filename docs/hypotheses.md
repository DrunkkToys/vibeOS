# Pre-registered hypotheses

Written before any benchmark run. A hypothesis passes only on the holdout half of the benchmark subset, run once. Dev-half results never count as proof.

Benchmark: HumanEval (164 Python tasks, hidden `check()` tests; the local copy at `theog-frontier-extract/evaluation/humaneval/HumanEval.jsonl.gz`), 30 tasks by seeded selection, split into 15 dev and 15 holdout. The agent sees the stub and a doctest suite built from the docstring examples; the hidden `check()` suite is applied only after the session ends. k=2 runs per exercise per arm. Statistics: paired bootstrap 95% CI over exercises and an exact sign test (`scripts/e2e/codebench/stats.mjs`).

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
