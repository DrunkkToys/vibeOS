# vibeOS Mode Benchmark — Final Report

## Dataset

- **1,084 successful data points** across 3 tiers + 3 multi-turn conversations
- **Total cost: $1.34** (DeepSeek API direct calls)
- **3 conversation scripts** (12 turns each) simulating real human-flow (browser loading, debugging, system design)
- **Scenarios**: 20 single-turn prompts x 3 tiers x 17+ rounds + 3 multi-turn scripts x 3 tiers x 12 turns

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

### 3. Peak Throughput (identical ceiling)

All tiers can hit 19,000-26,000 tok/s on long outputs when max_tokens isn't binding.

### 4. Human-Flow Simulation

3 real multi-turn conversations (12 turns each) across 3 tiers:
- **browser-load**: 12-turn deep dive on web page loading
- **debug-crash**: 12-turn debugging session (Node.js ECONNRESET)
- **design-url-shortener**: 12-turn system design exercise

Multi-turn cost impact: context growth adds minimal latency per turn (~10-20ms per additional history message).

## Mode Calibration Updates

### 5 Existing Modes (updated with empirical data)

| Mode | Tier | Thinking | Enforcement | Flow | TDD | Loop Threshold | Context7 |
|---|---|---|---|---|---|---|---|
| balanced | medium (auto) | auto | normal | normal | normal | 0.6 | preferred |
| budget | cheap | off | relaxed | audit | lazy | 0.6 | optional |
| quality | brain | full | strict | normal | strict | 0.4 | high |
| speed | medium | off | relaxed | audit | lazy | 0.7 | optional |
| longrun | brain | brief | normal | normal | normal | 0.5 | preferred |

### 2 New Modes Added

| Mode | Tier | Thinking | Enforcement | Flow | TDD | Loop Threshold | Context7 |
|---|---|---|---|---|---|---|---|
| **forensic** | brain | full | strict | strict | strict | 0.3 | high |
| **web-research** | medium | full | audit | audit | lazy | 0.7 | required |

### Critical Fix: autoSelectMode()
Was a stub (`return "balanced"`). Now responds to stress + regime:
- LOOPING/DIVERGENT → forensic
- EXPLORING/INIT → web-research
- stress > 1.5 → quality
- CONVERGING/CLOSED → speed
- Default → balanced

### Critical Fix: computeControlVector()
Was returning static defaults. Now returns mode-specific enforcement, flow, TDD, tier bias, thinking, context7, and loop protection settings.

## Running the Benchmarks

```bash
# First run (tier x thinking matrix, ~$0.15)
node scripts/run-token-latency-benchmark.mjs

# Full mode analysis (tier x thinking x scenarios, ~$0.30)
node scripts/run-all-mode-benchmark.mjs

# Mass benchmark (1000+ datapoints, ~$1.50)
node scripts/run-mass-benchmark.mjs

# Signal analysis (from log data)
node scripts/mode-signal-analysis.mjs

# Final report generator
node scripts/mode-final-report.mjs
```

## Raw Data

All results appended to `~/.claude/experiment-benchmark.jsonl` (2,221 entries total, 1,084 successful).
Reports saved to `~/.claude/reports/mass-benchmark-*.json` and `mode-calibration-*.json`.

## Signals for Future Work

1. Add session-level mode auto-detection (classify conversation type on session start)
2. Link mode selection to actual task routing (task subagents should use mode's tier_bias)
3. Run on more model families (Claude, GPT) for cross-provider comparison
