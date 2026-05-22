// SPDX-License-Identifier: MIT
// @ts-nocheck

export function extractExports(sourceContent, ext) {
  if (!sourceContent || typeof sourceContent !== "string") return []
  const exports = []
  const seen = new Set()
  const add = (name, type = "function") => {
    if (name && !seen.has(name)) { seen.add(name); exports.push({ name, type }) }
  }

  switch (ext) {
    case "py": {
      for (const m of sourceContent.matchAll(/^def\s+([a-zA-Z]\w*)\s*\(/gm)) add(m[1])
      for (const m of sourceContent.matchAll(/^class\s+([a-zA-Z_]\w*)\s*[\(:]/gm)) add(m[1], "class")
      break
    }
    case "js": case "mjs": case "jsx": {
      for (const m of sourceContent.matchAll(/export\s+(?:async\s+)?function\s+([a-zA-Z_$]\w*)\s*\(/g)) add(m[1])
      for (const m of sourceContent.matchAll(/export\s+const\s+([a-zA-Z_$]\w*)\s*=/g)) add(m[1])
      if (exports.length === 0) {
        for (const m of sourceContent.matchAll(/^(?:async\s+)?function\s+([a-zA-Z_$]\w*)\s*\(/gm)) add(m[1])
      }
      break
    }
    case "ts": case "tsx": {
      for (const m of sourceContent.matchAll(/export\s+(?:async\s+)?function\s+([a-zA-Z_$]\w*)\s*\(/g)) add(m[1])
      for (const m of sourceContent.matchAll(/export\s+const\s+([a-zA-Z_$]\w*)\s*[:=]/g)) add(m[1])
      for (const m of sourceContent.matchAll(/export\s+class\s+([a-zA-Z_$]\w*)/g)) add(m[1], "class")
      break
    }
    case "go": {
      for (const m of sourceContent.matchAll(/func\s+(?:\([^)]+\)\s+)?([A-Z]\w*)\s*\(/g)) add(m[1])
      break
    }
    case "rs": {
      for (const m of sourceContent.matchAll(/pub\s+fn\s+([a-zA-Z_]\w*)\s*</g)) add(m[1])
      for (const m of sourceContent.matchAll(/pub\s+fn\s+([a-zA-Z_]\w*)\s*\(/g)) add(m[1])
      for (const m of sourceContent.matchAll(/pub\s+struct\s+([a-zA-Z_]\w*)/g)) add(m[1], "struct")
      break
    }
    case "rb": {
      for (const m of sourceContent.matchAll(/def\s+(?:self\.)?([a-zA-Z_]\w*[?!=]?)/g)) add(m[1])
      for (const m of sourceContent.matchAll(/class\s+([A-Z]\w*)/g)) add(m[1], "class")
      break
    }
    case "java": case "kt": {
      for (const m of sourceContent.matchAll(/(?:public|protected)\s+(?:static\s+)?(?:final\s+)?\S+\s+([a-zA-Z_$]\w*)\s*\(/g)) add(m[1])
      for (const m of sourceContent.matchAll(/fun\s+([a-zA-Z_$]\w*)\s*\(/g)) add(m[1])
      break
    }
    case "sh": {
      for (const m of sourceContent.matchAll(/^(?:function\s+)?([a-zA-Z_]\w*)\s*\(\)\s*\{/gm)) add(m[1])
      for (const m of sourceContent.matchAll(/^function\s+([a-zA-Z_]\w*)/gm)) add(m[1])
      break
    }
  }
  return exports
}

export function generateTestCaseNames(funcName, _type, quality = false) {
  const base = funcName.replace(/^[_$]+/, "")
  if (!quality) {
    return [
      `should ${base} with valid input`,
      `should handle invalid input for ${base}`,
      `should handle edge cases in ${base}`,
    ]
  }
  return [
    `${base}: works correctly with typical valid input`,
    `${base}: raises gracefully on invalid/malformed input`,
    `${base}: handles boundary and edge-case values`,
  ]
}

export function inferFunctionParams(sourceContent, funcName) {
  if (!sourceContent || !funcName) return []
  const patterns = [
    new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${funcName}\\s*\\(([^)]*)\\)`, 'm'),
    new RegExp(`(?:export\\s+)?const\\s+${funcName}\\s*[:=]\\s*(?:async\\s+)?\\(([^)]*)\\)`, 'm'),
    new RegExp(`(?:export\\s+)?const\\s+${funcName}\\s*[:=]\\s*(?:async\\s+)?function\\s*\\(([^)]*)\\)`, 'm'),
    new RegExp(`def\\s+${funcName}\\s*\\(([^)]*)\\)`, 'm'),
    new RegExp(`fun\\s+${funcName}\\s*\\(([^)]*)\\)`, 'm'),
  ]
  for (const pat of patterns) {
    const m = sourceContent.match(pat)
    if (m) {
      return m[1].split(',').map(s => {
        const trimmed = s.trim()
        if (!trimmed) return null
        const nameMatch = trimmed.match(/^\s*((?:public|protected)|static|final|val|var|let|const)?\s*(?:readonly\s+)?(?:[_$a-zA-Z][_$a-zA-Z0-9]*)\s*(?::|(?=\s*=)|(?=\s*[,)]))/)
        const rawName = trimmed.replace(/^[^a-zA-Z_$]*/, '').replace(/[=:].*$/, '').replace(/\s+.*$/, '').trim()
        const defaultMatch = trimmed.match(/=\s*(.+)$/)
        const typeMatch = trimmed.match(/:\s*(\w+)/)
        return {
          name: rawName || `arg${Math.random().toString(36).slice(2, 5)}`,
          type: typeMatch ? typeMatch[1] : null,
          defaultValue: defaultMatch ? defaultMatch[1].trim() : null,
        }
      }).filter(Boolean)
    }
  }
  return []
}

export function inferTypeFromName(paramName, defaultValue) {
  if (!paramName) return "any"
  const name = paramName.toLowerCase()
  if (defaultValue !== null && defaultValue !== undefined) {
    if (/^["']/.test(defaultValue)) return "string"
    if (/^\d+\.?\d*$/.test(defaultValue)) return "number"
    if (/^(true|false)$/i.test(defaultValue)) return "boolean"
    if (/^\[/.test(defaultValue)) return "array"
    if (/^\{/.test(defaultValue)) return "object"
    if (/^null$/i.test(defaultValue)) return "null"
  }
  if (/^(is|has|can|should|will|did|was|are|contains?_|[A-Z])/.test(name)) return "boolean"
  if (/^(count|index|limit|offset|max|min|size|length|total|num|age)_?/.test(name)) return "number"
  if (/^(name|title|label|msg|message|text|str|prefix|suffix|path|url|email|id)_?/.test(name)) return "string"
  if (/^(items|list|arr|entries|data|values|args)_?/.test(name)) return "array"
  if (/^(obj|config|opts|options|settings|params|props)_?/.test(name)) return "object"
  if (/^(fn|cb|callback|handler|on[A-Z])/.test(name)) return "function"
  return "any"
}

export function _langComment(lang) {
  const map = { py: "#", js: "//", mjs: "//", ts: "//", tsx: "//", jsx: "//", go: "//", rs: "//", rb: "#", sh: "#", java: "//", kt: "//" }
  return map[lang] || "//"
}

export function buildQualityAssertionsForFunc(funcName, params, lang, indent) {
  const cmt = _langComment(lang)
  const nl = lang === "py" || lang === "rb" || lang === "sh" ? "\n" : "\n"
  let block = ""

  const testValues = params.map(p => {
    const t = p.type || inferTypeFromName(p.name, p.defaultValue)
    if (t === "string" || t === "String") return '"sample_input"'
    if (t === "number" || t === "int" || t === "float" || t === "Number") return "42"
    if (t === "boolean" || t === "bool" || t === "Boolean") return "true"
    if (t === "array" || t === "Array" || t === "list" || t === "List") return "[]"
    if (t === "object" || t === "Object" || t === "dict" || t === "Dict") return "{}"
    if (t === "function" || t === "Function") return "() => {}"
    if (t === "any") return '"test"'
    if (t === "null") return "null"
    return '"test"'
  })

  const args = testValues.join(", ")

  switch (lang) {
    case "py": {
      block += `${indent}def test_${funcName}_valid_input():\n`
      block += `${indent}    """Assert ${funcName} runs with typical valid input."""\n`
      block += `${indent}    result = ${funcName}(${args})\n`
      block += `${indent}    assert result is not None\n\n`
      block += `${indent}def test_${funcName}_invalid_input():\n`
      block += `${indent}    """Assert ${funcName} raises on None/null input where applicable."""\n`
      block += `${indent}    with pytest.raises((TypeError, ValueError)):\n`
      block += `${indent}        ${funcName}(None)\n\n`
      block += `${indent}def test_${funcName}_edge_cases():\n`
      block += `${indent}    """Assert ${funcName} handles boundary values."""\n`
      const ecArgs = params.map(p => {
        const t = p.type || inferTypeFromName(p.name, p.defaultValue)
        if (t === "string") return '""'
        if (t === "number" || t === "int" || t === "float") return "0"
        return '"edge"'
      }).join(", ")
      block += `${indent}    result = ${funcName}(${ecArgs})\n`
      block += `${indent}    assert result is not None\n\n`
      break
    }
    case "js": case "mjs": case "ts": case "tsx": case "jsx": {
      const blkLang = (lang === "ts" || lang === "tsx") ? "it" : "test"
      block += `${indent}${blkLang}('${funcName}: handles valid input', () => {\n`
      block += `${indent}  const result = mod.${funcName}(${args});\n`
      block += `${indent}  expect(result).toBeDefined();\n`
      block += `${indent}});\n\n`
      block += `${indent}${blkLang}('${funcName}: rejects invalid input', () => {\n`
      block += `${indent}  // TODO: replace with expected error type\n`
      block += `${indent}  expect(() => mod.${funcName}(null)).toThrow();\n`
      block += `${indent}});\n\n`
      block += `${indent}${blkLang}('${funcName}: handles edge cases', () => {\n`
      const ecArgsJS = params.map(p => {
        const t = p.type || inferTypeFromName(p.name, p.defaultValue)
        if (t === "string") return '""'
        if (t === "number" || t === "int" || t === "float") return "0"
        if (t === "boolean") return "false"
        if (t === "array") return "[]"
        if (t === "object") return "{}"
        return "undefined"
      }).join(", ")
      block += `${indent}  const result = mod.${funcName}(${ecArgsJS});\n`
      block += `${indent}  expect(result).toBeDefined();\n`
      block += `${indent}});\n\n`
      break
    }
    default: {
      block += `${indent}${cmt} TODO: Quality assertion for ${funcName} — valid input\n`
      block += `${indent}${cmt} ${funcName}(${args}) should return expected result\n\n`
      block += `${indent}${cmt} TODO: Quality assertion for ${funcName} — invalid input\n`
      block += `${indent}${cmt} ${funcName}(null) should error gracefully\n\n`
      block += `${indent}${cmt} TODO: Quality assertion for ${funcName} — edge case\n`
      block += `${indent}${cmt} ${funcName}() with boundary values should not crash\n\n`
    }
  }
  return block
}

export function isSkeletonUseless(content) {
  if (!content) return true
  const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#') && !l.trim().startsWith('/*') && !l.trim().startsWith('*'))
  const todoLines = content.split('\n').filter(l => /TODO|placeholder|smoke|is exported|module loads/.test(l))
  const meaningfulLines = lines.filter(l => !/TODO|placeholder|smoke|is exported|module loads|throw new Error|raise AssertionError|pytest\.skip|assert.*true/.test(l))
  return meaningfulLines.length < 2
}
