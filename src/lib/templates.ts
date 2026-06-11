// SPDX-License-Identifier: MIT

export interface Template {
  tier_bias: string;
  thinking_mode: string;
  enforcement_mode: string;
  flow_mode: string;
  tdd_mode: string;
  context7_urgency: string;
  wbp_verbosity: string;
  agent_mode: string;
  directive: string;
}

export const TEMPLATES: Record<string, Template> = {
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
      "Skip unnecessary verification. Batch parallel Task subagents.",
  },
  quality: {
    tier_bias: "brain",
    thinking_mode: "full",
    enforcement_mode: "strict",
    flow_mode: "strict",
    tdd_mode: "quality",
    context7_urgency: "preferred",
    wbp_verbosity: "verbose",
    agent_mode: "plan",
    directive: "[QUALITY mode] High quality output. " +
      "Full verification of all results. Production-grade code. " +
      "Write tests covering all paths and edge cases. " +
      "Validate outputs before presenting. Do not cut corners.",
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
      "Consider: injection, broken auth, data exposure, logic errors, race conditions.",
  },
  speed: {
    tier_bias: "medium",
    thinking_mode: "off",
    enforcement_mode: "relaxed",
    flow_mode: "audit",
    tdd_mode: "lazy",
    context7_urgency: "preferred",
    wbp_verbosity: "minimal",
    agent_mode: "auto",
    directive: "[SPEED mode] Break the loop. Try a different approach. " +
      "Verify each step before proceeding. " +
      "If stuck, step back and reassess assumptions. " +
      "Do NOT repeat the same failing strategy. " +
      "Prioritize getting a working solution over optimal code. " +
      "Use Task subagents to parallelize exploration. " +
      "After 3 failed attempts, explicitly ask the user for guidance.",
  },
}

export const DEFAULT_TEMPLATE = "save"

const SEC_KEYWORDS = /\b(security|vuln|exploit|injection|xss|csrf|secret|credential|token leak|auth bypass|privacy|breach|backdoor|sql injection|cve)\b/i

export function detectSecuritySignal(text: string | undefined): boolean {
  if (!text || typeof text !== "string") return false
  return SEC_KEYWORDS.test(text)
}

export function detectBudgetSignal(creditPercent: number): boolean {
  return creditPercent < 40
}

const _recentTools: string[] = []
export function detectLoopSignal(toolName: string): boolean {
  _recentTools.push(toolName)
  if (_recentTools.length > 8) _recentTools.shift()
  const last = _recentTools[_recentTools.length - 1]
  const count = _recentTools.filter(t => t === last).length
  return count >= 3
}

let _prevStress = 0
export function detectStressSpike(stressScore: number): boolean {
  const delta = stressScore - _prevStress
  _prevStress = stressScore
  return delta > 0.3 && stressScore > 0.5
}

export function resolveTemplate(
  prevTemplate: string | null,
  stressScore: number,
  userText: string | undefined,
  creditPercent: number,
  subRegime?: string | null,
): string {
  if (detectSecuritySignal(userText)) return "security"
  if (detectBudgetSignal(creditPercent)) {
    // Only return "save" if not in LOOPING regime (looping needs quality focus, not cost-cutting)
    const regime = String(subRegime || "").toUpperCase()
    if (regime === "LOOPING" || regime === "DIVERGENT") return "speed" // Override: looping needs correction, not cost-cutting
    return "save"
  }
  if (detectStressSpike(stressScore)) return "quality"
  return prevTemplate || DEFAULT_TEMPLATE
}

let _turnCount = 0
export function shouldInjectTemplate(template: string, prevTemplate: string | null): boolean {
  _turnCount++
  if (template !== prevTemplate) return true
  if (_turnCount % 10 === 0) return true
  return false
}

export function getTurnCount(): number {
  return _turnCount
}
