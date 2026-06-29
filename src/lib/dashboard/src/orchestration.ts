type CapabilityState = {
  enabled: boolean
  provider?: string
  fixture_mode?: boolean
  benchmark_path?: string | null
  backend_status?: number | null
}

export type CapabilitiesPayload = {
  compression?: CapabilityState
  web_search?: CapabilityState
  tdd?: CapabilityState
  blackbox?: CapabilityState
  vibemax?: CapabilityState
  vibeqmax?: CapabilityState
  vibeultrax?: CapabilityState
}

type OrchestrationInput = {
  prompt?: string
  text?: string
  contextText?: string
  sourceContent?: string
  fileName?: string
  file_name?: string
  ext?: string
  extension?: string
  loopCount?: number
  loop_count?: number
  loopConsecutive?: number
  loop_consecutive?: number
  stressScore?: number
  stress_score?: number
  latest_stress_multiplier?: number
  capabilities?: CapabilitiesPayload
  skipCompression?: boolean
}

type OrchestrationStep = {
  tool: string
  label: string
  reason: string
  autoExecute: boolean
  requires: string[]
}

type OrchestrationPlan = {
  recommended_next_action: string
  recommended_label: string
  reason: string
  confidence: number
  steps: OrchestrationStep[]
  signals: Record<string, unknown>
  capabilities: Required<CapabilitiesPayload>
}

const DEFAULT_CAPABILITIES: Required<CapabilitiesPayload> = {
  compression: { enabled: true, provider: "local" },
  web_search: { enabled: true, provider: "duckduckgo" },
  tdd: { enabled: true, provider: "local" },
  blackbox: { enabled: true, provider: "local" },
  vibemax: { enabled: true, provider: "local" },
  vibeqmax: { enabled: true, provider: "local" },
  vibeultrax: { enabled: true, provider: "local" },
}

function normalizeText(value: unknown): string {
  return String(value || "").trim()
}

