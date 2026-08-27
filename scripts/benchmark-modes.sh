#!/usr/bin/env bash
# ─── vibeOS Mode Calibration Benchmark v2 ──────────────────────────────────────
# Collects all KPIs per optimization mode and validates calibration.
# Usage:   bash scripts/benchmark-modes.sh            # static analysis
#          bash scripts/benchmark-modes.sh --live     # live benchmark harness
#          bash scripts/benchmark-modes.sh --table    # comparison table only
#
# @vibeOS 2026 — pre-production benchmark pipeline v2
# ==============================================================================
set -euo pipefail

USER_HOME="${HOME:?}"
VIBEOS_DIR="${VIBEOS_HOME:-$USER_HOME/.vibeos}"
DELEGATION_STATE="$VIBEOS_DIR/delegation-state.json"
BLACKBOX_STATE="$VIBEOS_DIR/blackbox-state.json"
PROJECT_STATE="$VIBEOS_DIR/project-states.json"
MODEL_TIERS="$VIBEOS_DIR/model-tiers.json"
GLOBAL_LEARNING="$VIBEOS_DIR/global-learning.json"
PRICING_CACHE="$VIBEOS_DIR/model-pricing-cache.json"
REPORTS_DIR="$VIBEOS_DIR/reports"
LEDGER="$VIBEOS_DIR/savings-ledger.jsonl"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="$REPORTS_DIR/mode-calibration-$TIMESTAMP.json"
SNAPSHOT_DIR="$VIBEOS_DIR/bench-snapshots"

BOLD='\033[1m'; DIM='\033[2m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; CYAN='\033[36m'; RESET='\033[0m'
HEADER() { printf "\n${BOLD}${CYAN}%s${RESET}\n" "$*"; }
OK()     { printf "  ${GREEN}[OK]${RESET}  %s\n" "$*"; }
WARN()   { printf "  ${YELLOW}[!]${RESET}  %s\n" "$*"; }
FAIL()   { printf "  ${RED}[X]${RESET}  %s\n" "$*"; }
INFO()   { printf "  ${DIM}%s${RESET}\n" "$*"; }
METRIC() { printf "  %-40s ${BOLD}%s${RESET}\n" "$1" "$2"; }

safe_json() {
  node -e "
    try{var fs=require('fs');var r=fs.readFileSync('$1','utf-8');var c=r.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*\$/gm,'').replace(/,\s*([}\]])/g,'\$1');console.log(JSON.stringify(JSON.parse(c)))}catch(e){console.log('null')}
  " 2>/dev/null || echo "null"
}
format_usd() { printf "\$%.4f" "$1"; }
pct() { printf "%.1f%%" "$1"; }
pad() { printf "%-14s" "$1"; }
num()  { printf "%s" "$1"; }

# ══════════════════════════════════════════════════════════════════════════════
# Live benchmark harness
# ══════════════════════════════════════════════════════════════════════════════
if [[ "${1:-}" == "--live" ]]; then
  MODE="${2:-balanced}"
  TASK="${3:-bench}"
  mkdir -p "$SNAPSHOT_DIR"

  PRE_SNAP="$SNAPSHOT_DIR/pre-${TASK}-${MODE}-${TIMESTAMP}.json"
  POST_SNAP="$SNAPSHOT_DIR/post-${TASK}-${MODE}-${TIMESTAMP}.json"

  HEADER "LIVE BENCHMARK: mode=$MODE task=$TASK"

  cat <<'LIVE'
  HOW TO USE THIS HARNESS:

  1. A pre-snapshot has been saved. Now run your test task in OpenCode.
     Switch to the target mode first:  trinity mode SPEED

  2. Run your test task (e.g., a code edit, research query, refactor).

  3. When done, return to THIS terminal and press ENTER.
     The post-snapshot will be captured automatically.

  4. Metrics computed from the snapshot delta:
     - Cost delta → estimated token consumption
     - Wall-clock elapsed
     - Savings delta
     - Warn delta
     - Cache hit delta
