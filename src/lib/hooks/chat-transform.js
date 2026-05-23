// @ts-nocheck
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { currentModel, currentProjectFingerprint, currentProjectName, _blackboxEnabled, loadSelection, writeSelection, safeJsonParse, applyDecadence, getSessionScratchpadDir, ensureSessionScratchpadDirs, indexAppend, briefedProjects, getActiveJobForProject, loadTodos, promotedProjectPatterns, detectTechStack, TRINITY_OPENCODE_CONFIG, TIERS_FILE, loadGlobalLearning, setCurrentModel, setCurrentTier, } from '../state.js';
import { TRINITY_CHEAP, TRINITY_MEDIUM, TRINITY_BRAIN, } from '../pricing.js';
import { scoreStress, classifyTurnSimple, loadOptimizationMode, saveOptimizationMode, getBlackboxTracker, loadBlackboxState as loadBlackboxStateFromCtx, saveBlackboxState as saveBlackboxStateToCtx, extractLastUserText, isLikelyOffTopic, fetchBlackboxEnrichment, estimateContextBudget, buildControlHistoryEntry, } from '../turn-classify.js';
import { remoteCall } from '../api-client.js';
import { loadCredit } from '../credit-api.js';
import { loadSessionSlot, writeSessionSlot } from '../selection-manager.js';
import { noteProjectPattern } from '../index-helpers.js';
import { saveSessionStress } from '../index-helpers.js';
import { COMPRESS_THRESHOLD, KEEP_HOT, COMPRESS_MARKER, PROTOCOL_MARKER, PROTOCOL_TEXT } from "../constants.js";
let latestUserIntent = null;
let _OC_SID = 'opencode-' + (process.pid || 'x') + '-' + Date.now();
let _latestBlackboxState = null;
let _latestBlackboxLoopMsg = null;
let _latestBlackboxPivotMsg = null;
let _prevOutputText = '';
const correctionSeenKeys = new Set();
async function apiComputeControlVector(state, action, optimizationMode) {
    try {
        const res = await remoteCall('blackboxControlVector', [state, action, optimizationMode], null);
        if (res?.control_vector)
            return res.control_vector;
    }
    catch { }
    const opt = (optimizationMode || "balanced").toLowerCase();
    const isRelaxed = opt === "budget" || opt === "speed" || opt === "audit";
    const isStrict = opt === "quality";
    return {
        enforcement_mode: isStrict ? "strict" : "normal",
        enforcement_reason: `[optimize: ${opt}] offline fallback`,
        flow_mode: isStrict ? "strict" : isRelaxed ? "audit" : "normal",
        flow_focus: [],
        tdd_mode: isStrict ? "strict" : isRelaxed ? "lazy" : "normal",
        tdd_focus: [],
        tier_bias: isStrict ? "brain" : isRelaxed ? "cheap" : "auto",
        thinking_mode: isStrict ? "full" : isRelaxed ? "off" : "auto",
        stress_multiplier: 1.0,
        context7_urgency: isStrict ? "required" : isRelaxed ? "preferred" : "preferred",
        wbp_verbosity: isStrict ? "verbose" : isRelaxed ? "minimal" : "normal",
        agent_mode: isStrict ? "plan" : "auto",
        optimization_mode: opt,
        directives: [],
    };
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
    return `Working on ${label}. Keep focused on this repository and its conventions.`;
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
    const skillName = `project-${projectName.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`;
    let content = `---\n`;
    content += `name: ${skillName}\n`;
    content += `description: Project-specific conventions, patterns, and workflows for ${projectName}. Auto-generated by vibeOS.\n`;
    content += `---\n\n`;
    content += `# ${projectName} Conventions\n\n`;
    if (techStack.length > 0) {
        content += `## Tech Stack\n\n`;
        content += techStack.map((t) => `- ${t}`).join('\n') + '\n\n';
    }
    const routines = promoted.filter((p) => p.label === 'routine');
    if (routines.length > 0) {
        content += `## Routines (established workflows)\n\n`;
        for (const r of routines) {
            content += `- ${r.summary} (${r.sessions} sessions)\n`;
        }
        content += '\n';
    }
    const frictions = promoted.filter((p) => p.label === 'friction');
    if (frictions.length > 0) {
        content += `## Frictions (patterns to avoid)\n\n`;
        for (const f of frictions) {
            content += `- ${f.summary} (${f.sessions} sessions)\n`;
        }
        content += '\n';
    }
    if (promotedRoutines.length > 0) {
        content += `## Common Tool Chains\n\n`;
        for (const pair of promotedRoutines) {
            content += `- ${pair}\n`;
        }
        content += '\n';
    }
    try {
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(skillPath, content, 'utf-8');
        console.error(`[vibeOS] Project Guard: created .opencode/skills/${projectName}/SKILL.md`);
        return { created: true, path: skillPath, skipped: false };
    }
    catch (err) {
        console.error(`[vibeOS] Project Guard: failed to create skill for ${projectName}: ${err.message}`);
        return { created: false, skipped: false };
    }
}
export function syncControlSettings(cv) {
    if (!cv)
        return;
    try {
        const sid = _OC_SID;
        const writeIf = (key, val) => {
            const sel = loadSelection();
            if (sel[key] !== val)
                writeSelection(key, val);
        };
        if (cv.enforcement_mode === "relaxed")
            writeIf("delegation_enforce", false);
        else
            writeIf("delegation_enforce", true);
        if (cv.flow_mode === "audit") {
            writeIf("flow_enabled", false);
            writeIf("flow_enforce", false);
        }
        else {
            writeIf("flow_enabled", true);
            writeIf("flow_enforce", cv.flow_mode === "strict");
        }
        if (cv.tdd_mode === "lazy") {
            writeIf("tdd_enforce", false);
            writeIf("tdd_strict", false);
        }
        else {
            writeIf("tdd_enforce", true);
            writeIf("tdd_strict", cv.tdd_mode === "strict");
        }
        if (cv.thinking_mode)
            writeIf("thinking_level", cv.thinking_mode);
        const userOptMode = loadSessionSlot(sid + "_opt") || loadOptimizationMode();
        if (cv.optimization_mode && userOptMode !== "auto") {
            if (userOptMode !== cv.optimization_mode) {
                writeSessionSlot(sid + "_opt", cv.optimization_mode);
                saveOptimizationMode(cv.optimization_mode);
            }
        }
        const slot = cv.tier_bias;
        if (slot && slot !== "auto") {
            const existingSlot = loadSessionSlot(sid);
            if (existingSlot !== slot) {
                writeSessionSlot(sid, slot);
            }
            if (slot === "brain" && TRINITY_BRAIN) {
                setCurrentModel(TRINITY_BRAIN);
                setCurrentTier("high");
            }
            else if (slot === "medium" && TRINITY_MEDIUM) {
                setCurrentModel(TRINITY_MEDIUM);
                setCurrentTier("mid");
            }
            else if (slot === "cheap" && TRINITY_CHEAP) {
                setCurrentModel(TRINITY_CHEAP);
                setCurrentTier("low");
            }
        }
        if (cv.agent_mode) {
            try {
                const OC_CONFIG = TRINITY_OPENCODE_CONFIG || join(homedir(), ".config/opencode/opencode.json");
                if (existsSync(OC_CONFIG)) {
                    const oc = safeJsonParse(readFileSync(OC_CONFIG, "utf-8"));
                    if (oc.default_agent !== cv.agent_mode) {
                        oc.default_agent = cv.agent_mode;
                        writeFileSync(OC_CONFIG, JSON.stringify(oc, null, 2) + "\n");
                    }
                }
            }
            catch { }
        }
        if (cv.agent_mode === "plan" && latestUserIntent) {
            const planDone = /^(yes|go ahead|proceed|looks? good|do it|sounds? good|perfect|great|nice|ok|okay|let.s do it|implement|execute|make it|build it|write it|start)\b/i.test(latestUserIntent.trim());
            if (planDone) {
                try {
                    const OC_CONFIG = TRINITY_OPENCODE_CONFIG || join(homedir(), ".config/opencode/opencode.json");
                    if (existsSync(OC_CONFIG)) {
                        const oc = safeJsonParse(readFileSync(OC_CONFIG, "utf-8"));
                        if (oc.default_agent === "plan") {
                            oc.default_agent = "orchestrator";
                            writeFileSync(OC_CONFIG, JSON.stringify(oc, null, 2) + "\n");
                        }
                    }
                }
                catch { }
            }
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
    if (briefedProjects.has(key))
        return true;
    briefedProjects.add(key);
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
            const fullPath = join(getSessionScratchpadDir(), `${hash}.txt`);
            try {
                ensureSessionScratchpadDirs();
                if (!existsSync(fullPath)) {
                    writeFileSync(fullPath, raw);
                    indexAppend(hash, part.tool, raw.length);
                }
            }
            catch (err) {
                console.error(`[vibeOS] ctx-compress write failed: ${err.message}`);
                continue;
            }
            if (!isCold)
                continue;
            const summary = raw.slice(0, 200).replace(/\n+/g, " ").trim() + (raw.length > 200 ? "\u2026" : "");
            const ref = `${COMPRESS_MARKER} [${raw.length} chars compressed -- cold storage at ${fullPath}] ` +
                `[summary] ${summary}`;
            state.output = ref;
            compressedBytes += raw.length - ref.length;
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
        const serialized = tracker.serialize();
        serialized.project_fingerprint = currentProjectFingerprint || "";
        if (!state.sessions[sid])
            state.sessions[sid] = {};
        state.sessions[sid].control_history ??= [];
        const st = scoreStress(latestUserIntent);
        if (st) {
            localState.latest_stress_multiplier = st;
            saveSessionStress(st, st > 1.5 ? "critical" : st > 0.7 ? "elevated" : st > 0.3 ? "moderate" : "none");
        }
        const cv = await apiComputeControlVector(localState, undefined, loadOptimizationMode());
        state.sessions[sid].control_history.push(buildControlHistoryEntry(state.sessions[sid].control_history.length + 1, localState.sub_regime || "INIT", cv));
        if (state.sessions[sid].control_history.length > 100) {
            state.sessions[sid].control_history = state.sessions[sid].control_history.slice(-100);
        }
        state.sessions[sid] = serialized;
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
    required: " This turn, context7 usage is required.",
    optional: " This turn, context7 is optional — use it if helpful.",
};
function context7Directive(cv) {
    const urgency = cv?.context7_urgency || "preferred";
    return "When looking up library or framework documentation " +
        "(docs.*, readthedocs.*, npmjs.com/package/*, pypi.org/project/*, pkg.go.dev, /api/reference/), " +
        "use mcp__context7__resolve-library-id and mcp__context7__get-library-docs if they are available " +
        "instead of WebFetch or WebSearch — they cost less. Saves roughly $0.06 per turn on average." +
        (C7_URGENCY[urgency] || "");
}
function thinkingDirective(level) {
    const credit = loadCredit();
    const creditNote = `credit ${credit}%`;
    if (level === "brief") {
        return `You're in brief reasoning mode (${creditNote}). Use extended thinking only for genuinely complex multi-step problems. Keep reasoning concise and skip exploratory scratch work.`;
    }
    return `Extended thinking is off (${creditNote}). Respond directly and concisely — thinking tokens cost money, save them for when the user explicitly asks.`;
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
    return `You coordinate the work. Delegate heavy implementation to Task subagents (runs on ${targetModel}). ` +
        `Your job: verify results, fill gaps, and synthesize. Write/Edit tools are blocked on this tier — delegate all implementation work. ` +
        `Always show the vibeOS cost footer.` +
        (tierBias !== "auto" ? ` This turn is biased toward ${tierBias} tier.` : "");
}
const TDD_NOTES = {
    lazy: " Skeletons only when explicitly requested.",
    strict: " STRICT mode: TODO tests MUST pass before considering work complete.",
    quality: " QUALITY mode: Full coverage including edge cases.",
};
function tddDirective(cv, sel) {
    const tddMode = cv?.tdd_mode || (sel.tdd_strict ? "strict" : "normal");
    const tddFocus = cv?.tdd_focus || [];
    const focusNote = tddFocus.length > 0 ? ` Focus on: ${tddFocus.join(", ")}.` : "";
    return `Auto-create test skeletons for source files you write or edit.${TDD_NOTES[tddMode] || ""}${focusNote} ` +
        "Make sure corresponding test files exist with proper assertions.";
}
function flowDirective(cv, sel) {
    const flowMode = cv?.flow_mode || (sel.flow_enforce ? "normal" : "audit");
    const flowFocus = cv?.flow_focus || [];
    const enforceNote = sel.flow_enforce ? " TODO and FIXME markers are being tracked." : "";
    const focusNote = flowFocus.length > 0 ? ` Focus on: ${flowFocus.join(", ")}.` : "";
    return `Follow project conventions when writing or editing code — check existing patterns and naming conventions.${enforceNote}${focusNote}`;
}
function flowTodosDirective() {
    const pendingTodos = loadTodos().filter((t) => t.status === "pending").length;
    if (pendingTodos === 0)
        return null;
    return pendingTodos + " extracted TODO or FIXME items are pending. " +
        "Consider using \`todowrite\` to add them to the task list.";
}
function patternDirective(fp) {
    const patterns = promotedProjectPatterns(fp);
    if (!patterns || patterns.length === 0)
        return null;
    const routines = patterns.filter(p => p.label === 'routine');
    const frictions = patterns.filter(p => p.label === 'friction');
    const parts = [];
    if (routines.length > 0) {
        parts.push("Routines: " + routines.map(r => r.summary).join("; "));
    }
    if (frictions.length > 0) {
        parts.push("Things to watch: " + frictions.map(f => f.summary).join("; "));
    }
    if (parts.length === 0)
        return null;
    return "Learned patterns for this project — " + parts.join(". ") + ".";
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
    return "vibeOS is active. Slot: " + active + " (" + current + "). " +
        "Use \`trinity\` to switch slots, rebuild, or check status. " +
        "Run \`trinity help\` for all commands.";
}
function contextBudgetDirective(_input, output) {
    const ctxBudget = estimateContextBudget(_input, output);
    if (!ctxBudget || ctxBudget.pct <= 70)
        return null;
    return `Context is ${ctxBudget.pct}% full (~${ctxBudget.estimatedTokens} tokens). ` +
        "Consider delegating heavy work to Task subagents, compressing tool outputs, or starting a new session.";
}
export const onSystemTransform = async (_input, output) => {
    if (!loadSelection().enabled)
        return;
    try {
        if (!latestUserIntent) {
            const userText = extractLastUserText(_input) || extractLastUserText(output);
            latestUserIntent = typeof userText === "string" ? userText : null;
        }
        if (latestUserIntent)
            observeUserCorrection(latestUserIntent);
        let _controlVector = null;
        if (_latestBlackboxState) {
            const st = latestUserIntent ? scoreStress(latestUserIntent) : 0;
            if (st)
                _latestBlackboxState.latest_stress_multiplier = st;
            _controlVector = await apiComputeControlVector(_latestBlackboxState, undefined, loadOptimizationMode());
        }
        else if (latestUserIntent) {
            const st = scoreStress(latestUserIntent);
            _controlVector = await apiComputeControlVector({
                sub_regime: classifyTurnSimple(latestUserIntent),
                latest_stress_multiplier: st || undefined,
            }, undefined, loadOptimizationMode());
        }
        syncControlSettings(_controlVector);
        const system = output?.system;
        if (!Array.isArray(system))
            return;
        const sel = loadSelection();
        const fp = currentProjectFingerprint || "";
        const stressScore = latestUserIntent ? scoreStress(latestUserIntent) * (_controlVector?.stress_multiplier ?? 1) : 0;
        pushSystem(output, context7Directive(_controlVector));
        if (sel.thinking_level && sel.thinking_level !== "full") {
            pushSystem(output, thinkingDirective(sel.thinking_level));
        }
        if (stressScore > 0.7) {
            pushSystem(output, "The user seems quite stressed. Stay calm, structured, and thorough. " +
                "Use clear markdown with code blocks, lists, and organized sections — do not mirror their tone. " +
                "This is important.");
        }
        else if (stressScore > 0.4) {
            pushSystem(output, "The user seems a bit stressed. Keep responses well-structured " +
                "with clear markdown and organized sections.");
        }
        if (_controlVector?.directives?.length > 0) {
            for (const directive of _controlVector.directives) {
                pushSystem(output, directive);
            }
        }
        else if (_blackboxEnabled && _latestBlackboxState?.n_interactions > 0) {
            const res = _latestBlackboxState;
            pushSystem(output, `Current resolution: ${res.resolution || "unresolved"} (${res.sub_regime || "EXPLORING"}). ` +
                `Momentum: ${(res.momentum || 0) > 0 ? "positive" : (res.momentum || 0) < 0 ? "negative" : "neutral"}. ` +
                `If the conversation is looping or stuck, suggest stepping back. ` +
                `If you're converging or closing, push toward a decision.`);
            if (res.is_looping && res.loop_intervention_level && res.loop_intervention_level !== "none") {
                pushSystem(output, `${_latestBlackboxLoopMsg || "The conversation may be circling — try a fresh angle."} ` +
                    `(level: ${res.loop_intervention_level})`);
            }
            if (res.pivot_detected && _latestBlackboxPivotMsg) {
                pushSystem(output, `Topic seems to have shifted: ${_latestBlackboxPivotMsg}`);
            }
        }
        const projectJob = getActiveJobForProject();
        if (latestUserIntent && projectJob && isLikelyOffTopic(latestUserIntent, projectJob)) {
            pushSystem(output, `There's an active job: "${(projectJob.prompt || "").slice(0, 140)}...". ` +
                `The latest request looks unrelated. Before acting, ask if they want to switch focus.`);
            console.error("[vibeOS] [job-focus] off-topic request detected vs active job context");
        }
        if (sel.delegation_enforce && _controlVector?.enforcement_mode !== "relaxed" && _controlVector?.agent_mode !== "plan") {
            pushSystem(output, orchestratorDirective(_controlVector, sel));
        }
        if (_controlVector?.enforcement_mode !== "relaxed" && _controlVector?.agent_mode !== "plan") {
            pushSystem(output, "When you have multiple independent tasks, run them all in parallel — " +
                "it's faster and cheaper. Only sequence them when one depends on another's output.");
        }
        if (sel.tdd_enforce && _controlVector?.tdd_mode !== "lazy") {
            pushSystem(output, tddDirective(_controlVector, sel));
        }
        if (sel.flow_enabled && _controlVector?.flow_mode !== "audit") {
            pushSystem(output, flowDirective(_controlVector, sel));
            if (sel.flow_enforce) {
                pushSystem(output, flowTodosDirective());
            }
        }
        pushSystem(output, "AGENTS.md and README.md are protected files — never edit them without asking. " +
            "When you add new features, update README.md to document them. " +
            "AGENTS.md defines the project rules — follow them.");
        pushSystem(output, contextBudgetDirective(_input, output));
        if (!oneShot(fp)) {
            pushSystem(output, buildProjectBriefing(currentProjectName || ""));
        }
        if (!oneShot("vibeos_patterns_" + fp)) {
            pushSystem(output, patternDirective(fp));
        }
        if (!oneShot("trinity_welcome_" + fp)) {
            pushSystem(output, welcomeDirective());
        }
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
    }
    catch (err) {
        console.error(`[vibeOS] system.transform failed: ${err.message}`);
    }
};
export { latestUserIntent };