function lexicalScore(text: string) {
  const lower = text.toLowerCase()
  const wordCount = text.split(/\s+/).filter(Boolean).length
  const hasDebug = /\b(debug|bug|fix|error|issue|problem|null|undefined|crash|fault|wrong|broken)\b/i.test(lower)
  const hasComplex = /\b(refactor|optimize|migrate|architecture|design|implement|integrate|pattern|pipeline|deploy|orchestrate|analyze|analysis|proposal|explain|evaluate|review|compare|strategy|plan|recommend|roadmap|security|vulnerability|risk|assessment|\bai\b|complex|distributed|scale|performance|capacity)\b/i.test(lower)
  const hasCode = /\b(function|class|const|let|var|import|export|return|async|await|interface|type|enum)\b/i.test(lower)
  const hasUrgent = /\b(urgent|critical|crash|broken|fail|blocker|down|outage|incident)\b/i.test(lower)
  let score = 0.05
  if (wordCount <= 3 && !hasComplex && !hasCode && !hasDebug) score = 0.05
  else if (wordCount <= 10 && !hasComplex && !hasDebug && !hasCode && !hasUrgent) score = 0.25
  else if (wordCount <= 20 && !hasComplex && !hasDebug && !hasUrgent && !hasCode) score = 0.4
  else if (hasDebug || hasUrgent) score = 0.65
  else if (hasComplex || /```/.test(text) || /\b(implement|add|create|write|build|make|change|update|remove|delete|configure|set|run|test|audit|review|check)\b/gi.test(lower)) score = 0.8
  else score = 0.55
  return {
    score,
    signals: {
      hasDebug: hasDebug ? 1 : 0,
      hasComplexity: hasComplex ? 1 : 0,
      hasCode: hasCode ? 1 : 0,
      hasUrgency: hasUrgent ? 1 : 0,
      wordCount,
    },
  }
}

export function normalizeCapabilities(capabilities: CapabilitiesPayload = {}): Required<CapabilitiesPayload> {
  const item = (value: CapabilityState | undefined, fallbackProvider: string): CapabilityState => ({
    enabled: value?.enabled !== false,
    provider: value?.provider || fallbackProvider,
    fixture_mode: Boolean(value?.fixture_mode),
    benchmark_path: value?.benchmark_path || null,
    backend_status: value?.backend_status || null,
  })
  return {
    compression: item(capabilities.compression, "local"),
    web_search: item(capabilities.web_search, "duckduckgo"),
    tdd: item(capabilities.tdd, "local"),
    blackbox: item(capabilities.blackbox, "local"),
    vibemax: item(capabilities.vibemax, "local"),
    vibeqmax: item(capabilities.vibeqmax, "local"),
    vibeultrax: item(capabilities.vibeultrax, "local"),
  }
}

export function detectSignals(input: OrchestrationInput = {}) {
  const prompt = normalizeText(input.prompt || input.text)
  const contextText = normalizeText(input.contextText || input.sourceContent)
  const fileName = normalizeText(input.fileName || input.file_name)
  const ext = normalizeText(input.ext || input.extension)
  const combined = [prompt, contextText, fileName, ext].filter(Boolean).join("\n")
  const lower = combined.toLowerCase()
  const lex = lexicalScore(combined)
  const lineCount = combined ? combined.split("\n").length : 0
  const hasLongContext = Math.max(prompt.length, contextText.length) >= 2400 || lineCount >= 40
  const hasNoisyContext = lineCount >= 25 && (combined.match(/```/g)?.length || 0) > 1
  const hasCodeShape = /\b(function|class|const|let|var|import|export|interface|type|enum|schema|api|route|endpoint|module|service|component|hook|test|spec|params?|skeleton|mock|fixture)\b/i.test(lower) || combined.includes("```")
  const hasResearchSignal = /\b(latest|current|recent|today|this week|this month|now|up to date|up-to-date|release notes|docs|documentation|sources|citations|web search|search the web|look up|compare)\b/i.test(lower)
  const hasUnknownFactSignal = /\b(who|what|when|where|why|how many|is there|does|do we|can we|should we|could we)\b/i.test(lower)
  const hasLoopSignal = Number(input.loopCount || input.loop_count || input.loopConsecutive || input.loop_consecutive || 0) >= 2 || /\b(loop|stuck|again|repeating|same answer|not helping|circling|over and over|still not|you keep)\b/i.test(lower)
  const stressScore = Number(input.stressScore || input.stress_score || input.latest_stress_multiplier || 0)
  const hasStressSignal = stressScore >= 0.7 || /\b(urgent|critical|blocked|blocking|broken|failing|error|crash|outage|incident|hotfix|p0|p1)\b/i.test(lower) || lex.signals.hasUrgency === 1
  const needsTdd = hasCodeShape || Boolean(input.sourceContent) || Boolean(fileName) || Boolean(ext) || /\b(tdd|test first|tests first|skeleton|exports?|params?|infer type)\b/i.test(lower)
  const needsWebSearch = hasResearchSignal || hasUnknownFactSignal
  const needsCompression = hasLongContext || hasNoisyContext
  const needsEscalation = hasLoopSignal || hasStressSignal || /\b(ambiguous|unclear|uncertain|confusing|many moving parts|multi step|orchestrate|plan)\b/i.test(lower)

  return {
    prompt,
    contextText,
    fileName,
    ext,
    lineCount,
    lexical: lex,
    hasLongContext,
    hasNoisyContext,
    hasCodeShape,
    hasResearchSignal,
    hasUnknownFactSignal,
    hasLoopSignal,
    hasStressSignal,
    needsTdd,
    needsWebSearch,
    needsCompression,
    needsEscalation,
  }
}

function pushStep(steps: OrchestrationStep[], tool: string, label: string, reason: string, extra: Partial<OrchestrationStep> = {}) {
  steps.push({
    tool,
    label,
    reason,
    autoExecute: extra.autoExecute !== false,
    requires: extra.requires || [],
  })
}