LIVE

  # Save pre-snapshot
  node -e "
    var fs=require('fs'),vh='$VIBEOS_DIR';
    var state={};
    try{state=JSON.parse(fs.readFileSync(vh+'/delegation-state.json','utf-8'))}catch(e){}
    var bb={};
    try{bb=JSON.parse(fs.readFileSync(vh+'/blackbox-state.json','utf-8'))}catch(e){}
    var pricing={};
    try{pricing=JSON.parse(fs.readFileSync(vh+'/model-pricing-cache.json','utf-8'))}catch(e){}
    fs.mkdirSync('$SNAPSHOT_DIR',{recursive:true});
    fs.writeFileSync('$PRE_SNAP',JSON.stringify({
      ts:Date.now(),
      ts_iso:new Date().toISOString(),
      mode:'$MODE',
      task:'$TASK',
      total_savings:state?.lifetime?.total_savings_usd||0,
      cache_savings:state?.lifetime?.cache_savings_usd||0,
      warn_count:state?.lifetime?.warn_count||0,
      scratchpad_hits:state?.lifetime?.scratchpad_hits_observed||0,
      session_count:state?.sessions?Object.keys(state.sessions).length:0,
      total_cost:(()=>{var c=0;for(var s of Object.values(state?.sessions||{}))c+=Number(s?.cost_usd||0);return c})(),
      blackbox_sessions:bb?.sessions?Object.keys(bb.sessions).length:0,
      pricing_models:Object.keys(pricing||{}).length,
    },null,2));
  "

  START_MS=$(node -e "console.log(Date.now())")
  START_EPOCH=$(date +%s)
  OK "Pre-snapshot saved. Run your test task now, then press ENTER."
  read -r _
  END_MS=$(node -e "console.log(Date.now())")
  END_EPOCH=$(date +%s)
  ELAPSED_MS=$((END_MS - START_MS))
  ELAPSED_S=$((END_EPOCH - START_EPOCH))

  # Save post-snapshot
  node -e "
    var fs=require('fs'),vh='$VIBEOS_DIR';
    var state={};
    try{state=JSON.parse(fs.readFileSync(vh+'/delegation-state.json','utf-8'))}catch(e){}
    var bb={};
    try{bb=JSON.parse(fs.readFileSync(vh+'/blackbox-state.json','utf-8'))}catch(e){}
    fs.writeFileSync('$POST_SNAP',JSON.stringify({
      ts:Date.now(),
      ts_iso:new Date().toISOString(),
      mode:'$MODE',
      task:'$TASK',
      total_savings:state?.lifetime?.total_savings_usd||0,
      cache_savings:state?.lifetime?.cache_savings_usd||0,
      warn_count:state?.lifetime?.warn_count||0,
      scratchpad_hits:state?.lifetime?.scratchpad_hits_observed||0,
      session_count:state?.sessions?Object.keys(state.sessions).length:0,
      total_cost:(()=>{var c=0;for(var s of Object.values(state?.sessions||{}))c+=Number(s?.cost_usd||0);return c})(),
      blackbox_sessions:bb?.sessions?Object.keys(bb.sessions).length:0,
    },null,2));
  "

  # Compute delta
  DELTA=$(node -e "
    var fs=require('fs');
    var pre=JSON.parse(fs.readFileSync('$PRE_SNAP','utf-8'));
    var post=JSON.parse(fs.readFileSync('$POST_SNAP','utf-8'));
    var d={
      elapsed_ms: $ELAPSED_MS,
      elapsed_s: $ELAPSED_S,
      delta_cost: +(post.total_cost - pre.total_cost).toFixed(6),
      delta_savings: +(post.total_savings - pre.total_savings).toFixed(6),
      delta_cache: +(post.cache_savings - pre.cache_savings).toFixed(6),
      delta_warns: post.warn_count - pre.warn_count,
      delta_cache_hits: post.scratchpad_hits - pre.scratchpad_hits,
      delta_sessions: post.session_count - pre.session_count,
      delta_blackbox: post.blackbox_sessions - pre.blackbox_sessions,
    };
    // Estimate tokens from cost delta using known pricing
    // brain ~$15/M in, $60/M out; medium ~$5/M in, $20/M out; cheap ~$0.27/M in, $1.10/M out
    // Rough blended rate: ~$2-$5 / MTok
    d.est_tokens = d.delta_cost > 0 ? Math.round(d.delta_cost / 0.000003) : 0;
    d.est_prompt_tokens = d.delta_cost > 0 ? Math.round(d.delta_cost * 0.7 / 0.000003) : 0;
    d.est_output_tokens = d.delta_cost > 0 ? Math.round(d.delta_cost * 0.3 / 0.000003) : 0;
    d.cost_per_second = d.elapsed_s > 0 ? +(d.delta_cost / d.elapsed_s).toFixed(8) : 0;
    d.tokens_per_second = d.elapsed_s > 0 ? Math.round(d.est_tokens / d.elapsed_s) : 0;
    console.log(JSON.stringify(d,null,0));
  ")

  ELAPSED_MS_J=$(echo "$DELTA" | node -e "var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.elapsed_ms)")
  COST_DELTA=$(echo "$DELTA" | node -e "var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.delta_cost.toFixed(5))")
  SAVINGS_DELTA=$(echo "$DELTA" | node -e "var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.delta_savings.toFixed(5))")
  CACHE_DELTA=$(echo "$DELTA" | node -e "var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.delta_cache.toFixed(5))")
  WARN_DELTA=$(echo "$DELTA" | node -e "var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.delta_warns)")
  EST_TOKENS=$(echo "$DELTA" | node -e "var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.est_tokens)")
  EST_PROMPT=$(echo "$DELTA" | node -e "var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.est_prompt_tokens)")
  EST_OUTPUT=$(echo "$DELTA" | node -e "var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.est_output_tokens)")
  TOK_PER_SEC=$(echo "$DELTA" | node -e "var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.tokens_per_second)")

  HEADER "LIVE BENCHMARK RESULTS: $MODE / $TASK"
  echo ""
  METRIC "Wall-clock time:" "${ELAPSED_S}s (${ELAPSED_MS_J}ms)"
  METRIC "Cost delta:" "$(format_usd "$COST_DELTA")"
  METRIC "Delegation savings delta:" "$(format_usd "$SAVINGS_DELTA")"
  METRIC "Cache savings delta:" "$(format_usd "$CACHE_DELTA")"
  METRIC "Warnings triggered:" "$WARN_DELTA"
  METRIC "Estimated total tokens:" "$EST_TOKENS"
  METRIC "Estimated prompt tokens:" "$EST_PROMPT"
  METRIC "Estimated output tokens:" "$EST_OUTPUT"
  METRIC "Cost per second:" "$(format_usd "$(echo "$DELTA" | node -e "var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.cost_per_second.toFixed(7))")")"
  METRIC "Estimated tok/sec:" "$TOK_PER_SEC"
  echo ""
  INFO "Snapshots: $PRE_SNAP / $POST_SNAP"

  # Save to results file
  mkdir -p "$SNAPSHOT_DIR"
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") | $MODE | $TASK | ${ELAPSED_S}s | \$${COST_DELTA} | est_tok=${EST_TOKENS} | tok/s=${TOK_PER_SEC} | warns=${WARN_DELTA} | cache=\$${CACHE_DELTA}" >> "$SNAPSHOT_DIR/results.log"
  INFO "Results appended to: $SNAPSHOT_DIR/results.log"
  exit 0
fi

# ══════════════════════════════════════════════════════════════════════════════
# Main static analysis
# ══════════════════════════════════════════════════════════════════════════════

HEADER "SECTION 1 — Pre-benchmark Health Checks"
for f in "$DELEGATION_STATE" "$BLACKBOX_STATE" "$MODEL_TIERS"; do
  if [[ -f "$f" ]]; then
    if node -e "JSON.parse(require('fs').readFileSync('$f','utf-8'))" 2>/dev/null; then
      OK "$(basename "$f") — valid JSON"
    else
      WARN "$(basename "$f") — invalid JSON (will auto-repair on read)"
    fi
  else
    WARN "$(basename "$f") — not found (first run)"
  fi
done

HEADER "Model Tiers Configuration"
TIERS=$(safe_json "$MODEL_TIERS")
BRAIN=$(echo "$TIERS" | node -e "var j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(j?.trinity?.brain?.oc||j?.brain||'not-set')")
MEDIUM=$(echo "$TIERS" | node -e "var j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(j?.trinity?.medium?.oc||j?.medium||'not-set')")
CHEAP=$(echo "$TIERS" | node -e "var j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(j?.trinity?.cheap?.oc||j?.cheap||'not-set')")
INFO "Brain:  $BRAIN"
INFO "Medium: $MEDIUM"
INFO "Cheap:  $CHEAP"
[[ "$MEDIUM" == "$BRAIN" && "$MEDIUM" != "not-set" ]] && WARN "Medium == Brain — SPEED mode has NO latency advantage"
[[ "$MEDIUM" == "$CHEAP" && "$MEDIUM" != "not-set" ]] && WARN "Medium == Cheap — SPEED costs as budget with no quality gain"

# ══════════════════════════════════════════════════════════════════════════════
HEADER "SECTION 2 — Mode Configuration Matrix"
printf "\n"
printf "  %-12s %-8s %-10s %-14s %-10s %-12s %-12s %-8s %-10s\n" \
  "MODE" "TIER" "THINKING" "ENFORCEMENT" "FLOW" "TDD" "LOOP_THRSH" "API" "STRESS"
printf "  %-12s %-8s %-10s %-14s %-10s %-12s %-12s %-8s %-10s\n" \
  "───────────" "──────" "────────" "────────────" "────────" "───────" "──────────" "──────" "──────"
for mode in balanced budget quality speed longrun; do
  case "$mode" in
    balanced) T="auto"   TH="auto"  EN="normal" FL="normal" TD="normal"  LT="0.6" API="yes" ST="1.0" ;;
    budget)   T="cheap"  TH="off"   EN="relaxed" FL="audit" TD="lazy"    LT="0.7" API="no"  ST="0.3" ;;
    quality)  T="brain"  TH="full"  EN="strict"  FL="strict" TD="quality" LT="0.4" API="yes" ST="2.0" ;;
    speed)    T="medium" TH="off"   EN="relaxed" FL="audit" TD="lazy"    LT="0.9" API="no"  ST="0.0" ;;
    longrun)  T="brain"  TH="brief" EN="strict"  FL="strict" TD="quality" LT="0.5" API="yes" ST="1.0" ;;
  esac
  printf "  ${BOLD}%-12s${RESET} %-8s %-10s %-14s %-10s %-12s %-12s %-8s %-10s\n" \
    "$mode" "$T" "$TH" "$EN" "$FL" "$TD" "$LT" "$API" "$ST"
