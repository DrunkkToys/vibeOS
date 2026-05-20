// @ts-nocheck
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { currentTier, currentModel, _OC_SID, _modelLocked, loadSelection, readLifetimeSavings, recordCacheSaving, recordMissedContext7, getScratchpadHit, recordScratchpadObservation, updateState, SAVINGS_LEDGER_FILE, CONTEXT7_INSTALL_FLAG, SOFT_QUOTA_LIMIT, ML_ENABLED, _mlGraph, _cacheDb, _mlSavePending, ML_CONFIDENCE_THRESHOLD, saveMLState, SCRATCHPAD_TOOLS, } from '../state.js';
import { classify, modelCostPerTurn, isModelFree, detectContext7, isDocsTarget, shortModelName, formatUsd, _refreshModel, } from '../pricing.js';
import { scoreStress, extractFirstWordFromArgs, shouldLogWarn, isUserAskingForTests, resolveEnforcementMode, getLearnedExploratoryWords, noteTaskRoutingLearning, } from '../turn-classify.js';
import { saveReport } from '../reporting.js';
import { remoteCall } from '../api-client.js';
import { checkFlowRules } from '../../vibeOS-lib/flow-enforcer.js';
import { computeDifficulty, addRouteEdge, predictBestModel, hashQuery } from '../../vibeOS-lib/ml-router.js';
import { addCacheEntry, recordCacheStats, predictCacheHit } from '../../vibeOS-lib/smart-cache.js';
import { buildTestReminder, enforceTestFile } from '../tdd-enforcer.js';
import { modelToSlotLabel } from '../pricing.js';
import { setActiveJobFromTaskPrompt, observeToolPattern, applyDecadence, compressText, recordSaving } from '../index-helpers.js';
const SAVE_EST = { WRITE_EDIT: 0.005, SOFT_QUOTA: 0.0003, CONTEXT7: 0.002, OPUS_DISABLE: 0.03 };
const BYTES_PER_TOKEN = 4;
const CACHE_SAVED_PER_1M_INPUT_TOKENS = 0.10;
const WARN_ON_DIRECT = new Set(['write', 'edit', 'notebookedit', 'write_to_file', 'replace_in_file', 'apply_patch']);
const SOFT_QUOTA = new Set(['bash', 'webfetch', 'websearch']);
const FREE = new Set(['task', 'todowrite', 'question', 'skill', 'read', 'glob', 'grep', 'list']);
let latestUserIntent = null;
let activeJob = null;
let pendingUiNote = null;
let enforcementBlocked = false;
let taskSlotRestore = null;
let scratchpadHitsSeen = new Set();
let softQuotaCounts = {};
let context7AlertedThisSession = false;
let context7Seen = new Set();
let _cacheSave = 0;
let _prompt = '';
let _autoReportCount = 0;
export const onToolExecuteBefore = async (input, output) => {
    if (!loadSelection().enabled)
        return;
    _refreshModel(directory);
    const t = input?.tool ?? "";
    const args = output?.args;
    const inArgs = input?.args;
    let _cacheSave = 0;
    let _prompt = "";
    // Scratchpad observation (all tiers) — read-only, never blocks.
    if (SCRATCHPAD_TOOLS.has(t)) {
        const hit = getScratchpadHit(t, args);
        if (hit && !scratchpadHitsSeen.has(hit.hash)) {
            scratchpadHitsSeen.add(hit.hash);
            const total = recordScratchpadObservation();
            // Persist cache savings as a first-class savings type.
            // Compute from actual scratchpad file size: inputs that would
            // have been charged at miss rate are served from cache.
            const _inputTokens = Math.max(1, Math.round(hit.sizeBytes / BYTES_PER_TOKEN));
            _cacheSave = Math.round(_inputTokens * CACHE_SAVED_PER_1M_INPUT_TOKENS / 1_000_000 * 1000) / 1000;
            const cacheSaved = recordCacheSaving(t, _cacheSave, { hash: hit.hash });
            const sumNote = hit.summaryPath ? ` (summary: ${hit.summaryPath})` : "";
            const cacheNote = cacheSaved ? `, cache+$${(cacheSaved.lifetime || 0).toFixed(3)} lt` : "";
            console.error(`[vibeOS] 📦 scratchpad hit for ${t}: ${hit.fullPath} ${hit.sizeBytes}B ${hit.ageSec}s old${sumNote} — total observed: ${total ?? "?"}${cacheNote}`);
        }
        // Smart cache: learn from this observation + predict future reuse.
        if (ML_ENABLED) {
            try {
                const rawArgs = args || inArgs || {};
                const promptText = typeof rawArgs.prompt === "string" ? rawArgs.prompt
                    : typeof rawArgs.filePath === "string" ? `${t}:${rawArgs.filePath}`
                        : typeof rawArgs.command === "string" ? rawArgs.command
                            : typeof rawArgs.url === "string" ? rawArgs.url
                                : typeof rawArgs.pattern === "string" ? rawArgs.pattern
                                    : typeof rawArgs.query === "string" ? rawArgs.query
                                        : "";
                if (promptText) {
                    const keyStr = `${t}:${String(promptText).slice(0, 120)}`;
                    addCacheEntry(_cacheDb, hit ? hit.hash : hashQuery(keyStr), t, promptText, hit ? hit.sizeBytes : 0, hit ? hit.ageSec : 0);
                    recordCacheStats(_cacheDb, t, !!hit, hit ? _cacheSave : 0);
                    if (!hit) {
                        const prediction = predictCacheHit(_cacheDb, t, promptText);
                        if (prediction.shouldWarm && prediction.confidence >= 0.6) {
                            console.error(`[vibeOS] 🔮 Smart cache: ${t} may benefit from caching — ${prediction.reason} (conf: ${(prediction.confidence * 100).toFixed(0)}%)`);
                        }
                    }
                }
            }
            catch (scErr) {
                console.error(`[vibeOS] Smart cache error: ${scErr.message}`);
            }
        }
    }
    // Credit < 40% + Task: force to cheap slot (mirrors CC's rwh path).
    const _credit = loadCredit();
    if (_credit < 40 && t === "task" && TRINITY_CHEAP && args && typeof args === "object") {
        if (args.model !== TRINITY_CHEAP) {
            args.model = TRINITY_CHEAP;
            console.error(`[vibeOS] 🔀 Credit ${_credit}%: forcing Task → cheap slot (${TRINITY_CHEAP})`);
        }
        return;
    }
    // Trinity rule: route Task subagents based on orchestrator tier.
    // Exploratory first-word detection → cheap (mirrors CC exploratory routing).
    // Then: high-tier brain → medium slot; mid-tier brain → cheap slot.
    if (t === "task" && currentModel && ((args && typeof args === "object") || (inArgs && typeof inArgs === "object"))) {
        // OpenCode versions differ on where task args are consumed and what
        // key name is used for model. Update both input/output arg objects and
        // all known key variants so routing sticks.
        const targetArgs = (args ? args
            : input?.args ? input.args
                : {});
        _prompt = (targetArgs?.prompt ?? "").trim().toLowerCase();
        if (typeof targetArgs?.prompt === "string")
            setActiveJobFromTaskPrompt(targetArgs.prompt);
        const _firstWord = _prompt.split(/\s+/)[0];
        const BASE_EXPLORATORY = new Set(["check", "find", "list", "search", "does", "verify", "look", "count", "show", "get", "read", "grep", "scan", "detect", "inspect"]);
        const LEARNED_EXPLORATORY = getLearnedExploratoryWords();
        const EXPLORATORY = new Set([...BASE_EXPLORATORY, ...LEARNED_EXPLORATORY]);
        const _exploratoryTarget = EXPLORATORY.has(_firstWord) ? TRINITY_CHEAP : null;
        const _tierTarget = (currentTier === "high" && TRINITY_MEDIUM && TRINITY_MEDIUM !== currentModel) ? TRINITY_MEDIUM
            : TRINITY_CHEAP && TRINITY_CHEAP !== currentModel ? TRINITY_CHEAP
                : null;
        let _target = _exploratoryTarget ?? _tierTarget;
        const stressScore = latestUserIntent ? scoreStress(latestUserIntent) : 0;
        const apiRoute = await remoteCall("routeModel", [_prompt, currentTier, TRINITY_CHEAP, TRINITY_MEDIUM, LEARNED_EXPLORATORY, stressScore], null);
        if (apiRoute?.target) {
            _target = apiRoute.target;
        }
        else if (_target === TRINITY_CHEAP && TRINITY_MEDIUM) {
            if (stressScore > 0.5) {
                _target = TRINITY_MEDIUM;
                console.error(`[vibeOS] 🧘 Stress ${stressScore.toFixed(2)} → preserving medium tier for Task quality`);
            }
        }
        // ML Router: difficulty prediction + confidence cascading.
        if (ML_ENABLED) {
            try {
                const mlDifficulty = computeDifficulty(_prompt);
                const mlHash = hashQuery(_prompt);
                const mlGraphPrediction = predictBestModel(_mlGraph, _firstWord, currentTier);
                if (mlDifficulty.confidence >= ML_CONFIDENCE_THRESHOLD && mlDifficulty.level !== "moderate") {
                    const mlTarget = mlDifficulty.suggestedTier === "cheap" ? TRINITY_CHEAP
                        : mlDifficulty.suggestedTier === "medium" ? TRINITY_MEDIUM
                            : null;
                    if (mlTarget && mlTarget !== currentModel) {
                        const tierRank = { budget: 0, cheap: 1, mid: 2, medium: 2, high: 3, brain: 3 };
                        const mlRank = tierRank[mlDifficulty.suggestedTier] || 0;
                        const curRank = _target ? (tierRank[classify(_target)] || 0) : 0;
                        if (!_target) {
                            _target = mlTarget;
                            console.error(`[vibeOS] 🧠 ML difficulty: ${mlDifficulty.level} (score ${mlDifficulty.score.toFixed(2)}, conf ${mlDifficulty.confidence.toFixed(2)}) → ${mlTarget}`);
                        }
                        else if (mlRank > curRank && mlDifficulty.confidence >= 0.75) {
                            _target = mlTarget;
                            console.error(`[vibeOS] 🧠 ML upgrade: ${mlDifficulty.level} (score ${mlDifficulty.score.toFixed(2)}, conf ${mlDifficulty.confidence.toFixed(2)}) → ${mlTarget}`);
                        }
                    }
                }
                if (mlGraphPrediction && mlGraphPrediction !== currentModel) {
                    const graphNode = _mlGraph.nodes[_firstWord];
                    if (graphNode && graphNode.count >= 3) {
                        if (!_target) {
                            _target = mlGraphPrediction;
                            console.error(`[vibeOS] 🕸 ML graph: ${_firstWord} → ${mlGraphPrediction} (${graphNode.count} samples)`);
                        }
                    }
                }
                if (_target) {
                    const _mlTier = classify(_target) === "budget" ? "cheap" : classify(_target) === "mid" ? "medium" : classify(_target);
                    addRouteEdge(_mlGraph, _firstWord, _target, _mlTier, true);
                }
            }
            catch (mlErr) {
                console.error(`[vibeOS] ML router error: ${mlErr.message}`);
            }
        }
        if (_target)
            noteTaskRoutingLearning(_firstWord, _target, _exploratoryTarget ? "exploratory" : `tier:${currentTier}`);
        if (_target && targetArgs?.model !== _target) {
            const _reason = _exploratoryTarget ? `exploratory ('${_firstWord}')` : `tier=${currentTier}`;
            const _setModel = (obj) => {
                if (!obj || typeof obj !== "object")
                    return;
                obj.model = _target;
                obj.modelID = _target;
                obj.modelId = _target;
            };
            _setModel(targetArgs);
            _setModel(args);
            _setModel(inArgs);
            // Workaround: some OpenCode builds ignore per-task model args.
            // Force delegation by temporarily switching global slot for this task.
            try {
                const selNow = loadSelection();
                const desiredSlot = _target === TRINITY_CHEAP ? "cheap" : _target === TRINITY_MEDIUM ? "medium" : null;
                if (selNow.delegation_enforce && currentTier === "high" && desiredSlot && selNow.active_slot !== desiredSlot) {
                    taskSlotRestore = selNow.active_slot || "brain";
                    const switched = applySlot(desiredSlot);
                    if (switched?.ok) {
                        currentModel = switched.ocModel;
                        currentTier = classify(currentModel);
                        console.error(`[vibeOS] 🔁 task workaround: switched global slot ${taskSlotRestore} → ${desiredSlot}`);
                    }
                    else {
                        taskSlotRestore = null;
                    }
                }
            }
            catch { }
            console.error(`[vibeOS] 🔀 Task → ${_target} (${_reason}, orchestrator: ${currentModel})`);
        }
    }
    if (FREE.has(t))
        return;
    // Free models have no per-turn cost — no savings to enforce.
    if (isModelFree(currentModel))
        return;
    // Dynamic save estimates derived from actual model pricing.
    const _brainCost = modelCostPerTurn(currentModel);
    const _workerModel = TRINITY_CHEAP || TRINITY_MEDIUM || null;
    const _workerCost = _workerModel ? (modelCostPerTurn(_workerModel) ?? 0) : 0;
    // Keep precision high to avoid dropping tiny but real per-event savings to zero.
    const _rawEdit = _brainCost !== null
        ? Math.max(0, _brainCost - _workerCost)
        : SAVE_EST.WRITE_EDIT;
    const _estEdit = Math.max(_rawEdit, SAVE_EST.WRITE_EDIT * 0.1);
    const _estOpus = _brainCost !== null ? Math.max(_brainCost, _estEdit) : SAVE_EST.OPUS_DISABLE;
    const _estC7 = _brainCost !== null ? Math.max(_brainCost, SAVE_EST.CONTEXT7) : SAVE_EST.CONTEXT7;
    const _tierWord = currentTier === "high" ? "Brain" : currentTier === "mid" ? "Medium" : "Budget";
    const _firstWord = extractFirstWordFromArgs(t, args || inArgs);
    // Credit < 40%: non-task tool — record and nudge to step aside.
    if (_credit < 40) {
        const total = recordSaving(t, "credit<40% high-tier", _estOpus, { firstWord: _firstWord });
        const trend = trendDisplay(readLifetimeSavings().sesTrend);
        const msg = `⚠ [vibeOS] Credit: ${_credit}% — switching to medium saves ~$${_estOpus.toFixed(3)}/turn. Run \`trinity medium\`.`;
        if (shouldLogWarn(`${t}|credit|${_tierWord}`))
            console.error(`[vibeOS] [delegation] ${msg}`);
        pendingUiNote = msg;
        return;
    }
    // Write/Edit/NotebookEdit: enforce delegation on high tier when delegation_enforce is on.
    if (WARN_ON_DIRECT.has(String(t || "").toLowerCase())) {
        const sel = loadSelection();
        console.error(`[vibeOS] [enforce-debug] tool=${t} tier=${currentTier} enforce=${sel?.delegation_enforce} argsType=${typeof args} argsExists=${!!args}`);
        const tLower = String(t || "").toLowerCase();
        if (sel.delegation_enforce && currentTier === "high" && args && typeof args === "object") {
            const actualArgs = args || (output && output.args) || {};
            const originalPath = actualArgs.filePath || actualArgs.file_path || "";
            const basename = originalPath.split("/").pop() || "blocked";
            const apiResult = await remoteCall("delegateCheck", [tLower, currentTier, currentModel, _prompt], () => ({
                blocked: true,
                savings: _estEdit,
            }));
            const isBlocked = apiResult?.blocked !== false;
            const savings = apiResult?.savings ?? _estEdit;
            if (isBlocked) {
                if (tLower === "write") {
                    actualArgs.filePath = `/tmp/vibeos-enforcement-blocked-${basename}`;
                    if (actualArgs.file_path !== undefined)
                        actualArgs.file_path = actualArgs.filePath;
                }
                else if (tLower === "edit" || tLower === "notebookedit") {
                    actualArgs.oldString = `__THE_SAVER_ENFORCEMENT_BLOCK_${Date.now()}__`;
                }
                const total = recordSaving(t, "delegation enforced", savings, { firstWord: _firstWord });
                pendingUiNote = `🚫 Direct ${t} blocked on Brain tier → delegate via Task or run \`trinity medium\`.`;
                enforcementBlocked = true;
                if (shouldLogWarn(`${t}|enforced|${_tierWord}`))
                    console.error(`[vibeOS] [enforcement] BLOCKED direct ${t} on high tier → delegate via Task`);
                return;
            }
        }
        const total = recordSaving(t, "direct edit", _estEdit, { firstWord: _firstWord });
        const msg = `[vibeOS] ${_tierWord} tier direct ${t} — save ~$${_estEdit.toFixed(3)} by delegating to Task. Run \`trinity medium\`.`;
        if (shouldLogWarn(`${t}|direct|${_tierWord}`))
            console.error(`[vibeOS] [delegation] ${msg}`);
        pendingUiNote = msg;
        return;
    }
    if (SOFT_QUOTA.has(t)) {
        // Context7 nudge / install-suggestion / per-session alert (WebFetch/WebSearch only).
        if (t !== "bash") {
            const target = args?.url || args?.query || "";
            if (isDocsTarget(target) && !context7Seen.has(target)) {
                context7Seen.add(target);
                // Re-check each time — context7 might be added mid-session
                if (detectContext7()) {
                    const total = recordSaving(t, "docs-target without context7", _estC7, { firstWord: _firstWord });
                    console.error(`[vibeOS] [cost policy] Context7 available — prefer over webfetch for docs lookups (~$0.06/turn saved).`);
                }
                else {
                    const missed = recordMissedContext7(_estC7);
                    if (!existsSync(CONTEXT7_INSTALL_FLAG)) {
                        try {
                            mkdirSync(dirname(CONTEXT7_INSTALL_FLAG), { recursive: true });
                            writeFileSync(CONTEXT7_INSTALL_FLAG, "");
                        }
                        catch { }
                        console.error(`[vibeOS] 💡 Install context7 MCP to save ~$0.06/turn on docs: \`claude mcp add context7 npx @upstash/context7-mcp\``);
                    }
                    else if (!context7AlertedThisSession) {
                        context7AlertedThisSession = true;
                        console.error(`[vibeOS] 💸 context7 not installed — missed ~$${(missed ?? 0).toFixed(2)} savings this session.`);
                    }
                }
            }
        }
        // Soft quota: track per-tool, fire exactly once at QUOTA+1 (tool still runs).
        softQuotaCounts[t] = (softQuotaCounts[t] ?? 0) + 1;
        const n = softQuotaCounts[t];
        if (n === SOFT_QUOTA_LIMIT + 1) {
            const total = recordSaving(t, `soft quota exceeded (limit ${SOFT_QUOTA_LIMIT})`, SAVE_EST.SOFT_QUOTA);
            console.error(`[vibeOS] Bash usage high (${n}/${SOFT_QUOTA_LIMIT}) — delegate to Task subagent.`);
        }
        else if (n <= SOFT_QUOTA_LIMIT) {
            console.error(`[vibeOS] ${t} ${n}/${SOFT_QUOTA_LIMIT}`);
        }
        return;
    }
};
export const onToolExecuteAfter = async (input, output) => {
    if (!loadSelection().enabled)
        return;
    _refreshModel(directory);
    // ── Generate footer alert (prepended to tool result, visible in chat) ──
    let _footerText = "";
    try {
        const { ltTasks, ltCache, ltCost, sesTrend, sesModelTurns } = readLifetimeSavings();
        const ltTotal = ltTasks + ltCache;
        const trendIcon = sesTrend === "down" ? "↓" : sesTrend === "up" ? "↑" : "→";
        const selNow = loadSelection();
        const tags = [`[${shortModelName(currentModel)}]`];
        const bbMode = resolveEnforcementMode();
        if (bbMode === "relaxed") {
            tags.push("[Q&A]");
        }
        else {
            if (selNow.delegation_enforce)
                tags.push("[ENF ON]");
            if (selNow.flow_enforce)
                tags.push("[FLOW ON]");
            if (selNow.tdd_enforce)
                tags.push("[TDD ON]");
            if (bbMode === "strict")
                tags.push("[STRICT]");
        }
        if (_modelLocked)
            tags.push("[LOCK ON]");
        const workerModel = (currentTier === "high" && TRINITY_MEDIUM) ? TRINITY_MEDIUM : TRINITY_CHEAP;
        const totalTurns = (sesModelTurns?.brain || 0) + (sesModelTurns?.worker || 0);
        if (totalTurns > 0 && workerModel && workerModel !== currentModel) {
            const brainPct = Math.round((sesModelTurns.brain / totalTurns) * 100);
            tags[0] = `[${shortModelName(currentModel)} ${brainPct}% > ${shortModelName(workerModel)} ${100 - brainPct}%]`;
        }
        const statusLine = tags.join(" ");
        let stressTag = "";
        if (latestUserIntent) {
            const ss = scoreStress(latestUserIntent);
            if (ss > 0.1) {
                const label = ss > 0.7 ? "high" : ss > 0.4 ? "elevated" : "calm";
                stressTag = ` stress:${label}`;
            }
        }
        if (ltTotal > 0) {
            _footerText = `vibeOS: ${formatUsd(ltTotal)} saved ${trendIcon} | ${statusLine}${stressTag}\n\n`;
        }
        else {
            _footerText = `${statusLine}${stressTag}\n\n`;
        }
        output.title = _footerText.trim();
        if (typeof output?.output === "string")
            output.output = _footerText + output.output;
        else if (typeof output?.result === "string")
            output.result = _footerText + output.result;
        else if (typeof output?.text === "string")
            output.text = _footerText + output.text;
        else if (typeof output?.content === "string")
            output.content = _footerText + output.content;
        else
            output.output = _footerText;
        _autoReportCount = (_autoReportCount || 0) + 1;
        if (_autoReportCount % 5 === 0 && ltTotal > 0) {
            saveReport({
                type: "session", summary: `Session cost: $${formatUsd(ltCost)} | cache saved: $${formatUsd(ltCache)} | delegation saved: $${formatUsd(ltTasks)}`,
                metrics: { sessionId: _OC_SID, sessionCost: ltCost, cacheSavings: ltCache, delegationSavingsUsd: ltTasks, model: currentModel, slot: selNow.active_slot || "unknown" },
                tags: ["auto", "cost"],
            });
        }
    }
    catch { }
    // ── End footer ──
    const t = input?.tool ?? "";
    // Save ML state after Task or key tools (throttled to avoid excessive I/O).
    if ((t === "task" || t === "bash" || t === "edit" || t === "write") && !_mlSavePending) {
        _mlSavePending = true;
        setTimeout(() => { saveMLState(); _mlSavePending = false; }, 5000);
    }
    // Show human-friendly slot label in the UI title for Task subagents.
    if (t === "task") {
        const m = input?.args?.model;
        if (m && typeof output?.title === "string") {
            const label = modelToSlotLabel(m);
            output.title = output.title.replace(/\[agent\]|\[general\]/gi, label);
            if (!output.title.includes(label))
                output.title = `${output.title} ${label}`;
        }
    }
    // Quality scoring for task outputs
    if (t === "task") {
        const quality = scoreTaskQuality(output?.result || output?.text || "", input?.args?.prompt || "");
        try {
            appendFileSync(SAVINGS_LEDGER_FILE, JSON.stringify({
                at: new Date().toISOString(),
                kind: "quality",
                score: quality,
                tool: t,
                sid: _OC_SID,
                v: 2
            }) + "\n");
        }
        catch { }
        updateState((s) => {
            s.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" };
            s.lifetime.quality_total_score = (s.lifetime.quality_total_score || 0) + quality;
            s.lifetime.quality_total_count = (s.lifetime.quality_total_count || 0) + 1;
            s.lifetime.last_updated = new Date().toISOString();
            return s;
        });
    }
    // Inject pending delegation UI note (set in tool.execute.before).
    // This surfaces the warning in the OC chat transcript, not just stderr.
    if (pendingUiNote) {
        if (enforcementBlocked) {
            if (typeof output?.result === "string")
                output.result = pendingUiNote;
            else if (typeof output?.text === "string")
                output.text = pendingUiNote;
            else if (typeof output?.content === "string")
                output.content = pendingUiNote;
            else
                output.result = pendingUiNote;
        }
        else {
            const note = `\n\n${pendingUiNote}`;
            if (typeof output?.result === "string")
                output.result += note;
            else if (typeof output?.text === "string")
                output.text += note;
            else if (typeof output?.content === "string")
                output.content += note;
            else
                output.result = pendingUiNote;
        }
        pendingUiNote = null;
    }
    // Restore original slot after a forced task-slot workaround.
    if (t === "task" && taskSlotRestore) {
        try {
            const back = applySlot(taskSlotRestore);
            if (back?.ok) {
                currentModel = back.ocModel;
                currentTier = classify(currentModel);
                console.error(`[vibeOS] 🔁 task workaround: restored global slot → ${taskSlotRestore}`);
            }
        }
        catch { }
        taskSlotRestore = null;
    }
    // Skip test-reminder, TDD, flow enforcement, and compression for blocked tools
    if (enforcementBlocked) {
        enforcementBlocked = false;
        return;
    }
    observeToolPattern(t, input, output, directory);
    // TDD enforcement for task subagent results: scan task output for
    // file paths with source extensions and create skeletons (same logic
    // as the write/edit handler below, but for files written by subagents).
    if (t === "task") {
        const outputText = (output?.result ?? output?.text ?? output?.content ?? "");
        if (typeof outputText === "string" && outputText.length > 0) {
            const TASK_FILE_RE = /((?:\.?[\w@][\w.\-]*\/)+[\w.\-]+\.(?:py|js|ts|mjs|tsx|jsx|cjs|mts|sh|go|rs|rb|java|kt))/gi;
            const sel = loadSelection();
            const explicitTestIntent = isUserAskingForTests(latestUserIntent);
            const seen = new Set();
            let match;
            while ((match = TASK_FILE_RE.exec(outputText)) !== null) {
                const fp = match[1];
                if (seen.has(fp))
                    continue;
                seen.add(fp);
                const isTestPath = /(^|\/)(tests?|spec)\//i.test(fp) || /\.(test|spec)\./i.test(fp);
                if (sel.tdd_enforce && !isTestPath) {
                    const createdPath = enforceTestFile(fp);
                    if (createdPath) {
                        const ext = createdPath.split('.').pop();
                        const fileName = createdPath.split('/').pop();
                        const enforceNote = "\n\n[test-enforced] Created skeleton at " + createdPath + "\n  NEXT: 1) Open " + fileName + "  2) Replace TODO/FIXME markers with real assertions  3) Run `npx vitest run " + createdPath + "` (or language-equivalent)  4) Confirm tests pass";
                        if (typeof output?.text === "string")
                            output.text += enforceNote;
                        else if (typeof output?.result === "string")
                            output.result += enforceNote;
                    }
                }
            }
        }
    }
    // Test-reminder: nudge when source code is written/edited.
    if (t === "write" || t === "edit" || t === "multiedit") {
        const fp = input?.args?.filePath || input?.args?.file_path || input?.args?.path || "";
        const reminder = buildTestReminder(fp);
        if (reminder) {
            // Surface as a side note via the output; OpenCode renders the
            // tool's text/result in the transcript. We append a short line.
            const note = `\n\n[test-reminder] ${reminder}`;
            if (typeof output?.text === "string")
                output.text += note;
            else if (typeof output?.result === "string")
                output.result += note;
            else
                console.error(`[vibeOS] ${reminder}`);
        }
        // TDD enforcement: auto-create skeleton test if enabled and no test exists.
        const sel = loadSelection();
        const explicitTestIntent = isUserAskingForTests(latestUserIntent);
        const isTestPath = /(^|\/)(tests?|spec)\//i.test(fp) || /\.(test|spec)\./i.test(fp);
        if (sel.tdd_enforce && !isTestPath) {
            const createdPath = enforceTestFile(fp);
            if (createdPath) {
                const ext = createdPath.split('.').pop();
                const fileName = createdPath.split('/').pop();
                const enforceNote = `\n\n[test-enforced] Created skeleton at ${createdPath}\n  NEXT: 1) Open ${fileName}  2) Replace TODO/FIXME markers with real assertions  3) Run \`npx vitest run ${createdPath}\` (or language-equivalent)  4) Confirm tests pass`;
                if (typeof output?.text === "string")
                    output.text += enforceNote;
                else if (typeof output?.result === "string")
                    output.result += enforceNote;
            }
        }
        // Detect test-file follow-up edits (telemetry)
        if (t === "edit" || t === "write") {
            const testExtRe = /\.(test|spec)\./i;
            if (testExtRe.test(fp)) {
                try {
                    updateState((state) => {
                        state.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" };
                        state.lifetime.tdd_followup_completions = (state.lifetime.tdd_followup_completions || 0) + 1;
                        state.lifetime.last_updated = new Date().toISOString();
                        return state;
                    });
                }
                catch { }
            }
        }
        // Project Guard: check edits to protected doc files (AGENTS.md / README.md)
        {
            const fp = input?.args?.filePath || input?.args?.file_path || input?.args?.path || "";
            const guardRe = /(?:^|\/)(AGENTS|README)\.md$/i;
            if (guardRe.test(fp)) {
                const guardIcons = { flag: "!", warn: "!!", hint: "_" };
                const guardIcon = guardIcons.flag || "!";
                const fn = basename(fp);
                console.error(`[flow-enforcer] ${guardIcon} [guard] ${fn}: protected project doc modified — verify user intent`);
            }
        }
        // Flow enforcer: check Write/Edit against development-flow rules.
        if (sel.flow_enabled) {
            const toolName = t === "edit" ? "edit" : "write";
            const filePath = input?.args?.filePath || input?.args?.file_path || input?.args?.path || "";
            const content = t === "edit" ? (input?.args?.newString || "") : (input?.args?.content || "");
            const flowHits = checkFlowRules({ tool: toolName, filePath, content });
            for (const h of flowHits) {
                if (h.deduped)
                    continue;
                const icon = h.severity === "warn" ? "⚠" : "💡";
                console.error(`[flow-enforcer] ${icon} [${h.severity}] ${h.id}: ${h.description} — ${filePath}`);
            }
            // Flow enforcement: extract TODO/FIXME to queue when flow_enforce is on.
            if (sel.flow_enforce) {
                const { recordFlowTodo } = await import("./vibeOS-lib/flow-enforcer.js");
                for (const h of flowHits) {
                    if (h.id === "todo-comment" && !h.deduped) {
                        recordFlowTodo({ filePath, content });
                    }
                }
            }
        }
    }
    // Compress verbose tool outputs before they bloat context.
    // Only webfetch — task results contain synthesized data the brain needs verbatim.
    if (t !== "webfetch") {
        // Run decadence even for non-webfetch tools (opportunistic maintenance)
        applyDecadence();
        return;
    }
    // Try multiple output paths (plugin API may vary)
    const raw = output?.result ?? output?.text ?? output?.content ?? output?.data;
    if (!raw || typeof raw !== "string") {
        applyDecadence();
        return;
    }
    const processed = compressText(raw);
    // Note: the Worker-to-Brain protocol is now injected via the
    // `experimental.chat.messages.transform` hook below as a separate
    // text content block, not prepended to the worker output. This keeps
    // worker output and orchestrator directive cleanly separated.
    if (processed !== raw) {
        // Write back to whichever field held the original
        if (output.result !== undefined)
            output.result = processed;
        else if (output.text !== undefined)
            output.text = processed;
        else if (output.content !== undefined)
            output.content = processed;
        else if (output.data !== undefined)
            output.data = processed;
    }
    applyDecadence();
};
