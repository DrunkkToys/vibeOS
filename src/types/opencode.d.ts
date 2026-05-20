// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// Ambient type declarations for the OpenCode plugin API.
// These types describe the 7 hook entry points and their input/output shapes.

export interface OpenCodeClient {
  config?: {
    get?: (key?: string) => Promise<unknown>
  }
  [key: string]: unknown
}

export interface HookContext {
  client?: OpenCodeClient
  directory?: string
  [key: string]: unknown
}

// ── Message types ─────────────────────────────────────────────────────

export interface MessageInfo {
  role?: string
  [key: string]: unknown
}

export interface ToolState {
  status?: string
  output?: string
  [key: string]: unknown
}

export interface ToolPart {
  type: "tool"
  tool: string
  callID?: string
  state?: ToolState
  [key: string]: unknown
}

export interface TextPart {
  type: "text"
  content: string
  [key: string]: unknown
}

export type Part = ToolPart | TextPart | { type: string; [key: string]: unknown }

export interface MessageEntry {
  info?: MessageInfo
  parts?: Part[]
  [key: string]: unknown
}

// ── Hook input/output shapes ──────────────────────────────────────────

export interface TextCompleteInput {
  text?: string
  messageId?: string
  [key: string]: unknown
}

export interface TextCompleteOutput {
  text?: string
  [key: string]: unknown
}

export interface MessageUpdatedInput {
  messageId?: string
  [key: string]: unknown
}

export interface MessageUpdatedOutput {
  messageId?: string
  text?: string
  [key: string]: unknown
}

export interface MessagesTransformInput {
  messages?: MessageEntry[]
  [key: string]: unknown
}

export interface MessagesTransformOutput {
  messages?: MessageEntry[]
  system?: string[]
  [key: string]: unknown
}

export interface SystemTransformInput {
  system?: string[]
  [key: string]: unknown
}

export interface SystemTransformOutput {
  system?: string[]
  context?: Array<{ role: string; content: string }>
  [key: string]: unknown
}

export interface ToolExecuteBeforeInput {
  tool?: string
  args?: Record<string, unknown>
  [key: string]: unknown
}

export interface ToolExecuteBeforeOutput {
  args?: Record<string, unknown>
  [key: string]: unknown
}

export interface ToolExecuteAfterInput {
  tool?: string
  args?: Record<string, unknown>
  [key: string]: unknown
}

export interface ToolExecuteAfterOutput {
  args?: Record<string, unknown>
  [key: string]: unknown
}

export interface SessionCompactingInput {
  [key: string]: unknown
}

export interface SessionCompactingOutput {
  context?: Array<{ role: string; content: string }>
  [key: string]: unknown
}

// ── Hook function types ───────────────────────────────────────────────

export type TextCompleteHook = (input: TextCompleteInput, output: TextCompleteOutput) => Promise<void>
export type MessageUpdatedHook = (input: MessageUpdatedInput, output: MessageUpdatedOutput) => Promise<void>
export type MessagesTransformHook = (input: MessagesTransformInput, output: MessagesTransformOutput) => Promise<void>
export type SystemTransformHook = (input: SystemTransformInput, output: SystemTransformOutput) => Promise<void>
export type ToolExecuteBeforeHook = (input: ToolExecuteBeforeInput, output: ToolExecuteBeforeOutput) => Promise<void>
export type ToolExecuteAfterHook = (input: ToolExecuteAfterInput, output: ToolExecuteAfterOutput) => Promise<void>
export type SessionCompactingHook = (input: SessionCompactingInput, output: SessionCompactingOutput) => Promise<void>

// ── Plugin hooks registry ─────────────────────────────────────────────

export interface PluginHooks {
  "experimental.text.complete"?: TextCompleteHook
  "message.updated"?: MessageUpdatedHook
  "experimental.chat.messages.transform"?: MessagesTransformHook
  "experimental.chat.system.transform"?: SystemTransformHook
  "tool.execute.before"?: ToolExecuteBeforeHook
  "tool.execute.after"?: ToolExecuteAfterHook
  "experimental.session.compacting"?: SessionCompactingHook
  [key: string]: unknown
}

// ── Plugin server function ────────────────────────────────────────────

export type PluginServerFn = (ctx: { client?: OpenCodeClient; directory?: string }) => Promise<PluginHooks>

// ── Node.js Process augmentation ──────────────────────────────────────

declare global {
  namespace NodeJS {
    interface Process {
      _vibeOS_cleanupRegistered?: boolean
    }
  }
}