done

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3: Generate Comprehensive Comparison Table
# ══════════════════════════════════════════════════════════════════════════════
HEADER "SECTION 3 — KPI Comparison Table"

mkdir -p "$REPORTS_DIR"

# Run the full KPI computation in a single Node.js pass
export REPORTS_DIR="$REPORTS_DIR"
export REPORT_FILE="$REPORT"
export DELEGATION_STATE="$DELEGATION_STATE"
export BLACKBOX_STATE="$BLACKBOX_STATE"
export MODEL_TIERS="$MODEL_TIERS"
export PROJECT_STATE="$PROJECT_STATE"
export GLOBAL_LEARNING="$GLOBAL_LEARNING"
export PRICING_CACHE="$PRICING_CACHE"
node <<'NODESCRIPT'
var fs = require('fs');
var h = require('os').homedir();
var reportsDir = process.env.REPORTS_DIR;
var reportFile = process.env.REPORT_FILE;

function readOrNull(p) {
  try { if(!fs.existsSync(p))return null; var r=fs.readFileSync(p,'utf-8'); var c=r.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*\$/gm,'').replace(/,\s*([}\]])/g,'\$1'); return JSON.parse(c); } catch(e){return null;}
}

var state = readOrNull(process.env.DELEGATION_STATE);
var bb    = readOrNull(process.env.BLACKBOX_STATE);
var tiers = readOrNull(process.env.MODEL_TIERS);
var proj  = readOrNull(process.env.PROJECT_STATE);
var learn = readOrNull(process.env.GLOBAL_LEARNING);
var price = readOrNull(process.env.PRICING_CACHE);

