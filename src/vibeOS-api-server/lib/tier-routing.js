const FALLBACK_HIGH = /opus|gemini-.*-pro|deepseek\/deepseek-v4-pro|gpt-5|(^|\/)o[134]($|-|\/)/i
const FALLBACK_MID = /deepseek\/deepseek-v4-flash|claude.*sonnet|gemini-.*-flash|gpt-4o(?!-mini)/i

const BASE_EXPLORATORY = new Set([
  "check", "find", "list", "search", "does", "verify", "look", "count",
  "show", "get", "read", "grep", "scan", "detect", "inspect"
])

function classify(model, customRegex = null) {
  const s = String(model || "").toLowerCase()
  const highRe = customRegex?.high ? new RegExp(customRegex.high, "i") : FALLBACK_HIGH
  const midRe = customRegex?.mid ? new RegExp(customRegex.mid, "i") : FALLBACK_MID
  if (highRe.test(s)) return "high"
  if (midRe.test(s)) return "mid"
  return "budget"
}

function routeModel(prompt, currentTier, trinityCheap, trinityMedium, learnedExploratory = [], stressScore = 0) {
  const firstWord = prompt.split(/\s+/)[0]?.toLowerCase() || ""

  const exploratory = new Set([...BASE_EXPLORATORY, ...(learnedExploratory || [])])
  const isExploratory = exploratory.has(firstWord)

  if (isExploratory && trinityCheap) {
    return { target: trinityCheap, reason: "exploratory_first_word", word: firstWord }
  }

  if (currentTier === "high" && trinityMedium) {
    let target = trinityMedium

    if (trinityCheap && stressScore > 0.5) {
      target = trinityCheap
      return { target, reason: "stress_aware_downgrade", stress_score: stressScore }
    }

    return { target, reason: "medium_fallback" }
  }

  return { target: trinityCheap || null, reason: "default_cheap" }
}

function isExploratoryPrompt(prompt, learnedExploratory = []) {
  const firstWord = prompt.split(/\s+/)[0]?.toLowerCase() || ""
  const exploratory = new Set([...BASE_EXPLORATORY, ...(learnedExploratory || [])])
  return { is_exploratory: exploratory.has(firstWord), first_word: firstWord }
}

export { classify, routeModel, isExploratoryPrompt, BASE_EXPLORATORY }
