const DEFAULT_TEMPLATE = "save"

const SECURITY_RE = /\b(security|vuln|exploit|injection|xss|csrf|secret|credential|token leak|auth bypass|privacy|breach|backdoor|sql injection|cve)\b/i

let _recentTools: string[] = []
let _prevStress = 0
let _turnCount = 0

export function detectSecuritySignal(text: string | undefined): boolean {
  if (!text || typeof text !== "string") return false
  return SECURITY_RE.test(text)
}

export function detectBudgetSignal(creditPercent: number): boolean {
  return creditPercent < 40
}

export function detectLoopSignal(toolName: string): boolean {
  _recentTools.push(toolName)
  if (_recentTools.length > 8) _recentTools.shift()
  const last = _recentTools[_recentTools.length - 1]
  const count = _recentTools.filter((t) => t === last).length
  return count >= 3
}

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
    const regime = String(subRegime || "").toUpperCase()
    if (regime === "LOOPING" || regime === "DIVERGENT") return "quality"
    return DEFAULT_TEMPLATE
  }
  if (detectStressSpike(stressScore)) return "quality"
  return prevTemplate || DEFAULT_TEMPLATE
}

export function shouldInjectTemplate(template: string, prevTemplate: string | null): boolean {
  _turnCount++
  if (template !== prevTemplate) return true
  if (_turnCount % 10 === 0) return true
  return false
}

export function getTurnCount(): number {
  return _turnCount
}

export function resetSessionPolicyStateForTest(): void {
  _recentTools = []
  _prevStress = 0
  _turnCount = 0
}
