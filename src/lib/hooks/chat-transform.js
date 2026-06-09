// @ts-nocheck
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { currentModel, currentProjectFingerprint, currentProjectName, _blackboxEnabled, loadSelection, writeSelection, safeJsonParse, applyDecadence, getSessionScratchpadDir, ensureSessionScratchpadDirs, indexAppend, briefedProjects, getActiveJobForProject, loadTodos, promotedProjectPatterns, detectTechStack, projectFingerprint, SCRATCHPAD_ROOT, TRINITY_OPENCODE_CONFIG, TIERS_FILE, loadGlobalLearning, setCurrentProjectFingerprint, setCurrentProjectName, stableJson, TOOL_NAME_NORMALIZE, _cacheDb, recordCacheSaving, } from "../state.js";
import { applySlot, TRINITY_CHEAP, TRINITY_MEDIUM, cacheSavePer1MInputTokens, } from "../pricing.js";
import { scoreStress, classifyTurnSimple, loadOptimizationMode, selectOptimizationModeRemote, computeControlVector, getBlackboxTracker, loadBlackboxState as loadBlackboxStateFromCtx, saveBlackboxState as saveBlackboxStateToCtx, extractLastUserText, isLikelyOffTopic, fetchBlackboxEnrichment, estimateContextBudget, buildControlHistoryEntry, setBlackboxEnabled, } from "../turn-classify.js";
import { applyBudgetFirstMode, peekBudgetFirstMode } from "../mode-policy.js";
import { BRANDED_MODES, RUNTIME_MODES } from "../mode-router.js";
import { addCacheEntry, extractRecentCacheOutputs } from "../../vibeOS-lib/smart-cache.js";
import { remoteCall, isApiConnected } from "../api-client.js";
import { loadCredit } from "../credit-api.js";
import { loadSessionOptMode, loadSessionSlot, writeSessionSlot } from "../selection-manager.js";
import { noteProjectPattern } from "../index-helpers.js";
import { saveSessionStress } from "../index-helpers.js";
import { COMPRESS_THRESHOLD, KEEP_HOT, COMPRESS_MARKER, PROTOCOL_MARKER, PROTOCOL_TEXT } from "../constants.js";
import { TEMPLATES, DEFAULT_TEMPLATE, resolveTemplate, shouldInjectTemplate } from "../templates.js";
const BYTES_PER_TOKEN = 4;
function getVibeOSHome() {
    return process.env.VIBEOS_HOME || join(process.env.HOME || "", ".claude");
}
function resolveRestorableOpenCodeAgent(currentSel) {
    const remembered = typeof currentSel?.previous_default_agent === "string" ? currentSel.previous_default_agent.trim() : "";
    if (remembered && remembered !== "plan")
        return remembered;
    try {
        const configDir = dirname(TRINITY_OPENCODE_CONFIG || join(process.env.HOME || "", ".config/opencode/opencode.json"));
        const candidates = readdirSync(configDir)
            .filter((name) => /^opencode\.json\.bak/.test(name))
            .map((name) => {
            const path = join(configDir, name);
            return { path, mtime: statSync(path).mtimeMs };
        })
            .sort((a, b) => b.mtime - a.mtime);
        for (const candidate of candidates) {
            try {
                const snapshot = safeJsonParse(readFileSync(candidate.path, "utf-8"));
                const agent = typeof snapshot?.default_agent === "string" ? snapshot.default_agent.trim() : "";
                if (agent && agent !== "plan")
                    return agent;
            }
            catch { }
        }
    }
    catch { }
    return null;
}
function getOpenCodeHome() {
    return process.env.VIBEOS_OPENCODE_HOME || join(process.env.HOME || "", ".config", "opencode");
}
function ensureProjectContext(hookDirectory) {
    const resolved = projectFingerprint(hookDirectory || currentProjectFingerprint || process.cwd() || "");
    if (resolved && resolved !== currentProjectFingerprint)
        setCurrentProjectFingerprint(resolved);
    if (hookDirectory) {
        const name = hookDirectory.split("/").filter(Boolean).pop() || "unknown";
        if (name && name !== currentProjectName)
            setCurrentProjectName(name);
    }
    return resolved;
}
let latestUserIntent = null;
let _OC_SID = "opencode-" + (process.pid || "x") + "-" + Date.now();
let _latestBlackboxState = null;
let _latestBlackboxLoopMsg = null;
let _latestBlackboxPivotMsg = null;
let _prevOutputText = "";
let _prevBlackboxRegime = null;
let _currentTemplate = DEFAULT_TEMPLATE;
let _prevTemplate = null;
let _turnCountInject = 0;
const correctionSeenKeys = new Set();
async function apiComputeControlVector(state, action, optimizationMode) {
    try {
        const res = await remoteCall("blackboxControlVector", [state, action, optimizationMode], null);
        if (res?.control_vector) {
            const local = computeControlVector(state, action, optimizationMode);
            return { ...res.control_vector, tier_bias: local.tier_bias, optimization_mode: local.optimization_mode };
        }
    }
    catch { }
    return computeControlVector(state, action, optimizationMode);
}
function observeUserCorrection(text) {
    if (!text || typeof text !== "string")
        return;
    try {
        const t = text.toLowerCase();
        const corrections = [];
        if (/wrong\b|that.s wrong|incorrect|not what i|didn.t mean|misunderstood/i.test(t)) {
            if (/\bimport\b|require\b|from\b|path\b|module\b/i.test(t))
                corrections.push("correction:imports");
            if (/\bfunction\b|logic\b|algorithm\b|calculation\b|formula\b|return\b|result\b/i.test(t) && !corrections.includes("correction:imports"))
                corrections.push("correction:logic");
            if (/\brename\b|variable\b|const\b|let\b|var\b|name\b|called\b/i.test(t) && !corrections.includes("correction:logic"))
                corrections.push("correction:naming");
            if (/\bdelete\b|remove\b|get rid\b|revert\b|undo\b|rollback\b/i.test(t))
                corrections.push("correction:deletion");
            if (/\brestructure\b|refactor\b|reorganize\b|move\b|split\b|extract\b/i.test(t) && !corrections.includes("correction:deletion"))
                corrections.push("correction:restructure");
            if (corrections.length === 0)
                corrections.push("correction:general");
        }
        if (corrections.length === 0 && /\bshould be\b|change .+ to\b|replace .+ with\b|instead of\b/i.test(t)) {
            corrections.push("correction:general");
        }
        for (const c of corrections) {
            const sessionKey = `friction:${c}`;
            if (correctionSeenKeys.has(sessionKey))
                continue;
            correctionSeenKeys.add(sessionKey);
            try {
                noteProjectPattern("friction", c, `User corrected ${c.replace("correction:", "")} in a follow-up message.`, { family: c });
            }
            catch { }
        }
    }
    catch { }
}
function buildProjectBriefing(directory) {
    const label = currentProjectName || (directory ? basename(directory) : "");
    if (!label)
        return null;
    return `[project memory] Active project: ${label}. Stay focused on the current repository and prefer the existing workflow.`;
}
export function ensureProjectSkill(dir, fp) {
    const skillsDir = join(dir, ".opencode", "skills");
    const projectName = basename(dir);
    const skillDir = join(skillsDir, projectName);
    const skillPath = join(skillDir, "SKILL.md");
    if (existsSync(skillPath)) {
        return { created: false, skipped: true, path: skillPath };
    }
    const promoted = promotedProjectPatterns(fp);
    if (!promoted || promoted.length === 0) {
        return { created: false, skipped: false };
    }
    const techStack = detectTechStack(dir);
    const globalLearning = loadGlobalLearning();
    const promotedRoutines = globalLearning.promotedRoutines || [];
    const skillName = `project-${projectName.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
    let content = `---\n`;
    content += `name: ${skillName}\n`;
    content += `description: Project-specific conventions, patterns, and workflows for ${projectName}. Auto-generated by vibeOS.\n`;
    content += `---\n\n`;
    content += `# ${projectName} Conventions\n\n`;
    if (techStack.length > 0) {
        content += `## Tech Stack\n\n`;
        content += techStack.map((t) => `- ${t}`).join("\n") + "\n\n";
    }
    const routines = promoted.filter((p) => p.label === "routine");
    if (routines.length > 0) {
        content += `## Routines (established workflows)\n\n`;
        for (const r of routines) {
            content += `- ${r.summary} (${r.sessions} sessions)\n`;
        }
        content += "\n";
    }
    const frictions = promoted.filter((p) => p.label === "friction");
    if (frictions.length > 0) {
        content += `## Frictions (patterns to avoid)\n\n`;
        for (const f of frictions) {
            content += `- ${f.summary} (${f.sessions} sessions)\n`;
        }
        content += "\n";
    }
    if (promotedRoutines.length > 0) {
        content += `## Common Tool Chains\n\n`;
        for (const pair of promotedRoutines) {
            content += `- ${pair}\n`;
        }
        content += "\n";
    }
    try {
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(skillPath, content, "utf-8");
        console.error(`[vibeOS] Project Guard: created .opencode/skills/${projectName}/SKILL.md`);
        return { created: true, path: skillPath, skipped: false };
    }
    catch (err) {
        console.error(`[vibeOS] Project Guard: failed to create skill for ${projectName}: ${err.message}`);
        return { created: false, skipped: false };
    }
}
export function syncControlSettings(cv, options = {}) {
    if (!cv)
        return;
    try {
        const sid = _OC_SID;
        const persistOptimizationMode = options.persistOptimizationMode !== false;
        const currentSel = loadSelection();
        const userSetMode = loadSessionOptMode(sid + "_opt");
        const userOptMode = userSetMode || loadOptimizationMode();
        const isManualMode = userSetMode && userOptMode !== "auto";
        const writeIf = (key, val) => {
            const sel = loadSelection();
            if (sel[key] !== val)
                writeSelection(key, val);
        };
        if (isManualMode) {
            const allEntries = [...BRANDED_MODES, ...RUNTIME_MODES];
            const modeEntry = allEntries.find((e) => e.id === userOptMode);
            if (modeEntry) {
                writeIf("active_pipeline", JSON.stringify(modeEntry.pipeline));
            }
        }
        const compatibilityMode = currentSel.onboarding_mode === "assist";
        writeIf("delegation_enforce", compatibilityMode ? cv.enforcement_mode === "strict" : cv.enforcement_mode !== "relaxed");
        if (compatibilityMode) {
            writeIf("flow_enabled", cv.flow_mode === "strict");
            writeIf("flow_enforce", cv.flow_mode === "strict");
        }
        else if (cv.flow_mode === "audit") {
            writeIf("flow_enabled", false);
            writeIf("flow_enforce", false);
        }
        else {
            writeIf("flow_enabled", true);
            writeIf("flow_enforce", cv.flow_mode === "strict");
        }
        if (compatibilityMode) {
            writeIf("tdd_enforce", cv.tdd_mode === "strict");
            writeIf("tdd_strict", cv.tdd_mode === "strict");
        }
        else if (cv.tdd_mode === "lazy") {
            writeIf("tdd_enforce", false);
            writeIf("tdd_strict", false);
        }
        else {
            writeIf("tdd_enforce", true);
            writeIf("tdd_strict", cv.tdd_mode === "strict");
        }
        if (cv.thinking_mode) {
            const nextThinking = cv.thinking_mode === "auto" ? "off" : cv.thinking_mode;
            if (currentSel.thinking_level !== nextThinking)
                writeIf("thinking_level", nextThinking);
        }
        if (persistOptimizationMode && cv.optimization_mode && userOptMode !== "auto") {
            if (userOptMode !== cv.optimization_mode) {
                writeIf("optimization_mode", cv.optimization_mode);
            }
        }
        const slot = cv.tier_bias;
        if (slot && slot !== "auto") {
            const existingSlot = loadSessionSlot(sid);
            if (existingSlot !== slot) {
                writeSessionSlot(sid, slot);
                writeIf("vector_changed_slot", slot);
                writeIf("vector_changed_at", Date.now());
                const applied = applySlot(slot);
                if (!applied?.ok) {
                    console.error(`[vibeOS] failed to apply slot ${slot}: ${applied?.reason || "unknown"}`);
                }
            }
        }
        if (cv.agent_mode) {
            try {
                const OC_CONFIG = TRINITY_OPENCODE_CONFIG || join(getOpenCodeHome(), "opencode.json");
                if (existsSync(OC_CONFIG)) {
                    const oc = safeJsonParse(readFileSync(OC_CONFIG, "utf-8"));
                    if (oc.default_agent !== cv.agent_mode) {
                        if (cv.agent_mode === "plan" && oc.default_agent && oc.default_agent !== "plan") {
                            writeSelection("previous_default_agent", oc.default_agent);
                        }
                        oc.default_agent = cv.agent_mode;
                        writeFileSync(OC_CONFIG, JSON.stringify(oc, null, 2) + "\n");
                    }
                }
            }
            catch { }
        }
        else {
            try {
                const OC_CONFIG = TRINITY_OPENCODE_CONFIG || join(getOpenCodeHome(), "opencode.json");
                if (existsSync(OC_CONFIG)) {
                    const oc = safeJsonParse(readFileSync(OC_CONFIG, "utf-8"));
                    const restoreAgent = oc.default_agent === "plan" ? resolveRestorableOpenCodeAgent(currentSel) : null;
                    if (restoreAgent && oc.default_agent === "plan") {
                        oc.default_agent = restoreAgent;
                        writeFileSync(OC_CONFIG, JSON.stringify(oc, null, 2) + "\n");
                        if (currentSel.previous_default_agent)
                            writeSelection("previous_default_agent", null);
                    }
                }
            }
            catch { }
        }
    }
    catch { /* noop -- non-critical sync */ }
}
function pushSystem(output, text) {
    if (text && Array.isArray(output?.system)) {
        output.system.push(text);
    }
}
function oneShot(key) {
    const scoped = onSystemTransform._briefedProjects || briefedProjects;
    if (scoped.has(key))
        return true;
    scoped.add(key);
    return false;
}
// -- Context compression --------------------------------------------
function compressToolOutputs(messages) {
    let compressedBytes = 0;
    const hotStart = Math.max(0, messages.length - KEEP_HOT);
    for (let i = 0; i < messages.length; i++) {
        const { info, parts } = messages[i];
        if (!Array.isArray(parts))
            continue;
        const isCold = i < hotStart;
        for (const part of parts) {
            if (part?.type !== "tool")
                continue;
            const state = part.state;
            if (state?.status !== "completed")
                continue;
            const raw = state.output;
            if (!raw || typeof raw !== "string" || raw.length < COMPRESS_THRESHOLD)
                continue;
            if (raw.includes(COMPRESS_MARKER))
                continue;
            const hash = createHash("sha256")
                .update(`tool_result\n${raw}\n`).digest("hex").slice(0, 16);
            const globalDir = join(SCRATCHPAD_ROOT, "by-hash");
            const sessPath = join(getSessionScratchpadDir(), `${hash}.txt`);
            const globalPath = join(globalDir, `${hash}.txt`);
            try {
                mkdirSync(globalDir, { recursive: true });
                ensureSessionScratchpadDirs();
                if (!existsSync(globalPath)) {
                    writeFileSync(globalPath, raw);
                    indexAppend(hash, part.tool, raw.length);
                    // Clean up any existing session-local copy
                    if (existsSync(sessPath))
                        rmSync(sessPath, { force: true });
                }
                // Create pointer file for input-hash-based lookup
                const invPart = parts.slice(0, parts.indexOf(part)).reverse().find((p) => p?.type === "tool" && p?.tool === part.tool && p?.state?.input && p?.state?.status !== "completed");
                if (invPart?.state?.input) {
                    const toolKey = TOOL_NAME_NORMALIZE[part.tool] || part.tool;
                    const inputHash = createHash("sha256")
                        .update(`${toolKey}\n${stableJson(invPart.state.input)}\n`)
                        .digest("hex").slice(0, 16);
                    const ptrPath = join(getSessionScratchpadDir(), `${inputHash}.ptr`);
                    try {
                        writeFileSync(ptrPath, JSON.stringify({ contentHash: hash, tool: part.tool }));
                    }
                    catch { }
                }
            }
            catch (err) {
                console.error(`[vibeOS] ctx-compress write failed: ${err.message}`);
                continue;
            }
            if (!isCold)
                continue;
            const summary = raw.slice(0, 200).replace(/\n+/g, " ").trim() + (raw.length > 200 ? "\u2026" : "");
            const ref = `${COMPRESS_MARKER} [${raw.length} chars compressed -- cold storage at ${globalPath}] ` +
                `[summary] ${summary}`;
            state.output = ref;
            compressedBytes += raw.length - ref.length;
            const toolKey = TOOL_NAME_NORMALIZE[part.tool] || part.tool;
            const rate = cacheSavePer1MInputTokens(currentModel);
            if (rate > 0) {
                const inputTokens = Math.max(1, Math.round((raw.length - ref.length) / BYTES_PER_TOKEN));
                const saveEst = Math.max(0.0001, Math.round(inputTokens * rate / 1_000_000 * 10000) / 10000);
                recordCacheSaving(toolKey, saveEst, { hash });
            }
            console.error(`[vibeOS] ctx-compress: ${raw.length}\u2192${ref.length} chars (hash: ${hash})`);
        }
    }
    return compressedBytes;
}
// -- Worker-to-Brain Protocol ---------------------------------------
function injectWBP(messages) {
    for (let i = 0; i < messages.length - 1; i++) {
        const { info, parts } = messages[i];
        if (!Array.isArray(parts))
            continue;
        const hasTask = parts.some(p => p?.type === "tool" && p?.tool === "task" && p?.state?.status === "completed");
        if (!hasTask)
            continue;
        const nextMsg = messages[i + 1];
        if (!Array.isArray(nextMsg?.parts))
            continue;
        const alreadyHas = nextMsg.parts.some(p => p?.type === "text" && p?.text?.includes(PROTOCOL_MARKER));
        if (alreadyHas)
            continue;
        const textPart = nextMsg.parts.find(p => p?.type === "text");
        if (textPart) {
            textPart.text = textPart.text + "\n\n" + PROTOCOL_TEXT;
        }
        else {
            nextMsg.parts.push({ type: "text", text: PROTOCOL_TEXT, synthetic: true });
        }
    }
}
// -- Blackbox resolution tracking -----------------------------------
async function trackBlackbox(messages) {
    const lastUserMsg = messages.slice().reverse().find(m => m.info?.role === "user");
    if (!lastUserMsg)
        return;
    const textPart = lastUserMsg.parts?.find(p => p?.type === "text");
    if (!textPart?.text)
        return;
    latestUserIntent = textPart.text;
    if (!_blackboxEnabled)
        return;
    try {
        const tracker = getBlackboxTracker();
        const localState = tracker.update(latestUserIntent);
        const state = loadBlackboxStateFromCtx();
        const sid = _OC_SID;
        ensureProjectContext(process.cwd() || "");
        const serialized = tracker.serialize();
        const existingSession = state.sessions[sid] || {};
        if (!state.sessions[sid])
            state.sessions[sid] = {};
        state.sessions[sid].control_history ??= [];
        const st = scoreStress(latestUserIntent);
        if (st) {
            localState.latest_stress_multiplier = st;
            saveSessionStress(st, st > 1.5 ? "critical" : st > 0.7 ? "elevated" : st > 0.3 ? "moderate" : "none");
        }
        const modePreview = peekBudgetFirstMode({
            requestedMode: loadOptimizationMode(),
            subRegime: localState.sub_regime || "INIT",
            stress: st || 0,
        });
        const cv = await apiComputeControlVector(localState, undefined, modePreview.mode);
        state.sessions[sid].control_history.push(buildControlHistoryEntry(state.sessions[sid].control_history.length + 1, localState.sub_regime || "INIT", cv));
        if (state.sessions[sid].control_history.length > 100) {
            state.sessions[sid].control_history = state.sessions[sid].control_history.slice(-100);
        }
        state.sessions[sid] = {
            ...existingSession,
            ...serialized,
            project_fingerprint: currentProjectFingerprint || existingSession.project_fingerprint || "",
            sub_regime: localState.sub_regime || existingSession.sub_regime || "INIT",
            regime: localState.sub_regime || existingSession.regime || "INIT",
            resolution: localState.resolution || existingSession.resolution || "unresolved",
            momentum: localState.momentum ?? existingSession.momentum ?? 0,
            signals: localState.signals || existingSession.signals || {},
            intent_state: localState.intent_state || existingSession.intent_state || {},
            continuity_state: localState.continuity_state || existingSession.continuity_state || "HIGH",
            is_looping: localState.is_looping ?? existingSession.is_looping ?? false,
            loop_consecutive: localState.loop_consecutive ?? existingSession.loop_consecutive ?? 0,
            loop_intervention_level: localState.loop_intervention_level || existingSession.loop_intervention_level || "none",
            pivot_detected: localState.pivot_detected ?? existingSession.pivot_detected ?? false,
            pivot_score: localState.pivot_score ?? existingSession.pivot_score ?? 0,
            outcome: localState.outcome || existingSession.outcome || null,
            control_history: state.sessions[sid].control_history,
            optimization_mode: existingSession.optimization_mode || null,
            active_slot: existingSession.active_slot || null,
            turn_counter: existingSession.turn_counter || 0,
        };
        saveBlackboxStateToCtx(state);
        _latestBlackboxState = localState;
        fetchBlackboxEnrichment(sid, localState).then(enriched => {
            if (enriched)
                _latestBlackboxState = enriched;
        }).catch(() => { });
    }
    catch { }
}
export const onMessagesTransform = async (_input, output) => {
    if (!loadSelection().enabled)
        return;
    try {
        const messages = output?.messages;
        if (!Array.isArray(messages))
            return;
        const compressedBytes = compressToolOutputs(messages);
        if (compressedBytes > 0) {
            console.error(`[vibeOS] ctx-compress total saved this transform: ~${Math.round(compressedBytes / 4)} tokens`);
        }
        injectWBP(messages);
        applyDecadence();
        await trackBlackbox(messages);
    }
    catch (err) {
        console.error(`[vibeOS] messages.transform failed: ${err.message}`);
    }
};
// -- Directive builders for system prompt injection ------------------
const C7_URGENCY = {
    required: " CRITICAL: context7 usage is REQUIRED this turn.",
    optional: " (context7 is optional this turn -- use if helpful but not required.)",
};
function context7Directive(cv) {
    const urgency = cv?.context7_urgency || "preferred";
    return "[cost policy] If mcp__context7__resolve-library-id and mcp__context7__get-library-docs " +
        "tools are available in this session, ALWAYS use them instead of WebFetch or WebSearch " +
        "when looking up library or framework documentation " +
        "(docs.*, readthedocs.*, npmjs.com/package/*, pypi.org/project/*, pkg.go.dev, /api/reference/). " +
        "Do not fetch those URLs directly when context7 can serve the same content. " +
        "This saves ~$0.06/turn on average." +
        (C7_URGENCY[urgency] || "");
}
function thinkingDirective(level) {
    const credit = loadCredit();
    const creditNote = `credit ${credit}%`;
    if (level === "brief") {
        return `[thinking policy] Reasoning depth: BRIEF (manually set, ${creditNote}). Use extended thinking only for genuinely complex multi-step problems. Keep reasoning concise -- skip exploratory scratch work and restatement.`;
    }
    return `[thinking policy] Reasoning depth: OFF (manually set, ${creditNote}). Skip extended thinking entirely. Respond directly and concisely. Every thinking token costs money -- save it for when the user explicitly asks.`;
}
function orchestratorDirective(cv, sel) {
    const tierBias = cv?.tier_bias || "auto";
    let brainModel = "(brain)";
    try {
        brainModel = safeJsonParse(readFileSync(TIERS_FILE, "utf-8")).trinity?.brain?.oc || brainModel;
    }
    catch { }
    const cheapModel = TRINITY_CHEAP || "the cheaper model";
    const mediumModel = TRINITY_MEDIUM || "the medium model";
    const targetModel = tierBias === "cheap" ? cheapModel : tierBias === "medium" ? mediumModel : tierBias === "brain" ? brainModel : `${cheapModel} or ${mediumModel}`;
    const compatibilityMode = sel?.onboarding_mode === "assist";
    return `[AI ORCHESTRATOR AGENT] You are an AI orchestrator agent. ` +
        `Delegate heavy work to Task subagents (runs on ${targetModel}). ` +
        `Your role: verify, fill gaps, synthesize. ` +
        (compatibilityMode
            ? "Compatibility mode is active: direct Write/Edit is allowed until the user enables strict guardrails."
            : "CRITICAL: Write/Edit tools are BLOCKED on this tier. You MUST delegate ALL implementation work to Task subagents.") +
        ` Always display the vibeOS cost footer.` +
        (tierBias !== "auto" ? ` [tier routing] This turn is biased toward ${tierBias} tier.` : "");
}
const TDD_NOTES = {
    lazy: " Skeletons only when explicitly requested.",
    strict: " STRICT mode: TODO tests MUST pass before considering work complete.",
    quality: " QUALITY mode: Full coverage including edge cases.",
};
function tddDirective(cv, sel) {
    const tddMode = cv?.tdd_mode || (sel.tdd_strict ? "strict" : "normal");
    const tddFocus = cv?.tdd_focus || [];
    const focusNote = tddFocus.length > 0 ? ` Focus: ${tddFocus.join(", ")}.` : "";
    return `[tdd enforcement: ${tddMode}] Auto-create skeleton tests for source files being written/edited.${TDD_NOTES[tddMode] || ""}${focusNote} ` +
        "When creating or modifying source files, ensure corresponding test files exist with proper assertions.";
}
function flowDirective(cv, sel) {
    const flowMode = cv?.flow_mode || (sel.flow_enforce ? "normal" : "audit");
    const flowFocus = cv?.flow_focus || [];
    const enforceNote = sel.flow_enforce ? " TODO/FIXME extraction is active." : "";
    const focusNote = flowFocus.length > 0 ? ` Focus rules: ${flowFocus.join(", ")}.` : "";
    return `[flow enforcement: ${flowMode}] Development flow rules are active: write/edit operations are checked against project conventions.${enforceNote}${focusNote} ` +
        "Follow existing code patterns, naming conventions, and project structure.";
}
function flowTodosDirective() {
    const pendingTodos = loadTodos().filter((t) => t.status === "pending").length;
    if (pendingTodos === 0)
        return null;
    return "[vibeOS] " + pendingTodos + " extracted TODO/FIXME items are pending. " +
        "Consider calling `todowrite` to add them to the native task list.";
}
function patternDirective(fp) {
    const patterns = promotedProjectPatterns(fp);
    if (!patterns || patterns.length === 0)
        return null;
    const routines = patterns.filter(p => p.label === "routine");
    const frictions = patterns.filter(p => p.label === "friction");
    const parts = [];
    if (routines.length > 0) {
        parts.push("Routines: " + routines.map(r => r.summary).join("; "));
    }
    if (frictions.length > 0) {
        parts.push("Frictions: " + frictions.map(f => f.summary).join("; "));
    }
    if (parts.length === 0)
        return null;
    return "[project patterns] " + parts.join(". ") + ".";
}
function welcomeDirective() {
    const sel = loadSelection();
    let tiers = {};
    try {
        tiers = safeJsonParse(readFileSync(TIERS_FILE, "utf-8")).trinity || {};
    }
    catch { }
    const active = sel.active_slot || "medium";
    const current = currentModel || "(unknown)";
    return "[vibeOS] Active plugin. Slot: " + active + " (" + current + "). " +
        "Use trinity command to switch slots, rebuild, or check status. " +
        "Run `trinity help` for all commands.";
}
function contextBudgetDirective(_input, output) {
    const ctxBudget = estimateContextBudget(_input, output);
    if (!ctxBudget || ctxBudget.pct <= 70)
        return null;
    const severity = ctxBudget.pct > 90 ? "CRITICAL" : "WARNING";
    return `[context budget: ${severity}] Context window is ${ctxBudget.pct}% full (~${ctxBudget.estimatedTokens} tokens). ` +
        "Consider using Task subagents for heavy work, compressing tool outputs, or starting a new session to avoid context overflow.";
}
export const onSystemTransform = async (_input, output) => {
    if (!loadSelection().enabled)
        return;
    try {
        const hookDirectory = String(onSystemTransform._directory || "");
        const userText = extractLastUserText(_input) || extractLastUserText(output);
        if (typeof userText === "string" && userText.trim())
            latestUserIntent = userText;
        else if (!latestUserIntent)
            latestUserIntent = null;
        if (latestUserIntent)
            observeUserCorrection(latestUserIntent);
        const optimizationSuggestion = await selectOptimizationModeRemote(_latestBlackboxState?.sub_regime || (latestUserIntent ? classifyTurnSimple(latestUserIntent) : "INIT"), latestUserIntent ? scoreStress(latestUserIntent) : 0, loadOptimizationMode());
        const optimizationDecision = applyBudgetFirstMode({
            requestedMode: loadOptimizationMode(),
            suggestedMode: optimizationSuggestion,
            subRegime: _latestBlackboxState?.sub_regime || (latestUserIntent ? classifyTurnSimple(latestUserIntent) : "INIT"),
            stress: latestUserIntent ? scoreStress(latestUserIntent) : 0,
            nInteractions: _latestBlackboxState?.n_interactions ?? 0,
        });
        const optimizationMode = optimizationDecision.mode;
        let _controlVector = null;
        ensureProjectContext(hookDirectory);
        if (_latestBlackboxState) {
            const st = latestUserIntent ? scoreStress(latestUserIntent) : 0;
            if (st)
                _latestBlackboxState.latest_stress_multiplier = st;
            _controlVector = await apiComputeControlVector(_latestBlackboxState, undefined, optimizationMode);
        }
        else if (latestUserIntent) {
            const st = scoreStress(latestUserIntent);
            _controlVector = await apiComputeControlVector({
                sub_regime: classifyTurnSimple(latestUserIntent),
                latest_stress_multiplier: st || undefined,
            }, undefined, optimizationMode);
        }
        if (!_controlVector) {
            _controlVector = await apiComputeControlVector({
                sub_regime: "INIT",
                latest_stress_multiplier: latestUserIntent ? scoreStress(latestUserIntent) : undefined,
            }, undefined, optimizationMode);
        }
        const system = output?.system;
        if (!Array.isArray(system))
            return;
        if (isApiConnected()) {
            try {
                const bb = loadBlackboxStateFromCtx();
                if (!bb.enabled || _blackboxEnabled === false) {
                    setBlackboxEnabled(true);
                    if (!bb.enabled) {
                        bb.enabled = true;
                        saveBlackboxStateToCtx(bb);
                    }
                }
            }
            catch { }
        }
        const sel = loadSelection();
        syncControlSettings(_controlVector, { persistOptimizationMode: optimizationDecision.shouldPersistRequestedMode });
        const fp = ensureProjectContext(hookDirectory);
        const rawStress = latestUserIntent ? scoreStress(latestUserIntent) : 0;
        const stressScore = rawStress * (_controlVector?.stress_multiplier ?? 1);
        const credit = loadCredit();
        _turnCountInject++;
        // ── Pivot detection and PIVOT BACK injection ──
        if (latestUserIntent && _blackboxEnabled !== false) {
            try {
                let pivotResult = null;
                try {
                    const remote = await remoteCall("vibemaxPipeline", [{
                            user_text: latestUserIntent,
                            _pivotContext: {
                                files: onSystemTransform._recentFiles || [],
                                decisions: onSystemTransform._recentDecisions || [],
                                blockers: onSystemTransform._recentBlockers || [],
                                toolOutputs: _cacheDb ? extractRecentCacheOutputs(_cacheDb, 10) : [],
                            },
                        }], null);
                    if (remote?.pivot)
                        pivotResult = remote;
                }
                catch { /* remote vibemax pipeline */ }
                if (!pivotResult) {
                    const { vibemaxPipeline: localPipeline } = await import("../../vibeOS-lib/blackbox/vibemax.js");
                    pivotResult = await localPipeline({
                        user_text: latestUserIntent,
                        _pivotContext: {
                            files: onSystemTransform._recentFiles || [],
                            decisions: onSystemTransform._recentDecisions || [],
                            blockers: onSystemTransform._recentBlockers || [],
                            toolOutputs: _cacheDb ? extractRecentCacheOutputs(_cacheDb, 10) : [],
                        },
                    });
                }
                if (pivotResult?.pivot?.injection) {
                    pushSystem(output, pivotResult.pivot.injection);
                    // Warm smart cache with workflow tool outputs
                    if (pivotResult.pivot.workflowId && pivotResult.pivot.toolOutputs?.length > 0) {
                        try {
                            for (const entry of pivotResult.pivot.toolOutputs) {
                                addCacheEntry(_cacheDb, entry.hash, entry.tool, entry.prompt, entry.sizeBytes || 1024, entry.ageSec || 3600);
                            }
                        }
                        catch { /* cache warming is best-effort */ }
                    }
                }
            }
            catch { /* pivot pipeline is best-effort */ }
        }
        const stressMitigationDirective = rawStress > 0.7
            ? "[stress mitigation: CRITICAL] The user's message shows very high stress indicators. " +
                "Stay calm, structured, and thorough. Use proper markdown formatting with code blocks, " +
                "lists, and organized structure. Do NOT mirror the user's tone or brevity. " +
                "This is the most important directive in your system prompt for this turn."
            : rawStress > 0.4
                ? "[stress mitigation: elevated] The user's message has elevated stress indicators. " +
                    "Maintain structured, well-formatted responses with markdown and code blocks."
                : null;
        if (stressMitigationDirective) {
            pushSystem(output, stressMitigationDirective);
        }
        // ── Template resolution ──
        _prevTemplate = _currentTemplate;
        _currentTemplate = resolveTemplate(_prevTemplate, stressScore, latestUserIntent, credit);
        // ── Gated template directive (only on transition or periodic) ──
        if (shouldInjectTemplate(_currentTemplate, _prevTemplate)) {
            const tpl = TEMPLATES[_currentTemplate] || TEMPLATES[DEFAULT_TEMPLATE];
            let fused = tpl.directive;
            if (sel.delegation_enforce && _controlVector?.enforcement_mode !== "relaxed") {
                fused += " CRITICAL: Write/Edit tools are BLOCKED on brain tier. Delegate ALL implementation to Task subagents. Use parallel invocation for independent tasks.";
            }
            if (sel.tdd_enforce && _controlVector?.tdd_mode !== "lazy") {
                fused += " Auto-create test skeletons for changed source files.";
            }
            if (sel.flow_enabled && _controlVector?.flow_mode !== "audit") {
                fused += " Follow existing code conventions and project patterns.";
            }
            pushSystem(output, fused);
        }
        // ── Cost policy (every turn — lightweight) ──
        pushSystem(output, context7Directive(_controlVector));
        // ── Thinking directive ──
        if (sel.thinking_level && sel.thinking_level !== "full") {
            pushSystem(output, thinkingDirective(sel.thinking_level));
        }
        // ── Remote control-vector directives ──
        if (_controlVector?.directives?.length > 0) {
            for (const directive of _controlVector.directives) {
                pushSystem(output, directive);
            }
        }
        // ── Blackbox — only on regime change ──
        else if (_blackboxEnabled && _latestBlackboxState?.n_interactions > 0) {
            const prevRegime = _prevBlackboxRegime;
            const res = _latestBlackboxState;
            const currentRegime = res.sub_regime || "EXPLORING";
            if (currentRegime !== prevRegime) {
                _prevBlackboxRegime = currentRegime;
                pushSystem(output, "[decision engine] Resolution: " + (res.resolution || "unresolved") + " " +
                    "(" + currentRegime + "). Momentum: " + ((res.momentum || 0) > 0 ? "positive" : (res.momentum || 0) < 0 ? "negative" : "neutral") + ".");
                if (res.is_looping && res.loop_intervention_level && res.loop_intervention_level !== "none") {
                    const severity = res.loop_intervention_level === "escalated" ? "CRITICAL"
                        : res.loop_intervention_level === "assertive" ? "WARNING" : "NOTICE";
                    pushSystem(output, "[loop prevention: " + severity + "] " + (_latestBlackboxLoopMsg || "The conversation may be looping — try a different approach.") + " " +
                        "(level: " + res.loop_intervention_level + ")");
                }
                if (res.pivot_detected && _latestBlackboxPivotMsg) {
                    pushSystem(output, "[context switch: PIVOT] " + _latestBlackboxPivotMsg);
                }
            }
        }
        // ── Job focus ──
        const projectJob2 = onSystemTransform._activeJob || getActiveJobForProject(fp);
        if (latestUserIntent && projectJob2 && isLikelyOffTopic(latestUserIntent, projectJob2)) {
            pushSystem(output, "[job-focus] Active job context exists: \"" + ((projectJob2.prompt || "").slice(0, 140)) + "...\". " +
                "The latest user request appears off-topic relative to this running job. " +
                "Before taking write/edit/task actions, ask one concise confirmation question to validate switching scope.");
            console.error("[vibeOS] [job-focus] off-topic request detected vs active job context");
        }
        // ── Flow todos ──
        if (sel.flow_enabled && sel.flow_enforce) {
            const todoDirective = flowTodosDirective();
            if (todoDirective)
                pushSystem(output, todoDirective);
        }
        // ── Project guard (every 5 turns instead of every turn) ──
        if (_turnCountInject % 5 === 0) {
            pushSystem(output, "[project guard: CRITICAL] AGENTS.md and README.md are protected by vibeOS. " +
                "Do NOT modify either file without explicit user permission. " +
                "AGENTS.md defines that AI agents must ask before changing code.");
        }
        // ── Context budget ──
        const budgetDirective = contextBudgetDirective(_input, output);
        if (budgetDirective)
            pushSystem(output, budgetDirective);
        // ── One-shots ──
        if (!oneShot(fp)) {
            pushSystem(output, buildProjectBriefing(currentProjectName || ""));
        }
        if (!oneShot("vibeos_patterns_" + fp)) {
            const pd = patternDirective(fp);
            if (pd)
                pushSystem(output, pd);
        }
        if (!oneShot("trinity_welcome_" + fp)) {
            pushSystem(output, welcomeDirective());
        }
        // ── Calibration logging ──
        const calDir = getVibeOSHome();
        const calFile = join(calDir, "calibration-data.jsonl");
        const regime2 = _latestBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || "");
        const calRecord = JSON.stringify({
            ts: new Date().toISOString(), sid: _OC_SID,
            mode: _currentTemplate, regime: regime2, stress: stressScore,
            fp: currentProjectFingerprint || "",
        }) + "\n";
        try {
            mkdirSync(calDir, { recursive: true });
            appendFileSync(calFile, calRecord);
        }
        catch { }
        if (!oneShot("vibeos_dashboard_instruct")) {
            pushSystem(output, "[vibeOS dashboard display] When the trinity tool returns output starting with '[vibeOS-dashboard]', " +
                "you MUST use the question tool to display that data in a clean, human-readable format. " +
                "Use the question field (not the header) to show the dashboard data. " +
                "Format it with clear sections separated by blank lines, aligned columns with spaces, " +
                "and plain text only (no emojis, no markdown). " +
                "The header should be 'vibeOS Dashboard'. " +
                "Include only one option in options: {label: 'Dismiss', description: ''}. " +
                "Strip the '[vibeOS-dashboard]' marker line before displaying.");
        }
        if (!oneShot("vibeos_dopamine_style_" + fp)) {
            pushSystem(output, "[tool style: dopamine] When calling the bash tool, use a short, progress-focused description " +
                "that names the user-visible milestone being advanced. Combine independent bash commands into a single " +
                "call with && or ;. Never use raw technical labels as tool descriptions.");
        }
    }
    catch (err) {
        console.error(`[vibeOS] system.transform failed: ${err.message}`);
    }
};
export { latestUserIntent };
