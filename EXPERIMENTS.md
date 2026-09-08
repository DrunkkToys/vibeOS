# EXPERIMENTS

Every A/B run against `scripts/e2e/ml-impact.mjs`, recorded whatever the result.
Negative results stay. Token and model columns come from
`~/.local/share/opencode/opencode.db`, never from the plugin's own evidence:

```bash
sqlite3 ~/.local/share/opencode/opencode.db \
  "select json_extract(data,'\$.modelID'), count(*),
          sum(json_extract(data,'\$.tokens.input')),
          sum(json_extract(data,'\$.tokens.cache.read')),
          sum(json_extract(data,'\$.tokens.output'))
   from message where session_id='<sid>'
     and json_extract(data,'\$.role')='assistant' group by 1;"
```

Trial session ids are in each run's `results.json` under `sessionId`.

## Pass criteria

1. Routing is real — >= 2 distinct models per vibeultrax session.
2. Escalation is answer-driven — escalations correlate with recorded gate verdicts.
3. De-escalation survives — at least one turn runs cheap.
4. No void trials.
5. Quality — mean vibeultrax qscore >= raw, correctness >= raw.
6. Cost — reported separately, never folded into the score.

---

## Ladder calibration (raw arm only, k=1, dsforge, 5 turns)

Ran each tier's model with no plugin, to find out whether the ladder's rungs
differ in capability at all.

| model | slot it fills | correctness | assertions | wall |
|---|---|---|---|---|
| muse-spark-1.2-contributor | cheap | 1.000 | 15/15 | 725s |
| ling-3.0-flash-fin | medium | 1.000 | 15/15 | 443s |
| mimo-v2.5 | brain | 0.933 | 14/15 | 410s |

**Result: the tier ordering has no measured basis on this scenario.** The model
labelled brain scored lowest, and the whole spread is one assertion in fifteen.
A cascade cannot buy quality by escalating between rungs that are the same
height, so criterion 5 is structurally unreachable with these three models here.
Re-ordering the ladder by measured capability is a separate experiment and has
not been run.

---

## run20 — baseline, both arms on the identical model

Both arms forced onto `mimo-v2.5` so every difference is the plugin.

| | raw | vibeultrax |
|---|---|---|
| uncached input | 72,684 | 231,254 (3.2x) |
| cache read | 1,467,072 | 1,158,336 (-21%) |
| output | 29,792 | 25,091 |
| wall | 652s | 1,756s (2.7x) |
| correctness | 0.933 | 0.933 |

**Result: negative.** Identical answers, 3.2x the uncached input and 2.7x the
wall clock. The run also logged 40 ReferenceErrors, 38 API failures and 5 lost
state writes, none of which any instrument reported at the time.

---

## run21 — three-tier ladder, before the gate-escalation fix

`cheap=muse-spark-1.2-contributor, medium=ling-3.0-flash-fin, brain=mimo-v2.5`,
`VIBEOS_STABLE_PREFIX=1`, `VIBEOS_TURN_VOTE=off`, k=2, dsforge, 5 turns.

| trial | model(s) actually run | msgs | uncached input | cache read | output | qscore |
|---|---|---|---|---|---|---|
| raw-0 | mimo-v2.5 | 59 | 82,721 | 2,584,320 | 38,263 | 0.920 |
| raw-1 | mimo-v2.5 | 40 | 78,437 | 1,837,696 | 29,073 | 0.954 |
| vibeultrax-0 | muse-spark only | 53 | 608,018 | 1,715,429 | 28,384 | 0.950 |
| vibeultrax-1 | muse-spark only | 61 | 701,524 | 2,120,828 | 30,836 | 0.948 |

**Criterion 1: failed.** One model per vibeultrax session. The cascade never
escalated -- it sat on the cheap rung for all five turns of both trials.
Criteria 2 and 3 are unevaluable as a result.

**Criterion 5: met, and not by the intended mechanism.** Mean vibeultrax qscore
0.949 vs raw 0.937 -- while running nothing but the cheapest model. Consistent
with the ladder calibration above: on this scenario the cheap model is not worse.

**Criterion 6: 8x.** 654,771 mean uncached input against raw's 80,579. Worse
than run20's 3.2x, on a smaller model.

**Also logged:** 10 `updateState failed after 3 retries: lock not acquired for
delegation-state.json`, five in each vibeultrax trial, zero in either raw trial.
Each one blocks ~6s and drops the write.

**What it produced:** the diagnosis behind PRs #551 (the answer-derived verdict
was being reverted every turn), #553 (the cached prefix moved every fifth turn;
the trinity schema was sent twice per request) and #554 (a callback error was
being retried as lock contention and then mislabelled).

---

## run22 — in flight

Same configuration as run21, on `d0ab1bd8` (#551 only). The single variable
against run21 is the gate-escalation routing fix; #552, #553 and #554 are
deliberately excluded so criterion 1 is testable on its own.

**Prediction:** >= 2 distinct models in each vibeultrax session, with the
escalation following a gate failure rather than a regime label.
**Falsified if:** `opencode.db` still shows one model per session.
