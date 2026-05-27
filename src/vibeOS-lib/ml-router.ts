// ML-enhanced query router for vibeOS trinity routing.
// Pure TypeScript — no external ML dependencies.
//
// Features:
//   1. TF-IDF inspired query difficulty scoring
//   2. Confidence-aware model cascading (cheap → escalate if uncertain)
//   3. Interaction graph memory (query → model → outcome tracking)
//
// Integrates into src/index.js trinity routing for Task subagent model selection.

// ── Types ───────────────────────────────────────────────────────────

export interface QueryFeatures {
  length: number
  wordCount: number
  fileMentions: number
  errorSignals: number
  actionDensity: number
  argCount: number
  complexityWords: number
  questionDensity: number
}

export interface DifficultyResult {
  score: number
  level: "simple" | "moderate" | "complex"
  features: QueryFeatures
  confidence: number
  suggestedTier: "cheap" | "medium" | "brain"
}

export interface RouteEntry {
  queryHash: string
  firstWord: string
  chosenModel: string
  chosenTier: "cheap" | "medium" | "brain"
  success: boolean
  at: string
  queryWords: string[]
}

export interface PatternGraphNode {
  id: string
  kind: "query" | "model" | "outcome"
  count: number
  lastSeen: string
  edges: Record<string, number>
}

export interface PatternGraph {
  nodes: Record<string, PatternGraphNode>
  tiers: { cheap: string[]; medium: string[]; brain: string[] }
}

export interface MLError {
  ok: false
  error: string
}

// ── Constants ───────────────────────────────────────────────────────

const SIMPLE_ACTIONS = new Set([
  "check", "find", "list", "search", "look", "count", "show",
  "get", "read", "grep", "scan", "detect", "inspect", "ls",
  "cat", "head", "tail", "which", "where", "describe", "explain",
  "summarize", "what", "how", "does", "is", "are", "can", "will",
])

const COMPLEX_ACTIONS = new Set([
  "implement", "refactor", "migrate", "redesign", "architect",
  "optimize", "debug", "diagnose", "fix", "resolve", "patch",
  "build", "deploy", "integrate", "orchestrate", "pipeline",
  "benchmark", "profile", "secure", "harden", "audit",
  "design", "create", "generate", "transform", "convert",
  "setup", "configure", "provision", "bootstrap",
])

const ERROR_SIGNAL_WORDS = /\b(?:bug|error|fail|crash|broken|wrong|incorrect|issue|problem|exception|stackoverflow|traceback|segfault|race|deadlock|leak|corrupt)\b/g

const COMPLEXITY_INDICATORS = /multi.*(?:file|module|step|stage|phase|tenant|region|thread|process)|concurrent|async|parallel|distributed|replicated|shard|cluster|microservice|framework|database|schema|migration|backward.*compat|breaking.*change|api.*(?:version|breaking)|protocol|encoding|serializ/

