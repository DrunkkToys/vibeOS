// @ts-nocheck

import { join } from "node:path"
import { LABEL_MODES, buildDeterministicTrinity, formatProviderName, formatQualityName, resolveExecutionIdentity } from "./pricing.js"
import { invalidateApiToken } from "./api-client.js"

export function createTrinityTool(deps) {
  return {
    description:
      "Control the vibeOS plugin and active model slot. " +
      "Use action='status' to see current state. " +
      "Use action='enable' or 'disable' to toggle the plugin (takes effect immediately, no restart needed). " +
      "Use action='set' with slot='brain'|'medium'|'cheap' to switch model tiers " +
      "(writes opencode.json — active immediately). " +
      "Use action='rebuild' to auto-detect available models from all configured providers and reassign brain/medium/cheap slots. " +
      "Use action='flow' with slot='on'|'off' to toggle flow enforcer, or action='flow' alone for audit. " +
      "Use action='flow' with slot='enforce' and level='on'|'off' to toggle auto-extract TODOs. " +
      "Use action='enforce' with slot='on'|'off' to toggle delegation enforcement (blocks direct writes/edits on brain tier). " +
      "Use action='tdd' with slot='on'|'off' to toggle auto-create test skeletons. " +
      "Use action='tdd' with slot='strict' and level='on'|'off' to toggle strict failing TODO test templates. " +
      "Use action='tdd' alone for audit. " +
      "Use action='setup' to create a compatibility profile for first-time users. " +
      "Use action='project' to show per-project analytics and optimization suggestions. " +
      "Use action='patterns' to inspect learned project patterns or slot='clear' to clear them. " +
      "Use action='guard' to ensure AGENTS.md and README.md exist and stay current. Use action='api-token' with token='<new_token>' to update the API token and re-enable remote control-vector, or token='invalidate' to disable the embedded alpha token " +
      "Use action='api-bootstrap-token' with token='<new_token>' to store an alpha bootstrap token and exchange it for a normal API token on alpha builds. " +
      "Call this when the user says things like 'switch to medium', 'use cheap model', 'disable plugin', 'trinity status'.",
    args: {
      action: deps.tool.schema.enum(["status", "enable", "disable", "set", "mode", "thinking", "flow", "tdd", "setup", "project", "patterns", "rebuild", "diagnose", "help", "enforce", "repair-state", "blackbox", "report", "target", "guard", "api-token", "api-bootstrap-token", "todo", "todo-done", "todo-sync"]).optional(),
      slot: deps.tool.schema.enum(["brain", "medium", "cheap", "budget", "quality", "speed", "longrun", "auto", "on", "off", "enforce", "strict", "preview", "apply", "clear", "savings"]).optional(),
      level: deps.tool.schema.enum(["full", "brief", "off", "on"]).optional(),
      token: deps.tool.schema.string().optional(),
    },
    async execute({ action, slot, level, token }: { action?: string; slot?: string; level?: string; token?: string } = {}) {
      if (typeof deps._lazyRefresh === "function") deps._lazyRefresh()
      if (!action) action = "status"
      if (["brain", "medium", "cheap"].includes(action)) { slot = action; action = "set" }
      if (action === "status") {
        const sel = deps.loadSelection()
        let tiers = {}
        try { tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8")).trinity || {} } catch {}
        let cheapModel = "(unset)"
        const credit = deps.loadCredit()
        const effectiveLevel = sel.thinking_level || deps.thinkingLevel(credit)

        const sv = deps.readLifetimeSavings()
        const ltTotal = (sv.ltTasks || 0) + (sv.ltCache || 0)
        const sesTasks = sv.sesTasks || 0
        const sesCache = Number(deps.readFullState()?.sessions?.[deps._OC_SID]?.cache_savings_usd || 0)
        const sesWarns = Array.isArray(deps.readFullState()?.sessions?.[deps._OC_SID]?.warns) ? deps.readFullState().sessions[deps._OC_SID].warns.length : 0
        const sesTrend = sv.sesTrend || "stable"
        const sesRate = sv.sesRatePerHour || 0
        const missedC7 = sv.missedC7 || 0
        const toolBreakdown = sv.sesToolBreakdown || {}
        const topTools = Object.entries(toolBreakdown).filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]).slice(0, 5)

        const brainModel = tiers?.brain?.oc || "(unset)"
        const mediumModel = tiers?.medium?.oc || "(unset)"
        cheapModel = tiers?.cheap?.oc || cheapModel
        const activeSlot = sel.active_slot || "brain"
        const lockedSlot = deps._lockedSlot || null
        const lockedModel = deps._lockedModel || null
        const onboardingMode = sel.onboarding_mode || "strict"

        const stressScore = deps.latestUserIntent ? deps.scoreStress(deps.latestUserIntent) : 0
        const stressBar = stressScore > 0.85 ? "█" : stressScore > 0.7 ? "▆" : stressScore > 0.5 ? "▅" : stressScore > 0.3 ? "▃" : stressScore > 0.1 ? "▂" : "▁"
        const stressLabel = stressScore > 0.7 ? "high" : stressScore > 0.4 ? "elevated" : stressScore > 0.1 ? "calm" : "none"

        const totalTurns = (sv.sesModelTurns?.brain || 0) + (sv.sesModelTurns?.worker || 0)
        const brainPct = totalTurns > 0 ? Math.round((sv.sesModelTurns.brain / totalTurns) * 100) : 0
        const workerPct = 100 - brainPct
        const qualityAvg = sv.quality_avg || 0
        const sesDuration = sv.sesDuration || 0
        const durHrs = Math.floor(sesDuration / 3600)
        const durMins = Math.floor((sesDuration % 3600) / 60)

        let decisionLine = ""
        if (deps._blackboxEnabled) {
          try {
            const res = deps._latestBlackboxState || deps.getBlackboxResolution()
            if (res && res.n_interactions > 3) {
              const momentumIcon = res.momentum > 0.3 ? "up up" : res.momentum > 0 ? "up" : res.momentum < -0.3 ? "down down" : res.momentum < 0 ? "down" : "flat"
              const loopTag = res.is_looping ? " (loop)" : ""
              decisionLine = `${res.resolution} ${res.sub_regime} ${momentumIcon}${loopTag}`
            }
          } catch {}
        }

        const execution = resolveExecutionIdentity(tiers?.[activeSlot]?.oc || deps.currentModel || "", deps.directory)
        const lines = [
          `[vibeOS-dashboard]`,
          `Model: ${activeSlot} (${tiers?.[activeSlot]?.oc || deps.currentModel || "(unset)"})`,
          `Provider: ${execution.provider_label}`,
          `Quality: ${execution.quality_label}`,
          ...(totalTurns > 0 ? [`Split: brain ${brainPct}% / worker ${workerPct}% (${totalTurns} total)`] : []),
          `Thinking: ${effectiveLevel}`,
          `Credit: ${credit}%`,
          ...(qualityAvg > 0 ? [`Quality: ${Math.round(qualityAvg)}%`] : []),
          ...(decisionLine ? [`Decision: ${decisionLine}`] : []),
          `|`,
          `Stress: ${stressBar} (${stressLabel})`,
          `|`,
          `Guards:`,
          `  Flow: ${sel.flow_enabled !== false ? "ON" : "OFF"}${sel.flow_enforce ? " (extract)" : ""}`,
          `  TDD: ${sel.tdd_enforce ? "ON" : "OFF"}${sel.tdd_strict !== false ? " strict" : ""}${sel.tdd_quality !== false ? " quality" : ""}`,
          `  Enforce: ${sel.delegation_enforce ? "ON" : "OFF"}${sel.onboarding_mode === "assist" ? " (compatibility)" : " (mandatory)"}`,
          `  Lock: ${deps._modelLocked ? `\u{1F512} ON${lockedSlot ? ` (${lockedSlot})` : ""}${lockedModel ? ` ${lockedModel}` : ""}` : "\u{1F513} OFF"}`,
          `  Compatibility: ${onboardingMode === "assist" ? "ASSIST (soft defaults, progressive activation)" : "STRICT (full guardrails)"}`,
          `|`,
          `All-time savings:`,
          `  Total: $${ltTotal.toFixed(2)} (${sesTrend})`,
          `  Delegation: $${(sv.ltTasks || 0).toFixed(2)}`,
          `  Cache: $${deps.formatUsd(sv.ltCache || 0)}`,
          `  Missed: $${missedC7.toFixed(2)}`,
          `|`,
          `This session:`,
          ...(sesDuration > 0 ? [`  Duration: ${durHrs}h ${durMins}m`] : []),
          `  Rate: $${sesRate.toFixed(2)}/hr`,
          `  Warnings: ${sesWarns}`,
          ...(topTools.length > 0 ? [`  Top tools:`, ...topTools.map(([t, v]) => `    ${t}: $${v.toFixed(2)}`)] : []),
          `|`,
          `Tiers:`,
          `  brain:  ${brainModel}${activeSlot === "brain" ? "  *" : ""}`,
          `  medium: ${mediumModel}${activeSlot === "medium" ? "  *" : ""}`,
          `  cheap:  ${cheapModel}${activeSlot === "cheap" ? "  *" : ""}`,
          `  Labels: ${(LABEL_MODES || []).join(", ")}`,
        ]
        return lines.join("\n")
      }

      if (action === "enable" || action === "disable") {
        const val = action === "enable"
        const ok = deps.writeSelection("enabled", val)
        if (!ok) return `\u274c Failed to write model-tiers.json`
        return `${val ? "\u2705 Plugin ENABLED" : "\u274c Plugin DISABLED"} \u2014 takes effect immediately (no restart needed).`
      }

      if (action === "set") {
        if (!slot || !["brain", "medium", "cheap"].includes(slot)) {
          return `\u274c Provide slot: brain | medium | cheap`
        }
        let targetModel = ""
        try {
          const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"))
          targetModel = tiers?.trinity?.[slot]?.oc || ""
        } catch {}
        if (!targetModel) {
          return "\u274c No model configured for " + slot + " slot. Run \`trinity rebuild\` first."
        }
        const auth = deps._readAuth()
        try {
          const ok = await deps.probeModel(targetModel, auth, deps._loadOpenCodeProviders())
          if (!ok) console.error("[vibeOS] WARN: " + targetModel + " probe failed - switching anyway")
        } catch (e) {
          console.error("[vibeOS] WARN: probe error for " + targetModel + ": " + e.message + " - switching anyway")
        }
        deps.writeSessionSlot(deps._OC_SID, slot)
        const result = deps.applySlot(slot)
        if (!result.ok) return `\u274c Failed to set slot: ${result.reason}`
        try {
          const selected = typeof deps.resolveExecutionIdentity === "function"
            ? deps.resolveExecutionIdentity(result.ocModel, deps.directory)
            : null
          if (selected) {
            deps.writeSelection("selected_provider", selected.provider || "")
            deps.writeSelection("selected_quality_tier", selected.quality || slot)
            deps.writeSelection("selected_model", selected.model || result.ocModel)
            deps.writeSelection("executed_provider", selected.provider || "")
            deps.writeSelection("executed_quality_tier", selected.quality || slot)
            deps.writeSelection("executed_model", selected.model || result.ocModel)
          }
        } catch {}
        deps._refreshModel(deps.directory)
        return `\u2705 Switched to ${slot} slot (${result.ocModel}). Active now (no restart needed).`
      }
      if (action === "mode") {
        if (!slot) return `Provide mode: budget | quality | speed | longrun | vibemax | vibeqmax | auto`
        const modeAlias = { vibemax: "vibemax", vibeqmax: "quality" }
        const resolvedSlot = modeAlias[slot] || slot
        if (!["budget", "quality", "speed", "longrun", "vibemax", "auto"].includes(resolvedSlot)) {
          return `Provide mode: budget | quality | speed | longrun | vibemax | vibeqmax | auto`
        }
        const ok = deps.saveOptimizationMode(resolvedSlot)
        if (!ok) return `Failed to write mode`
        const tierMap = { budget: "cheap", quality: "brain", speed: "medium", longrun: "brain", vibemax: "medium" }
        const tierSlot = tierMap[slot] || "cheap"
        deps.writeSelection("active_slot", tierSlot)
        deps.writeSelection("onboarding_mode", slot === "quality" || slot === "longrun" ? "strict" : "assist")
        if (slot === "budget") {
          deps.writeSelection("delegation_enforce", false)
          deps.writeSelection("flow_enabled", false)
          deps.writeSelection("flow_enforce", false)
          deps.writeSelection("tdd_enforce", false)
          deps.writeSelection("thinking_level", "off")
        } else if (slot === "quality") {
          deps.writeSelection("delegation_enforce", true)
          deps.writeSelection("flow_enabled", true)
          deps.writeSelection("flow_enforce", true)
          deps.writeSelection("tdd_enforce", true)
          deps.writeSelection("thinking_level", "full")
        } else if (slot === "speed") {
          deps.writeSelection("delegation_enforce", false)
          deps.writeSelection("flow_enabled", false)
          deps.writeSelection("flow_enforce", false)
          deps.writeSelection("tdd_enforce", false)
          deps.writeSelection("thinking_level", "off")
        }
        return `Mode set to ${slot.toUpperCase()}. Tier: ${tierSlot}.`
      }
      if (action === "thinking") {
        if (!level || !["full", "brief", "off"].includes(level)) {
          return `\u274c Provide level: full | brief | off`
        }
        const stored = level
        const ok = deps.writeSelection("thinking_level", stored)
        if (!ok) return `\u274c Failed to write model-tiers.json`
        const desc = {
          full:  "full thinking (no restriction) \u2014 takes effect on next message",
          brief: "brief thinking (complex tasks only) \u2014 takes effect on next message",
          off:   "thinking OFF (respond directly) \u2014 takes effect on next message",
        }
        return `\u2705 Reasoning depth \u2192 ${desc[level]}`
      }

      if (action === "flow") {
        if (slot === "on" || slot === "off") {
          const ok = deps.writeSelection("flow_enabled", slot === "on")
          if (ok && slot === "on") deps.writeSelection("onboarding_mode", "strict")
          return ok
            ? `\u2705 Flow enforcer ${slot === "on" ? "ENABLED" : "DISABLED"}`
            : `\u274c Failed to write model-tiers.json`
        }
        if (slot === "enforce") {
          if (level !== "on" && level !== "off") return "\u274c Provide level on|off for \`trinity flow enforce\`"
          const enforceOn = level === "on"
          const ok = deps.writeSelection("flow_enforce", enforceOn)
          if (ok && enforceOn) deps.writeSelection("onboarding_mode", "strict")
          return ok
            ? `\u2705 Flow enforcement ${enforceOn ? "ENABLED (auto-extract TODOs)" : "DISABLED (log only)"}`
            : `\u274c Failed to write model-tiers.json`
        }
        const flowWarns = deps.getFlowWarns()
        const sid = String(process.pid || "?")
        const sessionWarns = flowWarns.filter(w => String(w.sid) === sid)
        const bySev = { warn: 0, hint: 0, flag: 0 }
        for (const w of sessionWarns) {
          if (bySev[w.severity] !== undefined) bySev[w.severity]++
        }
        const lines = [`\u{1F500} Flow enforcer audit (this session):`]
        lines.push(`  ${bySev.warn} warn, ${bySev.hint} hint, ${bySev.flag} flag`)
        if (sessionWarns.length > 0) {
          for (const w of sessionWarns.slice(-15)) {
            const icon = w.severity === "warn" ? "\u26A0" : "\u{1F4A1}"
            lines.push(`  ${icon} [${w.severity}] ${w.rule_id}: ${w.description} \u2014 ${w.filePath || "(no file)"}`)
          }
        }
        if (sessionWarns.length === 0) lines.push(`  No flow violations this session.`)
        return lines.join("\n")
      }

      if (action === "enforce") {
        if (slot === "off") {
          const sel = deps.loadSelection()
          if (sel.onboarding_mode === "assist" && sel.delegation_enforce !== true) {
            return `\u2705 Delegation enforcement is already OFF in compatibility mode.`
          }
          return `\u274c Delegation enforcement is mandatory and cannot be disabled.`
        }
        if (slot === "on") {
          const ok = deps.writeSelection("delegation_enforce", true)
          if (ok) deps.writeSelection("onboarding_mode", "strict")
          return ok
            ? `\u{1F6AB} Delegation enforcement ENABLED \u2014 direct writes/edits BLOCKED on brain tier`
            : `\u274c Failed to write model-tiers.json`
        }
        const sel = deps.loadSelection()
        return `\u{1F6AB} Delegation enforcement: ON (mandatory, blocks direct writes/edits on brain tier)\nUse \`trinity enforce on\` to reapply the guard if needed.`
      }

      if (action === "lock") {
        if (slot === "on") {
          const lockSlot = deps.loadSelection()?.active_slot || "brain"
          const lockModel = deps._tiersData?.trinity?.[lockSlot]?.oc || deps.currentModel || "detected model"
          deps._modelLocked = true
          deps._lockedSlot = lockSlot
          deps._lockedModel = lockModel
          console.error(`[vibeOS] model LOCKED \u2014 ${lockModel} (${deps.currentTier}) will not auto-reconcile with config`)
          return `\u{1F512} Model LOCKED \u2014 ${lockModel} will not change unless you force with \`trinity set\` or \`trinity lock off\`.`
        }
        if (slot === "off") {
          deps._modelLocked = false
          deps._lockedSlot = null
          deps._lockedModel = null
          console.error(`[vibeOS] model UNLOCKED \u2014 auto-reconcile re-enabled`)
          return `\u{1F513} Model UNLOCKED \u2014 will auto-follow OpenCode config changes.`
        }
        return `\u{1F512} Model lock: ${deps._modelLocked ? "ON (fixed per session)" : "OFF (follows config)"}\nUse \`trinity lock on\` or \`trinity lock off\` to toggle.\nLock is per-session (resets on restart).`
      }

      if (action === "tdd") {
        if (slot === "strict") {
          if (level !== "on" && level !== "off") {
            return "\u274c Provide level on|off for \`trinity tdd strict\`"
          }
          const ok = deps.writeSelection("tdd_strict", level === "on")
          if (ok && level === "on") deps.writeSelection("onboarding_mode", "strict")
          return ok
            ? `\u2705 TDD strict ${level === "on" ? "ENABLED (TODO tests fail loudly)" : "DISABLED (TODO tests non-blocking)"}`
            : `\u274c Failed to write model-tiers.json`
        }
        if (slot === "quality") {
          if (level !== "on" && level !== "off") {
            return "\u274c Provide level on|off for \`trinity tdd quality\`"
          }
          const ok = deps.writeSelection("tdd_quality", level === "on")
          if (ok && level === "on") deps.writeSelection("onboarding_mode", "strict")
          return ok
            ? `\u2705 TDD quality templates ${level === "on" ? "ENABLED (real assertions, invalid-input, edge-case stubs)" : "DISABLED (TODO-only stubs)"}`
            : `\u274c Failed to write model-tiers.json`
        }
        if (slot === "on" || slot === "off") {
          const ok = deps.writeSelection("tdd_enforce", slot === "on")
          if (ok && slot === "on") deps.writeSelection("onboarding_mode", "strict")
          return ok
            ? `\u2705 TDD enforcement ${slot === "on" ? "ENABLED (auto-create skeletons)" : "DISABLED (nudge only)"}`
            : `\u274c Failed to write model-tiers.json`
        }
        const stateFile = deps.STATE_FILE
        let enforced = 0
        try {
          if (deps.existsSync(stateFile)) {
            const s = deps.safeJsonParse(deps.readFileSync(stateFile, "utf-8"))
            enforced = s.lifetime?.tdd_enforced ?? 0
          }
        } catch {}
        const sel = deps.loadSelection()
        const lines = [`\u{1F9EA} TDD enforcer audit:`]
        lines.push(`  Mode: ${sel.tdd_enforce ? "ENFORCE (auto-create skeletons)" : "NUDGE (reminders only)"}`)
        lines.push(`  Strict templates: ${sel.tdd_strict !== false ? "ON (fail TODO tests)" : "OFF (non-blocking TODO tests)"}`)
        lines.push(`  Quality templates: ${sel.tdd_quality !== false ? "ON (real assertion stubs)" : "OFF (TODO-only stubs)"}`)
        lines.push(`  Skeletons created this lifetime: ${enforced}`)
        return lines.join("\n")
      }

      if (action === "setup") {
        const now = new Date().toISOString()
        const existing = deps.existsSync(deps.TIERS_FILE)
          ? (deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8")) || {})
          : {}
        const providers = typeof deps._loadOpenCodeProviders === "function" ? deps._loadOpenCodeProviders() : {}
        const auth = typeof deps._readAuth === "function" ? deps._readAuth() : {}
        let discovered = []
        try {
          if (typeof deps.discoverAvailableModels === "function") {
            discovered = await deps.discoverAvailableModels(providers, auth)
          }
        } catch {}
        const selectedModel = deps.currentModel || existing?.selection?.selected_model || existing?.selection?.executed_model || ""
        const selectedTier = existing?.selection?.active_slot || "brain"
        const trinity = buildDeterministicTrinity(discovered, { selectedModelId: selectedModel, selectedTier })
        const brain = trinity?.brain || existing?.trinity?.brain?.oc || selectedModel || ""
        const medium = trinity?.medium || existing?.trinity?.medium?.oc || brain
        const cheap = trinity?.cheap || existing?.trinity?.cheap?.oc || medium || brain
        const tiers = existing && typeof existing === "object" ? existing : {}
        tiers.selection ??= {}
        tiers.trinity ??= {}
        tiers.selection.enabled = true
        tiers.selection.active_slot = tiers.selection.active_slot || (brain ? "brain" : "medium")
        tiers.selection.onboarding_mode = "assist"
        tiers.selection.delegation_enforce = false
        tiers.selection.flow_enabled = false
        tiers.selection.flow_enforce = false
        tiers.selection.tdd_enforce = false
        tiers.selection.tdd_strict = false
        tiers.selection.tdd_quality = false
        tiers.selection.thinking_level = "off"
        tiers.selection.setup_completed_at = now
        tiers.selection.selected_provider = trinity?.provider || resolveExecutionIdentity(selectedModel, deps.directory)?.provider || ""
        tiers.selection.selected_quality_tier = trinity?.selected_tier || selectedTier || "brain"
        tiers.selection.selected_model = trinity?.selected_model || selectedModel || ""
        tiers.selection.executed_provider = tiers.selection.selected_provider
        tiers.selection.executed_quality_tier = tiers.selection.selected_quality_tier
        tiers.selection.executed_model = tiers.selection.selected_model
        if (brain) tiers.trinity.brain = { oc: brain, cc: deps.modelToCcAlias(brain) }
        if (medium) tiers.trinity.medium = { oc: medium, cc: deps.modelToCcAlias(medium) }
        if (cheap) tiers.trinity.cheap = { oc: cheap, cc: deps.modelToCcAlias(cheap) }
        deps.mkdirSync(dirname(deps.TIERS_FILE), { recursive: true })
        deps.writeFileSync(deps.TIERS_FILE, JSON.stringify(tiers, null, 2) + "\n")
        try {
          const bbState = deps.loadBlackboxState()
          bbState.enabled = false
          deps.saveBlackboxState(bbState)
          if (typeof deps.setBlackboxEnabled === "function") deps.setBlackboxEnabled(false)
          else deps._blackboxEnabled = false
        } catch {}
        if (typeof deps._refreshModel === "function") deps._refreshModel(deps.directory)
        const lines = [
          "\u2705 Compatibility profile created.",
          `  Mode: assist`,
          `  Models: ${brain || "(unset)"}${medium && medium !== brain ? ` / ${medium}` : ""}${cheap && cheap !== medium ? ` / ${cheap}` : ""}`,
          `  Provider: ${trinity?.provider || resolveExecutionIdentity(selectedModel, deps.directory)?.provider_label || "Unknown"}`,
          `  Delegation: off`,
          `  Flow: off`,
          `  TDD: off`,
          `  Blackbox: off`,
        ]
        if (discovered.length > 0) lines.push(`  Discovered models: ${discovered.length}`)
        lines.push("Use `trinity mode quality` or `trinity enforce on` to graduate to strict mode.")
        return lines.join("\n")
      }

      if (action === "project") {
        const L = "\u2501"
        const lines = [`\ud83d\udcca Project profile \u2014 ${deps.currentProjectName || (deps.directory ? deps.directory.split("/").pop() : "unknown")}`]
        lines.push(L.repeat(40))
        const fp = deps.currentProjectFingerprint || deps.projectFingerprint(deps.directory)

        const pstate = deps.loadProjectState()
        const proj = pstate.project_hashes?.[fp]
        if (proj) {
          lines.push(`\n\ud83d\udcc5 Sessions: ${proj.totalSessions || 0} | Last: ${(proj.lastSeen || "").slice(0, 10)}`)
          if (proj.researchChains) lines.push(`\ud83d\udd0d Research chains detected: ${proj.researchChains}`)
          if (proj.context7Bypasses) lines.push(`\ud83d\udcb8 Context7 bypasses: ${proj.context7Bypasses}`)
          if (proj.commonTopics?.length) {
            const topics = proj.commonTopics.slice(0, 5).join(", ")
            lines.push(`\ud83c\udf10 Common fetch domains: ${topics}`)
          }
          const promoted = deps.promotedProjectPatterns(fp)
          if (promoted.length) {
            lines.push(`\nLearned patterns:`)
            for (const ptn of promoted) lines.push(`  [${ptn.label}] ${ptn.summary}`)
          }
        } else {
          lines.push(`\n  (no project memory yet \u2014 first session)`)
        }

        const sv = deps.readLifetimeSavings()
        const totalTurns = (sv.sesModelTurns?.brain || 0) + (sv.sesModelTurns?.worker || 0)
        const brainPct = totalTurns > 0 ? Math.round((sv.sesModelTurns.brain / totalTurns) * 100) : 0
        if (totalTurns > 0) {
          const workerPct = 100 - brainPct
          lines.push(`\n\ud83d\udd04 Model usage: Brain ${brainPct}% (${sv.sesModelTurns.brain} turns) / Worker ${workerPct}% (${sv.sesModelTurns.worker} tasks)`)
        }
        if (sv.sesTasks > 0.01 || sv.ltCache > 0.01) {
          lines.push(`\ud83d\udcb0 Session savings: $${sv.sesTasks.toFixed(2)} delegation + $${sv.ltCache.toFixed(2)} cache`)
        }
        if (sv.sesDuration > 0) {
          const hrs = Math.floor(sv.sesDuration / 3600)
          const mins = Math.floor((sv.sesDuration % 3600) / 60)
          lines.push(`\u23f1  Duration: ${hrs}h ${mins}m | Rate: $${sv.sesRatePerHour.toFixed(2)}/hr | Trend: ${sv.sesTrend === "down" ? "\u2193" : sv.sesTrend === "up" ? "\u2191" : "\u2192"}`)
        }

        const toolEntries = Object.entries(sv.sesToolBreakdown || {}).filter(([_, v]) => v > 0.005).sort((a, b) => b[1] - a[1])
        if (toolEntries.length > 0) {
          lines.push(`\n\ud83d\udd27 Per-tool savings:`)
          for (const [tool, savings] of toolEntries) {
            lines.push(`  ${tool.padEnd(14)} \u2014$${savings.toFixed(2)}`)
          }
        }

        const flowWarns = deps.getFlowWarns()
        const sid = String(process.pid || "?")
        const sessionFlowWarns = flowWarns.filter(w => String(w.sid) === sid)
        const byRule = {}
        for (const w of sessionFlowWarns) {
          const key = w.rule_id || "unknown"
          byRule[key] = (byRule[key] || 0) + 1
        }
        if (Object.keys(byRule).length > 0) {
          lines.push(`\n\u26a0\ufe0f Flow violations (this session):`)
          for (const [rule, count] of Object.entries(byRule)) {
            lines.push(`  ${rule.padEnd(22)} ${count}`)
          }
        }

        const suggestions = []
        if (totalTurns > 10 && sv.sesModelTurns.brain > sv.sesModelTurns.worker * 2) {
          if (!deps.loadSelection().delegation_enforce) {
            suggestions.push(`\ud83d\udca1 High direct brain usage (${brainPct}%) \u2014 enable enforcement with \`trinity enforce on\` to block direct writes/edits`)
          } else {
            suggestions.push(`\ud83d\udca1 High direct brain usage (${brainPct}%) \u2014 enforcement is ON but brain keeps editing directly; check plugin logs`)
          }
        }
        if (proj?.context7Bypasses > 3) {
          suggestions.push(`\ud83d\udca1 ${proj.context7Bypasses} context7 bypasses \u2014 install context7 MCP to save ~$0.05/turn`)
        }
        if (proj?.researchChains > 2) {
          suggestions.push(`\ud83d\udca1 ${proj.researchChains} research domain chains \u2014 consider caching or batching doc lookups`)
        }
        if ((sv.sesToolBreakdown?.webfetch || 0) > 0.1 || (sv.sesToolBreakdown?.websearch || 0) > 0.1) {
          suggestions.push(`\ud83d\udca1 High webfetch/websearch usage \u2014 use context7 tools or scratchpad caching`)
        }
        if ((byRule["new-md-file"] || 0) > 2) {
          suggestions.push(`\ud83d\udca1 ${byRule["new-md-file"]} new .md files \u2014 verify explicit user request for docs`)
        }
        if ((byRule["todo-comment"] || 0) > 5) {
          suggestions.push(`\ud83d\udca1 ${byRule["todo-comment"]} TODO/FIXME left \u2014 clean up or track in issue tracker`)
        }
        if (deps.loadSelection().flow_enabled === false) {
          suggestions.push(`\ud83d\udca1 Flow enforcer is OFF \u2014 enable with \`trinity flow on\` to catch anti-patterns`)
        }
        for (const ptn of deps.promotedProjectPatterns(fp)) {
          suggestions.push(`Learned ${ptn.label} pattern: ${ptn.summary}`)
        }
        const credit = deps.loadCredit()
        if (credit < 40) {
          suggestions.push(`\ud83d\udca1 Credit at ${credit}% \u2014 switch to medium/cheap slot with \`trinity medium\``)
        }

        if (suggestions.length > 0) {
          lines.push(`\n\ud83c\udfaf Optimization suggestions:`)
          for (const s of suggestions) lines.push(`  ${s}`)
        } else {
          lines.push(`\n\u2705 No optimization suggestions \u2014 looking good!`)
        }

        lines.push(`\n${L.repeat(40)}`)
        lines.push(`Run \`trinity help\` for all commands | \`research-audit\` for deep fetch analysis`)
        return lines.join("\n")
      }

      if (action === "report" && slot === "savings") {
        const L = "\u2501"
        const lines = [`== Savings Deep Report ==`]
        lines.push(L.repeat(40))
        const sv = deps.readLifetimeSavings()
        const ltTotal = sv.ltTasks + sv.ltCache

        const toolTotals = {}
        let entryCount = 0
        try {
          if (deps.existsSync(deps.SAVINGS_LEDGER_FILE)) {
            const raw = deps.readFileSync(deps.SAVINGS_LEDGER_FILE, "utf-8")
            for (const ln of raw.trim().split("\n")) {
              if (!ln.trim()) continue
              let rec = null
              try { rec = JSON.parse(ln) } catch { continue }
              if (!rec || rec.v !== 2) continue
              const amt = Number(rec.amount_usd ?? 0)
              const tool = String(rec.tool || "unknown")
              toolTotals[tool] = (toolTotals[tool] || 0) + amt
              entryCount++
            }
          }
        } catch {}
        lines.push(`\nBy tool:`)
        const sortedTools = Object.entries(toolTotals).sort((a, b) => b[1] - a[1])
        if (sortedTools.length === 0) {
          lines.push(`  (no ledger entries yet)`)
        } else {
          for (const [tool, amt] of sortedTools) {
            lines.push(`  ${tool.padEnd(14)} $${amt.toFixed(4)}`)
          }
        }

        const dayTotals = {}
        try {
          if (deps.existsSync(deps.SAVINGS_LEDGER_FILE)) {
            const raw = deps.readFileSync(deps.SAVINGS_LEDGER_FILE, "utf-8")
            for (const ln of raw.trim().split("\n")) {
              if (!ln.trim()) continue
              let rec = null
              try { rec = JSON.parse(ln) } catch { continue }
              if (!rec || rec.v !== 2) continue
              const amt = Number(rec.amount_usd ?? 0)
              const day = (rec.at || "").slice(0, 10)
              if (day) dayTotals[day] = (dayTotals[day] || 0) + amt
            }
          }
        } catch {}
        lines.push(`\nBy day:`)
        const sortedDays = Object.entries(dayTotals).sort((a, b) => a[0].localeCompare(b[0]))
        if (sortedDays.length === 0) {
          lines.push(`  (no daily data yet)`)
        } else {
          for (const [day, amt] of sortedDays) {
            lines.push(`  ${day}  $${amt.toFixed(4)}`)
          }
        }

        lines.push(`\nLifetime:`)
        lines.push(`  Delegation savings: $${sv.ltTasks.toFixed(4)}`)
        lines.push(`  Cache savings:     $${(sv.ltCache || 0).toFixed(4)}`)
        lines.push(`  Total:             $${ltTotal.toFixed(4)}`)
        lines.push(`  Ledger entries:    ${entryCount}`)
        lines.push(`\n${L.repeat(40)}`)
        return lines.join("\n")
      }

      if (action === "patterns") {
        const fp = deps.currentProjectFingerprint || deps.projectFingerprint(deps.directory)
        const name = deps.currentProjectName || (deps.directory ? deps.directory.split("/").pop() : "unknown")
        if (slot === "clear") {
          const count = deps.clearProjectPatterns(fp)
          return `Pattern memory cleared for "${name}" (${count} pattern${count === 1 ? "" : "s"} removed).`
        }
        if (slot === "suggest") {
          const pstate = deps.loadProjectState()
          const currentBucket = pstate.project_hashes?.[fp]
          const currentTech = currentBucket?.techStack || []
          const currentKeys = new Set([
            ...Object.keys(currentBucket?.userPatterns?.friction || {}),
            ...Object.keys(currentBucket?.userPatterns?.routines || {}),
          ])
          const candidates = []
          for (const [otherFp, bucket] of Object.entries(pstate.project_hashes || {})) {
            if (otherFp === fp) continue
            const otherTech = bucket?.techStack || []
            if (!otherTech.some(t => currentTech.includes(t))) continue
            for (const [kind, label] of [["friction", "friction"], ["routines", "routine"]]) {
              for (const [key, row] of Object.entries(bucket?.userPatterns?.[kind] || {})) {
                if (currentKeys.has(key)) continue
                const sessions = new Set(row?.sessions || []).size
                candidates.push({ key, label, summary: row?.summary || key, count: Number(row?.count || 0), sessions, lastSeen: row?.lastSeen || "" })
              }
            }
          }
          candidates.sort((a, b) => b.count - a.count || b.sessions - a.sessions)
          const top = candidates.slice(0, 5)
          const lines = ["[\u26a1 From similar tech stack projects]"]
          if (top.length === 0) {
            lines.push("  No cross-project suggestions available yet.")
            return lines.join("\n")
          }
          for (const c of top) {
            const tag = c.sessions >= 3 ? "promoted" : "learning"
            lines.push(`  [${c.label}/${tag}] ${c.summary} (${c.count} hit${c.count === 1 ? "" : "s"}, ${c.sessions} session${c.sessions === 1 ? "" : "s"})`)
          }
          lines.push("")
          lines.push("Use \`trinity patterns\` to see this project's own patterns.")
          return lines.join("\n")
        }
        const rows = deps.projectPatternRows(fp)
        const lines = [`Project patterns - ${name}`]
        if (rows.length === 0) {
          lines.push("  No learned patterns yet.")
          lines.push("  Patterns promote into briefings after 3 separate sessions.")
          return lines.join("\n")
        }
        const promoted = rows.filter(r => r.sessions >= 3).length
        lines.push(`  ${rows.length} stored, ${promoted} promoted`)
        for (const r of rows.slice(0, 15)) {
          const tag = r.sessions >= 3 ? "promoted" : "learning"
          lines.push(`  [${r.label}/${tag}] ${r.summary} (${r.sessions} session${r.sessions === 1 ? "" : "s"}, ${r.count} hit${r.count === 1 ? "" : "s"})`)
        }
        lines.push("")
        lines.push("Use \`trinity patterns clear\` to clear project pattern memory.")
        return lines.join("\n")
      }

      if (action === "guard") {
        if (!deps.directory || !deps.existsSync(deps.directory)) return "Working directory not accessible."
        const techStack = deps.detectTechStack(deps.directory)
        const result = deps.ensureProjectDocs(deps.directory, techStack)
        if (result.created.length === 0 && result.skipped.length > 0) {
          return `AGENTS.md and README.md already exist. Use \`trinity guard\` to check for missing features.`
        }
        const lines = [`Project Guard: ${deps.directory.split("/").pop() || "unknown"}`]
        for (const f of result.created) lines.push(`  Created ${f}`)
        for (const f of result.skipped) lines.push(`  Already exists: ${f}`)
        lines.push("")
        lines.push("AGENTS.md: defines AI agent behavioral rules \u2014 ASK BEFORE changing code.")
        lines.push("README.md: auto-maintained feature documentation \u2014 keep it updated.")
        return lines.join("\n")
      }

      if (action === "todo") {
        const todos = deps.loadTodos()
        const pending = todos.filter((t: any) => t.status === "pending")
        if (pending.length === 0) return "No pending todos."
        const lines = ["Pending todos: " + pending.length]
        for (const t of pending.slice(0, 20)) {
          lines.push("  #" + (t.id || "").slice(0, 8) + " [" + t.priority + "] " + (t.content || "").slice(0, 60))
        }
        if (pending.length > 20) lines.push("  ... and " + (pending.length - 20) + " more")
        return lines.join("\n")
      }
      if (action === "todo-done") {
        if (!slot) return "Usage: trinity todo-done <id>\nMark a todo as done by its ID."
        deps.markTodoDone(slot)
        return "Todo " + slot + " marked done."
      }
      if (action === "todo-sync") {
        const count = deps.syncFlowTodosToNative((entry: any) => {
          deps.upsertTodo(entry)
        })
        return "Synced " + count + " flow TODO(s) to native todo list."
      }

      if (action === "api-token") {
        if (!token) return "Usage: trinity api-token <token|invalidate>\nProvide a valid VIBEOS_API_TOKEN to enable remote control-vector computation, or 'invalidate' to disable it for alpha."
        const cleanToken = String(token).trim()
        if (["invalidate", "disable", "clear", "revoke"].includes(cleanToken.toLowerCase())) {
          invalidateApiToken()
          return "[vibeOS] API token invalidated. Remote API disabled until a new token is set."
        }
        deps.setApiToken(token)
        return "[vibeOS] API token updated. Remote API re-enabled."
      }

      if (action === "api-bootstrap-token") {
        if (!token) return "Usage: trinity api-bootstrap-token <token>\nProvide an alpha bootstrap token to exchange for a normal API token on alpha builds."
        deps.setApiBootstrapToken(token)
        const ok = typeof deps.ensureBootstrapExchange === "function" ? await deps.ensureBootstrapExchange() : false
        if (ok) return "[vibeOS] Alpha bootstrap token exchanged successfully. Remote API re-enabled."
        return "[vibeOS] Alpha bootstrap token saved. Remote API will retry the exchange on the next call."
      }

      if (action === "rebuild") {
        const providers = deps._loadOpenCodeProviders()
        const auth = deps._readAuth()
        const models = await deps.discoverAvailableModels(providers, auth)
        const selectedModel = deps.currentModel || deps.loadSelection?.().selected_model || deps.loadSelection?.().executed_model || ""
        const selectedTier = deps.loadSelection?.().active_slot || "brain"
        const trinity = buildDeterministicTrinity(models, { selectedModelId: selectedModel, selectedTier })
        if (!trinity) {
          return "\u274c No models discovered from any configured provider."
        }
        const probed = {
          brain: models.find(m => m.id === trinity.brain) || { id: trinity.brain, cost: deps._modelCost(trinity.brain), tier: deps._modelTier(trinity.brain) },
          medium: models.find(m => m.id === trinity.medium) || { id: trinity.medium, cost: deps._modelCost(trinity.medium), tier: deps._modelTier(trinity.medium) },
          cheap: models.find(m => m.id === trinity.cheap) || { id: trinity.cheap, cost: deps._modelCost(trinity.cheap), tier: deps._modelTier(trinity.cheap) },
        }
        const failed = []
        for (const slot of ["brain", "medium", "cheap"]) {
          const candidate = probed[slot]
          if (!candidate?.id) continue
          const ok = await deps.probeModel(candidate.id, auth, providers)
          if (!ok) failed.push(`${slot}: ${candidate.id}`)
        }
        if (!probed.brain) {
          return "\u274c No models responded to probe. Try checking your API keys.\n" + (failed.length > 0 ? "Failed:\n  " + failed.join("\n  ") : "No models discovered.")
        }
        try {
          const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"))
          tiers.trinity = {
            brain: { oc: probed.brain.id, cc: deps.modelToCcAlias(probed.brain.id) },
            medium: { oc: probed.medium.id, cc: deps.modelToCcAlias(probed.medium.id) },
            cheap: { oc: probed.cheap.id, cc: deps.modelToCcAlias(probed.cheap.id) },
          }
          tiers.selection ??= {}
          tiers.selection.selected_provider = trinity.provider || resolveExecutionIdentity(selectedModel, deps.directory)?.provider || ""
          tiers.selection.selected_quality_tier = trinity.selected_tier || selectedTier || "brain"
          tiers.selection.selected_model = trinity.selected_model || selectedModel || ""
          tiers.selection.executed_provider = tiers.selection.selected_provider
          tiers.selection.executed_quality_tier = tiers.selection.selected_quality_tier
          tiers.selection.executed_model = tiers.selection.selected_model
          const _tmp = deps.TIERS_FILE + ".tmp." + Date.now()
          deps.writeFileSync(_tmp, JSON.stringify(tiers, null, 2) + "\n", "utf-8")
          deps.renameSync(_tmp, deps.TIERS_FILE)
        } catch (err) {
          return "\u274c Failed to write model-tiers.json: " + err.message
        }
        try { deps.applySlot("brain") } catch (e) { console.error("[vibeOS] auto-activate brain failed:", e.message) }
        const lines = [
          `\ud83d\udd0d Auto-detected models from provider: ${trinity.provider || "unknown"}`,
          "  \ud83e\udde0 brain  \u2192 " + probed.brain.id + " (tier: " + probed.brain.tier + ", $" + probed.brain.cost.toFixed(4) + "/turn) \u2705",
          "  \u2699  medium \u2192 " + probed.medium.id + " (tier: " + probed.medium.tier + ", $" + probed.medium.cost.toFixed(4) + "/turn) \u2705",
          "  \u26a1 cheap  \u2192 " + probed.cheap.id + " (tier: " + probed.cheap.tier + ", $" + probed.cheap.cost.toFixed(4) + "/turn) \u2705",
        ]
        if (failed.length > 0) {
          lines.push("", "Probe failures (skipped):")
          for (const f of failed) lines.push("  \u274c " + f)
        }
        lines.push("", "\u2705 model-tiers.json updated.", "\ud83e\udde0 Brain slot auto-activated: " + probed.brain.id)
        return lines.join("\n")
      }

      if (action === "diagnose") {
        const results = []
        const ocConfig = join(deps.OPENCODE_HOME, "opencode.json")

        const checks = [
          { path: deps.TIERS_FILE,                                        label: "model-tiers.json"       },
          { path: ocConfig,                                            label: "opencode.json"          },
          { path: deps.STATE_FILE,                                          label: "delegation-state.json" },
        ]
        for (const c of checks) {
          results.push({
            ok: deps.existsSync(c.path),
            okLabel: deps.existsSync(c.path) ? "\u2705" : "\u274c",
            label: c.label,
            detail: deps.existsSync(c.path) ? "exists" : "missing",
            fix: deps.existsSync(c.path) ? null : (c.label === "model-tiers.json" ? "run \`trinity rebuild\` to create it" : undefined),
          })
        }

        try {
          const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"))
          for (const s of ["brain","medium","cheap"]) {
            const m = tiers?.trinity?.[s]?.oc || ""
            const ok = m.length > 0 && !m.toLowerCase().includes("placeholder")
            results.push({
              ok, okLabel: ok ? "\u2705" : "\u274c",
              label: `${s} slot`,
              detail: ok ? m : (m.length > 0 ? `placeholder: ${m}` : "unset"),
              fix: ok ? null : "run \`trinity rebuild\` to auto-assign",
            })
          }
        } catch {
          for (const s of ["brain","medium","cheap"]) {
            results.push({ ok: false, okLabel: "\u274c", label: `${s} slot`, detail: "cannot read model-tiers.json", fix: "run \`trinity rebuild\` to create it" })
          }
        }

        if (deps.currentModel || !deps.existsSync(deps.TIERS_FILE)) {
          try {
            const auth = deps._readAuth()
            const ok = await deps.probeModel(deps.currentModel, auth, deps._loadOpenCodeProviders())
            results.push({
              ok, okLabel: ok ? "\u2705" : "\u274c",
              label: "model probe",
              detail: ok ? "API responsive" : `probe failed: ${deps.currentModel}`,
            })
          } catch {
            results.push({ ok: false, okLabel: "\u274c", label: "model probe", detail: "exception during probe" })
          }
        } else {
          results.push({ ok: false, okLabel: "\u274c", label: "model probe", detail: "no current model detected" })
        }

        const credit = deps.loadCredit()
        let budget = 50
        let totalBal = 0
        try {
          const j = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"))
          cheapModel = j?.trinity?.cheap?.oc || cheapModel
          if (j?.selection?.monthly_budget_usd) budget = j.selection.monthly_budget_usd
        } catch {}
        try {
          const cache = deps.safeJsonParse(deps.readFileSync(deps.CREDIT_CACHE_F, "utf-8"))
          if (cache?.total != null) totalBal = cache.total
        } catch {}
        const runway = typeof deps.estimateTurnsRemaining === "function"
          ? deps.estimateTurnsRemaining(totalBal, cheapModel)
          : { balanceUsd: totalBal, costPerTurn: deps.modelCostPerTurn?.(cheapModel) ?? null, turnsRemaining: null, unlimited: false }
        const runwayText = runway.costPerTurn === 0
          ? `unlimited on ${cheapModel}`
          : runway.turnsRemaining != null && runway.costPerTurn != null
            ? `${Number(runway.turnsRemaining).toLocaleString()} turns on ${cheapModel} @ $${deps.formatUsd(runway.costPerTurn)}/turn`
            : "n/a"
        const creditOk = credit >= 40
        results.push({
          ok: creditOk, okLabel: creditOk ? "\u2705" : "\u274c",
          label: "credits",
          detail: `${credit}%${totalBal > 0 ? ` ($${totalBal.toFixed(2)} of $${budget})` : ` (of $${budget})`}`,
          fix: creditOk ? null : "run \`trinity medium\` to reduce spend",
        })
        results.push({
          ok: runway.turnsRemaining != null || runway.costPerTurn === 0,
          okLabel: runway.turnsRemaining != null || runway.costPerTurn === 0 ? "\u2705" : "\u274c",
          label: "runway",
          detail: totalBal > 0 ? `$${totalBal.toFixed(2)} left -> ${runwayText}` : "no cached balance yet",
          fix: runway.turnsRemaining == null && runway.costPerTurn !== 0 ? "wait for a balance snapshot or configure a known cheap slot" : null,
        })

        try {
          const state = deps.safeJsonParse(deps.readFileSync(deps.STATE_FILE, "utf-8"))
          const sid = String(process.pid || "?")
          const ses = state?.sessions?.[sid]
          const delegationCount = ses?.warns?.length || 0
          const cacheSavings = deps.formatUsd(state?.lifetime?.cache_savings_usd || 0)
          const fw = (state?.flow_warns || []).filter(w => String(w.sid) === sid)
          const flowW = fw.filter(w => w.severity === "warn").length
          const flowH = fw.filter(w => w.severity === "hint").length
          const tdd = state?.lifetime?.tdd_enforced ?? 0
          const enf = deps.loadSelection().delegation_enforce ? " ENFORCE" : ""
          results.push({
            ok: true, okLabel: "\u2705",
            label: "session",
            detail: `${delegationCount} delegates, $${cacheSavings} cache, ${flowW}w/${flowH}h flow, ${tdd} TDD${enf}`,
          })
        } catch {
          results.push({ ok: true, okLabel: "\u2705", label: "session", detail: "no state file yet" })
        }

        const okCount = results.filter(r => r.ok).length
        results.sort((a, b) => (a.ok === b.ok ? 0 : a.ok ? 1 : -1))
        const lines = [
          "\ud83d\udd0d  vibeOS \u2014 Self Diagnostic",
          "=".repeat(40),
          "",
        ]
        for (const r of results) {
          lines.push(`  ${r.okLabel} ${r.label}: ${r.detail}`)
          if (!r.ok && r.fix) lines.push(`    \u2192 ${r.fix}`)
        }
        if (okCount === results.length) {
          lines.push("", `\u2705 All ${results.length} checks passed`)
        } else {
          const failCount = results.length - okCount
          lines.push("", `\u274c ${failCount}/${results.length} checks failed \u2014 fix items above`)
        }
        return lines.join("\n")
      }

      if (action === "repair-state") {
        const mode = slot || "preview"
        if (mode !== "preview" && mode !== "apply") {
          return "\u274c Use \`trinity repair-state preview\` or \`trinity repair-state apply\`."
        }
        const dstFp = deps.currentProjectFingerprint || deps.projectFingerprint(deps.directory)
        const name = deps.currentProjectName || (deps.directory ? deps.directory.split("/").pop() : "unknown")
        const idx = deps.reportsIndex()
        const byFp = new Map()
        for (const r of idx.reports || []) {
          if (r.project !== name) continue
          byFp.set(r.fingerprint, (byFp.get(r.fingerprint) || 0) + 1)
        }
        const candidates = [...byFp.entries()]
          .filter(([fp2, count]) => fp2 && fp2 !== dstFp && count > 0)
          .sort((a, b) => b[1] - a[1])
        if (candidates.length === 0) {
          return `\u2705 No duplicate fingerprint candidates found for project "${name}".`
        }
        const [srcFp, reportCount] = candidates[0]
        const pstate = deps.loadProjectState()
        const dstBucket = deps.ensureProjectBucket(pstate, dstFp)
        const srcBucket = pstate.project_hashes?.[srcFp] || null
        const merged = deps.mergeProjectBucket(dstBucket, srcBucket)
        const lines = [
          `\u{1F6E0} State repair (${mode})`,
          `  project: ${name}`,
          `  target:  ${dstFp}`,
          `  source:  ${srcFp}`,
          `  reports to relabel: ${reportCount}`,
          `  sessions: ${(dstBucket.totalSessions || 0)} + ${(srcBucket?.totalSessions || 0)} -> ${merged.totalSessions}`,
          `  bypasses: ${(dstBucket.context7Bypasses || 0)} + ${(srcBucket?.context7Bypasses || 0)} -> ${merged.context7Bypasses}`,
          `  researchChains(max): ${Math.max(dstBucket.researchChains || 0, srcBucket?.researchChains || 0)}`,
        ]
        if (mode === "preview") {
          lines.push("", "Run \`trinity repair-state apply\` to execute with backups.")
          return lines.join("\n")
        }

        const backups = []
        const b1 = deps.backupFile(deps.PROJECT_STATE_FILE, "repair-state")
        if (b1) backups.push(b1)
        const b2 = deps.backupFile(deps.REPORTS_INDEX, "repair-state")
        if (b2) backups.push(b2)

        pstate.project_hashes ??= {}
        pstate.project_hashes[dstFp] = merged
        delete pstate.project_hashes[srcFp]
        deps.saveProjectState(pstate)

        let relabeled = 0
        for (const r of idx.reports || []) {
          if (r.project === name && r.fingerprint === srcFp) {
            r.fingerprint = dstFp
            relabeled++
          }
        }
        deps.saveReportsIndex(idx)

        for (const r of idx.reports || []) {
          if (r.project !== name || r.fingerprint !== dstFp) continue
          const rf = join(deps.REPORTS_DIR, `${r.id}.json`)
          try {
            if (!deps.existsSync(rf)) continue
            const data = deps.safeJsonParse(deps.readFileSync(rf, "utf-8"))
            if (data?.meta?.project === name && data?.meta?.fingerprint === srcFp) {
              data.meta.fingerprint = dstFp
              deps.writeFileSync(rf, JSON.stringify(data, null, 2) + "\n")
            }
          } catch {}
        }

        lines.push("")
        lines.push(`\u2705 Applied. Relabeled ${relabeled} report index entries.`)
        if (backups.length > 0) {
          lines.push("Backups:")
          for (const b of backups) lines.push(`  - ${b}`)
        }
        return lines.join("\n")
      }

      if (action === "blackbox") {
        const mode = slot || "status"
        if (mode === "on") {
          if (typeof deps.setBlackboxEnabled === "function") deps.setBlackboxEnabled(true)
          else deps._blackboxEnabled = true
          const state = deps.loadBlackboxState()
          state.enabled = true
          deps.saveBlackboxState(state)
          return "\u2705 Blackbox decision engine ENABLED \u2014 will track resolution state and enhance system prompts."
        }
        if (mode === "off") {
          if (typeof deps.setBlackboxEnabled === "function") deps.setBlackboxEnabled(false)
          else deps._blackboxEnabled = false
          const state = deps.loadBlackboxState()
          state.enabled = false
          deps.saveBlackboxState(state)
          return "\u23F8 Blackbox decision engine DISABLED."
        }
        if (mode === "reset") {
          deps._blackboxTracker = null
          const state = deps.loadBlackboxState()
          const sid = deps._OC_SID
          delete state.sessions[sid]
          deps.saveBlackboxState(state)
          return "\u{1F504} Blackbox resolution tracker RESET."
        }
        if (mode === "status") {
          const bbState = deps.loadBlackboxState()
          const enabled = deps._blackboxEnabled || bbState.enabled
          const lines = [`Blackbox Decision Engine: ${enabled ? "ON" : "OFF"}`]
          if (enabled) {
            const res = deps._latestBlackboxState || deps.getBlackboxResolution()
            if (res) {
              lines.push(`  Resolution: ${res.resolution}`)
              lines.push(`  Sub-regime: ${res.sub_regime}`)
              lines.push(`  Momentum: ${res.momentum > 0 ? "\u2191" : res.momentum < 0 ? "\u2193" : "\u2192"} ${res.momentum.toFixed(2)}`)
              lines.push(`  Interactions: ${res.n_interactions}`)
              if (res.is_looping) lines.push("  \u26A0 Looping detected \u2014 consider a fresh perspective")
            } else {
              lines.push("  No resolution data yet \u2014 start a decision session")
            }
            if (deps.currentProjectFingerprint) {
              lines.push("")
              lines.push(`  Project: ${deps.currentProjectName || "unknown"}`)
              const projectSessions = Object.entries(bbState.sessions || {}).filter(([k, v]) => v.project_fingerprint === deps.currentProjectFingerprint)
              lines.push(`  Cross-session history: ${projectSessions.length} session(s) for this project`)
            }
          }
          lines.push("")
          lines.push("Usage: trinity blackbox on|off|status|reset")
          return lines.join("\n")
        }
        return `\u274c Use \`trinity blackbox on|off|status|reset\``
      }

      if (action === "help") {
        return [
          "vibeOS \u2014 trinity commands",
          "",
          "TIERS:",
          "  trinity status            See plugin state, credit, model assignment",
          "  trinity brain             Switch to brain tier (most capable)",
          "  trinity medium            Switch to medium tier (balanced)",
          "  trinity cheap             Switch to cheap tier (most savings)",
          "  trinity rebuild           Auto-detect available models",
          "",
          "CONTROLS:",
          "  trinity enable/disable    Toggle vibeOS plugin on/off",
          "  trinity enforce on        Block brain-tier writes/edits (save $$)",
          "  trinity lock on/off       Lock model at session start (skip auto-reconcile)",
          "  trinity thinking full|brief|off  Set reasoning depth",
          "",
          "GUARDRAILS:",
          "  trinity flow on/off       Toggle flow enforcer (code quality checks)",
          "  trinity tdd on/off        Toggle auto test skeleton creation",
          "  trinity setup             Create a compatibility profile for new users",
          "  trinity guard             Ensure AGENTS.md/README.md exist and are current",
          "  trinity api-token <token|invalidate>  Update or invalidate VIBEOS_API_TOKEN",
          "  trinity api-token <token|invalidate>  Update or invalidate VIBEOS_API_TOKEN",
          "  trinity flow              Show flow violations this session",
          "",
          "DIAGNOSTICS:",
          "  trinity diagnose          Self-check: config, files, model probes, budget",
          "  trinity project           Project analytics and optimization tips",
          "  trinity patterns          Show learned friction/routine patterns",
          "  trinity patterns suggest  Suggest relevant patterns from similar stack projects",
          "  trinity patterns clear    Clear learned patterns for this project",
          "",
          "REPAIR:",
          "  trinity repair-state      Fix fingerprint collisions (preview/apply)",
          "",
          "DECISION ENGINE:",
          "  trinity blackbox on/off   Toggle theWay blackbox decision engine",
          "  trinity blackbox status   View resolution state, momentum, project history",
          "  trinity blackbox reset    Clear resolution tracker for current session",
        ].join("\n")
      }

      return `\u274c Unknown action: ${action}`
    },
  }
}