// ── Pricing estimates (per 1M tokens, blended in/out) ──
var PRICING = {
  'deepseek-v4-pro':   { prompt: 1.25, completion: 8.00 },
  'deepseek-v4-flash': { prompt: 0.25, completion: 1.00 },
  'deepseek-chat':     { prompt: 0.14, completion: 0.56 },
  'deepseek-reasoner': { prompt: 0.55, completion: 2.19 },
  'gpt-4o':            { prompt: 2.50, completion: 10.00 },
  'gpt-4o-mini':       { prompt: 0.15, completion: 0.60 },
  'claude-sonnet-4':   { prompt: 3.00, completion: 15.00 },
  'default':           { prompt: 1.00, completion: 4.00 },
};

function getPricing(modelId) {
  for (var k in PRICING) { if ((modelId||'').includes(k)) return PRICING[k]; }
  return PRICING.default;
}

var activeModels = {
  brain: tiers?.trinity?.brain?.oc || tiers?.brain || 'not-set',
  medium: tiers?.trinity?.medium?.oc || tiers?.medium || 'not-set',
  cheap: tiers?.trinity?.cheap?.oc || tiers?.cheap || 'not-set',
};

// ── Per-mode KPI computation ──
var MODES = ['balanced','budget','quality','speed','longrun'];
var modeData = {};
MODES.forEach(function(m){ modeData[m] = {
  sessions:0, cost:0, deleg_savings:0, cache_savings:0, warns:0,
  tool_calls:0, stress_sum:0, stress_count:0, scratchpad_hits:0,
  total_session_ms:0, context7_bypass:0, ledger_entries:0,
  task_calls:0, task_success:0, regime_changes:0,
  cost_per_turn:0, savings_ratio:0, warn_per_session:0,
  stress_avg:0, cache_hit_rate:0, cost_per_success:0,
  thinking_roi:0, speed_to_cost:0,
};});

