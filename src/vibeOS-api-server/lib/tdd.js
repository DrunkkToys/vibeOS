function extractExports(sourceContent, ext) {
  if (!sourceContent || typeof sourceContent !== "string") return []
  const exports = []
  const seen = new Set()
  const add = (name, type = "function") => {
    if (name && !seen.has(name)) { seen.add(name); exports.push({ name, type }) }
  }

  switch (ext) {
    case "py": {
      const defRe = /^def\s+([a-zA-Z_]\w*)\s*\(/gm
      const classRe = /^class\s+([a-zA-Z_]\w*)/gm
      let m
      while ((m = defRe.exec(sourceContent)) !== null) add(m[1], "function")
      while ((m = classRe.exec(sourceContent)) !== null) add(m[1], "class")
      break
    }
    case "js": case "mjs": case "jsx": {
      const funcRe = /^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$]\w*)\s*\(/gm
      const constRe = /^(?:export\s+)?const\s+([a-zA-Z_$]\w*)\s*[:=]\s*(?:async\s+)?(?:\(|function)/gm
      let m
      while ((m = funcRe.exec(sourceContent)) !== null) add(m[1], "function")
      while ((m = constRe.exec(sourceContent)) !== null) add(m[1], "function")
      break
    }
    case "ts": case "tsx": {
      const funcRe = /^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$]\w*)\s*\(/gm
      const constRe = /^(?:export\s+)?const\s+([a-zA-Z_$]\w*)\s*[:=]\s*(?:async\s+)?(?:\(|function)/gm
      const classRe = /^(?:export\s+)?class\s+([a-zA-Z_$]\w*)/gm
      let m
      while ((m = funcRe.exec(sourceContent)) !== null) add(m[1], "function")
      while ((m = constRe.exec(sourceContent)) !== null) add(m[1], "function")
      while ((m = classRe.exec(sourceContent)) !== null) add(m[1], "class")
      break
    }
    case "go": {
      const funcRe = /^func\s+(?:\([^)]+\)\s+)?([a-zA-Z_]\w*)\s*\(/gm
      let m
      while ((m = funcRe.exec(sourceContent)) !== null) add(m[1], "function")
      break
    }
    case "rs": {
      const fnRe = /^pub\s+(?:async\s+)?fn\s+([a-zA-Z_]\w*)\s*[<(]/gm
      const structRe = /^pub\s+struct\s+([a-zA-Z_]\w*)/gm
      let m
      while ((m = fnRe.exec(sourceContent)) !== null) add(m[1], "function")
      while ((m = structRe.exec(sourceContent)) !== null) add(m[1], "struct")
      break
    }
    case "rb": {
      const defRe = /^\s*def\s+(?:self\.)?([a-zA-Z_]\w*[!?=]?)/gm
      const classRe = /^\s*class\s+([a-zA-Z_]\w*)/gm
      let m
      while ((m = defRe.exec(sourceContent)) !== null) add(m[1], "function")
      while ((m = classRe.exec(sourceContent)) !== null) add(m[1], "class")
      break
    }
    case "java": case "kt": {
      const methodRe = /^\s*(?:public|protected|private|\s)+\s+(?:static\s+)?(?:final\s+)?\w+\s+([a-zA-Z_]\w*)\s*\(/gm
      const funRe = /^\s*(?:fun)\s+([a-zA-Z_]\w*)\s*[<(]/gm
      let m
      while ((m = ext === "kt" ? funRe.exec(sourceContent) : methodRe.exec(sourceContent)) !== null) add(m[1], "function")
      break
    }
    case "sh": {
      const funcRe = /^(?:function\s+)?([a-zA-Z_]\w*)\s*\(\)/gm
      let m
      while ((m = funcRe.exec(sourceContent)) !== null) add(m[1], "function")
      break
    }
  }
  return exports
}

function inferFunctionParams(sourceContent, funcName) {
  if (!sourceContent || !funcName) return []
  const patterns = [
    new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${escapeRegex(funcName)}\\s*\\(([^)]*)\\)`, "m"),
    new RegExp(`(?:export\\s+)?const\\s+${escapeRegex(funcName)}\\s*[:=]\\s*(?:async\\s+)?\\(([^)]*)\\)`, "m"),
    new RegExp(`def\\s+${escapeRegex(funcName)}\\s*\\(([^)]*)\\)`, "m"),
    new RegExp(`func\\s+(?:\\([^)]+\\)\\s+)?${escapeRegex(funcName)}\\s*\\(([^)]*)\\)`, "m"),
    new RegExp(`(?:pub\\s+)?fn\\s+${escapeRegex(funcName)}\\s*[<\\(]([^)]*)\\)`, "m"),
  ]

  for (const pat of patterns) {
    const m = sourceContent.match(pat)
    if (m) {
      return m[1].split(",").map(s => {
        const trimmed = s.trim()
        if (!trimmed) return null
        const parts = trimmed.split(":").map(p => p.split("="))
        const name = parts[0][0]?.trim().replace(/^[*&]/, "")
        const type = parts[0][1]?.trim() || inferTypeFromName(name, parts[0][0]?.split("=")[1]?.trim())
        const defaultValue = parts[0][1]?.includes("=") ? parts[0][0].split("=")[1]?.trim() : (parts[1]?.join("=").trim())
        return name ? { name, type: type || "any", defaultValue } : null
      }).filter(Boolean)
    }
  }
  return []
}

function inferTypeFromName(paramName, defaultValue) {
  if (!paramName) return "any"
  const name = paramName.toLowerCase()

  if (defaultValue !== undefined) {
    if (typeof defaultValue === "string") {
      if (defaultValue === "true" || defaultValue === "false") return "boolean"
      if (/^-?\d+(\.\d+)?$/.test(defaultValue)) return "number"
      if (defaultValue.startsWith("[") || defaultValue.startsWith("{")) return defaultValue.startsWith("[") ? "array" : "object"
      return "string"
    }
  }

  if (/^(is|has|can|should|will|did|enable|disable|visible|active|open|closed)/.test(name)) return "boolean"
  if (/^(count|index|limit|size|length|max|min|width|height|depth|offset|duration|delay|timeout|interval|rate|threshold|level|score|priority|version|port|year|month|day|hour|minute|second)/.test(name)) return "number"
  if (/^(name|title|label|text|content|body|message|description|summary|path|url|uri|host|port|file|filename|ext|extension|format|type|kind|mode|state|status|color|theme|lang|language|locale|timezone|currency|unit|prefix|suffix|key|token|secret|password|email|phone|address|id|uuid|slug)/.test(name)) return "string"
  if (/^(items|list|array|elements|nodes|children|options|params|args|arguments|values|entries|records|rows|columns|fields|properties|attrs|attributes|headers|tags|categories|labels|classes|styles)/.test(name)) return "array"
  if (/^(obj|config|opts|options|settings|prefs|preferences|context|state|data|info|metadata|meta|props|query|filter|sort|pagination|page|request|response|event|error|result|output|input)/.test(name)) return "object"
  if (/^(fn|cb|callback|handler|listener|middleware|transform|map|reduce|filter|sort|forEach)/.test(name)) return "function"

  return "any"
}

function buildTestSkeleton(language, fileName, exports, options = {}) {
  const { strict = true, quality = true } = options
  const testName = fileName.replace(/\.[^.]+$/, "")

  const skeletons = {
    py: () => {
      const imports = `import unittest\nfrom ${testName} import ${exports.map(e => e.name).join(", ")}\n`
      const tests = exports.map(exp => {
        if (exp.type === "class") {
          return `\nclass Test${exp.name}(unittest.TestCase):\n    def test_init(self):\n        """Test ${exp.name} initialization."""\n        instance = ${exp.name}()\n        self.assertIsNotNone(instance)\n`
        }
        const params = inferFunctionParams("", exp.name)
        const paramStr = params.map(p => p.defaultValue !== undefined ? `${p.name}=${p.defaultValue}` : "None").join(", ") || ""
        return `\n    def test_${exp.name}_smoke(self):\n        """Smoke test for ${exp.name}."""\n        result = ${exp.name}(${paramStr})\n        ${strict ? "self.assertIsNotNone(result)" : "pass"}\n`
      }).join("")
      return `${imports}\n${tests}`
    },

    js: () => {
      const imports = `const { ${exports.map(e => e.name).join(", ")} } = require("./${testName}")\n`
      const tests = exports.map(exp => {
        const params = inferFunctionParams("", exp.name)
        const paramStr = params.map(p => p.defaultValue !== undefined ? `${p.name}=${p.defaultValue}` : "undefined").join(", ") || ""
        return `\ntest("${exp.name} smoke test", () => {\n  const result = ${exp.name}(${paramStr})\n  ${strict ? "expect(result).toBeDefined()" : "// TODO: add assertions"}\n})`
      }).join("\n")
      return `${imports}\n${tests}`
    },

    ts: () => {
      const imports = `import { ${exports.map(e => e.name).join(", ")} } from "./${testName}"\n`
      const tests = exports.map(exp => {
        const params = inferFunctionParams("", exp.name)
        const paramStr = params.map(p => p.defaultValue !== undefined ? `${p.name}=${p.defaultValue}` : "undefined").join(", ") || ""
        return `\ntest("${exp.name} smoke test", () => {\n  const result = ${exp.name}(${paramStr})\n  ${strict ? "expect(result).toBeDefined()" : "// TODO: add assertions"}\n})`
      }).join("\n")
      return `${imports}\n${tests}`
    },

    go: () => {
      const tests = exports.map(exp => {
        return `\nfunc Test${capitalize(exp.name)}(t *testing.T) {\n\t// TODO: implement test for ${exp.name}\n\tt.Skip("not implemented")\n}`
      }).join("\n")
      return `package main\n\nimport "testing"\n${tests}`
    },

    sh: () => {
      const tests = exports.map(exp => {
        return `\ntest_${exp.name}() {\n  # TODO: implement test for ${exp.name}\n  echo "SKIP: test_${exp.name} not implemented"\n}`
      }).join("\n")
      return `#!/usr/bin/env bash\nset -euo pipefail\n\nsource "./${testName}.sh"\n${tests}`
    },

    rs: () => {
      const tests = exports.map(exp => {
        return `\n#[test]\nfn test_${exp.name}() {\n    // TODO: implement test for ${exp.name}\n}`
      }).join("\n")
      return `#[cfg(test)]\nmod tests {\n    use super::*;\n${tests}\n}`
    },

    rb: () => {
      const tests = exports.map(exp => {
        return `\n  def test_${exp.name}\n    # TODO: implement test for ${exp.name}\n    skip "not implemented"\n  end`
      }).join("\n")
      return `require "minitest/autorun"\nrequire_relative "${testName}"\n\nclass Test${capitalize(testName)} < Minitest::Test\n${tests}\nend`
    },

    java: () => {
      const tests = exports.map(exp => {
        return `\n    @Test\n    void test${capitalize(exp.name)}() {\n        // TODO: implement test for ${exp.name}\n    }`
      }).join("\n")
      return `import org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.*;\n\nclass ${capitalize(testName)}Test {\n${tests}\n}`
    },

    kt: () => {
      const tests = exports.map(exp => {
        return `\n    @Test\n    fun test${capitalize(exp.name)}() {\n        // TODO: implement test for ${exp.name}\n    }`
      }).join("\n")
      return `import org.junit.jupiter.api.Test\nimport org.junit.jupiter.api.Assertions.*\n\nclass ${capitalize(testName)}Test {\n${tests}\n}`
    },
  }

  const generator = skeletons[language] || skeletons.js
  return generator()
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export { extractExports, inferFunctionParams, inferTypeFromName, buildTestSkeleton }
