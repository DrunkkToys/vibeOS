#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Seeded broken dataset-build pipeline for the ML-orchestrator A/B. Every trial in
// every arm gets a byte-identical copy, so the only variable is the model/routing.
//
// The defects are not invented. They are the five findings the 2026-06-10 dataset
// audit recorded against a real LLM training corpus, reproduced in miniature:
//
//   D1 echo rows survive     — the echo filter compares raw strings, so a completion
//                              that differs from its prompt only by trailing space
//                              passes. The real audit removed 45 of these by hand.
//   D2 artifacts survive     — the artifact filter matches one error shape, so API
//                              errors in any other shape become training rows. The
//                              real audit removed 123 of these by hand.
//   D3 dedup keys on id      — content duplicates carrying distinct ids all survive.
//                              This is the real 4,859 -> 4,858 signature: a dedup
//                              pass that reports success having removed one row.
//   D4 config never read     — dsforge.config.json declares the split ratios and the
//                              pipeline hardcodes different ones. Only findable by
//                              reading a file the modules never mention.
//   D5 splits are unstratified (PIVOT) — rows are sliced in file order, so a label
//                              that sits together in the corpus lands entirely in one
//                              split. The real report showed math at 4 rows and
//                              writing at 1, unusable for validation.
//
// The visible smoke test PASSES against the broken code. The grading suite lives in
// ./hidden and is copied in only after the session has ended.

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Deterministic, no RNG: every trial must diff to nothing.
const CLEAN_SPEC = [
  ["answer", 30],
  ["code", 25],
  ["reasoning", 20],
  ["logic", 15],
  ["math", 10],
  ["writing", 8],
  ["knowledge", 6],
]

const PROMPT_STEM = {
  answer: "What does the flush interval control in a streaming ingest job",
  code: "Write a function that merges two sorted arrays without allocating a third",
  reasoning: "A cache shows 95% hit rate but latency rose. Explain what could cause that",
  logic: "If every A is B, and some B are C, does it follow that some A are C",
  math: "Compute the expected number of draws to see every one of six coupons",
  writing: "Rewrite this release note so it leads with the user-visible change",
  knowledge: "What is the difference between a write-through and a write-back cache",
}

const COMPLETION_STEM = {
  answer: "The flush interval bounds how long an event may sit buffered before the sink sees it",
  code: "Walk both inputs with two cursors and write into the longer input from the end",
  reasoning: "Hit rate counts requests, not cost, so a few expensive misses can dominate the mean",
  logic: "No. The B that are C need not overlap the B that are A, so the conclusion does not follow",
  math: "Sum the per-stage waiting times, which gives six times the sixth harmonic number",
  writing: "Lead with what changed for the reader, then the mechanism, then the migration note",
  knowledge: "Write-through commits to the backing store on every write; write-back defers it",
}

// Rows are laid out label-block by label-block, on purpose: an unstratified split
// that slices in file order then puts an entire label in one bucket, which is D5.
function cleanRows() {
  const rows = []
  let n = 0
  for (const [label, count] of CLEAN_SPEC) {
    for (let i = 0; i < count; i++) {
      n++
      rows.push({
        id: `r${String(n).padStart(4, "0")}`,
        source: "seed-corpus",
        label,
        prompt: `${PROMPT_STEM[label]} (case ${i + 1})?`,
        completion: `${COMPLETION_STEM[label]}, specifically for case ${i + 1}.`,
      })
    }
  }
  return rows
}

function pathologicalRows(base) {
  const rows = []
  let n = base.length

  // D1. Three echoes are byte-identical and the filter does catch those, which is
  // what makes it look alive. Eight differ only by trailing whitespace or case and
  // sail straight through.
  for (let i = 0; i < 3; i++) {
    n++
    const p = `${PROMPT_STEM.answer} (echo exact ${i + 1})?`
    rows.push({ id: `r${String(n).padStart(4, "0")}`, source: "sft-bundle", label: "answer", prompt: p, completion: p })
  }
  const echoTails = ["\n", " ", "\n\n", "\t", "  \n", " \n ", "\r\n", "   "]
  for (let i = 0; i < echoTails.length; i++) {
    n++
    const p = `${PROMPT_STEM.reasoning} (echo soft ${i + 1})?`
    rows.push({ id: `r${String(n).padStart(4, "0")}`, source: "sft-bundle", label: "reasoning", prompt: p, completion: p + echoTails[i] })
  }

  // D2. Two artifacts use the one shape the filter knows. Six use shapes it does not:
  // leading whitespace, a pretty-printed body, and a different error key entirely.
  for (let i = 0; i < 2; i++) {
    n++
    rows.push({
      id: `r${String(n).padStart(4, "0")}`, source: "sft-star", label: "code",
      prompt: `${PROMPT_STEM.code} (artifact known ${i + 1})?`,
      completion: `{"error": "upstream timeout", "status": 504}`,
    })
  }
  const artifactBodies = [
    `  {"error": "upstream timeout", "status": 504}`,
    `\n{"error": "context length exceeded", "status": 400}`,
    `{\n  "error": "service overloaded",\n  "status": 503\n}`,
    `{"message": "rate limited", "code": 429}`,
    `{"message": "Insufficient balance", "type": "CreditsError"}`,
    `   {"detail": {"message": "upstream refused", "code": 502}}`,
  ]
  for (let i = 0; i < artifactBodies.length; i++) {
    n++
    rows.push({
      id: `r${String(n).padStart(4, "0")}`, source: "sft-star", label: "code",
      prompt: `${PROMPT_STEM.code} (artifact subtle ${i + 1})?`,
      completion: artifactBodies[i],
    })
  }

  // D3. Ten exact content duplicates of rows already in the corpus, each carrying a
  // fresh id and a different source -- exactly how a merge of two overlapping dumps
  // produces them. An id-keyed dedup keeps every one.
  for (let i = 0; i < 10; i++) {
    const src = base[i * 7]
    n++
    rows.push({ id: `r${String(n).padStart(4, "0")}`, source: "merged-dump", label: src.label, prompt: src.prompt, completion: src.completion })
  }

  // ...and one row that repeats an id already used, so the broken dedup removes
  // exactly one row and reports a clean pass. That is the 4,859 -> 4,858 signature.
  rows.push({ id: base[0].id, source: "merged-dump", label: base[0].label, prompt: base[0].prompt, completion: base[0].completion })

  return rows
}