// Aggregate sessions
var sessions = state?.sessions || {};
var sessionKeys = Object.keys(sessions).sort();
for (var sid of sessionKeys) {
  var ses = sessions[sid];
  var m = ses?.optimization_mode || 'balanced';
  if (!modeData[m]) continue;
  var md = modeData[m];
  md.sessions++;
  md.cost += Number(ses?.cost_usd || 0);
  md.cache_savings += Number(ses?.cache_savings_usd || 0);
  var warns = Array.isArray(ses?.warns) ? ses.warns : [];
  md.warns += warns.length;
  for (var w of warns) md.deleg_savings += Number(w?.est_savings_usd || 0);
  md.scratchpad_hits += Number(ses?.cache_hits?.length || ses?.scratchpad_hits || 0);
  md.stress_sum += Number(ses?.maxSessionStress || ses?.stress || 0);
  md.stress_count += (ses?.maxSessionStress != null || ses?.stress != null) ? 1 : 0;
  md.context7_bypass += Number(ses?.context7_bypasses || 0);
  var tools = ses?.tool_counts || {};
  for (var t in tools) md.tool_calls += Number(tools[t]||0);
}

// Compute derived metrics
for (var m of MODES) {
  var md = modeData[m];
  md.avg_cost_per_session = md.sessions > 0 ? +(md.cost / md.sessions).toFixed(5) : 0;
  md.cost_per_turn = md.sessions > 0 ? +(md.cost / Math.max(md.sessions, 1)).toFixed(5) : 0;
  md.savings_ratio = md.cost > 0 ? +(md.deleg_savings / md.cost).toFixed(4) : 0;
  md.warn_per_session = md.sessions > 0 ? +(md.warns / md.sessions).toFixed(1) : 0;
  md.stress_avg = md.stress_count > 0 ? +(md.stress_sum / md.stress_count).toFixed(2) : 0;
  md.cache_hit_rate = md.sessions > 0 ? +(md.scratchpad_hits / md.sessions).toFixed(1) : 0;

  // Token estimates (blended brain/medium/cheap pricing ~$2.50/M in, $10/M out average)
  var blendedIn  = 0.0025;   // per 1K tokens
  var blendedOut = 0.00625;  // per 1K tokens
  md.est_prompt_tokens   = md.sessions > 0 ? Math.round((md.cost * 0.7 / blendedIn) * 1000) : 0;
  md.est_completion_tokens = md.sessions > 0 ? Math.round((md.cost * 0.3 / blendedOut) * 1000) : 0;
  md.est_total_tokens     = md.est_prompt_tokens + md.est_completion_tokens;
  md.est_tok_per_session  = md.sessions > 0 ? Math.round(md.est_total_tokens / md.sessions) : 0;

  // Efficiency ratios
  var netCost = Math.max(md.cost - md.deleg_savings, 0.00001);
  md.cost_per_success = md.sessions > 0 ? +(netCost / md.sessions).toFixed(5) : 0;

  // Thinking ROI: quality(brain+full_thinking) vs speed(medium+off)
}

// Thinking ROI (quality vs speed thinking cost premium)
if (modeData.quality && modeData.speed && modeData.quality.sessions > 0 && modeData.speed.sessions > 0) {
  modeData.quality.thinking_roi = +(modeData.quality.avg_cost_per_session / Math.max(modeData.speed.avg_cost_per_session, 0.00001)).toFixed(2);
  modeData.speed.thinking_roi = 1.0;
  modeData.speed.speed_to_cost = modeData.budget && modeData.budget.sessions > 0 ? +(modeData.speed.avg_cost_per_session / Math.max(modeData.budget.avg_cost_per_session,0.00001)).toFixed(2) : -1;
  modeData.budget.speed_to_cost = -1; // budget is baseline for speed-to-cost
}

// Blackbox regime analysis
var regimeData = {};
var regimeModeMap = {}; // regime -> { mode: count }
if (bb?.sessions) {
  for (var sid of Object.keys(bb.sessions)) {
    var bses = bb.sessions[sid];
    var bstate = bses?.state || bses;
    var regime = bstate?.sub_regime || bstate?.currentRegime || 'UNKNOWN';
    regimeData[regime] = (regimeData[regime] || 0) + 1;
    var sMode = sessions[sid]?.optimization_mode || 'balanced';
    if (!regimeModeMap[regime]) regimeModeMap[regime] = {};
    regimeModeMap[regime][sMode] = (regimeModeMap[regime][sMode] || 0) + 1;
  }
}

// Learning stats
var learningStats = {
  exploratory_words: Object.keys(learn?.exploratory_words || {}).length,
  task_first_words: Object.keys(learn?.task_first_words || {}).length,
  ml_graph: learn?.ml_graph_raw ? 'present' : 'absent',
  ml_cache: learn?.ml_cache_raw ? 'present' : 'absent',
  cross_project_patterns: Object.keys(proj?.project_hashes || {}).length,
};

// Tier collisions
var tierCollisions = [];
if (activeModels.medium === activeModels.brain && activeModels.medium !== 'not-set')
  tierCollisions.push('medium == brain: SPEED has no latency advantage');
