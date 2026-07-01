// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>

import { promises as fs } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { resolveVibeOSHome } from "./runtime-paths.js"

export interface OrchProject {
  id: string
  name: string
  fingerprint: string | null
  default_flow_id: string | null
  created_at: string
  updated_at: string
}

export interface OrchMessage {
  id: string
  role: "user" | "assistant"
  content: string
  plan: unknown | null
  results: unknown[] | null
  created_at: string
}

export interface OrchSessionRecord {
  id: string
  project_id: string
  title: string
  flow_id: string | null
  messages: OrchMessage[]
  created_at: string
  updated_at: string
}

export interface FlowNode {
  id: string
  tool: string
  label?: string
  condition?: Record<string, unknown> | null
  tier?: string
  x?: number
  y?: number
}

export interface FlowEdge {
  from: string
  to: string
}

export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface OrchFlow {
  id: string
  scope: "global" | "project"
  project_id: string | null
  name: string
  graph: FlowGraph
  created_at: string
  updated_at: string
}

function vibeOSHome(): string {
  return process.env.VIBEOS_HOME || resolveVibeOSHome()
}

function orchPath(filename: string): string {
  return join(vibeOSHome(), filename)
}

async function readOrchFile<T>(filename: string, defaultValue: T): Promise<T> {
  try {
    const raw = await fs.readFile(orchPath(filename), "utf8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T : defaultValue
  } catch {
    return defaultValue
  }
}

async function writeOrchFile(filename: string, data: unknown): Promise<void> {
  const dir = vibeOSHome()
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(orchPath(filename), JSON.stringify(data, null, 2), "utf8")
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export async function readProjects(): Promise<OrchProject[]> {
  return readOrchFile<OrchProject[]>("orch-projects.json", [])
}

export async function writeProjects(projects: OrchProject[]): Promise<void> {
  return writeOrchFile("orch-projects.json", projects)
}

export async function readSessions(): Promise<OrchSessionRecord[]> {
  return readOrchFile<OrchSessionRecord[]>("orch-sessions.json", [])
}

export async function writeSessions(sessions: OrchSessionRecord[]): Promise<void> {
  return writeOrchFile("orch-sessions.json", sessions)
}

export async function readFlows(): Promise<OrchFlow[]> {
  return readOrchFile<OrchFlow[]>("orch-flows.json", [])
}

export async function writeFlows(flows: OrchFlow[]): Promise<void> {
  return writeOrchFile("orch-flows.json", flows)
}
