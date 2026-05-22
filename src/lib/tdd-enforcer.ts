// @ts-nocheck
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, readdirSync, rmSync, openSync } from "node:fs"
import { join, dirname } from "node:path"
import { createHash } from "node:crypto"
import {
  USER_HOME,
  loadSelection,
  updateState,
  testReminderSeen,
} from "./state.js"
import { extractExports, generateTestCaseNames, inferFunctionParams, inferTypeFromName, _langComment, buildQualityAssertionsForFunc, isSkeletonUseless } from "../utils/tdd-helpers.js"

export { extractExports, generateTestCaseNames, inferFunctionParams, inferTypeFromName, _langComment, buildQualityAssertionsForFunc, isSkeletonUseless }

let _detectedFramework: any = null

let directory = undefined

const SOURCE_EXT_RE = /\.(py|js|ts|mjs|tsx|jsx|cjs|mts|sh|go|rs|rb|java|kt)$/i
const SKIP_PATH_RE = /(\/(node_modules|\.venv|dist|build|__pycache__)\/|\/(tests?|spec)\/|test_[^/]+\.py$|_test\.py$|\.test\.[a-z]+$|\.spec\.[a-z]+$|\.config\/opencode\/plugins\/)/i

function _detectTestFramework() {
  if (_detectedFramework) return _detectedFramework
  let framework = null
  let testExt = null
  try {
    const root = directory || process.cwd()
    const pkgPath = join(root, "package.json")
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
      const testScript = String(pkg?.scripts?.test || "")
      const deps = { ...pkg?.devDependencies, ...pkg?.dependencies }
      if (testScript.includes("vitest") || deps["vitest"]) { framework = "vitest"; testExt = "ts" }
      else if (testScript.includes("jest") || deps["jest"]) { framework = "jest"; testExt = "js" }
      else if (testScript.includes("mocha") || deps["mocha"]) { framework = "mocha"; testExt = "js" }
      else if (/node\s+--test/.test(testScript)) { framework = "node-test"; testExt = "js" }
    }
    if (!framework) {
      const testDirs = ["src/tests", "tests", "test", "__tests__"]
      for (const td of testDirs) {
        const dirPath = join(root, td)
        if (!existsSync(dirPath)) continue
        const files = readdirSync(dirPath).filter(f => /\.test\./.test(f) || /\.spec\./.test(f))
        if (files.length > 0) {
          const content = readFileSync(join(dirPath, files[0]), "utf-8")
          if (/from\s+['"]node:test['"]/.test(content)) { framework = "node-test"; testExt = files[0].split(".").pop(); break }
          if (/from\s+['"]vitest['"]/.test(content)) { framework = "vitest"; testExt = files[0].split(".").pop(); break }
          if (/require\(['"]@jest\/globals['"]\)/.test(content)) { framework = "jest"; testExt = files[0].split(".").pop(); break }
        }
      }
    }
  } catch (e) {
    console.error(`[vibeOS] [tdd] framework detection failed: ${e.message}`)
  }
  _detectedFramework = { framework, testExt }
  console.error(`[vibeOS] [tdd] detected test framework: ${framework || "default"} (ext: ${testExt || "match source"})`)
  return _detectedFramework
}

const TEST_SKELETONS = {
  py: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const moduleImport = name.replace(/-/g, "_")
    let content = `# [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `import pytest\n`
    content += `from ${moduleImport} import ${exports.length > 0 ? exports.map(e => e.name).join(", ") : moduleImport}\n\n`
    if (depth === "minimal") {
      content += `def test_${name}_smoke():\n`
      content += `    """Smoke test — replace with real assertions."""\n`
      content += `    assert ${exports.length > 0 ? exports[0].name : moduleImport} is not None\n\n`
    } else {
      // Smoke test (passing)
      content += `def test_${name}_smoke():\n`
      content += `    """Smoke test: module imports correctly."""\n`
      content += `    assert ${exports.length > 0 ? exports[0].name : moduleImport} is not None\n\n`
      // Generate test stubs for each exported function
      for (const exp of exports) {
        if (exp.type === "class") continue
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        content += `# TODO: implement tests for ${exp.name}\n`
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `def test_${caseFunc}():\n`
          if (strict) content += `    raise AssertionError("TODO: implement ${caseName}")\n\n`
          else content += `    pytest.skip("TODO: implement ${caseName}")\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "py", "")
        }
      }
      if (exports.length === 0) {
        content += `def test_${name}_placeholder():\n`
        if (strict) content += `    raise AssertionError("TODO: implement tests for ${name}")\n\n`
        else content += `    pytest.skip("TODO: implement tests for ${name}")\n\n`
      }
    }
    return content
  },
  js: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const importPath = `../${name}`
    let content = `// [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `const { test, expect, describe } = require('@jest/globals');\n`
    content += `const mod = require('${importPath}');\n\n`
    content += `describe('${name}', () => {\n`
    if (depth === "minimal") {
      content += `  test('smoke: module loads', () => {\n`
      content += `    expect(mod).toBeDefined();\n`
      content += `  });\n`
    } else {
      // Smoke test (passing)
      content += `  test('smoke: module loads', () => {\n`
      content += `    expect(mod).toBeDefined();\n`
      content += `  });\n\n`
      // Generate test stubs for each exported function
      for (const exp of exports) {
        if (exp.type === "class") continue
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        content += `  // TODO: implement tests for ${exp.name}\n`
        content += `  test('${exp.name} is exported', () => {\n`
        content += `    expect(typeof mod.${exp.name}).toBe('function');\n`
        content += `  });\n\n`
        for (const caseName of cases) {
          content += `  test('${caseName}', () => {\n`
          content += `    // TODO: implement ${caseName}\n`
          if (strict) content += `    throw new Error('TODO: implement ${caseName}');\n`
          else content += `    expect(true).toBe(true);\n`
          content += `  });\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "js", "  ")
        }
      }
      if (exports.length === 0) {
        content += `  test('placeholder', () => {\n`
        content += `    // TODO: implement tests for ${name}\n`
        content += `    expect(true).toBe(true);\n`
        content += `  });\n`
      }
    }
    content += `});\n`
    return content
  },
  mjs: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const importPath = `../${name}`
    let content = `// [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `import { test, expect, describe } from 'vitest';\n`
    content += `import * as mod from '${importPath}';\n\n`
    content += `describe('${name}', () => {\n`
    if (depth === "minimal") {
      content += `  test('smoke: module loads', () => {\n`
      content += `    expect(mod).toBeDefined();\n`
      content += `  });\n`
    } else {
      content += `  test('smoke: module loads', () => {\n`
      content += `    expect(mod).toBeDefined();\n`
      content += `  });\n\n`
      for (const exp of exports) {
        if (exp.type === "class") continue
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        content += `  // TODO: implement tests for ${exp.name}\n`
        content += `  test('${exp.name} is exported', () => {\n`
        content += `    expect(typeof mod.${exp.name}).toBe('function');\n`
        content += `  });\n\n`
        for (const caseName of cases) {
          content += `  test('${caseName}', () => {\n`
          content += `    // TODO: implement ${caseName}\n`
          if (strict) content += `    throw new Error('TODO: implement ${caseName}');\n`
          else content += `    expect(true).toBe(true);\n`
          content += `  });\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "mjs", "  ")
        }
      }
      if (exports.length === 0) {
        content += `  test('placeholder', () => {\n`
        content += `    // TODO: implement tests for ${name}\n`
        content += `    expect(true).toBe(true);\n`
        content += `  });\n`
      }
    }
    content += `});\n`
    return content
  },
  ts: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const importPath = `../${name}`
    let content = `// [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `import { test, expect, describe, it } from 'vitest';\n`
    content += `import * as mod from '${importPath}';\n\n`
    content += `describe('${name}', () => {\n`
    if (depth === "minimal") {
      content += `  it('smoke: module loads', () => {\n`
      content += `    expect(mod).toBeDefined();\n`
      content += `  });\n`
    } else {
      content += `  it('smoke: module loads', () => {\n`
      content += `    expect(mod).toBeDefined();\n`
      content += `  });\n\n`
      for (const exp of exports) {
        if (exp.type === "class") continue
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        content += `  // TODO: implement tests for ${exp.name}\n`
        content += `  it('${exp.name} is exported', () => {\n`
        content += `    expect(typeof mod.${exp.name}).toBe('function');\n`
        content += `  });\n\n`
        for (const caseName of cases) {
          content += `  it('${caseName}', () => {\n`
          content += `    // TODO: implement ${caseName}\n`
          if (strict) content += `    throw new Error('TODO: implement ${caseName}');\n`
          else content += `    expect(true).toBe(true);\n`
          content += `  });\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "ts", "  ")
        }
      }
      if (exports.length === 0) {
        content += `  it('placeholder', () => {\n`
        content += `    // TODO: implement tests for ${name}\n`
        content += `    expect(true).toBe(true);\n`
        content += `  });\n`
      }
    }
    content += `});\n`
    return content
  },
  tsx: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => TEST_SKELETONS.ts(name, exports, depth, strict, quality, sourceContent),
  jsx: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => TEST_SKELETONS.mjs(name, exports, depth, strict, quality, sourceContent),
  cjs: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => TEST_SKELETONS.mjs(name, exports, depth, strict, quality, sourceContent),
  mts: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => TEST_SKELETONS.ts(name, exports, depth, strict, quality, sourceContent),
  go: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1)
    let content = `// [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `package main\n\n`
    content += `import "testing"\n\n`
    if (depth === "minimal") {
      content += `func Test${cap}_Smoke(t *testing.T) {\n`
      content += `\tt.Log("TODO: implement smoke test")\n`
      content += `\tt.Fail()\n`
      content += `}\n`
    } else {
      content += `func Test${cap}_Smoke(t *testing.T) {\n`
      content += `\tt.Log("Module loads correctly")\n`
      content += `\tt.Fail()\n`
      content += `}\n\n`
      for (const exp of exports) {
        if (exp.type === "class") continue
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        const expCap = exp.name.charAt(0).toUpperCase() + exp.name.slice(1)
        content += `// TODO: implement tests for ${exp.name}\n`
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `func Test${cap}_${caseFunc}(t *testing.T) {\n`
          if (strict) content += `\tt.Error("TODO: implement ${caseName}")\n`
          else content += `\tt.Skip("TODO: implement ${caseName}")\n`
          content += `}\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += `    // TODO: Real assertion for ${exp.name} — valid input\n`
          content += `    // TODO: Real assertion for ${exp.name} — invalid input\n`
          content += `    // TODO: Real assertion for ${exp.name} — edge case\n\n`
        }
      }
      if (exports.length === 0) {
        content += `func Test${cap}_Placeholder(t *testing.T) {\n`
        if (strict) content += `\tt.Error("TODO: implement tests for ${name}")\n`
        else content += `\tt.Skip("TODO: implement tests for ${name}")\n`
        content += `}\n`
      }
    }
    return content
  },
  sh: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    let content = `# [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `#!/bin/bash\n\n`
    if (depth === "minimal") {
      content += `echo "TODO: implement smoke test for ${name}" && exit 1\n`
    } else {
      content += `# Smoke: module loads\n`
      content += `echo "Smoke test placeholder"\n\n`
      for (const exp of exports) {
        content += `# TODO: implement tests for ${exp.name}\n`
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `function test_${caseFunc} {\n`
          content += `    echo "TODO: implement ${caseName}"\n`
          if (strict) content += `    exit 1\n`
          else content += `    echo "SKIP: ${caseName}"\n`
          content += `}\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "sh", "")
        }
      }
      if (exports.length === 0) {
        content += `function test_smoke {\n`
        if (strict) content += `    echo "TODO: implement tests for ${name}" && exit 1\n`
        else content += `    echo "TODO: implement tests for ${name}"\n`
        content += `}\n`
      }
      content += `# Run all tests\n`
      content += `test_smoke\n`
    }
    return content
  },
  rs: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    let content = `// [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `#[cfg(test)]\nmod tests {\n`
    content += `    use super::*;\n\n`
    if (depth === "minimal") {
      content += `    #[test]\n    fn ${name}_smoke() {\n`
      content += `        // TODO: implement smoke test\n        panic!();\n    }\n`
    } else {
      content += `    #[test]\n    fn ${name}_smoke() {\n`
      content += `        // Smoke: module loads\n`
      content += `        assert!(true);\n    }\n\n`
      for (const exp of exports) {
        if (exp.type === "class") continue
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        content += `    // TODO: implement tests for ${exp.name}\n`
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `    #[test]\n    fn test_${caseFunc}() {\n`
          if (strict) content += `        panic!("TODO: implement ${caseName}");\n`
          else content += `        // TODO: implement ${caseName}\n`
          content += `    }\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "rs", "    ")
        }
      }
      if (exports.length === 0) {
        content += `    #[test]\n    fn ${name}_placeholder() {\n`
        if (strict) content += `        panic!("TODO: implement tests for ${name}");\n`
        else content += `        // TODO: implement tests for ${name}\n`
        content += `    }\n`
      }
    }
    content += `}\n`
    return content
  },
  rb: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    let content = `# [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `require 'minitest/autorun'\n`
    content += `require_relative '../${name}'\n\n`
    content += `class Test${name.charAt(0).toUpperCase() + name.slice(1)} < Minitest::Test\n`
    if (depth === "minimal") {
      content += `  def test_smoke\n`
      content += `    # TODO: implement smoke test\n`
      content += `    flunk "TODO: implement smoke test"\n`
      content += `  end\n`
    } else {
      content += `  def test_smoke\n`
      content += `    # Smoke: module loads\n`
      content += `    assert true\n`
      content += `  end\n\n`
      for (const exp of exports) {
        if (exp.type === "class") continue
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        content += `  # TODO: implement tests for ${exp.name}\n`
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `  def test_${caseFunc}\n`
          if (strict) content += `    flunk "TODO: implement ${caseName}"\n`
          else content += `    # TODO: implement ${caseName}\n`
          content += `  end\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "rb", "  ")
        }
      }
      if (exports.length === 0) {
        content += `  def test_placeholder\n`
        if (strict) content += `    flunk "TODO: implement tests for ${name}"\n`
        else content += `    # TODO: implement tests for ${name}\n`
        content += `  end\n`
      }
    }
    content += `end\n`
    return content
  },
  java: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1)
    let content = `// [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `import org.junit.jupiter.api.Test;\n`
    content += `import static org.junit.jupiter.api.Assertions.*;\n\n`
    content += `class Test${cap} {\n`
    if (depth === "minimal") {
      content += `    @Test\n`
      content += `    void testSmoke() {\n`
      content += `        assertTrue(true);\n`
      content += `    }\n`
    } else {
      content += `    @Test\n`
      content += `    void testSmoke() {\n`
      content += `        assertTrue(true);\n`
      content += `    }\n\n`
      for (const exp of exports) {
        content += `    // TODO: implement tests for ${exp.name}\n`
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        for (const caseName of cases) {
          const testFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          if (!strict) content += `    // @Disabled(\"TODO\")\n`
          content += `    @Test\n`
          content += `    void test${testFunc.charAt(0).toUpperCase() + testFunc.slice(1)}() {\n`
          if (strict) content += `        fail("TODO: implement ${caseName}");\n`
          else content += `        assertTrue(true); // TODO: implement ${caseName}\n`
          content += `    }\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "java", "    ")
        }
      }
      if (exports.length === 0) {
        content += `    @Test\n`
        content += `    void testPlaceholder() {\n`
        content += `        assertTrue(true); // TODO: implement tests for ${name}\n`
        content += `    }\n`
      }
    }
    content += `}\n`
    return content
  },
  kt: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1)
    let content = `// [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `import org.junit.jupiter.api.Test\n`
    content += `import org.junit.jupiter.api.Assertions.*\n\n`
    content += `class Test${cap} {\n`
    if (depth === "minimal") {
      content += `    @Test\n`
      content += `    fun testSmoke() {\n`
      content += `        assertTrue(true)\n`
      content += `    }\n`
    } else {
      content += `    @Test\n`
      content += `    fun testSmoke() {\n`
      content += `        assertTrue(true)\n`
      content += `    }\n\n`
      for (const exp of exports) {
        content += `    // TODO: implement tests for ${exp.name}\n`
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        for (const caseName of cases) {
          const testFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          if (!strict) content += `    // @Disabled(\"TODO\")\n`
          content += `    @Test\n`
          content += `    fun test${testFunc.charAt(0).toUpperCase() + testFunc.slice(1)}() {\n`
          if (strict) content += `        fail(\"TODO: implement ${caseName}\")\n`
          else content += `        assertTrue(true) // TODO: implement ${caseName}\n`
          content += `    }\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "kt", "    ")
        }
      }
      if (exports.length === 0) {
        content += `    @Test\n`
        content += `    fun testPlaceholder() {\n`
        content += `        assertTrue(true) // TODO: implement tests for ${name}\n`
        content += `    }\n`
      }
    }
    content += `}\n`
    return content
  },
}

// Cross-process lock directory for test file creation coordination.
const ENFORCEMENT_LOCK_DIR = join(USER_HOME, ".claude/.enforcement-lock")
const LOCK_EXPIRE_MS = 30_000

// Cross-process cooldown to avoid duplicate enforcement across processes.
const ENFORCEMENT_COOLDOWN_FILE = join(USER_HOME, ".claude/.enforcement-cooldown.jsonl")
const COOLDOWN_MS = 60_000

// Per-process recursion guard.
const _enforcementCooldown = new Set()

function _acquireLock(testPath) {
  try {
    mkdirSync(ENFORCEMENT_LOCK_DIR, { recursive: true })
    const hash = createHash("sha256").update(testPath).digest("hex").slice(0, 16)
    const lockPath = join(ENFORCEMENT_LOCK_DIR, `${hash}.lock`)
    try {
      openSync(lockPath, "wx")
      return true
    } catch (err) {
      if (err.code !== "EEXIST") return false
      try {
        const st = statSync(lockPath)
        if (Date.now() - st.mtimeMs >= LOCK_EXPIRE_MS) {
          rmSync(lockPath, { force: true })
          try { openSync(lockPath, "wx"); return true } catch {}
        }
      } catch {}
      return false
    }
  } catch { return false }
}

function _releaseLock(testPath) {
  try {
    const hash = createHash("sha256").update(testPath).digest("hex").slice(0, 16)
    const lockPath = join(ENFORCEMENT_LOCK_DIR, `${hash}.lock`)
    rmSync(lockPath)
  } catch {}
}

function _isInCooldown(testPath) {
  try {
    if (!existsSync(ENFORCEMENT_COOLDOWN_FILE)) return false
    const hash = createHash("sha256").update(testPath).digest("hex").slice(0, 16)
    const lines = readFileSync(ENFORCEMENT_COOLDOWN_FILE, "utf-8").trim().split("\n").filter(Boolean)
    const now = Date.now()
    for (const line of lines) {
      try {
        const { h, ts } = JSON.parse(line)
        if (h === hash && (now - ts) < COOLDOWN_MS) return true
      } catch {}
    }
    return false
  } catch { return false }
}

function _recordCooldown(testPath) {
  try {
    mkdirSync(dirname(ENFORCEMENT_COOLDOWN_FILE), { recursive: true })
    const hash = createHash("sha256").update(testPath).digest("hex").slice(0, 16)
    const entry = JSON.stringify({ h: hash, ts: Date.now() }) + "\n"
    appendFileSync(ENFORCEMENT_COOLDOWN_FILE, entry)
    // Prune old entries to keep file bounded
    const lines = readFileSync(ENFORCEMENT_COOLDOWN_FILE, "utf-8").trim().split("\n").filter(Boolean)
    if (lines.length > 500) {
      writeFileSync(ENFORCEMENT_COOLDOWN_FILE, lines.slice(-200).join("\n") + "\n")
    }
  } catch {}
}

export function buildTestSkeleton(filePath, sourceContent = "", options = {}) {
  const fw = _detectTestFramework()
  if (!filePath || typeof filePath !== "string") return null
  if (!SOURCE_EXT_RE.test(filePath)) return null
  if (SKIP_PATH_RE.test(filePath)) return null
  const m = filePath.match(/([^/]+)\.([^.]+)$/)
  if (!m) return null
  const [, name, ext] = m
  const extLower = ext.toLowerCase()
  const skeletonFn = TEST_SKELETONS[extLower]
  if (!skeletonFn) return null
  const strict = options.strict !== undefined ? options.strict : true
  const quality = options.quality !== undefined ? options.quality : true
  const m2 = filePath.match(/^(.*\/)?([^/]+)\.([^.]+)$/)
  const dir = m2 ? (m2[1] || "") : ""
  let testPath
  switch (extLower) {
    case "py": testPath = dir + "tests/test_" + name + ".py"; break
    case "sh": testPath = dir + "tests/test_" + name + ".sh"; break
    case "js": case "mjs": case "ts": case "jsx": case "tsx": case "cjs": case "mts":
      testPath = dir + "tests/" + name + ".test." + ext; break
    case "go": testPath = dir + name + "_test.go"; break
    case "rs": testPath = dir + "tests/" + name + "_test.rs"; break
    case "rb": testPath = dir + "test/" + name + "_test.rb"; break
    case "java": case "kt": testPath = dir + "src/test/" + name.charAt(0).toUpperCase() + name.slice(1) + "Test." + ext; break
    default: return null
  }
  if (fw?.testExt) {
    testPath = testPath.replace(new RegExp("\\.[^.]+$"), "." + fw.testExt)
  }
  const exports = extractExports(sourceContent, extLower)
  return { path: testPath, content: skeletonFn(name, exports, "full", strict, quality, sourceContent), dir: dirname(testPath) }
}

export function enforceTestFile(filePath) {
  console.error(`[vibeOS] [tdd-enforce] enforceTestFile called for ${filePath}`)
  let sourceContent = ""
  try {
    if (existsSync(filePath)) {
      sourceContent = readFileSync(filePath, "utf-8")
    }
  } catch {}
  const sel = loadSelection()
  const skeleton = buildTestSkeleton(filePath, sourceContent, { strict: sel.tdd_strict !== false, quality: sel.tdd_quality !== false })
  if (!skeleton) return null
  if (existsSync(skeleton.path)) return null
  if (_enforcementCooldown.has(skeleton.path)) return null
  if (_isInCooldown(skeleton.path)) return null
  if (!_acquireLock(skeleton.path)) return null
  try {
    mkdirSync(skeleton.dir, { recursive: true })
    writeFileSync(skeleton.path, skeleton.content)
    _enforcementCooldown.add(skeleton.path)
    _recordCooldown(skeleton.path)
    // Record extended telemetry in state file
    try {
      updateState((state) => {
        state.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" }
        state.lifetime.tdd_enforced = (state.lifetime.tdd_enforced || 0) + 1
        state.lifetime.tdd_skeletons_created = (state.lifetime.tdd_skeletons_created || 0) + 1
        if (sel.tdd_strict !== false) {
          state.lifetime.tdd_strict_fail_templates_created = (state.lifetime.tdd_strict_fail_templates_created || 0) + 1
        }
        if (sel.tdd_quality !== false) {
          state.lifetime.tdd_quality_templates_created = (state.lifetime.tdd_quality_templates_created || 0) + 1
        }
        state.lifetime.last_updated = new Date().toISOString()
        return state
      })
    } catch {}
    let resultPath = skeleton.path
    // Anti-useless-run guard: warn if content is only placeholders
    const useless = isSkeletonUseless(skeleton.content)
    if (useless) {
      console.error(`[vibeOS] ⚠ TDD skeleton at ${skeleton.path} has no real assertions. Run \`trinity tdd strict off\` or add manual tests.`)
    }
    console.error(`[vibeOS] [tdd-enforce] Created skeleton: ${skeleton.path}`)
    return resultPath
  } catch (err) {
    console.error(`[vibeOS] [tdd-enforce] Failed to create ${skeleton.path}: ${err.message}`)
    return null
  } finally {
    _releaseLock(skeleton.path)
  }
}

export function buildTestReminder(filePath) {
  if (!filePath || typeof filePath !== "string") return null
  if (!SOURCE_EXT_RE.test(filePath)) return null
  if (SKIP_PATH_RE.test(filePath)) return null
  if (testReminderSeen.has(filePath)) return null
  testReminderSeen.add(filePath)
  const m = filePath.match(/([^/]+)\.([^.]+)$/)
  if (!m) return null
  const [, name, ext] = m
  let suggest
  switch (ext.toLowerCase()) {
    case "py": suggest = `tests/test_${name}.py`; break
    case "sh": suggest = `tests/test_${name}.sh`; break
    case "js": case "mjs": case "ts": case "jsx": case "tsx":
      suggest = `tests/${name}.test.${ext}`; break
    case "go": suggest = `${name}_test.go`; break
    default: suggest = "co-located test file"
  }
  return `🧪 Changed ${filePath} — add test at ${suggest} before completing.`
}
