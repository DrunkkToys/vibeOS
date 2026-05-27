// @ts-nocheck
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { _patternFiredKeys, recentToolEvents, lastMutationEvent, setLastMutationEvent, frictionSessionKeys, routineSessionKeys, getSessionScratchpadDir, saveActiveJobForProject, currentProjectFingerprint, currentProjectName, _OC_SID, loadProjectState, saveProjectState, ensureProjectBucket, updateGlobalLearning, updateState, roundUsd, getCurrentSessionId, WARN_DEDUPE_WINDOW_MS, _ledgerBuffer, _flushLedgerBuffer, LEDGER_BUFFER_MAX, _ledgerBufferTimer, setLedgerBufferTimer, LEDGER_BUFFER_FLUSH_MS, saveSessionCheckpoint, } from "./state.js";
import { normalizeObservedPath, commandFamily, commandFailed, _pruneOldSessions, } from "./pattern-helpers.js";
import { TRINITY_CHEAP, TRINITY_MEDIUM } from "./pricing.js";
import { topKeywords, extractFirstWordFromArgs, noteTaskRoutingLearning, } from "./turn-classify.js";
let activeJob = null;
import { VERBOSE_LINE_RE, BULLET_PATTERNS, COMPRESS_RATIO, COMPRESS_THRESHOLD, MIN_KEPT_LINES_RATIO, extractBulletLines, compressText } from "./text-compress.js";
export { VERBOSE_LINE_RE, BULLET_PATTERNS, COMPRESS_RATIO, COMPRESS_THRESHOLD, MIN_KEPT_LINES_RATIO, extractBulletLines, compressText };
// ── setActiveJobFromTaskPrompt ───────────────────────────────────────
export function setActiveJobFromTaskPrompt(prompt) {
    if (!prompt || typeof prompt !== "string")
        return;
    const p = prompt.trim();
    if (p.length < 24)
        return;
    activeJob = {
        prompt: p.slice(0, 1200),
        keywords: topKeywords(p, 12),
        updatedAt: new Date().toISOString(),
    };
    saveActiveJobForProject(activeJob);
}
// ── Pattern helpers ──────────────────────────────────────────────────
export function noteProjectPattern(kind, key, summary, meta = {}) {
    if (!currentProjectFingerprint || !key || !summary)
        return;
    try {
        const pstate = loadProjectState();
        const bucket = ensureProjectBucket(pstate, currentProjectFingerprint);
        bucket.userPatterns ??= { friction: {}, routines: {} };
        bucket.userPatterns.friction ??= {};
        bucket.userPatterns.routines ??= {};
        const target = kind === "routine" ? bucket.userPatterns.routines : bucket.userPatterns.friction;
        const now = new Date().toISOString();
        const row = target[key] || { kind, summary, count: 0, sessions: [], firstSeen: now, lastSeen: null };
        row.kind = kind;
        row.summary = summary;
        row.count = Number(row.count || 0) + 1;
        row.sessions = [...new Set([...(row.sessions || []), getCurrentSessionId()])].slice(-10);
        row.lastSeen = now;
        if (meta.family)
            row.family = meta.family;
        if (meta.path)
            row.path = meta.path;
        target[key] = row;
        const entries = Object.entries(target);
        if (entries.length > 50) {
            entries.sort((a, b) => String(b[1]?.lastSeen || "").localeCompare(String(a[1]?.lastSeen || "")));
            const kept = Object.fromEntries(entries.slice(0, 50));
            for (const k of Object.keys(target))
                delete target[k];
            Object.assign(target, kept);
        }
        bucket.lastSeen = now;
        saveProjectState(pstate);
    }
    catch (err) {
        console.error(`[vibeOS] pattern learner write failed: ${err.message}`);
    }
}
function recordFrictionPattern(key, summary, meta = {}) {
    const sessionKey = `friction:${key}`;
    if (frictionSessionKeys.has(sessionKey))
        return;
    frictionSessionKeys.add(sessionKey);
    noteProjectPattern("friction", key, summary, meta);
}
function recordRoutinePattern(key, summary, meta = {}) {
    const sessionKey = `routine:${key}`;
    if (routineSessionKeys.has(sessionKey))
        return;
    routineSessionKeys.add(sessionKey);
    noteProjectPattern("routine", key, summary, meta);
}
// ── Stress history persistence ───────────────────────────────────────
let _lastStressWrite = 0;
const STRESS_WRITE_INTERVAL_MS = 15000;
export function saveSessionStress(score, level) {
    if (typeof score !== "number" || !isFinite(score))
        return;
    const now = Date.now();
    if (now - _lastStressWrite < STRESS_WRITE_INTERVAL_MS)
        return;
    _lastStressWrite = now;
    try {
        updateState((s) => {
            const sid = _OC_SID;
            const ses = s.sessions?.[sid] || {};
            if (!Array.isArray(ses.stress_history))
                ses.stress_history = [];
            ses.stress_history.push({ ts: new Date().toISOString(), score, level });
            if (ses.stress_history.length > 100)
                ses.stress_history = ses.stress_history.slice(-50);
            const scores = ses.stress_history.map((h) => h.score);
            ses.maxSessionStress = Math.max(...scores);
            ses.avgSessionStress = scores.reduce((a, b) => a + b, 0) / scores.length;
            s.sessions[sid] = ses;
            return s;
        });
    }
    catch { }
}
// ── observeToolPattern ───────────────────────────────────────────────
export function observeToolPattern(toolName, input, output, directory) {
    try {
        const t = String(toolName || "").toLowerCase();
        const args = input?.args || {};
        const filePath = args.filePath || args.file_path || args.path || "";
        const observedPath = normalizeObservedPath(filePath, directory);
        let target = observedPath;
        if (t === "bash")
            target = commandFamily(args.command || args.cmd || args.script || "");
        if (t === "task")
            target = extractFirstWordFromArgs(t, args) || "task";
        const event = { tool: t, target, at: Date.now() };
        recentToolEvents.push(event);
        if (recentToolEvents.length > 20)
            recentToolEvents.shift();
        let repeat = 0;
        for (let i = recentToolEvents.length - 1; i >= 0; i--) {
            const e = recentToolEvents[i];
            if (e.tool !== event.tool || e.target !== event.target)
                break;
            repeat++;
        }
        if (repeat === 3) {
            recordFrictionPattern(`repeat-tool:${t}:${target}`, `Repeated ${t} calls against ${target} in one session.`, { family: t, path: target });
            _patternFiredKeys.add(`repeat-tool:${t}:${target}`);
        }
        if (repeat > 3) {
            // User keeps doing the same thing after pattern fired -- ignored suggestion
            try {
                updateGlobalLearning((gl) => {
                    gl.patternQuality ??= { ignoredCount: 0, trustedCount: 0 };
                    gl.patternQuality.ignoredCount = (gl.patternQuality.ignoredCount || 0) + 1;
                    return gl;
                });
            }
            catch { }
        }
        if (repeat === 0 && _patternFiredKeys.size > 0) {
            // User switched to a different action -- could be following a suggestion
            try {
                updateGlobalLearning((gl) => {
                    gl.patternQuality ??= { ignoredCount: 0, trustedCount: 0 };
                    gl.patternQuality.trustedCount = (gl.patternQuality.trustedCount || 0) + 1;
                    return gl;
                });
            }
            catch { }
        }
        if (["write", "edit", "multiedit", "notebookedit"].includes(t) && observedPath !== "unknown") {
            setLastMutationEvent({ at: Date.now(), path: observedPath, tool: t });
            return;
        }
        if (t === "bash") {
            const family = commandFamily(args.command || args.cmd || args.script || "");
            if (lastMutationEvent && Date.now() - lastMutationEvent.at <= 10 * 60 * 1000) {
                if (["syntax-check", "typecheck", "test", "build"].includes(family) && commandFailed(output)) {
                    recordFrictionPattern(`post-edit-failure:${lastMutationEvent.path}:${family}`, `After editing ${lastMutationEvent.path}, ${family} failed soon after.`, { family, path: lastMutationEvent.path });
                }
                else if (["syntax-check", "typecheck", "test", "build", "git-status"].includes(family) && !commandFailed(output)) {
                    recordRoutinePattern(`post-edit-routine:${lastMutationEvent.path}:${family}`, `After editing ${lastMutationEvent.path}, ${family} is a recurring verification step.`, { family, path: lastMutationEvent.path });
                }
            }
        }
    }
    catch (err) {
        console.error(`[vibeOS] pattern learner observe failed: ${err.message}`);
    }
    // ── Cross-project tool co-occurrence & multi-turn routines ──
    try {
        const t = String(toolName || "").toLowerCase();
        const args = input?.args || {};
        const ev = { tool: t, at: Date.now() };
        if (recentToolEvents.length > 0) {
            const prev = recentToolEvents[recentToolEvents.length - 1];
            const pairKey = `${prev.tool}→${ev.tool}`;
            updateGlobalLearning((gl) => {
                gl.toolPairs ??= {};
                gl.toolPairs[pairKey] = (gl.toolPairs[pairKey] || 0) + 1;
                if (gl.toolPairs[pairKey] >= 3 && !gl.promotedRoutines?.includes(pairKey)) {
                    gl.promotedRoutines ??= [];
                    if (!gl.promotedRoutines.includes(pairKey))
                        gl.promotedRoutines.push(pairKey);
                    recordRoutinePattern(`pair:${pairKey}`, `Recurring tool pair ${pairKey} detected across projects.`, { pair: pairKey });
                }
                return gl;
            });
        }
        // Track project-type tool patterns
        if (currentProjectName) {
            const ext = currentProjectName.endsWith(".tsx") || currentProjectName.endsWith(".jsx") ? "frontend" :
                currentProjectName.endsWith(".go") || currentProjectName.endsWith(".rs") ? "backend" :
                    currentProjectName.endsWith(".py") ? "data" : "unknown";
            updateGlobalLearning((gl) => {
                gl.projectTypeToolCount ??= {};
                const ptc = gl.projectTypeToolCount;
                ptc[ext] ??= {};
                ptc[ext][t] = (ptc[ext][t] || 0) + 1;
                return gl;
            });
        }
    }
    catch { }
}
// ── recordSaving ──────────────────────────────────────────────────────
export function recordSaving(tool, reason, saveEst, meta = {}) {
    try {
        if (!saveEst || saveEst <= 0)
            return 0;
        const firstWord = meta?.firstWord || tool || "";
        updateState((s) => {
            s.lifetime ??= { total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0, session_count: 0, warn_count: 0 };
            s.sessions ??= {};
            const sid = _OC_SID;
            if (!s.sessions[sid]) {
                s.sessions[sid] = { total_savings_usd: 0, cache_savings_usd: 0, project_name: "", warns: [], cache_hits: [], seenWarnKeys: {} };
                if (currentProjectFingerprint) {
                    s.sessions[sid].project_fingerprint = currentProjectFingerprint;
                }
                if (currentProjectName) {
                    s.sessions[sid].project_name = currentProjectName;
                }
            }
            const ses = s.sessions[sid];
            ses.total_savings_usd = roundUsd(Number(ses.total_savings_usd || 0) + saveEst);
            s.lifetime.total_savings_usd = roundUsd(Number(s.lifetime.total_savings_usd || 0) + saveEst);
            s.lifetime.warn_count = (s.lifetime.warn_count || 0) + 1;
            if (reason && firstWord) {
                const now = Date.now();
                const warnKey = `${_OC_SID}:${firstWord}`;
                ses.seenWarnKeys ??= {};
                let deduped = false;
                for (let i = ses.warns.length - 1; i >= 0 && !deduped; i--) {
                    const w = ses.warns[i];
                    if (w?.key === warnKey && (now - w.ts) < WARN_DEDUPE_WINDOW_MS) {
                        w.count = (w.count || 1) + 1;
                        w.reason = reason;
                        w.saveEst = (w.saveEst || 0) + saveEst;
                        w.est_savings_usd = (w.est_savings_usd || 0) + saveEst;
                        deduped = true;
                    }
                }
                if (!deduped) {
                    ses.warns.push({ key: warnKey, reason, saveEst, est_savings_usd: saveEst, firstWord, ts: now, count: 1, tool });
                }
                if (!ses.seenWarnKeys[warnKey]) {
                    ses.seenWarnKeys[warnKey] = true;
                    try {
                        noteTaskRoutingLearning(firstWord, TRINITY_CHEAP || TRINITY_MEDIUM || "unknown", `observed:${tool}`);
                    }
                    catch { }
                }
            }
            const cap = 30;
            if (ses.warns.length > cap) {
                ses.warns = ses.warns.slice(-cap);
                const keys = Object.keys(ses.seenWarnKeys || {});
                if (keys.length > cap * 2) {
                    ses.seenWarnKeys = Object.fromEntries(keys.slice(-cap * 2).map(k => [k, true]));
                }
            }
            try {
                const sd = getSessionScratchpadDir();
                if (sd) {
                    const sp = join(sd, "delegation-state-hint.txt");
                    try {
                        writeFileSync(sp, JSON.stringify({ sid, total_savings: s.lifetime.total_savings_usd, last_reason: reason }), "utf8");
                    }
                    catch { }
                }
            }
            catch { }
            ses.last_reason = reason;
            ses.last_save_est = saveEst;
            s.last_updated = new Date().toISOString();
            _pruneOldSessions(s);
        });
        // Buffer ledger entry
        const entry = JSON.stringify({
            ts: new Date().toISOString(),
            usd: saveEst,
            sid: _OC_SID,
            tool,
            reason,
            saveEst,
            fgp: currentProjectFingerprint || "",
        });
        _ledgerBuffer.push(entry);
        if (_ledgerBuffer.length >= LEDGER_BUFFER_MAX)
            _flushLedgerBuffer();
        else if (!_ledgerBufferTimer)
            setLedgerBufferTimer(setTimeout(_flushLedgerBuffer, LEDGER_BUFFER_FLUSH_MS));
        return saveEst;
    }
    catch (err) {
        try {
            saveSessionCheckpoint();
        }
        catch { }
        return 0;
    }
}