if (activeModels.medium === activeModels.cheap && activeModels.medium !== 'not-set')
  tierCollisions.push('medium == cheap: SPEED costs as budget with no advantage');

// Calibration flags
var calibrationFlags = [];
if (modeData.speed && modeData.budget && modeData.speed.sessions > 0 && modeData.budget.sessions > 0) {
  if (modeData.speed.avg_cost_per_session > modeData.budget.avg_cost_per_session)
    calibrationFlags.push({ severity:'high', flag:'SPEED costs MORE than BUDGET per session — miscalibrated',
      speed_avg: modeData.speed.avg_cost_per_session, budget_avg: modeData.budget.avg_cost_per_session });
}
if (modeData.quality && modeData.balanced && modeData.quality.sessions > 0 && modeData.balanced.sessions > 0) {
  if (modeData.quality.avg_cost_per_session <= modeData.balanced.avg_cost_per_session)
    calibrationFlags.push({ severity:'medium', flag:'QUALITY costs same/less than BALANCED — brain tier may be undervalued',
      quality_avg: modeData.quality.avg_cost_per_session, balanced_avg: modeData.balanced.avg_cost_per_session });
}
if (modeData.budget && modeData.budget.warn_per_session > 5)
  calibrationFlags.push({ severity:'low', flag:'BUDGET mode has high warning rate ('+modeData.budget.warn_per_session.toFixed(1)+'/session) — relaxed enforcement may be too loose' });
if (modeData.speed && (regimeData.LOOPING || 0) > 0) {
  var loopingPct = ((regimeData.LOOPING||0) / Math.max(Object.values(regimeData).reduce(function(a,b){return a+b},0),1) * 100);
  if (loopingPct > 15) calibrationFlags.push({ severity:'medium', flag:'Looping >15% of sessions ('+loopingPct.toFixed(1)+'%) — SPEED loop_threshold 0.9 may be too loose' });
}

// ── Print comparison table ──
var fmtUSD = function(v){ return '\$' + (+v).toFixed(4).padStart(8); };
var fmtInt = function(v){ return String(v||0).padStart(8); };
var fmtNum = function(v,n){ return (+v).toFixed(n||1).padStart(8); };
var fmtPct = function(v){ return (+v).toFixed(1)+'%'; };

var headers = ['METRIC','BAL','BUD','QUAL','SPEED','LONG'];
var rows = [];

function row(label, fn) {
  var r = [label.padEnd(30)];
  for (var m of MODES) r.push(fn(m));
  rows.push(r);
}

row('Sessions',          function(m){ return fmtInt(modeData[m].sessions); });
row('Total Cost',        function(m){ return fmtUSD(modeData[m].cost); });
row('Avg Cost / Session', function(m){ return fmtUSD(modeData[m].avg_cost_per_session); });
row('Delegation Savings',function(m){ return fmtUSD(modeData[m].deleg_savings); });
row('Cache Savings',     function(m){ return fmtUSD(modeData[m].cache_savings); });
row('Warnings',           function(m){ return fmtInt(modeData[m].warns); });
row('Warns / Session',   function(m){ return fmtNum(modeData[m].warn_per_session,1); });
row('Est. Total Tokens', function(m){ return fmtInt(modeData[m].est_total_tokens); });
row('Est. Prompt Tokens',function(m){ return fmtInt(modeData[m].est_prompt_tokens); });
row('Est. Compl. Tokens',function(m){ return fmtInt(modeData[m].est_completion_tokens); });
row('Est. Tok / Session',function(m){ return fmtInt(modeData[m].est_tok_per_session); });
row('Tool Calls',         function(m){ return fmtInt(modeData[m].tool_calls); });
row('Scratchpad Hits',   function(m){ return fmtInt(modeData[m].scratchpad_hits); });
row('Cache Hit Rate/ses',function(m){ return fmtNum(modeData[m].cache_hit_rate,1); });
row('Avg Stress (0-6)',  function(m){ return fmtNum(modeData[m].stress_avg,2); });
row('C7 Bypasses',       function(m){ return fmtInt(modeData[m].context7_bypass); });

// ── Print the table ──
var sep = '─'.repeat(30) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(10);
console.log('  ' + headers[0].padEnd(30) + '  ' + headers[1].padStart(8) + '  ' + headers[2].padStart(8) + '  ' + headers[3].padStart(8) + '  ' + headers[4].padStart(8) + '  ' + headers[5].padStart(8));
console.log('  ' + sep);
for (var r of rows) {
  console.log('  ' + r[0] + '  ' + r[1] + '  ' + r[2] + '  ' + r[3] + '  ' + r[4] + '  ' + r[5]);
}

