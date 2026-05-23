// SPDX-License-Identifier: MIT
// @ts-nocheck
export var TEMPLATES = {
  save: {
    tier_bias: "cheap",
    thinking_mode: "off",
    enforcement_mode: "relaxed",
    flow_mode: "audit",
    tdd_mode: "lazy",
    context7_urgency: "required",
    wbp_verbosity: "minimal",
    agent_mode: "auto",
    directive: "[SAVE mode] Cost efficiency. Minimize token usage. " +
      "Combine independent tool calls with && or ;. " +
      "Prefer context7 over WebSearch/WebFetch for docs. " +
      "Skip unnecessary verification. Batch parallel Task subagents."
  },
  quality: {
    tier_bias: "brain",
    thinking_mode: "full",
    enforcement_mode: "strict",
    flow_mode: "strict",
    tdd_mode: "save",
    context7_urgency: "preferred",
    wbp_verbosity: "verbose",
    agent_mode: "plan",
    directive: "[QUALITY mode] High quality output. " +
      "Full verification of all results. Production-grade code. " +
      "Write tests covering all paths and edge cases. " +
      "Validate outputs before presenting. Do not cut corners."
  },
  security: {
    tier_bias: "brain",
    thinking_mode: "brief",
    enforcement_mode: "strict",
    flow_mode: "strict",
    tdd_mode: "quality",
    context7_urgency: "preferred",
    wbp_verbosity: "normal",
    agent_mode: "plan",
    directive: "[SECURITY mode] Defense-in-depth. " +
      "Define the threat model before writing code. " +
      "Validate all inputs. Never expose secrets or credentials. " +
      "Verify each defense handles its threat. " +
      "Consider: injection, broken auth, data exposure, logic errors, race conditions."
  }
};

export var DEFAULT_TEMPLATE = "quality";

export function detectBudgetSignal(creditPercent) {
  return creditPercent < 40;
}

var _recentTools = [];
export function detectLoopSignal(toolName) {
  _recentTools.push(toolName);
  if (_recentTools.length > 8) _recentTools.shift();
  var last = _recentTools[_recentTools.length - 1];
  var count = _recentTools.filter(function(t) { return t === last; }).length;
  return count >= 3;
}

var _prevStress = 0;
export function detectStressSpike(stressScore) {
  var delta = stressScore - _prevStress;
  _prevStress = stressScore;
  return delta > 0.3 && stressScore > 0.5;
}

export function resolveTemplate(prevTemplate, stressScore, userText, creditPercent) {
  if (detectBudgetSignal(creditPercent)) return "save";
  if (detectStressSpike(stressScore)) return "quality";
  return prevTemplate || DEFAULT_TEMPLATE;
}

var _turnCount = 0;
export function shouldInjectTemplate(template, prevTemplate) {
  _turnCount++;
  if (template !== prevTemplate) return true;
  if (_turnCount % 10 === 0) return true;
  return false;
}

export function getTurnCount() {
  return _turnCount;
}
