// @ts-nocheck
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import {
  currentTier, currentModel, currentProjectFingerprint, currentProjectName,
  _OC_SID, _modelLocked, _blackboxEnabled, _autoReportCount, 
  loadSelection, writeSelection, readLifetimeSavings,
  updateState, withFileLock, safeJsonParse, applyDecadence,
  getSessionScratchpadDir, ensureSessionScratchpadDirs, getSessionIndexPath,
  indexAppend, scratchpadHitsSeen, briefedProjects,
  loadActiveJobs, getActiveJobForProject,
  loadProjectState, saveProjectState, ensureProjectBucket,
  detectTechStack, projectFingerprint,
  loadMLState, saveMLState,
  TRINITY_OPENCODE_CONFIG, TRINITY_OPENCODE_CONFIGC, TIERS_FILE,
  loadGlobalLearning, updateGlobalLearning, DFLT_GL,
  getLearnedExploratoryWords,
  setCurrentModel, setCurrentTier,
} from '../state.js'
import {
  classify, modelCostPerTurn, isModelFree, detectContext7, isDocsTarget,
  shortModelName, formatUsd, _refreshModel, TRINITY_CHEAP, TRINITY_MEDIUM, TRINITY_BRAIN,
} from '../pricing.js'
import {
  scoreStress, classifyTurnSimple, computeControlVector, loadOptimizationMode,
  saveOptimizationMode,
  getBlackboxTracker, getBlackboxResolution,
  loadBlackboxState as loadBlackboxStateFromCtx, saveBlackboxState as saveBlackboxStateToCtx,
  resolveEnforcementMode, extractLastUserText,
  isUserAskingForTests, isLikelyOffTopic,
  updateGlobalLearning as _updateGlobalLearning,
  noteTaskRoutingLearning,
  fetchBlackboxEnrichment,
  estimateContextBudget,
  buildControlHistoryEntry,
} from '../turn-classify.js'
import { getApiClient, remoteCall } from '../api-client.js'
import { loadCredit } from '../credit-api.js'
import { saveReport } from '../reporting.js'
import { checkFlowRules, recordFlowTodo } from '../../vibeOS-lib/flow-enforcer.js'
import { ensureProjectDocs } from '../../vibeOS-lib/flow-enforcer.js'
import { computeDifficulty } from '../../vibeOS-lib/ml-router.js'
import { loadSessionSlot, writeSessionSlot } from '../selection-manager.js'
import { noteProjectPattern } from '../index-helpers.js'
import { saveSessionStress } from '../index-helpers.js'

let latestUserIntent = null
let currentProjectFingerprint = ''
let fp = ''
let _OC_SID = 'opencode-' + (process.pid || 'x') + '-' + Date.now()
let _latestBlackboxState = null
let _latestBlackboxLoopMsg = null
let _latestBlackboxPivotMsg = null
let _prevOutputText = ''
const briefedProjects = new Set()
const correctionSeenKeys = new Set()

async function apiComputeControlVector(state: any, action: any, optimizationMode: any): Promise<any> {
  try {
    const res = await remoteCall('blackboxControlVector', [state, action, optimizationMode], null)
    if (res?.control_vector) return res.control_vector
  } catch {}
  return computeControlVector(state, action, optimizationMode)
}

function observeUserCorrection(text: string | null): void {
  if (!text || typeof text !== "string") return
  try {
    const t = text.toLowerCase()
    const corrections: string[] = []
    if (/wrong\b|that.s wrong|incorrect|not what i|didn.t mean|misunderstood/i.test(t)) {
      if (/\bimport\b|require\b|from\b|path\b|module\b/i.test(t)) corrections.push("correction:imports")
      if (/\bfunction\b|logic\b|algorithm\b|calculation\b|formula\b|return\b|result\b/i.test(t) && !corrections.includes("correction:imports")) corrections.push("correction:logic")
      if (/\brename\b|variable\b|const\b|let\b|var\b|name\b|called\b/i.test(t) && !corrections.includes("correction:logic")) corrections.push("correction:naming")
      if (/\bdelete\b|remove\b|get rid\b|revert\b|undo\b|rollback\b/i.test(t)) corrections.push("correction:deletion")
      if (/\brestructure\b|refactor\b|reorganize\b|move\b|split\b|extract\b/i.test(t) && !corrections.includes("correction:deletion")) corrections.push("correction:restructure")
      if (corrections.length === 0) corrections.push("correction:general")
    }
    if (corrections.length === 0 && /\bshould be\b|change .+ to\b|replace .+ with\b|instead of\b/i.test(t)) {
      corrections.push("correction:general")
    }
    for (const c of corrections) {
      const sessionKey = `friction:${c}`
      if (correctionSeenKeys.has(sessionKey)) continue
      correctionSeenKeys.add(sessionKey)
      try {
        noteProjectPattern("friction", c, `User corrected ${c.replace("correction:", "")} in a follow-up message.`, { family: c })
      } catch {}
    }
  } catch {}
}

