const VERBOSE_LINE_RE = [
  /^\s*(Sure|Certainly|Absolutely|Of course|Great question)[!.,]?\s*$/i,
  /^\s*(Hope this helps|Let me know if|Feel free to|Happy to|Please let me know).*$/i,
  /^\s*(I'd be happy|I can help|I'm here|Is there anything|Do you need).*$/i,
]

const BULLET_PATTERNS = [
  /^\s*\w[^:]{0,80}:/,
  /^\s*[-*\u2022]\s/,
  /^\s*\d+\.\s/,
  /^\s*(NOTE|TIP|IMPORTANT|WARNING|FIX|TODO|HACK)\b/i,
  /^\s*[A-Z][A-Z\s_-]{4,}:\s/,
  /^\s*>\s/,
  /^\s*```\w*$/,
  /^\s*#{1,6}\s/,
]

const COMPRESS_RATIO = 0.30
const COMPRESS_THRESHOLD = 2000
const MIN_KEPT_LINES_RATIO = 0.40

function compressText(text) {
  if (!text || typeof text !== "string" || text.length <= COMPRESS_THRESHOLD) {
    return text
  }

  let lines = text.split("\n")

  lines = lines.filter(line => {
    return !VERBOSE_LINE_RE.some(re => re.test(line))
  })

  let result = lines.join("\n")
  result = result.replace(/\n{3,}/g, "\n\n")

  lines = result.split("\n")
  const originalCharCount = result.length
  const targetChars = Math.ceil(originalCharCount * COMPRESS_RATIO)
  const minLines = Math.ceil(lines.length * MIN_KEPT_LINES_RATIO)

  if (originalCharCount > targetChars && lines.length > minLines) {
    lines = extractBulletLines(lines, targetChars, minLines)
  }

  result = lines.join("\n")

  if (result.length > originalCharCount * 0.6) {
    result = safetyTruncate(result, Math.ceil(originalCharCount * 0.5))
  }

  if (!result.trim() && text.trim()) {
    return text.split("\n").slice(0, Math.max(5, Math.ceil(text.split("\n").length * 0.2))).join("\n")
  }

  return result
}

function extractBulletLines(lines, targetChars, minLines) {
  const keyLines = []
  const otherLines = []

  for (const line of lines) {
    if (BULLET_PATTERNS.some(re => re.test(line))) {
      keyLines.push(line)
    } else {
      otherLines.push(line)
    }
  }

  const selected = [...keyLines]

  for (const line of otherLines) {
    if (selected.length >= minLines && selected.join("\n").length >= targetChars) {
      break
    }
    selected.push(line)
  }

  while (selected.length > minLines && selected.join("\n").length > targetChars * 2) {
    selected.pop()
  }

  return selected
}

function safetyTruncate(text, maxChars) {
  if (text.length <= maxChars) return text

  const lines = text.split("\n")
  const selected = []
  let charCount = 0

  for (const line of lines) {
    if (charCount + line.length > maxChars && selected.length >= 3) {
      break
    }
    selected.push(line)
    charCount += line.length + 1
  }

  return selected.join("\n")
}

function compressToolOutput(output, threshold = COMPRESS_THRESHOLD) {
  if (!output || typeof output !== "string" || output.length <= threshold) {
    return { compressed: false, content: output, original_length: output?.length || 0 }
  }

  const compressed = compressText(output)
  return {
    compressed: true,
    content: compressed,
    original_length: output.length,
    compressed_length: compressed.length,
    savings_percent: Math.round((1 - compressed.length / output.length) * 100),
  }
}

export { compressText, compressToolOutput, extractBulletLines, COMPRESS_THRESHOLD, COMPRESS_RATIO }
