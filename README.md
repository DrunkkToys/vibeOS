# theSaver — OpenCode

Cost-aware plugin for [OpenCode](https://opencode.ai).

Three-tier model routing, prompt-cache savings tracking, and a live cost footer appended to every assistant response — without ever blocking a tool call.

---

## The problem it solves

Running a capable brain model for every message is expensive and unnecessary. Most work in a session — searches, file edits, subagent tasks — doesn't need the full brain. theSaver intercepts that work, routes it to a cheaper worker, and tracks exactly how much you saved in real time.

---

## Three tiers, one workflow

```
🧠 Brain   — orchestrates, judges, synthesises (your main OC model)
⚙  Medium  — capable mid-tier for complex subtasks
⚡ Cheap   — fast, cheap worker for all heavy lifting
```

### How they work together

**You stay on the brain.** theSaver automatically routes Task subagents to the cheap slot and injects a once-per-session judge directive: the brain orchestrates and verifies; the worker implements.

```
You ask: "build a data pipeline and write tests"

Brain (high-tier)
  ├── delegates pipeline implementation → Task subagent (budget-tier) ⚡
  ├── delegates test writing            → Task subagent (budget-tier) ⚡
  └── reviews output, fills gaps, delivers final answer
```

**Real example savings per session:**

| Work type | Brain cost | With theSaver |
|---|---|---|
| 50 tool calls (search, edit) | ~$0.80 | ~$0.12 (budget worker) |
| 20 web fetches | ~$0.40 | ~$0.06 (budget worker) |
| Prompt cache hits | paid at input rate | **paid at cache rate (10× cheaper)** |
| Typical 2h session | ~$3–6 | ~$0.50–1.50 |

---

## Cache reading — the biggest saving

Every time OpenCode re-reads its context (system prompt, history, tool results), it charges **input token rates**. With prompt caching enabled, repeated reads are charged at **cache-read rates — roughly 10× cheaper**.

theSaver tracks this in real time and appends it to every response:

```
session $8.84 tasks + $493 cache = $501 | lifetime $14 tasks + $496 cache = $510
```

The `$493 cache` is **real money saved** — computed from actual token counts, not estimated. It compounds fast across a long session.

> **Why it matters:** In a session with 50k+ context tokens, every response re-reads the entire history. At typical high-tier prices ($3/M input vs $0.30/M cache), a 100-turn session saves ~$0.27/turn × 100 = **$27 from caching alone**. The longer the session, the bigger the cache advantage.

---

## Three-tier use cases

### 🧠 Brain — when you need the best

Use the brain slot for:
- Architectural decisions and design reviews
- Complex multi-file debugging
- Final synthesis, answer quality, extended thinking
- Anything where depth matters more than cost

```
trinity brain    ← type directly in chat
```

### ⚙ Medium — capable, cheaper

Use the medium slot for:
- Focused coding on a single module
- Moderate-complexity refactors
- Sessions where credits are running low but quality still matters

```
trinity medium   ← type directly in chat
```

### ⚡ Cheap — the workhorse

Runs automatically as the Task subagent target. Also switch here for:
- Batch processing, log analysis, data transformation
- Repetitive edits with clear specs
- Speed > depth tasks

```
trinity cheap    ← type directly in chat
```

### Credit-based auto-switching

Configured in `~/.claude/model-tiers.json`:
```json
"selection": {
  "credit_threshold_percent": 30,
  "brain":    "brain",
  "fallback": "medium"
}
```

When credit drops below the threshold, `trinity auto` switches to the fallback slot automatically.

---

## Thinking level — automatic reasoning depth

theSaver adjusts extended thinking based on your remaining credit:

| Credit | Thinking | Effect |
|---|---|---|
| ≥ 70% | **FULL** | No restriction — use extended thinking freely |
| 40–69% | **BRIEF** | Extended thinking for complex problems only |
| < 40% | **OFF** | Skip extended thinking entirely — save tokens |

Override directly in chat:
```
trinity thinking full    → always use extended thinking
trinity thinking brief   → complex tasks only
trinity thinking off     → never (maximum savings)
```

---

## Live footer — see savings after every response

Every assistant response ends with:

```
— [⚙ Mid → ⚡ Budget] · 💰 session $8.84 tasks + $493 cache = $501 | lifetime $14 tasks + $496 cache = $510 (273 events) —
```

| Part | Meaning |
|---|---|
| `⚙ Mid → ⚡ Budget` | Brain → worker model pair |
| `session $X tasks` | Estimated savings from routing events this session |
| `session $Y cache` | **Real** savings from prompt cache hits (actual token counts) |
| `lifetime $A tasks + $B cache = $C` | Cumulative totals across all sessions |
| `(N events)` | Total delegation enforcement events lifetime |

---

## Workflow optimization features

| Feature | How it saves |
|---|---|
| Judge pattern | Brain orchestrates; budget worker implements — injected once per session as a system directive |
| Task subagent routing | Mid-tier brain → cheap worker automatically; 5–10× cost difference per task |
| Thinking auto-depth | Stops paying for extended thinking when credits are low |
| Context7 nudge | Redirects library-docs fetches to context7 MCP (smaller payload, no follow-ups) |
| Write/Edit ledger | Tracks every high-tier direct edit that could have been delegated |
| Session vs lifetime savings | See ROI per conversation and across all time |
| Live enable/disable | Toggle the whole plugin without restarting OpenCode |

---

## Purchase

**Buy now**: https://thesaver.gumroad.com/l/thesaver-oc
*(link active once product is published — or open a GitHub issue to request access)*

| Tier | Price | Who |
|---|---|---|
| Individual | **$15** | 1 developer |
| Team | **$50** | Up to 5 seats |
| Enterprise | Contact | Site license, priority support |

After purchase you receive a `.tgz` download. Install:

```bash
# Extract to plugins folder
mkdir -p ~/.config/opencode/plugins
tar -xzf opencode-delegation-enforcer-0.5.0.tgz -C /tmp/oc-extract
cp /tmp/oc-extract/package/src/index.js ~/.config/opencode/plugins/delegation-enforcer.js
cp /tmp/oc-extract/package/src/flow-enforcer.js ~/.config/opencode/plugins/
cp /tmp/oc-extract/package/src/flow-rules.json ~/.config/opencode/plugins/
rm -rf /tmp/oc-extract
```

Register in `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["./plugins/delegation-enforcer.js"]
}
```

### Quick start

```bash
cp model-tiers.sample.json ~/.claude/model-tiers.json
# edit to match your providers/models
```

### Copy the config

```bash
cp model-tiers.sample.json ~/.claude/model-tiers.json
```

*(Skip if you already have this from theSaver-cc — both plugins share the same file.)*

---

## In-chat trinity tool

Control everything without leaving the chat window:

| Command | Effect |
|---|---|
| `trinity brain` | Switch to brain slot |
| `trinity medium` | Switch to medium slot |
| `trinity cheap` | Switch to cheap slot |
| `trinity on` | Enable plugin |
| `trinity off` | Disable plugin |
| `trinity thinking full` | Always use extended thinking |
| `trinity thinking brief` | Complex tasks only |
| `trinity thinking off` | Never (max savings) |
| `trinity status` | Show current state |

---

## Configuration

`~/.claude/model-tiers.json` — shared with theSaver-cc:

```json
{
  "trinity": {
    "brain":  { "oc": "provider/high-tier-model",   "cc": "brain" },
    "medium": { "oc": "provider/mid-tier-model",    "cc": "medium" },
    "cheap":  { "oc": "provider/budget-tier-model",  "cc": "budget" }
  },
  "selection": {
    "credit_threshold_percent": 30,
    "enabled": true,
    "active_slot": "brain"
  }
}
```

---

## Credit tracking

```bash
echo 85 > ~/.claude/credit-percent          # manual file
export CLAUDE_CREDIT_PERCENT=85             # environment variable
export CLAUDE_CREDIT_HELPER=~/bin/check-credit.sh  # dynamic script
```

---

## Shared state with theSaver-cc

Both plugins write to the same files — install both to get unified savings tracking across runtimes:

```
~/.claude/delegation-state.json   # savings ledger (per-session + lifetime)
~/.claude/model-tiers.json        # model slot config
```

---

## Requirements

- OpenCode v1.14.33+
- Node.js ≥ 18
- `jq` — see platform notes below

### Platform notes

**macOS**
```bash
brew install jq
```

**Linux**
```bash
apt install jq      # Debian / Ubuntu
yum install jq      # RHEL / CentOS
```

**Windows**

The `trinity` CLI requires bash. Two options:

| Option | Setup |
|---|---|
| **WSL** *(recommended)* | Full Linux environment. `apt install jq` works natively. Run `trinity` inside WSL. |
| **Git Bash** | Ships with Git for Windows. Install `jq` manually: download the Windows binary from [jqlang.github.io/jq](https://jqlang.github.io/jq/download/) and place it on your PATH. |

Install `jq` on Windows via package manager (pick one):
```powershell
choco install jq          # Chocolatey
winget install jqlang.jq  # winget (Windows 11 / Win 10 1709+)
```

> **Note:** OpenCode itself runs on Windows, but the `trinity` CLI shells out to bash. WSL is the smoothest path — Git Bash works but may have edge cases with path handling.
