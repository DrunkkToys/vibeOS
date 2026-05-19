const AGGRESSIVE_WORDS = [
  "fuck", "shit", "bullshit", "useless", "wrong", "bad", "slow", "broken",
  "stupid", "idiot", "hell", "damn", "waste", "annoying", "terrible", "hate"
]

const URGENCY_WORDS = [
  "fix", "now", "fast", "urgent", "important", "critical", "hurry", "immediately", "asap"
]

const NEGATIVE_WORDS = [
  "no", "not", "don't", "can't", "won't", "doesn't", "isn't", "shouldn't", "never", "stop"
]

const CAPS_ACRONYMS = new Set([
  "ai", "ui", "api", "cli", "ssh", "dns", "http", "url", "json", "xml",
  "css", "html", "sql", "csv", "yaml", "ide", "tdd", "pr", "ci", "cd",
  "env", "os", "sdk", "gui", "crud", "rest", "crlf", "utf", "ascii"
])

function scoreStress(text) {
  if (!text || typeof text !== "string") return 0

  const t = text.toLowerCase()
  let score = 0

  for (const w of AGGRESSIVE_WORDS) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi")
    const hits = (t.match(re) || []).length
    score += hits * 0.05
  }

  for (const w of URGENCY_WORDS) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi")
    const hits = (t.match(re) || []).length
    score += hits * 0.04
  }

  for (const w of NEGATIVE_WORDS) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi")
    const hits = (t.match(re) || []).length
    score += hits * 0.02
  }

  const words = text.split(/\s+/)
  for (const w of words) {
    if (w.length >= 3 && /^[A-Z]+$/.test(w) && !CAPS_ACRONYMS.has(w.toLowerCase())) {
      score += 0.03
    }
  }

  const exclamParts = text.match(/!{2,}/g)
  if (exclamParts) score += exclamParts.length * 0.05

  const qmarkParts = text.match(/\?{2,}/g)
  if (qmarkParts) score += qmarkParts.length * 0.03

  const qeCombos = text.match(/\?!|!\?/g)
  if (qeCombos) score += qeCombos.length * 0.08

  if (text.length < 30) score += 0.10
  else if (text.length < 80) score += 0.05
  else if (text.length < 150) score += 0.02

  return Math.min(score, 1.0)
}

function getStressLevel(score) {
  if (score > 0.7) return { level: "critical", gauge: "\u2588", directive: "CRITICAL: User is highly stressed. Prioritize quick, actionable responses. Avoid lengthy explanations." }
  if (score > 0.4) return { level: "elevated", gauge: "\u2586\u2588", directive: "Elevated stress detected. Be concise and solution-focused." }
  if (score > 0.2) return { level: "moderate", gauge: "\u2584\u2586\u2588", directive: null }
  return { level: "calm", gauge: "\u2581\u2582\u2583\u2585\u2586\u2588", directive: null }
}

function buildStressFooter(score) {
  const { level, gauge } = getStressLevel(score)
  const bar = score > 0.7 ? "\u2588\u2588\u2588\u2588\u2588"
    : score > 0.5 ? "\u2584\u2585\u2586\u2588\u2588"
    : score > 0.3 ? "\u2582\u2583\u2584\u2585\u2586"
    : score > 0.1 ? "\u2581\u2582\u2583\u2584\u2585"
    : "\u2581\u2581\u2581\u2581\u2581"
  return `stress: [${bar}] (${level})`
}

export { scoreStress, getStressLevel, buildStressFooter, AGGRESSIVE_WORDS, URGENCY_WORDS, NEGATIVE_WORDS }
