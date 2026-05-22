# vibeOS Blackbox Signal Reference

> Training data: 532 synthetic + 770 production feature vectors (11 dims each)

## 1. Feature Pipeline

User text → `extractFeatures()` (11 raw features) → 4 derived signals → sub-regime → momentum → advice-layer

## 2. Derived Signals (per turn, stored in `ResolutionState.signals`)

| Signal | Formula | Window | Range | Prod mean | Null rate |
|--------|---------|--------|-------|-----------|-----------|
| `action_consistency` | mostCommonAction / min(hist,5) | last 5 | [0.33, 1.0] | 0.47 | 0% |
| `entropy_trend` | least-squares slope of entropies | last 5 | [-0.25, 0.09] | -0.09 | 0% |
| `feature_contradiction` | count(|cur-prev| > 0.2) / 6 | last 2 | [0, 0.5] | 0.04 | 94% zeros |
| `embedding_delta` | 1 - cosSim(embPrev, embCurr) | last 2 | **always 0** — no embed fn connected | — | 100% |

## 3. Calibratable Thresholds (all exposed in `calibratedWeights`)

| Threshold | Default | Exposed | Used in | Training data effect |
|-----------|---------|---------|---------|---------------------|
| `momentum[3]` | [-0.3, 0.5, 0.2] | ✓ | `computeMomentum()` | Directly varied in sweep |
| `loopJaccard` | 0.6 | ✓ | `detectLoop()` | Swept 0.3-0.9 |
| `loopK` | 3 | ✓ | `detectLoop()` | Swept 2-4 |
| `closureConfidence` | 0.7 | ✓ | `isClosed()` | Swept 0.5-0.9 |
| `closedDelta` | 0.1 | ✓ | `isClosed()` | Swept 0.05-0.25 |
| `closedContradiction` | 0.1 | ✓ | `isClosed()` | Swept 0.05-0.25 |
| `closedEntropy` | 0.5 | ✓ | `isClosed()` | Swept 0.2-0.9 |
| `divergentEntropyTrend` | 0.03 | ✓ | `isDivergent()` | Swept 0.008-0.05 |
| `divergentContradiction` | 0.3 | ✓ | `isDivergent()` | Swept 0.1-0.5 |
| `exploringContradiction` | 0.2 | ✓ | `isExploring()` | Swept 0.05-0.4 |
| `exploringEntropyTrend` | 0.005 | ✓ | `isExploring()` | Swept 0.001-0.02 |

## 4. Regime Priority (first match wins)

1. INIT (n===1)
2. LOOPING (`detectLoop()`)
3. CLOSED (consistency > ccThreshold && delta < closedDelta && contradiction < closedContradiction && entropy < closedEntropy)
4. DIVERGENT (entropyTrend > divergentEntropyTrend && (contradiction > divergentContradiction || consistency < 0.3))
5. EXPLORING (contradiction > exploringContradiction || entropyTrend > exploringEntropyTrend)
6. REFINING (contradiction < 0.2, delta < 0.3, consistency > 0.3, entropyTrend > -0.01)
7. CONVERGING (consistency >= 0.5, delta < 0.2, entropyTrend < 0)

## 5. Production Distribution (770 turns, 7 sessions)

- EXPLORING: 70.9% — INIT: 10.0% — CONVERGING: 18.7% — REFINING: 0.4%
- CLOSED/LOOPING/DIVERGENT: **0%** (never reached in real data)

## 6. Loop Detection Weakness

`detectLoop()` requires Jaccard similarity > threshold AND entropy must NOT be decreasing. In production dialogues (3-10 turns), the info gain guard blocks loop detection because entropy naturally decreases.

## 7. Key Findings for Training

1. `embedding_delta` and `drift_rate` are always 0 — need embedding provider
2. Loop detection needs shorter window (`loopK=2`) for short dialogues
3. CLOSED regime barriers should be lowered (`closedEntropy: 0.7` instead of 0.5)
4. `exploringContradiction: 0.1` produces more regime diversity
5. Momentum never negative — no loop/divergence events in production