// ── Efficiency ratios table ──
console.log('');
console.log('  ── EFFICIENCY RATIOS ──');
console.log('  ' + 'METRIC'.padEnd(30) + '  ' + 'BAL'.padStart(8) + '  ' + 'BUD'.padStart(8) + '  ' + 'QUAL'.padStart(8) + '  ' + 'SPEED'.padStart(8) + '  ' + 'LONG'.padStart(8));
console.log('  ' + sep);
console.log('  ' + 'Savings/Cost Ratio'.padEnd(30) + '  ' + fmtNum(modeData.balanced.savings_ratio,3) + '  ' + fmtNum(modeData.budget.savings_ratio,3) + '  ' + fmtNum(modeData.quality.savings_ratio,3) + '  ' + fmtNum(modeData.speed.savings_ratio,3) + '  ' + fmtNum(modeData.longrun.savings_ratio,3));
console.log('  ' + 'Net Cost/Session'.padEnd(30) + '  ' + fmtUSD(modeData.balanced.cost_per_success) + '  ' + fmtUSD(modeData.budget.cost_per_success) + '  ' + fmtUSD(modeData.quality.cost_per_success) + '  ' + fmtUSD(modeData.speed.cost_per_success) + '  ' + fmtUSD(modeData.longrun.cost_per_success));
if (modeData.quality.thinking_roi)
  console.log('  ' + 'Thinking ROI (vs SPEED)'.padEnd(30) + '  ' + '       -'.padStart(8) + '  ' + '       -'.padStart(8) + '  ' + (modeData.quality.thinking_roi+'x').padStart(8) + '  ' + '    1.0x'.padStart(8) + '  ' + '       -'.padStart(8));
if (modeData.speed.speed_to_cost > 0)
  console.log('  ' + 'Speed/Budget Cost Ratio'.padEnd(30) + '  ' + '       -'.padStart(8) + '  ' + '    1.0x'.padStart(8) + '  ' + '       -'.padStart(8) + '  ' + (modeData.speed.speed_to_cost+'x').padStart(8) + '  ' + '       -'.padStart(8));

// ── Regime Distribution ──
console.log('');
console.log('  ── REGIME DISTRIBUTION ──');
var regimeEntries = Object.entries(regimeData).sort(function(a,b){return b[1]-a[1]});
var regimeTotal = Object.values(regimeData).reduce(function(a,b){return a+b},0) || 1;
if (regimeEntries.length === 0) {
  console.log('  (no blackbox data yet)');
} else {
  for (var re of regimeEntries) {
    var pct = (re[1]/regimeTotal*100).toFixed(1);
    var modeBreakdown = regimeModeMap[re[0]] || {};
    var modeStr = Object.entries(modeBreakdown).map(function(e){return e[0]+':'+e[1]}).join(' ');
    console.log('  ' + re[0].padEnd(24) + ' ' + String(re[1]).padStart(4) + ' (' + pct + '%)  modes: ' + (modeStr || 'none'));
  }
}

// ── Learning / calibration ──
console.log('');
console.log('  ── META ──');
console.log('  Exploratory words learned:  ' + learningStats.exploratory_words);
console.log('  Task-first words learned:   ' + learningStats.task_first_words);
console.log('  ML graph:                   ' + learningStats.ml_graph);
console.log('  ML cache:                   ' + learningStats.ml_cache);
console.log('  Cross-project patterns:     ' + learningStats.cross_project_patterns);
console.log('  Pricing cache models:       ' + (price ? Object.keys(price).length : 0));
console.log('  Tier collisions:            ' + (tierCollisions.length ? tierCollisions.join('; ') : 'none'));
if (calibrationFlags.length) {
  console.log('  Calibration flags:');
  for (var cf of calibrationFlags) console.log('    [' + cf.severity + '] ' + cf.flag);
} else {
  console.log('  Calibration flags:          none');
}

// ── Expected rankings validation ──
console.log('');
console.log('  ── EXPECTED RANKING VALIDATION ──');
// Speed (latency): speed < budget < balanced < longrun < quality
// We can only validate cost-based rankings from state data
var costRanked = MODES.filter(function(m){return modeData[m].sessions>0}).sort(function(a,b){
  return modeData[a].avg_cost_per_session - modeData[b].avg_cost_per_session;
});
console.log('  Cost ranking (low→high): ' + costRanked.map(function(m){ return m.toUpperCase(); }).join(' < '));
var expectedCost = ['budget','speed','balanced','longrun','quality'];
var costOrderOk = JSON.stringify(costRanked) === JSON.stringify(expectedCost);
console.log('  Expected:              ' + expectedCost.map(function(m){return m.toUpperCase()}).join(' < '));
console.log('  Cost ranking valid?    ' + (costOrderOk ? 'YES' : 'NO — check mode configs'));

