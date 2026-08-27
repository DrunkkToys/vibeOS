#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Seeded broken repo for the ML-orchestrator A/B. Every trial in every arm gets a
// byte-identical copy of this project, so the only variable is the model/routing.
//
// Four defects, each requiring different work to find:
//   D1 batcher off-by-one   — only visible when the item count is a multiple of maxBatch
//   D2 shared mutable default — only visible on the SECOND call
//   D3 async flush race     — only visible when a push lands during an in-flight flush
//   D4 config never read    — only findable by reading a file the buggy module never mentions
//
// The visible smoke test PASSES against the broken code, so `npm test` does not
// point at the bugs. The grading suite lives in ./hidden and is copied in only
// after the session has ended.

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const FILES = {
  "package.json": JSON.stringify({
    name: "evtpipe",
    version: "0.1.0",
    type: "module",
    scripts: { test: "node --test \"tests/**/*.test.mjs\"" },
  }, null, 2) + "\n",

  "README.md": `# evtpipe

A small event pipeline: events are enriched, batched, and flushed to a sink.

    import { createPipeline } from "./src/pipeline.mjs"

    const pipe = createPipeline(async (batch) => { ... })
    pipe.push({ type: "click" })
    await pipe.drain()

Runtime behaviour is driven by \`pipeline.config.json\`.

\`push(event)\` returns the number of events emitted as a batch, or 0 if the
event was only buffered. \`stats()\` reports pipeline counters.

Run the tests with \`npm test\`.
`,

  "pipeline.config.json": JSON.stringify({
    maxBatch: 4,
    flushIntervalMs: 50,
    dropPolicy: "reject-oldest",
  }, null, 2) + "\n",

  "src/batcher.mjs": `// Buffers events and emits a batch once the buffer is full.
export class Batcher {
  constructor(maxBatch) {
    this.maxBatch = maxBatch
    this.buf = []
  }

  push(item) {
    this.buf.push(item)
    if (this.buf.length > this.maxBatch) return this.flush()
    return null
  }

  flush() {
    const batch = this.buf
    this.buf = []
    return batch
  }

  drain() {
    return this.buf.length ? this.flush() : null
  }
}
`,

  "src/enricher.mjs": `const DEFAULT_TAGS = []

// Attaches provenance tags to an event.
export function enrich(event, tags = DEFAULT_TAGS) {
  tags.push(event.type)
  return { ...event, tags, at: event.at ?? 0 }
}
`,

  "src/flusher.mjs": `// Ships queued events to an async sink.
export class Flusher {
  constructor(sink) {
    this.sink = sink
    this.queue = []
    this.emitted = 0
  }

  push(item) {
    this.queue.push(item)
  }

  async flush() {
    if (!this.queue.length) return 0
    const pending = this.queue
    await this.sink(pending)
    this.queue = []
    this.emitted += pending.length
    return pending.length
  }
}
`,

  "src/pipeline.mjs": `import { Batcher } from "./batcher.mjs"
import { enrich } from "./enricher.mjs"
import { Flusher } from "./flusher.mjs"

const MAX_BATCH = 16

export function createPipeline(sink) {
  const batcher = new Batcher(MAX_BATCH)
  const flusher = new Flusher(sink)

  return {
    push(event) {
      const batch = batcher.push(enrich(event))
      if (batch) for (const item of batch) flusher.push(item)
      return batch ? batch.length : 0
    },
    async drain() {
      const batch = batcher.drain()
      if (batch) for (const item of batch) flusher.push(item)
      return flusher.flush()
    },
    stats() {
      return { emitted: flusher.emitted }
    },
  }
}
`,

  "tests/smoke.test.mjs": `import test from "node:test"
import assert from "node:assert/strict"
import { createPipeline } from "../src/pipeline.mjs"

test("pipeline ships events to the sink", async () => {
  const seen = []
  const pipe = createPipeline(async (batch) => { seen.push(...batch) })
  pipe.push({ type: "click" })
  pipe.push({ type: "scroll" })
  await pipe.drain()
  assert.equal(seen.length, 2)
  assert.equal(seen[0].type, "click")
})
`,
}

export function generateTask(dir) {
  for (const [rel, body] of Object.entries(FILES)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, body)
  }
  return dir
}

export const TASK_FILES = Object.keys(FILES)