function buildProjectBriefing(directory: string): string | null {
  const label = currentProjectName || (directory ? basename(directory) : "")
  if (!label) return null
  return `[project memory] Active project: ${label}. Stay focused on the current repository and prefer the existing workflow.`
}

export function syncControlSettings(cv: any): void {
  if (!cv) return
  try {
    const sid = _OC_SID
    const writeIf = (key: string, val: any) => {
      const sel = loadSelection()
      if (sel[key] !== val) writeSelection(key, val)
    }
    if (cv.enforcement_mode === "relaxed") writeIf("delegation_enforce", false)
    else writeIf("delegation_enforce", true)

    if (cv.flow_mode === "audit") {
      writeIf("flow_enabled", false)
      writeIf("flow_enforce", false)
    } else {
      writeIf("flow_enabled", true)
      writeIf("flow_enforce", cv.flow_mode === "strict")
    }

    if (cv.tdd_mode === "lazy") {
      writeIf("tdd_enforce", false)
      writeIf("tdd_strict", false)
    } else {
      writeIf("tdd_enforce", true)
      writeIf("tdd_strict", cv.tdd_mode === "strict")
    }

    if (cv.thinking_mode) writeIf("thinking_level", cv.thinking_mode)

    if (cv.optimization_mode) {
      const existingMode = loadSessionSlot(sid + "_opt")
      if (existingMode !== cv.optimization_mode) {
        writeSessionSlot(sid + "_opt", cv.optimization_mode)
        saveOptimizationMode(cv.optimization_mode)
      }
    }

    const slot = cv.tier_bias
    if (slot && slot !== "auto") {
      const existingSlot = loadSessionSlot(sid)
      if (existingSlot !== slot) {
        writeSessionSlot(sid, slot)
      }
      if (slot === "brain" && TRINITY_BRAIN) {
        setCurrentModel(TRINITY_BRAIN)
        setCurrentTier("high")
      }
      else if (slot === "medium" && TRINITY_MEDIUM) {
        setCurrentModel(TRINITY_MEDIUM)
        setCurrentTier("mid")
      }
      else if (slot === "cheap" && TRINITY_CHEAP) {
        setCurrentModel(TRINITY_CHEAP)
        setCurrentTier("low")
      }
    }
  } catch { /* noop — non-critical sync */ }
}