const CLEAN = cleanRows()
const PATHOLOGICAL = pathologicalRows(CLEAN)
const ALL_ROWS = [...CLEAN, ...PATHOLOGICAL]

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n"

const FILES = {
  "package.json": JSON.stringify({
    name: "dsforge",
    version: "0.1.0",
    type: "module",
    scripts: { test: "node --test tests/*.test.mjs" },
  }, null, 2) + "\n",

  "README.md": `# dsforge

Builds a supervised fine-tuning corpus for a small language model.

    import { loadRaw } from "./src/load.mjs"
    import { build } from "./src/pipeline.mjs"

    const rows = loadRaw("./raw")
    const { splits, report } = build(rows)

A row is \`{ id, source, label, prompt, completion }\`.

\`loadRaw(dir)\` reads every \`*.jsonl\` under \`dir\` and returns the rows in file
order. \`build(rows)\` cleans, de-duplicates and splits them, and returns
\`{ splits: { train, valid, test }, report }\`.

Runtime behaviour is driven by \`dsforge.config.json\`.

Split sizes follow the configured ratios: \`train\` takes \`floor(n * train)\` rows,
\`valid\` takes \`floor(n * valid)\`, and \`test\` takes whatever remains.

Run the tests with \`npm test\`.
`,

  "dsforge.config.json": JSON.stringify({
    seed: 42,
    minRows: 100,
    labels: ["answer", "code", "reasoning", "logic", "math", "writing", "knowledge"],
    dedupOn: ["prompt", "completion"],
    splitRatios: { train: 0.7, valid: 0.15, test: 0.15 },
  }, null, 2) + "\n",

  "raw/seed-corpus.jsonl": jsonl(CLEAN),
  "raw/merged-dump.jsonl": jsonl(PATHOLOGICAL),

  "src/load.mjs": `import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

export function loadRaw(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()
  const rows = []
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf-8")
    for (const line of text.split("\\n")) {
      if (!line.trim()) continue
      rows.push(JSON.parse(line))
    }
  }
  return rows
}
`,

  "src/clean.mjs": `// Drops rows that are not training data: completions that merely echo the prompt,
// and API error bodies that were captured as if they were answers.

export function isEcho(row) {
  return row.completion === row.prompt
}

export function isArtifact(row) {
  return String(row.completion || "").startsWith('{"error"')
}

export function clean(rows) {
  return rows.filter((r) => !isEcho(r) && !isArtifact(r))
}
`,

  "src/dedup.mjs": `// Removes rows already present in the corpus.

export function dedup(rows) {
  const seen = new Set()
  const out = []
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}
`,

  "src/split.mjs": `// Partitions the corpus into train/valid/test.

export function split(rows) {
  const n = rows.length
  const nTrain = Math.floor(n * 0.8)
  const nValid = Math.floor(n * 0.1)
  return {
    train: rows.slice(0, nTrain),
    valid: rows.slice(nTrain, nTrain + nValid),
    test: rows.slice(nTrain + nValid),
  }
}
`,

  "src/pipeline.mjs": `import { clean } from "./clean.mjs"
import { dedup } from "./dedup.mjs"
import { split } from "./split.mjs"

export function labelCounts(rows) {
  const counts = {}
  for (const r of rows) counts[r.label] = (counts[r.label] || 0) + 1
  return counts
}

export function build(rows) {
  const cleaned = clean(rows)
  const deduped = dedup(cleaned)
  const splits = split(deduped)
  return {
    splits,
    report: {
      raw: rows.length,
      cleaned: cleaned.length,
      dedup: { before: cleaned.length, after: deduped.length },
      splits: { train: splits.train.length, valid: splits.valid.length, test: splits.test.length },
      labels: labelCounts(deduped),
    },
  }
}
`,

  "tests/smoke.test.mjs": `import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { loadRaw } from "../src/load.mjs"
import { build } from "../src/pipeline.mjs"

const RAW = fileURLToPath(new URL("../raw", import.meta.url))

test("the pipeline produces three non-empty splits", () => {
  const { splits } = build(loadRaw(RAW))
  assert.ok(splits.train.length > 0)
  assert.ok(splits.valid.length > 0)
  assert.ok(splits.test.length > 0)
})

test("no row is lost or invented by splitting", () => {
  const { splits, report } = build(loadRaw(RAW))
  const total = splits.train.length + splits.valid.length + splits.test.length
  assert.equal(total, report.dedup.after)
})

test("the report counts every raw row", () => {
  const rows = loadRaw(RAW)
  const { report } = build(rows)
  assert.equal(report.raw, rows.length)
})
`,
}

export function generateTask(dir) {
  for (const [rel, content] of Object.entries(FILES)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] || "."
  generateTask(target)
  console.log(`dsforge written to ${target} (${ALL_ROWS.length} raw rows)`)
}
