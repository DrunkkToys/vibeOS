import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { checkFlowRules, resetForTest, resolveRulesPath, resetAll, addFlowRule, getSessionFlowCounts } from "../flow-enforcer.js"

const SECRETS_RULE = {
  id: "detect-secrets",
  severity: "flag",
  trigger: "Edit",
  pattern: "(?<![a-zA-Z0-9])(sk-[a-zA-Z0-9_-]{10,}|gh[pousr]_[a-zA-Z0-9]{15,}|github_pat_[a-zA-Z0-9_]{15,}|xox[bpras]-[a-zA-Z0-9-]{10,}|-----BEGIN (?:RSA|EC|OPENSSH|ENCRYPTED) PRIVATE KEY-----)",
  description: "Potential secret/API key detected in content",
}

describe("resolveRulesPath", () => {
  it("returns a string path", () => {
    const path = resolveRulesPath()
    assert.ok(typeof path === "string", `expected string, got ${typeof path}`)
  })

  it("returns an absolute or resolvable relative path", () => {
    const path = resolveRulesPath()
    assert.ok(path.length > 0, "path should not be empty")
    assert.ok(path.includes("flow-rules.json"), "path should reference flow-rules.json")
  })
})

describe("addFlowRule", () => {
  it("exists as a callable function", () => {
    assert.strictEqual(typeof addFlowRule, "function")
  })
})

describe("getSessionFlowCounts stale cache after resetForTest", () => {
  it("returns fresh counts after resetForTest with new rules", () => {
    resetForTest([{
      id: "stale-cache-test",
      type: "pattern",
      pattern: "STALE_TEST_PATTERN",
      severity: "warn",
      message: "Test stale cache"
    }])
    const counts = getSessionFlowCounts()
    assert.ok(counts !== undefined, "counts should be defined after resetForTest")
  })
})

describe("resetAll", () => {
  it("exists as a callable function", () => {
    assert.strictEqual(typeof resetAll, "function")
  })

  it("resets internal state without throwing", () => {
    assert.doesNotThrow(() => resetAll())
  })
})

describe("detect-secrets flow rule", () => {
  it("sk- prefix (OpenAI key) in edit content → flag detected", () => {
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
  })

  it("ghp_ prefix (GitHub token) in edit content → flag detected", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "src/main.js",
      content: 'const token = "ghp_1234567890abcdef12345678"',
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, "detect-secrets")
    assert.equal(hits[0].severity, "flag")
  })

  it("-----BEGIN RSA PRIVATE KEY----- in edit content → flag detected", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "crypto/key.pem",
      content: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...\n-----END RSA PRIVATE KEY-----",
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, "detect-secrets")
  })

  it("-----BEGIN EC PRIVATE KEY----- in edit content → flag detected", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "crypto/ec.pem",
      content: "-----BEGIN EC PRIVATE KEY-----\nMHQCAQEE...\n-----END EC PRIVATE KEY-----",
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, "detect-secrets")
  })

  it("-----BEGIN OPENSSH PRIVATE KEY----- in edit content → flag detected", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "~/.ssh/id_rsa",
      content: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnN...\n-----END OPENSSH PRIVATE KEY-----",
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, "detect-secrets")
  })

  it("github_pat_ prefix (GitHub fine-grained token) in edit content → flag detected", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: ".env.local",
      content: "GITHUB_TOKEN=github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, "detect-secrets")
  })

  it("xoxb- prefix (Slack bot token) in edit content → flag detected", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "slack/config.json",
      content: 'SLACK_BOT_TOKEN=xoxb-1234567890-abcdefghij',
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, "detect-secrets")
  })

  it("normal comment about password policies → NO flag", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "docs/security.md",
      content: "This is a normal comment about password policies and key rotation.",
    })
    assert.equal(hits.length, 0)
  })

  it("const apiKey = process.env.OPENAI_KEY → NO flag (env var reference)", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "src/auth.ts",
      content: "const apiKey = process.env.OPENAI_KEY;",
    })
    assert.equal(hits.length, 0)
  })

  it("variable named publicKey → NO flag", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "src/crypto.ts",
      content: "const publicKey = '-----BEGIN PUBLIC KEY-----\n...';",
    })
    assert.equal(hits.length, 0)
  })

  it("normal file path with 'key' in name → NO flag", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Edit",
      filePath: "src/ssl/key.pem",
      content: "import { readFileSync } from 'fs';\nconst cert = readFileSync('/etc/ssl/key.pem');",
    })
    assert.equal(hits.length, 0)
  })

  it("Write trigger does NOT match (rule is Edit-only)", () => {
    resetForTest([SECRETS_RULE])
    const hits = checkFlowRules({
      tool: "Write",
      filePath: ".env",
      content: "SECRET=sk-proj-abc123xyz",
    })
    assert.equal(hits.length, 0)
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
    const h2 = checkFlowRules({
      tool: "Edit",
      filePath: "src/auth.ts",
      content: 'const key = "sk-proj-abc123xyzabcdefghij"',
    })
    assert.equal(h2.length, 1)
    assert.equal(h2[0].deduped, true)
  })
})
