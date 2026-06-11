// SPDX-License-Identifier: MIT
// @ts-nocheck

export function detectOutcomeSignal(text) {
  if (!text) return null
  if (/thank|perfect|exactly|that.?s it|works great|works perfectly|solved|fixed|awesome|you rock/i.test(text)) return "positive"
  if (/doesn.?t work|still broken|not working|incorrect|wrong|failed|error|useless|stuck/i.test(text)) return "negative"
  return null
}

export function scoreStress(text) {
  if (!text || typeof text !== "string") return 0
  const t = text.toLowerCase()
  let score = 0

  const aggressive = ["fuck","shit","bullshit","useless","wrong","bad","slow","broken","stupid","idiot","hell","damn","waste","annoying","terrible","hate"]
  for (const w of aggressive) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi")
    const hits = (t.match(re) || []).length
    score += hits * 0.18
  }

  const urgency = ["fix","now","fast","urgent","important","critical","hurry","immediately","asap","stressed","stress","frustrated","overwhelmed","panic","panicked","anxious"]
  for (const w of urgency) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi")
    const hits = (t.match(re) || []).length
    score += hits * 0.16
  }

  const negative = ["no","not","don't","can't","won't","doesn't","isn't","shouldn't","never","stop"]
  for (const w of negative) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi")
    const hits = (t.match(re) || []).length
    score += hits * 0.06
  }

  const capsAcronyms = new Set(["ai","ui","api","cli","ssh","dns","http","url","json","xml","css","html","sql","csv","yaml","ide","tdd","pr","ci","cd","env","os","sdk","gui","crud","rest","crlf","utf","ascii"])
  const words = text.split(/\s+/)
  for (const w of words) {
    if (w.length >= 3 && /^[A-Z]+$/.test(w) && !capsAcronyms.has(w.toLowerCase())) {
      score += 0.05
    }
  }

  const exclamParts = text.match(/!{2,}/g)
  if (exclamParts) score += exclamParts.length * 0.08

  const qmarkParts = text.match(/\?{2,}/g)
  if (qmarkParts) score += qmarkParts.length * 0.05

  const qeCombos = text.match(/\?!|!\?/g)
  if (qeCombos) score += qeCombos.length * 0.1

  if (text.length < 30) score += 0.06
  else if (text.length < 80) score += 0.05
  else if (text.length < 150) score += 0.03

  return Math.min(score, 0.95)
}

export function estimateContextBudget(_input, output) {
  try {
    const DEFAULT_CONTEXT_LIMIT = 128000
    const CHARS_PER_TOKEN = 4
    let totalChars = 0
    const messages = output?.messages
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        const parts = msg?.parts
        if (!Array.isArray(parts)) continue
        for (const part of parts) {
          if (part?.type === "text" && typeof part.text === "string") {
            totalChars += part.text.length
          } else if (part?.type === "tool" && typeof part.state?.output === "string") {
            totalChars += part.state.output.length
          }
        }
      }
    }
    const systemParts = output?.system
    if (Array.isArray(systemParts)) {
      for (const s of systemParts) {
        if (typeof s === "string") totalChars += s.length
      }
    }
    const estimatedTokens = Math.round(totalChars / CHARS_PER_TOKEN)
    const pct = Math.round((estimatedTokens / DEFAULT_CONTEXT_LIMIT) * 100)
    return { estimatedTokens, pct, totalChars }
  } catch {
    return null
  }
}

