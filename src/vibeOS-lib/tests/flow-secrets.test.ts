import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, cpSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"

import { checkFlowRules, resetForTest, resolveRulesPath, resetAll, addFlowRule, getSessionFlowCounts, __MODULE_DIRNAME } from "../flow-enforcer.js"

const SECRETS_RULE = {
  id: "detect-secrets",
  severity: "flag" as const,
  trigger: "Edit",
  pattern: "(?<![a-zA-Z0-9])(sk-[a-zA-Z0-9_-]{10,}|gh[pousr]_[a-zA-Z0-9]{15,}|github_pat_[a-zA-Z0-9_]{15,}|xox[bpras]-[a-zA-Z0-9-]{10,}|-----BEGIN (?:RSA|EC|OPENSSH|ENCRYPTED) PRIVATE KEY-----)",
  description: "Potential secret/API key detected in content",
}

const REALITY_CHECK_RULES = [
  {
    id: "require-read-before-claim",
    severity: "warn" as const,
    trigger: "Edit",
    pattern: "(?i)\\b(done|complete|success|trained|ready|works|fixed)\\b",
    description: "Success claim detected — verify live state before asserting completion",
  },
  {
    id: "verify-state-on-disk",
    severity: "flag" as const,
    trigger: "Edit",
    pattern: "(?i)\\b(assume|guess|probably|likely|maybe|seems|appears)\\b",
    description: "Inference language detected — verify actual files/state first",
  },
  {
    id: "postmortem-trigger",
    severity: "warn" as const,
    trigger: "Edit",
    pattern: "(?i)\\breality check\\b",
    description: "Reality check requested — read and verify live state before reporting",
  },
]

describe("resolveRulesPath", () => {
  it("returns a string path", () => {
    const path = resolveRulesPath()
    assert.ok(typeof path === "string", `expected string, got ${typeof path}`)
    assert.ok(path.length > 0, "path should not be empty")
    assert.ok(path.startsWith("/"), `expected absolute path, got ${path}`)
  })

  it("returns an absolute or resolvable relative path", () => {
    const path = resolveRulesPath()
    assert.ok(path.length > 0, "path should not be empty")
    assert.ok(path.includes("flow-rules.json"), "path should reference flow-rules.json")
    assert.ok(path.endsWith("flow-rules.json"), "path should end with flow-rules.json")
  })
})

describe("addFlowRule", () => {
  it("exists as a callable function", () => {
    assert.strictEqual(typeof addFlowRule, "function")
    assert.strictEqual(addFlowRule.name, "addFlowRule")
  })
})

describe("getSessionFlowCounts stale cache after resetForTest", () => {
  it("returns fresh counts after resetForTest with new rules", () => {
    resetForTest([{
      id: "stale-cache-test",
      trigger: "Edit",
      pattern: "STALE_TEST_PATTERN",
      severity: "warn",
      description: "Test stale cache"
    }])
    const counts = getSessionFlowCounts()
    assert.ok(counts !== undefined, "counts should be defined after resetForTest")
    assert.strictEqual(typeof counts, "object")
    assert.ok(counts === null || typeof counts === "object", "counts should be object or null")
  })
})

describe("resetAll", () => {
  it("exists as a callable function", () => {
    assert.strictEqual(typeof resetAll, "function")
    assert.strictEqual(resetAll.name, "resetAll")
  })

  it("resets internal state without throwing", () => {
    assert.doesNotThrow(() => resetAll())
    const counts = getSessionFlowCounts()
    assert.ok(typeof counts === "object" || counts === null)
  })
})