export function buildOrchestrationPlan(input: OrchestrationInput = {}): OrchestrationPlan {
  const capabilities = normalizeCapabilities(input.capabilities || {})
  const signals = detectSignals(input)
  const steps: OrchestrationStep[] = []
  const mixedCodeAndResearch = signals.needsTdd && signals.needsWebSearch

  if (!input.skipCompression && signals.needsCompression && capabilities.compression.enabled) {
    pushStep(steps, "compress", "Compress context", "The prompt or context is long/noisy enough to compact before routing.", { requires: ["contextText"] })
  }

  if (mixedCodeAndResearch && capabilities.vibeultrax.enabled) {
    pushStep(steps, "vibeultrax", "Plan with VibeUltraX", "The request mixes code and research, so the learned router should break the ordering tie before helper calls.", { requires: [] })
  }

  const helperSteps: OrchestrationStep[] = []
  if (signals.needsWebSearch && capabilities.web_search.enabled) {
    helperSteps.push({ tool: "web-search", label: "Search the web", reason: "The request asks for current, cited, or externally verifiable information.", autoExecute: true, requires: ["query"] })
  }
  if (signals.needsTdd && capabilities.tdd.enabled) {
    helperSteps.push({ tool: "tdd", label: "Use TDD helpers", reason: "The request looks code-heavy, API-shaped, or test-driven.", autoExecute: true, requires: ["sourceContent"] })
  }

  if (helperSteps.length === 2 && mixedCodeAndResearch && capabilities.vibeultrax.enabled) {
    const codeFirst = signals.hasCodeShape
    const ordered = codeFirst ? [helperSteps[1], helperSteps[0]] : [helperSteps[0], helperSteps[1]]
    for (const step of ordered) {
      pushStep(steps, step.tool, step.label, step.reason, { requires: step.requires })
    }
  } else {
    for (const step of helperSteps) {
      pushStep(steps, step.tool, step.label, step.reason, { requires: step.requires })
    }
  }

  if (signals.needsEscalation && (capabilities.blackbox.enabled || capabilities.vibeqmax.enabled || capabilities.vibemax.enabled || capabilities.vibeultrax.enabled)) {
    const tool = signals.hasLoopSignal
      ? (capabilities.vibeqmax.enabled ? "vibeqmax" : capabilities.vibemax.enabled ? "vibemax" : "blackbox")
      : (capabilities.vibeultrax.enabled ? "vibeultrax" : capabilities.vibeqmax.enabled ? "vibeqmax" : capabilities.vibemax.enabled ? "vibemax" : "blackbox")
    pushStep(steps, tool, tool === "vibeultrax" ? "Escalate with VibeUltraX" : tool === "vibeqmax" ? "Escalate with VibeQMax" : tool === "vibemax" ? "Escalate with VibeMaX" : "Escalate through blackbox", "Use the blackbox stack to decide whether to stay cheap, escalate, or switch to research mode.", { requires: ["sessionId"] })
  }

  if (!steps.length) {
    pushStep(steps, "direct", "Handle directly", "The request is simple enough to answer without helper calls.", { autoExecute: false })
  }

  const primary = steps[0]
  const confidence = Math.max(0.1, Math.min(0.99,
    signals.hasLongContext || signals.hasNoisyContext ? 0.93 :
      signals.needsWebSearch ? 0.9 :
        signals.needsTdd ? 0.84 :
          signals.needsEscalation ? 0.82 : 0.72,
  ))

  return {
    recommended_next_action: primary.tool,
    recommended_label: primary.label,
    reason: primary.reason,
    confidence,
    steps,
    signals,
    capabilities,
  }
}

export function summarizeOrchestrationPlan(plan: OrchestrationPlan) {
  if (!plan?.steps?.length) return "Direct path"
  return `${plan.recommended_label}${plan.steps.length > 1 ? ` -> ${plan.steps.slice(1).map(step => step.label).join(" -> ")}` : ""}`
}