var savingsRanked = MODES.filter(function(m){return modeData[m].sessions>0}).sort(function(a,b){
  return modeData[b].savings_ratio - modeData[a].savings_ratio;
});
console.log('  Savings ratio ranking:  ' + savingsRanked.map(function(m){return m.toUpperCase()+'('+modeData[m].savings_ratio.toFixed(2)+')'}).join(' > '));

var warningRanked = MODES.filter(function(m){return modeData[m].sessions>0}).sort(function(a,b){
  return modeData[b].warn_per_session - modeData[a].warn_per_session;
});
console.log('  Warning rate ranking:   ' + warningRanked.map(function(m){return m.toUpperCase()+'('+modeData[m].warn_per_session.toFixed(1)+')'}).join(' > '));

// ── Write JSON report ──
var report = {
  meta: { generated_at: new Date().toISOString(), version: '2.0', schema: 'vibeos-mode-calibration-v2' },
  active_models: activeModels,
  tier_collisions: tierCollisions,
  pricing_estimates: PRICING,
  mode_configs: {
    balanced: { tier:'auto', thinking:'auto', enforcement:'normal', flow:'normal', tdd:'normal', stress:1.0, loop_threshold:0.6, api_enrichment:true, outcome_detection:true },
    budget:   { tier:'cheap', thinking:'off', enforcement:'relaxed', flow:'audit', tdd:'lazy', stress:0.3, loop_threshold:0.7, api_enrichment:false, outcome_detection:true },
    quality:  { tier:'brain', thinking:'full', enforcement:'strict', flow:'strict', tdd:'quality', stress:2.0, loop_threshold:0.4, api_enrichment:true, outcome_detection:true },
    speed:    { tier:'medium', thinking:'off', enforcement:'relaxed', flow:'audit', tdd:'lazy', stress:0.0, loop_threshold:0.9, api_enrichment:false, outcome_detection:false },
    longrun:  { tier:'brain', thinking:'brief', enforcement:'strict', flow:'strict', tdd:'quality', stress:1.0, loop_threshold:0.5, api_enrichment:true, outcome_detection:true },
  },
  mode_breakdown: modeData,
  regime_distribution: regimeData,
  regime_mode_map: regimeModeMap,
  learning_stats: learningStats,
  calibration_flags: calibrationFlags,
  expected_rankings: {
    cost_ranking: costRanked,
    cost_valid: costOrderOk,
    savings_ranking: savingsRanked,
    warning_ranking: warningRanked,
  },
  lifetime: {
    total_savings_usd: Number(state?.lifetime?.total_savings_usd || 0),
    cache_savings_usd: Number(state?.lifetime?.cache_savings_usd || 0),
    missed_context7_usd: Number(state?.lifetime?.missed_context7_usd || 0),
    scratchpad_hits: Number(state?.lifetime?.scratchpad_hits_observed || 0),
    warn_count: Number(state?.lifetime?.warn_count || 0),
    session_count: Object.keys(sessions).length,
    cost_sum: Object.values(sessions).reduce(function(a,s){return a+Number(s?.cost_usd||0)},0),
  },
  checklist: {
    speed_is_fastest_unverified: true,
    budget_is_cheapest_unverified: true,
    quality_best_output_unverified: true,
    longrun_appropriate_unverified: true,
    auto_mode_sensible_unverified: true,
    ttft_needs_live_bench: true,
    token_throughput_needs_live_bench: true,
    first_attempt_success_needs_live_bench: true,
    rework_cycles_needs_live_bench: true,
    compile_pass_rate_needs_live_bench: true,
    user_override_rate_needs_live_bench: true,
  }
};

fs.mkdirSync(reportsDir,{recursive:true});
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
console.log('');
console.log('  Report saved: ' + reportFile);
NODESCRIPT

# ══════════════════════════════════════════════════════════════════════════════
HEADER "SECTION 4 — Summary & Next Actions"
cat <<SUMMARY

  KPI comparison table generated. To fill in the missing live metrics:

  1. Live benchmark a task under each mode:
     bash scripts/benchmark-modes.sh --live speed   task1
     bash scripts/benchmark-modes.sh --live budget  task1
     bash scripts/benchmark-modes.sh --live quality task1
     bash scripts/benchmark-modes.sh --live longrun task1
     bash scripts/benchmark-modes.sh --live auto    task1

  2. Results logged to: $VIBEOS_DIR/bench-snapshots/results.log

  3. Metrics needing live capture (not in state files):
     - TTFT (time-to-first-token)
     - Token throughput (tok/sec)
     - Delegation round-trip time
     - First-attempt success rate
     - Compile/typecheck pass rate
     - Rework cycles per task
     - User mode-override rate

  4. Full report: $REPORT

SUMMARY