const FILE_PATH_PATTERN = /(?:^|[\s"'(])\.{0,2}\/[a-zA-Z0-9._/-]+|\.(?:js|ts|tsx|jsx|py|rs|go|java|cpp|c|h|json|yaml|yml|toml|sql|css|html|md)\b|package\.json|tsconfig\.json|dockerfile|makefile|docker-compose/i

// ── Word frequency map (small pre-computed vocabulary) ──────────────

const WORD_FREQUENCY: Record<string, number> = {
  "test": 1, "tests": 1, "unit": 1, "integration": 1, "e2e": 1, "coverage": 1,
  "type": 0.9, "interface": 0.8, "class": 0.7, "function": 0.5, "method": 0.5,
  "async": 0.5, "await": 0.5, "promise": 0.5, "callback": 0.6,
  "import": 0.4, "export": 0.4, "require": 0.3, "module": 0.5,
  "api": 0.7, "endpoint": 0.7, "route": 0.6, "middleware": 0.7, "handler": 0.5,
  "database": 0.8, "query": 0.5, "migration": 0.8, "schema": 0.7, "index": 0.4,
  "docker": 0.7, "container": 0.7, "compose": 0.8, "kubernetes": 0.9, "deploy": 0.7,
  "ci": 0.7, "cd": 0.7, "pipeline": 0.7, "workflow": 0.4, "action": 0.3,
  "auth": 0.7, "authn": 0.9, "authz": 0.9, "token": 0.6, "jwt": 0.7, "oauth": 0.8,
  "security": 0.8, "vuln": 1, "exploit": 1, "injection": 0.9, "xss": 0.9, "csrf": 0.8,
  "cache": 0.6, "redis": 0.7, "memcache": 0.7, "persist": 0.6, "session": 0.5,
  "refactor": 0.7, "migrate": 0.8, "upgrade": 0.5, "deprecate": 0.6,
  "performance": 0.7, "latency": 0.7, "throughput": 0.8, "bottleneck": 0.8,
  "log": 0.3, "error": 0.4, "debug": 0.5, "trace": 0.6, "monitor": 0.5, "alert": 0.5,
  "commit": 0.3, "branch": 0.4, "merge": 0.4, "rebase": 0.5, "pr": 0.3, "review": 0.4,
  "npm": 0.3, "yarn": 0.3, "pnpm": 0.3, "install": 0.2, "build": 0.4, "lint": 0.4,
}

// ── Feature extraction ──────────────────────────────────────────────

export function extractFeatures(prompt: string): QueryFeatures {
  const s = String(prompt || "").trim()
  const words = s.split(/\s+/)
  const lower = s.toLowerCase()

  const fileMentions = (lower.match(FILE_PATH_PATTERN) || []).length
  const errorSignals = (lower.match(ERROR_SIGNAL_WORDS) || []).length

  let complexityWords = 0
  for (const w of words) {
    if (COMPLEXITY_INDICATORS.test(w.toLowerCase())) complexityWords++
  }

  let actionDensity = 0
  for (const w of words.slice(0, 8)) {
    if (COMPLEX_ACTIONS.has(w.toLowerCase())) {
      actionDensity += 0.15
    } else if (SIMPLE_ACTIONS.has(w.toLowerCase())) {
      actionDensity -= 0.05
    }
  }
  actionDensity = Math.max(0, Math.min(1, actionDensity))

  const questionDensity = (lower.match(/\?/g) || []).length / Math.max(1, words.length)

  return {
    length: s.length,
    wordCount: words.length,
    fileMentions,
    errorSignals,
    actionDensity,
    argCount: (s.match(/-{1,2}[a-zA-Z][\w-]*/g) || []).length,
    complexityWords,
    questionDensity,
  }
}

// ── TF-IDF inspired difficulty scoring ──────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

function wordComplexityScore(words: string[]): number {
  let score = 0
  let count = 0
  for (const w of words.slice(0, 20)) {
    const lw = w.toLowerCase()
    const freq = WORD_FREQUENCY[lw]
    if (freq !== undefined) {
      score += freq
      count++
    }
  }
  return count > 0 ? score / count : 0.3
}

export function computeDifficulty(prompt: string): DifficultyResult {
  const features = extractFeatures(prompt)
  const s = String(prompt || "").trim()
  const words = s.split(/\s+/)
  const lower = s.toLowerCase()

  let score = 0

  score += sigmoid((words.length - 20) / 30) * 0.20

  if (features.fileMentions >= 5) score += 0.12
  else if (features.fileMentions >= 3) score += 0.08
  else if (features.fileMentions >= 1) score += 0.04

  if (features.errorSignals >= 3) score += 0.15
  else if (features.errorSignals >= 1) score += 0.07

  score += features.actionDensity * 0.18

  if (features.complexityWords >= 4) score += 0.15
  else if (features.complexityWords >= 2) score += 0.08
  else if (features.complexityWords >= 1) score += 0.04

  score += features.questionDensity * 0.08
  score += sigmoid((features.argCount - 3) / 5) * 0.07

  const wcs = wordComplexityScore(words)
  score += wcs * 0.15

  const firstWord = words[0]?.toLowerCase() || ""
  if (COMPLEX_ACTIONS.has(firstWord)) score += 0.05

  let level: "simple" | "moderate" | "complex"
  if (score < 0.30) level = "simple"
  else if (score < 0.55) level = "moderate"
  else level = "complex"

  let suggestedTier: "cheap" | "medium" | "brain"
  if (level === "simple") suggestedTier = "cheap"
  else if (level === "moderate") suggestedTier = "medium"
  else suggestedTier = "brain"

  let confidence: number
  if (score < 0.15 || score > 0.75) confidence = 0.85
  else if (score < 0.25 || score > 0.65) confidence = 0.7
  else confidence = 0.5

  return { score, level, features, confidence, suggestedTier }
}

// ── Confidence-aware cascading ──────────────────────────────────────

export interface CascadeDecision {
  useCheap: boolean
  escalate: boolean
  confidence: number
  reason: string
  estimatedSavings: number
}

export function cascadeDecide(
  prompt: string,
  cheapModelCost: number,
  mediumModelCost: number,
  brainModelCost: number,
  cheapSuccessRate: number,
): CascadeDecision {
  const diff = computeDifficulty(prompt)

  if (diff.level === "simple" && diff.confidence >= 0.7) {
    const savings = brainModelCost - cheapModelCost
    return {
      useCheap: true, escalate: false, confidence: diff.confidence,
      reason: `simple query (difficulty ${diff.score.toFixed(2)})`,
      estimatedSavings: Math.max(0, savings),
    }
  }

  if (diff.level === "complex" && diff.confidence >= 0.7) {
    return {
      useCheap: false, escalate: true, confidence: diff.confidence,
      reason: `complex query (difficulty ${diff.score.toFixed(2)})`,
      estimatedSavings: 0,
    }
  }

  const expectedCheapCost = cheapModelCost / (cheapSuccessRate || 0.01)
  const cascadeCost = cheapModelCost + (1 - cheapSuccessRate) * brainModelCost

  if (expectedCheapCost < cascadeCost && diff.level !== "complex") {
    const savings = Math.max(0, brainModelCost - cheapModelCost)
    return {
      useCheap: true, escalate: true, confidence: diff.confidence,
      reason: `cascade: cheap (${cheapModelCost}) → escalate if fail`,
      estimatedSavings: savings * cheapSuccessRate,
    }
  }

  const tierCost = diff.level === "simple" ? cheapModelCost : mediumModelCost
  const savings = Math.max(0, brainModelCost - tierCost)
  return {
    useCheap: diff.level === "simple", escalate: diff.level !== "complex",
    confidence: diff.confidence,
    reason: `tier match: ${diff.level} (difficulty ${diff.score.toFixed(2)})`,
    estimatedSavings: savings,
  }
}

// ── Pattern graph memory ────────────────────────────────────────────

export function createPatternGraph(): PatternGraph {
  return {
    nodes: {},
    tiers: { cheap: [], medium: [], brain: [] },
  }
}

export function ensureNode(
  graph: PatternGraph,
  id: string,
  kind: "query" | "model" | "outcome",
): PatternGraphNode {
  graph.nodes[id] ??= { id, kind, count: 0, lastSeen: "", edges: {} }
  return graph.nodes[id]
}

export function addRouteEdge(
  graph: PatternGraph,
  queryWord: string,
  modelName: string,
  tier: string,
  success: boolean,
): void {
  const now = new Date().toISOString()
  const key = `${queryWord}::${modelName}`
  ensureNode(graph, queryWord, "query")
  ensureNode(graph, modelName, "model")
  const outcomeNode = ensureNode(graph, `${key}::${success ? "ok" : "fail"}`, "outcome")

  const queryNode = graph.nodes[queryWord]
  queryNode.count++
  queryNode.lastSeen = now
  queryNode.edges[modelName] = (queryNode.edges[modelName] || 0) + 1

  const modelNode = graph.nodes[modelName]
  modelNode.count++
  modelNode.lastSeen = now
  modelNode.edges[outcomeNode.id] = (modelNode.edges[outcomeNode.id] || 0) + 1

  outcomeNode.count++
  outcomeNode.lastSeen = now

  const normalizedTier: "cheap" | "medium" | "brain" =
    tier === "budget" || tier === "low" ? "cheap"
      : tier === "mid" ? "medium"
        : tier === "high" ? "brain"
          : (tier as "cheap" | "medium" | "brain")
  graph.tiers[normalizedTier] ??= []
  if (!graph.tiers[normalizedTier].includes(modelName)) {
    graph.tiers[normalizedTier].push(modelName)
    graph.tiers[normalizedTier].sort()
  }
}

export function predictBestModel(
  graph: PatternGraph,
  firstWord: string,
  tierPreference: "cheap" | "medium" | "brain",
): string | null {
  const node = graph.nodes[firstWord]
  if (!node || Object.keys(node.edges).length === 0) return null

  const edges = node.edges
  let bestModel = ""
  let bestScore = 0
  for (const [model, count] of Object.entries(edges)) {
    const modelNode = graph.nodes[model]
    if (!modelNode) continue
    const okEdges = Object.entries(modelNode.edges)
      .filter(([k]) => k.endsWith("::ok"))
      .reduce((sum, [, c]) => sum + c, 0)
    const totalEdges = Object.values(modelNode.edges).reduce((a, b) => a + b, 0) || 1
    const successRate = totalEdges > 0 ? okEdges / totalEdges : 0.5

    const tierBoost = graph.tiers.brain.includes(model) ? 0.1
      : graph.tiers.medium.includes(model) ? 0.05 : 0

    const prefBoost = model.includes(tierPreference) ? 0.05 : 0
    const score = count * 0.3 + successRate * 0.5 + tierBoost + prefBoost

    if (score > bestScore) {
      bestScore = score
      bestModel = model
    }
  }

  return bestModel || null
}

// ── Serialization helpers ───────────────────────────────────────────

export function serializeGraph(graph: PatternGraph): string {
  return JSON.stringify(graph)
}

export function deserializeGraph(raw: string): PatternGraph {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && parsed.nodes && parsed.tiers) {
      return parsed as PatternGraph
    }
  } catch {}
  return createPatternGraph()
}

// ── Query hashing for dedup ─────────────────────────────────────────

export function hashQuery(prompt: string): string {
  const s = String(prompt || "").trim().toLowerCase()
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    hash = ((hash << 5) - hash) + ch
    hash |= 0
  }
  return Math.abs(hash).toString(16).slice(0, 8)
}