export function classifyTurnSimple(userText) {
  const lower = String(userText || "").trim()
  if (!lower) return "INIT"
  if (/(security|vulnerability|audit|owasp|compliance|gdpr|privacy|analyze dependencies|license audit|xss|csrf|authn|authz|pentest)/i.test(lower)) {
    return "AUDIT"
  }
  if (/(inject|exploit|penetration|cve|attack|threat|encrypt|forensic|research|deep analysis|investigate|root cause|reverse engineer|disassemble|memory dump|core dump)/i.test(lower)) {
    return "FORENSIC"
  }
  const IMPL_VERBS = "fix|write|create|build|implement|change|edit|modify|update|refactor|generate|delete|remove|migrate|deploy|commit|push"
  // "can you fix/rewrite/..." are implementation requests phrased as questions
  if (new RegExp("^(can you|could you|tell me|we should|we need to|please) (" + IMPL_VERBS + ")\\b", "i").test(lower)) {
    return "REFINING"
  }
  // "I need to fix/update/..." — implementation intent
  if (new RegExp("^I (need|want|would like) to (" + IMPL_VERBS + ")\\b", "i").test(lower)) {
    return "REFINING"
  }
  // Problem-description patterns — user is investigating/reporting, not commanding
  if (/^(the |there is |there are |i think |looks like |seems like |i see |why (is|are|does|did) )/i.test(lower)) {
    return "EXPLORING"
  }
  // Q&A / research patterns -> EXPLORING
  if (/^(how|what|why|when|where|who|can you|could you|let me|tell me|explain|describe|show|list|check|is there|are there|does|do you|summarize|elaborate|clarify|inspect|trace|find|search|look|read|show me|dump|debug)/i.test(lower)) {
    return "EXPLORING"
  }
  // Full-text scan for implementation verbs — catches "I need to fix", "we should fix" without leading patterns
  if (new RegExp("\\b(" + IMPL_VERBS + ")\\b", "i").test(lower)) {
    return "REFINING"
  }
  // Implementation / write patterns (leading verb) -> REFINING
  if (/^(write|create|add|build|implement|fix|change|edit|modify|update|refactor|generate|make|commit|push|deploy|release|publish|install|remove|delete|rename|move|copy|transform|convert|migrate)/i.test(lower)) {
    return "REFINING"
  }
  return "INIT"
}

export function tokenizeWords(text) {
  if (!text || typeof text !== "string") return []
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w.length > 2)
}

export function topKeywords(text, max = 10) {
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "your", "you", "are", "but", "not", "all", "can", "use", "was", "have", "has", "had", "they", "them", "their", "then", "than", "when", "what", "why", "how", "who", "will", "would", "should", "about", "check", "make", "build", "write", "edit", "file", "code", "test", "tests", "run"])
  const freq = new Map()
  for (const w of tokenizeWords(text)) {
    if (stop.has(w)) continue
    freq.set(w, (freq.get(w) || 0) + 1)
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w)
}

export function extractLastUserText(obj) {
  if (!obj || typeof obj !== "object") return null
  const candidates = []
  const scan = (v) => {
    if (!v || typeof v !== "object") return
    if (Array.isArray(v)) {
      for (const i of v) scan(i)
      return
    }
    if (v.role === "user" && typeof v.content === "string") candidates.push(v.content)
    if (typeof v.text === "string") candidates.push(v.text)
    for (const val of Object.values(v)) scan(val)
  }
  scan(obj)
  if (!candidates.length) return null
  return candidates[candidates.length - 1]
}

export function isUserAskingForTests(text) {
  if (!text || typeof text !== "string") return false
  return /\b(test|tests|typecheck|coverage|qa|regression|e2e|unit test|integration test)\b/i.test(text)
}

export function isLikelyOffTopic(userText, job) {
  if (!userText || !job?.keywords?.length) return false
  if (/\b(new task|switch task|different task|ignore previous|start over)\b/i.test(userText)) return false
  const now = Date.now()
  const updatedAt = Date.parse(job.updatedAt || "")
  if (!Number.isFinite(updatedAt) || now - updatedAt > 2 * 60 * 60 * 1000) return false
  const userWords = new Set(topKeywords(userText, 12))
  const overlap = job.keywords.filter((k) => userWords.has(k))
  return overlap.length === 0 && userWords.size >= 3
}
