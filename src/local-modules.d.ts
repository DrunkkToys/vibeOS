// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// Ambient module declarations for local .js files that have no .ts equivalents.
// This file must live in src/ so that relative module paths resolve correctly.

declare module "./vibeOS-lib/flow-enforcer.js" {
  export function resolveRulesPath(): string
  export function ensureProjectDocs(dir: string, techStack?: string): void
  export function setFlowStateWriter(writer: (state: unknown) => void): void
  export function checkFlowRules(input: { tool: string; filePath?: string; content?: string }): void
  export function getFlowWarns(): Array<{ id: string; severity: string; filePath?: string; description?: string }>
  export function getSessionFlowCounts(): Record<string, number>
  export function resetForTest(rules?: unknown): void
  export function resetAll(): void
  export function addFlowRule(rule: unknown): void
  export function recordFlowTodo(input: { filePath?: string; content: string }): void
}

declare module "./vibeOS-lib/session-metrics.js" {
  export function aggregateWarns(warns: unknown[], filterFn?: (w: unknown) => boolean): number
  export function getSessionCost(state: unknown, sessionId: string): number
  export function computeSessionMetrics(state: unknown, sessionId: string): Record<string, unknown>
}

declare module "./vibeOS-lib/ml-router.js" {
  export function extractFeatures(prompt: string): Record<string, number>
  export function computeDifficulty(prompt: string): number
  export function cascadeDecide(
    prompt: string,
    cheapModelCost: number,
    mediumModelCost: number,
    brainModelCost: number,
    cheapSuccessRate: number,
  ): string
  export function hashQuery(prompt: string): string
}

declare module "./vibeOS-lib/smart-cache.js" {
  export function jaccardSimilarity(a: string[], b: string[]): number
  export function cosineSimilarity(a: number[], b: number[]): number
  export function compositeSimilarity(a: unknown, b: unknown): number
  export function createCacheDatabase(): unknown
  export function addCacheEntry(
    db: unknown,
    hash: string,
    tool: string,
    prompt: string,
    sizeBytes: number,
    ageSec: number,
  ): void
  export function recordCacheStats(db: unknown, tool: string, hit: boolean, bytesSaved: number): void
  export function predictCacheHit(db: unknown, tool: string, prompt: string): { shouldCache: boolean; shouldWarm: boolean; confidence: number; reason: string; similarEntries: Array<{ hash: string; score: number; entry: unknown; index?: number }> }
  export function evictStaleEntries(db: unknown, maxAgeSec: number): void
  export function serializeCacheDb(db: unknown): unknown
  export function deserializeCacheDb(raw: unknown): unknown
}

declare module "../../scripts/lib/opencode-homes.mjs" {
  export function resolveOpenCodeHomes(opts?: { cwd?: string; home?: string }): string[]
  export function resolveOpenCodeHome(opts?: { cwd?: string; home?: string }): string
}

declare module "../../scripts/lib/vibe-tier-agents.mjs" {
  export function installVibeTierAgentsInConfig(config: Record<string, any>, tiers?: unknown): boolean
}