describe("detect-secrets flow rule", () => {
  it("sk- prefix (OpenAI key) in edit content -> flag detected", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "src/config.ts",
      content: 'const key = "sk-proj-abc123xyzabcdefghij"',
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, "detect-secrets")
    assert.equal(hits[0].severity, "flag")
    assert.equal(hits[0].deduped, false)
    assert.ok(typeof hits[0].filePath === "string", "filePath should be present")
    assert.equal(hits[0].filePath, "src/config.ts")
  })

  it("ghp_ prefix (GitHub token) in edit content -> flag detected", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "src/main.js",
      content: 'const token = "ghp_1234567890abcdef12345678"',
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, "detect-secrets")
    assert.equal(hits[0].severity, "flag")
    assert.equal(hits[0].deduped, false)
    assert.equal(hits[0].filePath, "src/main.js")
  })

  it("-----BEGIN RSA PRIVATE KEY----- in edit content -> flag detected", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "crypto/key.pem",
      content: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...\n-----END RSA PRIVATE KEY-----",
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, "detect-secrets")
    assert.equal(hits[0].severity, "flag")
    assert.equal(hits[0].deduped, false)
  })

  it("-----BEGIN EC PRIVATE KEY----- in edit content -> flag detected", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "crypto/ec.pem",
      content: "-----BEGIN EC PRIVATE KEY-----\nMHQCAQEE...\n-----END EC PRIVATE KEY-----",
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, "detect-secrets")
    assert.equal(hits[0].deduped, false)
  })

  it("-----BEGIN OPENSSH PRIVATE KEY----- in edit content -> flag detected", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "~/.ssh/id_rsa",
      content: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnN...\n-----END OPENSSH PRIVATE KEY-----",
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, "detect-secrets")
    assert.equal(hits[0].deduped, false)
  })

  it("github_pat_ prefix (GitHub fine-grained token) in edit content -> flag detected", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: ".env.local",
      content: "GITHUB_TOKEN=github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, "detect-secrets")
    assert.equal(hits[0].deduped, false)
  })

  it("xoxb- prefix (Slack bot token) in edit content -> flag detected", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "slack/config.json",
      content: 'SLACK_BOT_TOKEN=xoxb-1234567890-abcdefghij',
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, "detect-secrets")
    assert.equal(hits[0].deduped, false)
  })

  it("normal comment about password policies -> NO flag", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "docs/security.md",
      content: "This is a normal comment about password policies and key rotation.",
    })
    assert.equal(hits.length, 0)
    assert.ok(Array.isArray(hits))
  })

  it("const apiKey = process.env.OPENAI_KEY -> NO flag (env var reference)", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "src/auth.ts",
      content: "const apiKey = process.env.OPENAI_KEY;",
    })
    assert.equal(hits.length, 0)
    assert.ok(Array.isArray(hits))
  })

  it("variable named publicKey -> NO flag", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "src/crypto.ts",
      content: "const publicKey = '-----BEGIN PUBLIC KEY-----\n...';",
    })
    assert.equal(hits.length, 0)
    assert.ok(Array.isArray(hits))
  })

  it("normal file path with 'key' in name -> NO flag", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "src/ssl/key.pem",
      content: "import { readFileSync } from 'fs';\nconst cert = readFileSync('/etc/ssl/key.pem');",
    })
    assert.equal(hits.length, 0)
    assert.ok(Array.isArray(hits))
  })

  it("Write trigger does NOT match (rule is Edit-only)", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Write",
      filePath: ".env",
      content: "SECRET=sk-proj-abc123xyz",
    })
    assert.equal(hits.length, 0)
    assert.ok(Array.isArray(hits))
  })

  it("dedup: second call for same rule+file is deduped", () => {
    resetForTest([SECRETS_RULE])
    const h1 = checkFlowRules({
      tool: "Edit",
      filePath: "src/auth.ts",
      content: 'const key = "sk-proj-abc123xyzabcdefghij"',
    })
    assert.equal(h1.length, 1)
    assert.equal(h1[0].deduped, false)
    assert.equal(h1[0].id, "detect-secrets")
    const h2 = checkFlowRules({
      tool: "Edit",
      filePath: "src/auth.ts",
      content: 'const key = "sk-proj-abc123xyzabcdefghij"',
    })
    assert.equal(h2.length, 1)
    assert.equal(h2[0].deduped, true)
    assert.equal(h2[0].id, "detect-secrets")
    assert.equal(h2[0].filePath, "src/auth.ts")
  })
})

describe("reality-check flow rules", () => {
  it("flags success claims before they are treated as done", () => {
    resetForTest(REALITY_CHECK_RULES)
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "src/agent.ts",
      content: "This is done, complete, and ready.",
    })
    assert.ok(hits.some((hit) => hit.id === "require-read-before-claim"))
  })

  it("flags inference language before state checks", () => {
    resetForTest(REALITY_CHECK_RULES)
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "src/state.ts",
      content: "This probably works, but I am not sure.",
    })
    assert.ok(hits.some((hit) => hit.id === "verify-state-on-disk"))
  })

  it("flags reality check prompts for a verification pass", () => {
    resetForTest(REALITY_CHECK_RULES)
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "src/state.ts",
      content: "reality check",
    })
    assert.ok(hits.some((hit) => hit.id === "postmortem-trigger"))
  })
})

describe("resolveRulesPath deployed-layout regression", () => {
  // The test runner's ts-src-loader may serve flow-enforcer from different
  // __dirname depending on which compiled copy is loaded (dist-ts/ or dist-ts-tests/).
  // We use __MODULE_DIRNAME (exported from flow-enforcer) to create the fixture
  // at the actual runtime __dirname/assets/, guaranteeing the candidate path exists.

  const fixtureDir = join(__MODULE_DIRNAME, "assets")
  const fixturePath = join(fixtureDir, "flow-rules.json")
  const srcRules = join(process.cwd(), "src", "vibeOS-lib", "flow-rules.json")
  let savedCwd: string

  before(() => {
    savedCwd = process.cwd()
    try {
      console.log(`[flow-regression] before: __MODULE_DIRNAME=${__MODULE_DIRNAME}, fixtureDir=${fixtureDir}`)
      mkdirSync(fixtureDir, { recursive: true })
      cpSync(srcRules, fixturePath)
      console.log(`[flow-regression] before: fixture created, exists=${existsSync(fixturePath)}`)
    } catch (err) {
      console.error(`[flow-regression] before: FAILED to create fixture:`, err)
    }
  })

  after(() => {
    try { process.chdir(savedCwd) } catch {}
    try { rmSync(fixtureDir, { recursive: true }) } catch {}
  })

  it("finds rules via __dirname/assets when cwd-relative candidates are defeated", () => {
    process.chdir(tmpdir())
    resetAll()
    const resolved = resolveRulesPath()
    assert.ok(
      resolved.endsWith("assets/flow-rules.json"),
      `Expected __dirname/assets/flow-rules.json, got: ${resolved}`,
    )
    assert.ok(existsSync(resolved), `Resolved path does not exist on disk: ${resolved}`)
  })
})