export const onMessagesTransform = async (_input, output) => {
      if (!loadSelection().enabled) return
      try {
        const messages = output?.messages
        if (!Array.isArray(messages)) return

        // OC message format: { info: Message, parts: Part[] }
        // Tool results live in ToolPart: { type: "tool", tool: string, callID: string, state: ToolState }
        // ToolStateCompleted: { status: "completed", output: string, ... }

        // ── Context compression ────────────────────────────────────────────
        const COMPRESS_THRESHOLD = 2000
        const KEEP_HOT = 10  // last 10 messages (~5 turns) stay verbatim
        const COMPRESS_MARKER = "[ctx-compressed-v1]"
        const hotStart = Math.max(0, messages.length - KEEP_HOT)
        let compressedBytes = 0

        for (let i = 0; i < messages.length; i++) {
          const { info, parts } = messages[i]
          if (!Array.isArray(parts)) continue
          const isCold = i < hotStart

          for (const part of parts) {
            if (part?.type !== "tool") continue
            const state = part.state
            if (state?.status !== "completed") continue
            const raw = state.output
            if (!raw || typeof raw !== "string" || raw.length < COMPRESS_THRESHOLD) continue
            if (raw.includes(COMPRESS_MARKER)) continue

            // Always write to disk — hot or cold.
            const hash = createHash("sha256")
              .update(`tool_result\n${raw}\n`).digest("hex").slice(0, 16)
            const fullPath = join(getSessionScratchpadDir(), `${hash}.txt`)
            try {
              ensureSessionScratchpadDirs()
              if (!existsSync(fullPath)) {
                writeFileSync(fullPath, raw)
                indexAppend(hash, part.tool, raw.length)
              }
            } catch (err) {
              console.error(`[vibeOS] ctx-compress write failed: ${err.message}`)
              continue
            }

            if (!isCold) continue  // hot: disk backup only, keep full content in context

            const summary = raw.slice(0, 200).replace(/\n+/g, " ").trim() + (raw.length > 200 ? "…" : "")
            const ref =
              `${COMPRESS_MARKER} [${raw.length} chars compressed — cold storage at ${fullPath}] ` +
              `[summary] ${summary}`

            state.output = ref
            compressedBytes += raw.length - ref.length
            console.error(`[vibeOS] 📦 ctx-compress: ${raw.length}→${ref.length} chars (hash: ${hash})`)
          }
        }
        if (compressedBytes > 0) {
          console.error(`[vibeOS] 📦 ctx-compress total saved this transform: ~${Math.round(compressedBytes / 4)} tokens`)
        }

        // ── Worker-to-Brain Report Protocol ───────────────────────────────
        // Find assistant messages containing a completed task ToolPart; inject
        // WBP directive into the next user message's first TextPart.
        const PROTOCOL_MARKER = "[wbp-v1]"
        const PROTOCOL_TEXT =
          PROTOCOL_MARKER +
          " [Worker-to-Brain Report Protocol] When synthesizing the preceding Task output: " +
          "1) EXTRACT core findings/data. " +
          "2) REFORMAT into bullet points. " +
          "3) VERIFY against the original ask. " +
          "4) SYNTHESIZE into final response."

        for (let i = 0; i < messages.length - 1; i++) {
          const { info, parts } = messages[i]
          if (!Array.isArray(parts)) continue
          const hasTask = parts.some(p => p?.type === "tool" && p?.tool === "task" && p?.state?.status === "completed")
          if (!hasTask) continue

          const nextMsg = messages[i + 1]
          if (!Array.isArray(nextMsg?.parts)) continue
          const alreadyHas = nextMsg.parts.some(p => p?.type === "text" && p?.text?.includes(PROTOCOL_MARKER))
          if (alreadyHas) continue

          // Append WBP to the first TextPart of the next message, or create a synthetic one.
          const textPart = nextMsg.parts.find(p => p?.type === "text")
          if (textPart) {
            textPart.text = textPart.text + "\n\n" + PROTOCOL_TEXT
          } else {
            nextMsg.parts.push({ type: "text", text: PROTOCOL_TEXT, synthetic: true })
          }
        }

        // ── Progressive decadence — age-based cache rotation ──────
        applyDecadence()

        // ── Blackbox resolution tracking ───────────────────────────────────
        const lastUserMsg = messages.slice().reverse().find(m => m.info?.role === "user")
        if (lastUserMsg) {
          const textPart = lastUserMsg.parts?.find(p => p?.type === "text")
          if (textPart?.text) {
            latestUserIntent = textPart.text
            try {
              if (_blackboxEnabled) {
                const tracker = getBlackboxTracker()
                const localState = tracker.update(latestUserIntent)
                const state = loadBlackboxStateFromCtx()
                const sid = _OC_SID
                const serialized = tracker.serialize()
                serialized.project_fingerprint = currentProjectFingerprint || ""
                if (!state.sessions[sid]) state.sessions[sid] = {}
                state.sessions[sid].control_history ??= []
                const st = scoreStress(latestUserIntent); if (st) { localState.latest_stress_multiplier = st; saveSessionStress(st, st > 1.5 ? "critical" : st > 0.7 ? "elevated" : st > 0.3 ? "moderate" : "none") }
                const cv = await apiComputeControlVector(localState, undefined, loadOptimizationMode())
                state.sessions[sid].control_history.push(buildControlHistoryEntry(
                  state.sessions[sid].control_history.length + 1,
                  localState.sub_regime || "INIT",
                  cv,
                ))
                if (state.sessions[sid].control_history.length > 100) {
                  state.sessions[sid].control_history = state.sessions[sid].control_history.slice(-100)
                }
                state.sessions[sid] = serialized
                saveBlackboxStateToCtx(state)
                _latestBlackboxState = localState
                fetchBlackboxEnrichment(sid, localState).then(enriched => {
                  if (enriched) _latestBlackboxState = enriched
                }).catch(() => {})
              }
            } catch {}
          }
        }
      } catch (err) {
        console.error(`[vibeOS] messages.transform failed: ${err.message}`)
      }
    }

