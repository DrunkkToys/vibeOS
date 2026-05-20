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
  export function createPatternGraph(): unknown
  export function ensureNode(graph: unknown, id: string, kind: string): void
  export function addRouteEdge(graph: unknown, queryWord: string, modelName: string, tier: string, success: boolean): void
  export function predictBestModel(graph: unknown, firstWord: string, tierPreference: string): string
  export function serializeGraph(graph: unknown): unknown
  export function deserializeGraph(raw: unknown): unknown
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
  export function predictCacheHit(db: unknown, tool: string, prompt: string): { shouldWarm: boolean; confidence: number; reason: string }
  export function evictStaleEntries(db: unknown, maxAgeSec: number): void
  export function serializeCacheDb(db: unknown): unknown
  export function deserializeCacheDb(raw: unknown): unknown
}

declare module "./vibeOS-lib/blackbox/local-stub.js" {
  export class LocalBlackboxStub {
    history: unknown[]
    loopCount: number
    extractFeatures(text: string): Record<string, number>
    classifyAction(text: string): string
    computeEntropy(features: Record<string, number>): number
    computeUncertainty(features: Record<string, number>): number
    update(text: string): Record<string, unknown>
    detectBasicLoop(text: string): boolean
    getLoopCount(): number
    serialize(): unknown
    deserialize(raw: unknown): void
  }
}

declare module "./vibeOS-mcp-server.js" {
  export function createMcpServer(deps: Record<string, unknown>): {
    start: (port: number) => Promise<unknown>
    close: () => Promise<void>
    [key: string]: unknown
  }
}

declare module "./vibeOS-api-server/client.js" {
  export class VibeOSApiClient {
    constructor(options?: { baseUrl?: string; apiToken?: string; masterKey?: string; timeout?: number; fallbackStubs?: unknown })
    baseUrl: string
    apiToken: string | null
    masterKey: string | null
    timeout: number
    fallbackMode: boolean
    fallbackStubs: unknown
    request(path: string, body?: unknown, isAdmin?: boolean): Promise<unknown>
    isFallbackMode(): boolean
    getFallbackStubs(): unknown
    [key: string]: unknown
  }
  export class VibeOSAuthError extends Error {
    constructor(message: string, status: number, code?: string)
    status: number
    code?: string
  }
  export class VibeOSNetworkError extends Error {
    constructor(message: string)
  }
  export class VibeOSTimeoutError extends Error {
    constructor(message: string)
  }
}
