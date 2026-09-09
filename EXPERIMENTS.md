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

## run22 — no comparison: three trials of four died on a silent hang

`d0ab1bd8` (#551 only), sha256 `076b6a9bf5d8`, worktree dirty. Same
configuration as run21; #552, #553 and #554 deliberately excluded so criterion 1
was testable on its own.

**Prediction:** >= 2 distinct models in each vibeultrax session, escalation
following a gate failure rather than a regime label.

**Result: unevaluable.** Nothing was measured about routing, because the run
never produced a vibeultrax trial to measure.

| trial | outcome |
|---|---|
| raw-0 | completed, 5 turns, correctness 0.933, qscore 0.973 |
| raw-1 | void — `pivot` was killed at 1800s |
| vibeultrax-0 | void — `diagnose` was killed at 1800s |
| vibeultrax-1 | void — `diagnose` was killed at 1800s |

Final table: raw n=1 (1 void), vibeultrax **n=0** (2 void).

**The failure mode.** Each dead turn's `.stdout` and `.stderr` logs are empty.
That is what a killed turn always looks like -- `opencode run --format json` does
not stream, so the kill takes the transcript with it -- and it therefore says
nothing about whether the turn did any work. What it does say is that the turn
never exited. `diagnose` is the turn
raw-0 completed in 169s and raw-1 in 156s. Both vibeultrax sessions logged
exactly three internal errors before going silent -- two
`API fallback activated (blackboxControlVector)` and one
`updateState failed after 3 retries: lock not acquired` -- and one chat-params
row, slot `medium`, `overridden: true`.

**What can and cannot be concluded.** Both plugin trials died on turn one; the
raw trial that died went four turns first. That asymmetry is suggestive and it
is not proof: one raw trial hung with no plugin loaded at all, so the provider
can produce this shape unaided, and four trials is not a distribution. run23
repeats turn one alone on current master to find out whether it is deterministic.

**What it produced:** #561 -- the rig had refused to retry any of these, because
an empty `errorText` does not match the retryable pattern, so a killed turn was
filed as "not a transient provider failure". Retrying them is right; #561's test
for whether a turn was safe to retry was not. It read the turn's own stdout byte
count and tool-call list, both of which the kill destroys, and #565 replaced it
with a hash of the trial project taken on either side of each attempt. The
sentence this entry originally carried -- that these turns "produced no output,
ran no tool and touched no file" -- was an inference from evidence that does not
exist, not an observation.

**A correction to the record.** In #558 I attributed the falling internal-error
counts across run20, run21 and run22 to #550, #552 and #554 landing. That is not
supported: run22's bundle contains none of #552, #553 or #554, and run20's and
run21's bundles were the main checkout's `dist/vibeOS.js`, since rebuilt and
now unidentifiable. All the counts support is that both raw arms logged zero
rows in every run and every vibeultrax trial logged some. #560 records the
sha256 and commit of the bundle for every run from now on, so no run's build is
ever unrecoverable again.

---

## run23 — the hang is the provider's, not the plugin's

Current master `6c70147f`, sha256 `c448fd85c202`. One turn, both arms, k=1.

**Prediction:** the vibeultrax trial completes turn one, or fails with output
rather than in silence.
**Result: falsified, and so was the alternative.** Both arms hung. Each ran
`diagnose` twice for the full 900s without exiting.

| trial | attempt 1 | attempt 2 | outcome |
|---|---|---|---|
| raw-0 | killed at 900s | killed at 900s | void |
| vibeultrax-0 | killed at 900s | killed at 900s | void |

raw-0 carries no plugin at all, so the hang cannot be plugin-side. That
retrospectively removes the only suggestive thing about run22: both of its
vibeultrax trials died on turn one, but so does the control here.

**The direct probe.** A bare `opencode run --pure`, no plugin, no scenario, in an
empty directory, prompt "Reply with the single word OK and nothing else":

| model | result |
|---|---|
| `opencode/mimo-v2.5-free` | killed at 180s, never exited |
| `opencode/muse-spark-1.2-contributor-free` | killed at 90s, never exited |
| `opencode-go/mimo-v2.5` | 401 — insufficient balance |
| `deepseek/deepseek-v4-flash` | 402 — insufficient balance |
| `openrouter/deepseek/deepseek-chat` | insufficient credits |
| `google/gemini-2.5-flash` | model retired |
| `google/gemini-3.5-flash-lite` | responded, 3s |
| `google/gemini-3.5-flash` | responded, 5s |
| `google/gemini-3.6-flash` | responded, 4s |

The comparison that carries the conclusion is latency, not output: under the
identical harness and the identical kill discipline, three Google models
answered a one-word prompt in 3 to 5 seconds and the free tier had not exited
after 90 and 180. The entire ladder run20 through run23 used is unreachable, and
the free tier fails by hanging rather than by erroring, which is why it cost four
trials and several hours before it was visible.

**What it produced:** #561's retry firing live, and the finding that the ladder
had to move providers.

---

## run24 — killed, not completed

Current master `6c70147f`, sha256 `c448fd85c202`. Five turns, k=2, both arms.
New ladder, since the old one is unreachable:

| slot | model |
|---|---|
| cheap | `google/gemini-3.5-flash-lite` |
| medium | `google/gemini-3.5-flash` |
| brain | `google/gemini-3.6-flash` |

**Not comparable to run20-22.** Different models, different provider. This is a
new baseline, and the raw arm in this run is the only control its vibeultrax arm
may be measured against.

**Prediction:** trials complete rather than hang, giving the first evaluable
answer to criteria 1 through 4 -- at least two distinct models per vibeultrax
session in `opencode.db`, escalation following gate verdicts, at least one turn
on the cheap rung, and no void trials.
**Falsified if:** `opencode.db` shows one model per vibeultrax session, which
would mean the routing fixes in #551 do not reach a live session even on a
provider that answers.

**Result: none. The run was killed by hand, 42 minutes in, at raw-0 turn 3.**
Not a provider failure and not a result -- it was stopped because #561's retry
rule was found to be unsafe while it was running, and collecting trials through a
retry that might double-apply an edit would have produced numbers that looked
like data.

| turn | outcome |
|---|---|
| `diagnose` | status 0, 118s |
| `fix-dedup` | status 0, 87s |
| `fix-rest` | killed; retried under the unsafe rule; run stopped during attempt 2 |

The ladder itself did what it was chosen for: two turns completed in 118s and
87s, against a provider that had not exited after 900s in run23. That is the
only thing run24 establishes.

One incidental measurement, taken after the kill: the killed `fix-rest` attempt
left the trial project byte-identical -- the newest file in it predates the turn
and was written by `fix-dedup`. So the retry it took was in fact harmless, which
the byte count that authorised it could not have known and the tree hash in #565
would have established.

---

## run25 — pre-registration

Rerun of run24 on the same Gemini ladder with the retry fixed (#565), five
turns, k=2, both arms, `--turn-timeout 1800000` (`fix-rest` exceeded 900s here).

**Not comparable to run20-23.** Different provider. The raw arm in this run is
the only control its vibeultrax arm may be measured against.

**Prediction:** criteria 1 through 4 become answerable for the first time -- at
least two distinct models per vibeultrax session in `opencode.db`, escalations
correlating with recorded gate verdicts, at least one turn on the cheap rung, no
void trials.
**Falsified if:** `opencode.db` shows one model per vibeultrax session, which
would mean the routing fixes in #551 do not reach a live session even on a
provider that answers.

A second prediction, on the mechanism rather than the outcome: run21's two
completed vibeultrax trials hold 21 gate verdicts and **all 21 passed**. If that
repeats, the answer-verification cascade has no failure to escalate on, and
criterion 2 is unreachable for a reason that has nothing to do with #551 -- the
gate's three rules never fire on this workload. That is a separate defect from
the one #551 fixed, and it would be the next thing to work on.