export const onSystemTransform = async (_input, output) => {
      if (!loadSelection().enabled) return
      try {
        if (!latestUserIntent) {
          const userText = extractLastUserText(_input) || extractLastUserText(output)
          latestUserIntent = typeof userText === "string" ? userText : null
        }
        if (latestUserIntent) observeUserCorrection(latestUserIntent)

        let _controlVector = null
        if (_latestBlackboxState) {
          const st = latestUserIntent ? scoreStress(latestUserIntent) : 0; if (st) _latestBlackboxState.latest_stress_multiplier = st
          _controlVector = await apiComputeControlVector(_latestBlackboxState, undefined, loadOptimizationMode())
        } else if (latestUserIntent) {
          const st = scoreStress(latestUserIntent)
          _controlVector = await apiComputeControlVector({ sub_regime: classifyTurnSimple(latestUserIntent), latest_stress_multiplier: st || undefined }, undefined, loadOptimizationMode())
        }

        syncControlSettings(_controlVector)

        // Context7 directive — model self-determines tool availability.
        const c7urgency = _controlVector?.context7_urgency || "preferred"
        const c7directive =
          "[cost policy] If mcp__context7__resolve-library-id and mcp__context7__get-library-docs " +
          "tools are available in this session, ALWAYS use them instead of WebFetch or WebSearch " +
          "when looking up library or framework documentation " +
          "(docs.*, readthedocs.*, npmjs.com/package/*, pypi.org/project/*, pkg.go.dev, /api/reference/). " +
          "Do not fetch those URLs directly when context7 can serve the same content. " +
          "This saves ~$0.06/turn on average." +
          (c7urgency === "required" ? " CRITICAL: context7 usage is REQUIRED this turn." : "") +
          (c7urgency === "optional" ? " (context7 is optional this turn — use if helpful but not required.)" : "")

        // Thinking-level directive — always inject when set (default is "brief" for cost savings).
        const sel = loadSelection()
        const { thinking_level: explicitLevel } = sel
        if (explicitLevel && explicitLevel !== "full" && Array.isArray(output?.system)) {
          const credit = loadCredit()
          const creditNote = `credit ${credit}%`
          const directives = {
            brief: `[thinking policy] Reasoning depth: BRIEF (manually set, ${creditNote}). Use extended thinking only for genuinely complex multi-step problems. Keep reasoning concise — skip exploratory scratch work and restatement.`,
            off:   `[thinking policy] Reasoning depth: OFF (manually set, ${creditNote}). Skip extended thinking entirely. Respond directly and concisely. Every thinking token costs money — save it for when the user explicitly asks.`,
          }
          const d = directives[explicitLevel]
          if (d) output.system.push(d)
        }

        if (Array.isArray(output?.system)) {
          output.system.push(c7directive)
        }

        if (latestUserIntent) {
          const stressMult = _controlVector?.stress_multiplier ?? 1.0
          const _s = scoreStress(latestUserIntent) * stressMult
          if (_s > 0.7) {
            if (Array.isArray(output?.system)) output.system.push(
              "[stress mitigation: CRITICAL] The user's message shows very high stress indicators. " +
              "Stay calm, structured, and thorough. Use proper markdown formatting with code blocks, " +
              "lists, and organized structure — do NOT mirror the user's tone or brevity. " +
              "This is the most important directive in your system prompt for this turn."
            )
          } else if (_s > 0.4) {
            if (Array.isArray(output?.system)) output.system.push(
              "[stress mitigation: elevated] The user's message has elevated stress indicators. " +
              "Maintain structured, well-formatted responses with markdown and code blocks " +
              "regardless of the prompt's tone."
            )
          }
        }

        // Unified control vector directives (v2 meta-controller)
        if (_controlVector && _controlVector.directives.length > 0) {
          for (const directive of _controlVector.directives) {
            if (Array.isArray(output?.system)) output.system.push(directive)
          }
        } else if (_blackboxEnabled && _latestBlackboxState && _latestBlackboxState.n_interactions > 0) {
          // Fallback: legacy ad-hoc blackbox directives (pre-v2)
          try {
            const res = _latestBlackboxState
            const decisionDirective =
              `[decision engine] Current resolution: ${res.resolution || "unresolved"} (${res.sub_regime || "EXPLORING"}). ` +
              `Momentum: ${(res.momentum || 0) > 0 ? "positive" : (res.momentum || 0) < 0 ? "negative" : "neutral"}. ` +
              `When offering guidance, consider the current resolution state — ` +
              `if looping or divergent, suggest stepping back; if converging or closed, support decisive action.`
            if (Array.isArray(output?.system)) output.system.push(decisionDirective)

            if (res.is_looping && res.loop_intervention_level && res.loop_intervention_level !== "none") {
              const severity = res.loop_intervention_level === "escalated" ? "CRITICAL"
                : res.loop_intervention_level === "assertive" ? "WARNING" : "NOTICE"
              const loopDirective =
                `[loop prevention: ${severity}] ${_latestBlackboxLoopMsg || "The conversation may be looping — try a different approach."} ` +
                `(level: ${res.loop_intervention_level})`
              if (Array.isArray(output?.system)) output.system.push(loopDirective)
            }

            if (res.pivot_detected && _latestBlackboxPivotMsg) {
              if (Array.isArray(output?.system)) output.system.push(`[context switch: PIVOT] ${_latestBlackboxPivotMsg}`)
            }
          } catch {}
        }

        const projectJob = getActiveJobForProject()
        if (latestUserIntent && projectJob && isLikelyOffTopic(latestUserIntent, projectJob)) {
          const offTopicDirective =
            `[job-focus] Active job context exists: "${(projectJob.prompt || "").slice(0, 140)}...". ` +
            `The latest user request appears off-topic relative to this running job. ` +
            `Before taking write/edit/task actions, ask one concise confirmation question to validate switching scope.`
          if (Array.isArray(output?.system)) output.system.push(offTopicDirective)
          console.error("[vibeOS] [job-focus] off-topic request detected vs active job context")
        }

        // AI ORCHESTRATOR AGENT — only when delegation enforcement is active
        // and enforcement is not relaxed (meta-controller already covers relaxed mode).
        if (sel.delegation_enforce && _controlVector?.enforcement_mode !== "relaxed" && Array.isArray(output?.system)) {
          const tierBias = _controlVector?.tier_bias || "auto"
          const cheapModel = TRINITY_CHEAP || "the cheaper model"
          const mediumModel = TRINITY_MEDIUM || "the medium model"
          let brainModel = "(brain)"
          try { brainModel = safeJsonParse(readFileSync(TIERS_FILE, "utf-8")).trinity?.brain?.oc || brainModel } catch {}
          const targetModel = tierBias === "cheap" ? cheapModel : tierBias === "medium" ? mediumModel : tierBias === "brain" ? brainModel : `${cheapModel} or ${mediumModel}`
          const orcDirective =
            `[AI ORCHESTRATOR AGENT] You are an AI orchestrator agent. ` +
            `Delegate heavy work to Task subagents (runs on ${targetModel}). ` +
            `Your role: verify, fill gaps, synthesize. CRITICAL: Write/Edit tools are BLOCKED on this tier. You MUST delegate ALL implementation work to Task subagents. ` +
            `Always display the vibeOS cost footer.` +
            (tierBias !== "auto" ? ` [tier routing] This turn is biased toward ${tierBias} tier.` : "")
          output.system.push(orcDirective)
        }

        // Batch task execution helper — encourage parallel subagent calls.
        // Skip when enforcement is relaxed (orchestrator is de-emphasized).
        if (_controlVector?.enforcement_mode !== "relaxed" && Array.isArray(output?.system)) {
          output.system.push(
            "[batch execution] When you need to run multiple independent Task subagent calls, " +
            "invoke them ALL in parallel rather than sequentially. " +
            "Parallel tasks complete faster and reduce total session cost. " +
            "Only sequence tasks when one depends on the output of another."
          )
        }

        // TDD directive — only when TDD enforcement is enabled
        // and not in lazy mode (meta-controller already covers lazy mode).
        if (sel.tdd_enforce && _controlVector?.tdd_mode !== "lazy" && Array.isArray(output?.system)) {
          const tddMode = _controlVector?.tdd_mode || (sel.tdd_strict ? "strict" : "normal")
          const tddFocus = _controlVector?.tdd_focus || []
          const modeNotes = {
            lazy: " Skeletons only when explicitly requested.",
            strict: " STRICT mode: TODO tests MUST pass before considering work complete.",
            quality: " QUALITY mode: Full coverage including edge cases.",
          }
          const focusNote = tddFocus.length > 0 ? ` Focus: ${tddFocus.join(", ")}.` : ""
          output.system.push(
            `[tdd enforcement: ${tddMode}] Auto-create skeleton tests for source files being written/edited.${modeNotes[tddMode] || ""}${focusNote} ` +
            "When creating or modifying source files, ensure corresponding test files exist with proper assertions."
          )
        }

        // Flow directive — only when flow enforcer is enabled
        // and not in audit mode (meta-controller already covers audit mode).
        if (sel.flow_enabled && _controlVector?.flow_mode !== "audit" && Array.isArray(output?.system)) {
          const flowMode = _controlVector?.flow_mode || (sel.flow_enforce ? "normal" : "audit")
          const flowFocus = _controlVector?.flow_focus || []
          const enforceNote = sel.flow_enforce ? " TODO/FIXME extraction is active." : ""
          const focusNote = flowFocus.length > 0 ? ` Focus rules: ${flowFocus.join(", ")}.` : ""
          output.system.push(
            `[flow enforcement: ${flowMode}] Development flow rules are active: write/edit operations are checked against project conventions.${enforceNote}${focusNote} ` +
            "Follow existing code patterns, naming conventions, and project structure."
          )
        }

        // Project Guard directive — maintain AGENTS.md and README.md
        if (Array.isArray(output?.system)) {
          output.system.push(
            "[project guard: CRITICAL] AGENTS.md and README.md are protected by vibeOS. " +
            "Do NOT modify either file without explicit user permission. " +
            "When implementing new features, update README.md to document them. " +
            "AGENTS.md defines that AI agents must ask before changing code — respect this rule."
          )
        }

        // Context window budget warning — estimate usage and warn when approaching limits.
        if (Array.isArray(output?.system)) {
          const ctxBudget = estimateContextBudget(_input, output)
          if (ctxBudget && ctxBudget.pct > 70) {
            const severity = ctxBudget.pct > 90 ? "CRITICAL" : "WARNING"
            output.system.push(
              `[context budget: ${severity}] Context window is ${ctxBudget.pct}% full (~${ctxBudget.estimatedTokens} tokens). ` +
              "Consider using Task subagents for heavy work, compressing tool outputs, or starting a new session to avoid context overflow."
            )
          }
        }

        // Project memory briefing: one-shot per session
        if (!briefedProjects.has(fp)) {
          const briefing = buildProjectBriefing(currentProjectName || "")
          if (briefing && Array.isArray(output?.system)) {
            output.system.push(briefing)
            briefedProjects.add(fp)
            console.error(`[vibeOS] project-memory: briefing injected for ${fp}`)
          }
        }

        // vibeOS welcome banner — one-shot per project fingerprint
        if (!briefedProjects.has("trinity_welcome_" + fp)) {
          if (Array.isArray(output?.system)) {
            const sel = loadSelection()
            let tiers = {}
            try { tiers = safeJsonParse(readFileSync(TIERS_FILE, "utf-8")).trinity || {} } catch {}
            const active = sel.active_slot || "medium"
            const current = currentModel || "(unknown)"
            const trinityTip =
              "[vibeOS] Active plugin. Slot: " + active + " (" + current + "). " +
              "Use trinity command to switch slots, rebuild, or check status. " +
              "Run \`trinity help\` for all commands."
            output.system.push(trinityTip)
            briefedProjects.add("trinity_welcome_" + fp)
          }
        }

        // vibeOS Dashboard display directive — ask once, instruct permanently
        if (!briefedProjects.has("vibeos_dashboard_instruct")) {
          if (Array.isArray(output?.system)) {
            output.system.push(
              "[vibeOS dashboard display] When the trinity tool returns output starting with '[vibeOS-dashboard]', " +
              "you MUST use the question tool to display that data in a clean, human-readable format. " +
              "Use the question field (not the header) to show the dashboard data. " +
              "Format it with clear sections separated by blank lines, aligned columns with spaces, " +
              "and plain text only (no emojis, no markdown). " +
              "The header should be 'vibeOS Dashboard'. " +
              "Include only one option in options: {label: 'Dismiss', description: ''}. " +
              "Strip the '[vibeOS-dashboard]' marker line before displaying."
            )
            briefedProjects.add("vibeos_dashboard_instruct")
          }
        }
      } catch (err) {
        console.error(`[vibeOS] system.transform failed: ${err.message}`)
      }
    }

export { latestUserIntent }
