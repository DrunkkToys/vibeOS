# Live GUI Test Prompts — 10 PRs Verified

> Auto-executable prompts for opencode chat. Zero risk (read-only). One per PR.

## PR #227 — anti-loop cost guard with per-turn memoization

```
Show me all active loop prevention directives active in my current session. List the per-turn memoization cache keys, loop intervention level, and any token waste signals detected so far. Do not modify anything.
```

**Expected:** Footer shows `LOOP` tag, system prompt has cost guard directive, no repeated same-tool calls.

---

## PR #226 — cascade data in blackbox history + loop detection threshold tuning

```
What is my current blackbox sub-regime? Show the last 10 history entries from the resolution tracker with timestamps, action types, and any loop intervention events. Do not change any state.
```

**Expected:** Regime listed, history shows actions, loop threshold now at 3 (not lower).

---

## PR #225 — readConfig falls back to bare model

```
Read the model-tiers.json file in ~/.claude/ and show me the full config. Then tell me if readConfig() has a fallback path to bare model IDs when the trinity slots are empty. Do not write anything.
```

**Expected:** Model config shown, fallback logic confirmed via code read.

---

## PR #224 — cascade icon uses live computeControlVector

```
Run vibe status and inspect the footer. Is the cascade icon (▸▸▸) displayed when VibeUltraX mode is active? Show me computeControlVector's live return value. Do not change any modes.
```

**Expected:** Cascade icon visible when mode=vibeultrax, icon sources from live vector not cached stale value.

---

## PR #223 — cascade icon in footer for VibeUltraX mode

```
Show me the current footer. List all components: model split, savings, trend arrow, stress gauge, cascade icon. Mark which are present and which are blank.
```

**Expected:** Cascade icon (▸▸▸) present when `optimization_mode=vibeultrax`, hidden otherwise.

---

## PR #222 — edge case cascade tests + footer test regressions

```
Run the cascade test file and show me pass/fail counts for the cascade icon and buildStatusPayload tests. Read the relevant test file without executing.
```

**Expected:** All cascade tests pass, footer tests without regressions.

---

## PR #221 — pattern learner, README table, footer brand/label

```
Show me learned patterns for this project via vibe patterns. Also display the current footer brand text and model slot labels.
```

**Expected:** Patterns shown with friction/routine counts. Footer brand says "vibeOS".

---

## PR #220 — two CRITICAL runtime bugs

```
Run vibe status. Then read src/vibeOS-lib/blackbox/index.ts (the .ts file, not .js) and check for any .catch() or error boundary in loadSelection and orchestratorDirective. Show me the error handling paths.
```

**Expected:** orchestratorDirective wrapped in try/catch. loadSelection doesn't throw during onSystemTransform.

---

## PR #219 — stress gauge to footer + cascade regression test

```
What is my current stress score? Display the footer stress gauge (▁▂▃▅▆█) and the cascade regression test results for the first 3 cascade scenarios (init, diverging, looping). Read-only.
```

**Expected:** Stress gauge visible in footer, cascade regression tests pass for init/diverging/looping regimes.

---

## PR #218 — chore(release): v0.25.29 (guard API reconnect/retry behind debug)

```
Check if VIBEOS_DEBUG is set. Show me the API reconnect/retry message handling. Read the guard implementation that hides reconnect noise behind debug flag.
```

**Expected:** No reconnect noise in normal output. Enabled only when VIBEOS_DEBUG is set.

---

## Batch execution command

Paste all of the above into opencode in sequence. Each prompt self-describes what to show and is read-only. Collect output and diff against "Expected" column.
