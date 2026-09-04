# Forensic record: the A/B rig and the turn vote

September 2026. Four A/B runs were reported as evidence that vibeultrax
underperforms raw opencode. The instrument was dead. This is the record of what
was claimed, what survives, and what changed so it cannot recur.

## What went wrong

`scripts/e2e/ml-impact.mjs` was invoked with `--turns 2` against a five-turn
scenario. The hidden grading groups are keyed to the turns that ask for them
(`g1-batcher` needs `fix-batching`, `g2`/`g3`/`g4` need `fix-rest`, `g5-pivot`
needs `pivot`), so groups 2 through 5 could not be reached. The same truncation
froze three more components: `honesty` reads `fix-rest`/`pivot`/`self-review`
and none of them ran, `completion` was `passed / 2` of 2, and `noRegression` was
never exercised. Four of the five qscore components were pinned by construction.
Only `efficiency` varied, so forty trials measured wall-clock and were reported
as quality evidence.

The file already carried the comment "Scores from a truncated run are not
comparable" directly above the flag that truncated them. It was documented and
not enforced.

Replaying the stored artifacts through the current scorer:

```
run 12  NO SIGNAL: correctness  constant at 0.4667 across 10 trials
        NO SIGNAL: noRegression constant at 1.0000 across 10 trials
        NO SIGNAL: honesty      constant at 1.0000 across 10 trials
        NO SIGNAL: completion   constant at 1.0000 across 10 trials
```

Identical for runs 13, 14 and 15. The per-group breakdown is byte-identical in
every trial of every run — `g1:2/2 g2:1/3 g3:1/2 g4:1/2 g5:0/2` — so it was not
merely the aggregate that was constant.

The first full-length trial of run 16 returned `5/5 groups, 11/11 assertions`.
The scenario does discriminate at five turns; the frozen number was an artifact
of how the rig was invoked.

## Claim ledger

| # | Claim | Status | Basis |
|---|---|---|---|
| 1 | vibeultrax underperforms raw (runs 12–15) | **INVALID** | Four of five components frozen; only efficiency moved. Retained on disk, not to be cited. |
| 2 | The `107.9%` figure is a simulation, not a measurement | **VALID** | `mc()` in `VibeBrainUltra/src/experiment/shared.ts:24` is `Math.random() < acc * (1 - d*0.15) + noise`. No model is ever called; `acc` values are constants. |
| 3 | The SDK client cannot deliver a vote from inside a hook | **VALID** | ~1900 attempts across three configurations (blocking 60s, blocking 240s, dispatched unawaited 120s): zero answers, zero errors, each burning its full deadline. The voters are polled over HTTP instead. |
| 4 | `VOTE_MAX_TOKENS = 900` starves reasoning voters | **VALID, but raising it is not a fix** | A reasoning model spends the cap on `reasoning_content` and returns empty `content` with no error: 900 → 2 of 4 voters answer, 4096 → 4 of 4. Raising it makes more voters answer, and see #9 for why that only buys more latency. |
| 5 | Run 15's votes never agreed | **VALID but confounded** | True as recorded, but the pool was starved by #4, and `resolveVote` compares normalised prose by exact string equality, which free-form answers cannot satisfy. |
| 6 | Voting cannot beat the best single model (p=0.508, phi=0.761) | **WRONG WORKLOAD** | Correctly measured on 400 MMLU items, and the error-correlation result stands on its own: the Condorcet independence assumption the paper relies on is false here. It says nothing about a five-turn agentic coding task, and was never a basis for a product decision. |
| 7 | The brain slot is weaker than the medium slot | **UNPROVEN** | Derived from the same MMLU run as #6. Must be re-derived from the multi-turn rig or dropped. |
| 9 | The vote never reaches consensus on this workload | **VALID, decisive** | Run 15's audit: 11 votes cast, 0 agreed. Every agreement value is exactly `1/samples` — 0.25 with four voters, 0.333 with three — so no two voters ever matched, including the votes where 4 of 4 answered. `resolveVote` compares free-form prose by exact string equality, which cannot collide. Cost: 356s for the 11, plus 266s burned on 4 more that dropped below `MIN_VOTERS`. Over ten minutes across five trials, at two turns deep. |
| 8 | Raw prompts are persisted server-side with no TTL | **VALID** | `entry.text` → `serialize()` → `state_json`; `prediction_log.input_snapshot` stores whole request bodies. Addressed in vibeOScore PR #57. |

Two corrections to earlier statements in this work:

- The vote branch was described as carrying twelve unmerged commits. Ten of them
  had already reached master through PRs #537–540 under different SHAs. The real
  delta was one commit: the token cap.
- `tests/test_grader_counts_dead_groups.test.mjs` was described as untracked. It
  is on master, committed in #538; only the vote branch predates it.

## What changed

Four guards, each with a contract test in
`tests/test_ml_impact_rig_integrity.test.mjs`:

1. **Reachability.** `GROUP_ENABLING_TURN` in `grade.mjs` declares which turn
   makes each hidden group answerable. Correctness is scored over reachable
   groups only, so it means "of what was actually asked". Unreachable groups are
   still run and still recorded, just not scored. A *reachable* group that
   crashed on import still scores zero, so damage cannot shrink the denominator.
2. **No silent truncation.** `--turns` below the scenario length aborts unless
   `--allow-partial` is passed. A partial run is stamped `PARTIAL RUN`.
3. **Zero-variance detection.** Any component with one value across every scored
   trial prints `NO SIGNAL` and is named as unable to separate the arms. Two or
   more triggers `WARNING: this run does not measure quality`.
4. **Full component reporting.** All five components print by default, not two.

`completion` now divides by the whole scenario rather than the truncation, and
`honesty` reports `honestyScorable: false` when the turns it reads did not run.

## What is still open

- **The vote ships ON by default** and never agrees. `turnVoteEnabled()` in
  `chat-transform.ts:1357` returns true unless `VIBEOS_TURN_VOTE=off`, so every
  vibeultrax user is paying the latency in #9 for zero consensus. Raising
  `VOTE_MAX_TOKENS` from 900 makes this worse, not better: at 900 a starved voter
  fails fast, and at 4096 it runs to completion and burns full latency to reach
  the same disagreement. The cap is not the bug.
- **What is genuinely undecided** is the contested note — "the models disagreed,
  be careful" — which is the only thing the vote actually produces. A
  disagreement signal can be useful even when consensus never forms. That is
  what the `vibeultrax` / `vibeultrax-novote` pair measures.
- **If the vote survives that**, agreement has to become semantic: a vote over an
  extracted verdict — a chosen file, an approach, a structured field — rather
  than over the prose. If it does not survive, only the escalation half is worth
  keeping, and it costs nothing when it does not fire.
- **Egress.** The plugin still sends raw prompts to six endpoints every turn.
  There is no opt-out flag and the README does not disclose what leaves the
  machine. PR #57 addresses retention on the server, not collection at source.
