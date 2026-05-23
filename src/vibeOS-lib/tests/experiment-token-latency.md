# vibeOS Mode Benchmark — Final Report

## Dataset

- **1,128 successful data points** across 3 tiers + multi-turn + compaction experiments
- **Total cost: $1.62** (DeepSeek API direct calls)
- **3 conversation scripts** (12 turns each) simulating real human-flow
- **Compaction experiments**: 3 strategies tested across all tiers

## Models Tested

| Slot | API Model | OpenCode Config Name |
|---|---|---|
| brain | `deepseek-v4-pro` | `deepseek/deepseek-v4-pro` |
| medium | `deepseek-v4-flash` | `deepseek/deepseek-v4-flash` |
| cheap | `deepseek-chat` | `deepseek/deepseek-chat` |

## Key Empirical Findings

### 1. Tier Latency Parity (confirmed at scale)

All three tiers have **identical latency**:
| Tier | p50 | p95 | Runs |
|---|---|---|---|
| brain | 342ms | 630ms | 351 |
| medium | 340ms | 618ms | 372 |
| cheap | 338ms | 609ms | 361 |

**Conclusion: Tier choice has zero impact on response speed.** The auto mode should always default to the cheapest tier that meets quality requirements.

### 2. Output Quality (the real differentiator)

| Tier | Avg tok/run | Response/Prompt ratio | Total tok out | Cost |
|---|---|---|---|---|
| brain | 395 | 18.85x | 138,498 | $1.18 |
| medium | 254 | 11.79x | 94,390 | $0.11 |
| cheap | 219 | 10.55x | 79,221 | $0.05 |

- **Brain produces 56% more output** than medium for the same prompt
- **Brain expands on prompts 60% more** (18.9x vs 11.8x ratio)
- **Medium is only 16% more verbose than cheap** — closer than expected
- **Brain costs 10x more than medium** and **24x more than cheap**

## Multi-Turn Quality Degradation

### Natural degradation (no compaction, 12-turn conversation)

| Turn Range | Avg tok_in (context) | Avg tok_out | Quality Signal |
|---|---|---|---|
| 0-2 | 23→1,430 | **1,341** | Peak |
| 3-5 | 2,690→4,087 | **973** | Stable |
| 6-8 | 5,146→7,364 | **1,297** | Stable |
| **9-11** | **6,319→7,550** | **627→550** | **55% drop** |

Critical turning point at ~5,000+ tokens of context.

## Compaction Experiment Results

### Three strategies compared

| Strategy | brain deg | medium deg | Verdict |
|---|---|---|---|
| **No compaction** (baseline) | -38.8% | -38.7% | Reference |
| **Naive summarization** | -45.8% | -39.8% | **WORSE** |
| **Fact-preserving compression** | **-28.7%** | **-31.6%** | **BETTER** |

### Key findings:

1. **Strategy matters more than compaction itself.** The directive tells the model what was preserved.
2. **Naive summarization causes 57% post-compaction crash** (1411→604 tok immediate drop)
3. **Fact-preserving compression: no crash** (1763→1473 tok, -16% dip, recovers)
4. **Cheap tier's unique advantage (+97% improvement over turns) is destroyed by any compaction**

### Implementation in session-compact.ts

The `onSessionCompacting` hook now:
- Reads per-session turn counter from blackbox state
- At turn >= 7, injects a system directive:
  ```
  ALL factual statements, technical details, decisions, code snippets,
  file paths, and references from prior turns are PRESERVED losslessly.
  Only verbose connectors, restatements, and redundant intros have been removed.
  ```
- Continues existing scratchpad-aware logic unchanged

## Mode Calibration

### 7 Modes (5 existing + 2 new)

| Mode | Tier | Thinking | Enforcement | Flow | TDD | Loop Threshold | Context7 |
|---|---|---|---|---|---|---|---|
| balanced | medium (auto) | auto | normal | normal | normal | 0.6 | preferred |
| budget | cheap | off | relaxed | audit | lazy | 0.6 | optional |
| quality | brain | full | strict | normal | strict | 0.4 | high |
| speed | medium | off | relaxed | audit | lazy | 0.7 | optional |
| longrun | brain | brief | normal | normal | normal | 0.5 | preferred |
| **forensic** | **brain** | **full** | **strict** | **strict** | **strict** | **0.3** | **high** |
| **web-research** | **medium** | **full** | **audit** | **audit** | **lazy** | **0.7** | **required** |

### autoSelectMode() fixed

Was a stub (`return "balanced"`). Now dynamic:
- LOOPING/DIVERGENT → forensic
- EXPLORING/INIT → web-research
- stress > 1.5 → quality
- CONVERGING/CLOSED → speed
- Default → balanced

## Running the Benchmarks

```bash
# First run — tier x thinking matrix (~$0.15)
node scripts/run-token-latency-benchmark.mjs

# Full mode analysis (~$0.30)
node scripts/run-all-mode-benchmark.mjs

# Mass benchmark (1000+ datapoints, ~$1.50)
node scripts/run-mass-benchmark.mjs

# Compaction experiments
node scripts/compaction-experiment.mjs        # naive summarization
node scripts/compaction-native-exp.mjs        # fact-preserving compression

# Analysis
node scripts/mode-signal-analysis.mjs
node scripts/mode-final-report.mjs
```

## Signals for Future Work

1. **Session-level mode auto-detection** — classify conversation type on session start
2. **Link mode selection to task routing** — task subagents should use mode's tier_bias
3. **Cross-provider comparison** — run on Claude, GPT for comparison
4. **Turn-aware compaction timing** — experiment with compaction at turn 5 vs 7 vs 10
5. **Cheap tier exploration** — cheap naturally improves over turns (+97%). Investigate why.

## Repository Structure

```
scripts/
  run-token-latency-benchmark.mjs      # First tier benchmark
  run-all-mode-benchmark.mjs           # Tier x thinking matrix
  run-mass-benchmark.mjs               # 1056-run mass benchmark
  compaction-experiment.mjs            # Naive summarization test
  compaction-native-exp.mjs            # Fact-preserving compression test
  mode-signal-analysis.mjs            # Signal detection from results
  mode-final-report.mjs               # Comprehensive report generator
src/vibeOS-lib/tests/
  experiment-scenarios-token-latency.json  # 30 scenario definitions
  experiment-token-latency.md              # This document
  experiment-data-export.json              # 1128 clean data points
  reports/                                 # Key reports
src/lib/hooks/session-compact.ts           # Turn-aware compaction hook
src/lib/turn-classify.ts                   # Mode definitions + auto-select
```
