// @ts-nocheck
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { _patternFiredKeys, recentToolEvents, lastMutationEvent, setLastMutationEvent, frictionSessionKeys, routineSessionKeys, getSessionScratchpadDir, normalizeObservedPath, commandFamily, commandFailed, saveActiveJobForProject, currentProjectFingerprint, currentProjectName, _OC_SID, loadProjectState, saveProjectState, ensureProjectBucket, updateGlobalLearning, updateState, roundUsd, WARN_DEDUPE_WINDOW_MS, _pruneOldSessions, _ledgerBuffer, _flushLedgerBuffer, LEDGER_BUFFER_MAX, _ledgerBufferTimer, LEDGER_BUFFER_FLUSH_MS, saveSessionCheckpoint, } from './state.js';
import { TRINITY_CHEAP, TRINITY_MEDIUM } from './pricing.js';
import { topKeywords, extractFirstWordFromArgs, noteTaskRoutingLearning, } from './turn-classify.js';
let activeJob = null;
// ── Verbose-line / compression rules ─────────────────────────────────
const VERBOSE_LINE_RE = [
    /^[\s#*/\\\-_=+|~:;'"`@\$%^&<>{}\[\]()!?.,0-9]+$/,
    /^(Filed|Created|Modified|Deleted|Updated|Renamed|Copied|Moved|Changed):/,
    /^➡️|^  👉|^  \-|^  \*|^  \d+\.|^  \d+\)/,
];
const BULLET_PATTERNS = [
    /^\s*[-*+•·]\s+/,
    /^\s*\d+[.)]\s+/,
];
const COMPRESS_RATIO = 0.30;
const COMPRESS_THRESHOLD = 2000;
const MIN_KEPT_LINES_RATIO = 0.40;
// ── Extracted helpers ────────────────────────────────────────────────
function extractBulletLines(lines, targetChars, minLines) {
    const keyLines = [];
    const otherLines = [];
    for (const line of lines) {
        if (BULLET_PATTERNS.some(re => re.test(line)))
            keyLines.push(line);
        else
            otherLines.push(line);
    }
    // Take key (bullet) lines first, then fill from remainder.
    const selected = [...keyLines];
    for (const line of otherLines) {
        if (selected.length >= minLines && selected.join("\n").length >= targetChars)
            break;
        selected.push(line);
    }
    // If still well over target, trim from the end.
    while (selected.length > minLines && selected.join("\n").length > targetChars * 2) {
        selected.pop();
    }
    return selected;
}
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
// ── compressText ─────────────────────────────────────────────────────
export function compressText(text) {
    if (!text || typeof text !== "string")
        return text;
    let lines = text.split("\n");
    let removed = 0;
    const out = [];
    for (const line of lines) {
        let skip = false;
        for (const re of VERBOSE_LINE_RE) {
            if (re.test(line)) {
                skip = true;
                removed++;
                break;
            }
        }
        if (!skip)
            out.push(line);
    }
    // Collapse 3+ consecutive blank lines to 2
    const collapsed = [];
    let blanks = 0;
    for (const line of out) {
        if (line.trim() === "") {
            blanks++;
            if (blanks <= 2)
                collapsed.push(line);
        }
        else {
            blanks = 0;
            collapsed.push(line);
        }
    }
    let result = collapsed.join("\n").trim();
    // Percentage-based compression: only act if above threshold.
    if (result.length > COMPRESS_THRESHOLD) {
        const targetChars = Math.max(Math.round(result.length * COMPRESS_RATIO), COMPRESS_THRESHOLD);
        const minLines = Math.max(1, Math.round(collapsed.length * MIN_KEPT_LINES_RATIO));
        const bulletLines = extractBulletLines(collapsed, targetChars, minLines);
        result = bulletLines.join("\n").trim();
        // Final safety truncate if bullet extraction didn't shrink enough.
        if (result.length > targetChars * 1.5) {
            const cutoff = result.lastIndexOf("\n\n", targetChars);
            if (cutoff > targetChars * 0.5) {
                result = result.slice(0, cutoff) + `\n\n... [${result.length - cutoff} chars truncated]`;
            }
            else {
                result = result.slice(0, targetChars) + `... [${result.length - targetChars} chars truncated]`;
            }
        }
    }
    if (removed > 0 || result !== collapsed.join("\n").trim()) {
        console.error(`[vibeOS] COMPRESS: ${text.length}->${result.length} chars (${removed} verbose lines stripped)`);
    }
    return result || text; // never return empty if original wasn't
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
        row.sessions = [...new Set([...(row.sessions || []), _OC_SID])].slice(-10);
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
}
// ── recordSaving ──────────────────────────────────────────────────────
export function recordSaving(tool, reason, saveEst, meta = {}) {
    try {
        if (!saveEst || saveEst <= 0)
            return 0;
        const firstWord = meta?.firstWord || "";
        updateState((s) => {
            s.lifetime ??= { total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0, session_count: 0 };
            s.sessions ??= {};
            const sid = _OC_SID;
            if (!s.sessions[sid]) {
                s.sessions[sid] = { delegation_savings_usd: 0, cache_savings_usd: 0, project_name: "", warns: [], cache_hits: [], seenWarnKeys: {} };
                if (currentProjectFingerprint) {
                    s.sessions[sid].project_fingerprint = currentProjectFingerprint;
                }
                if (currentProjectName) {
                    s.sessions[sid].project_name = currentProjectName;
                }
            }
            const ses = s.sessions[sid];
            ses.delegation_savings_usd = roundUsd(Number(ses.delegation_savings_usd || 0) + saveEst);
            s.lifetime.total_savings_usd = roundUsd(Number(s.lifetime.total_savings_usd || 0) + saveEst);
            if (reason && firstWord) {
                const now = Date.now();
                const warnKey = `${_OC_SID}:${firstWord}`;
                ses.seenWarnKeys ??= {};
                if (ses.warns.length > 0) {
                    const last = ses.warns[ses.warns.length - 1];
                    if (last?.key === warnKey && (now - last.ts) < WARN_DEDUPE_WINDOW_MS) {
                        last.count = (last.count || 1) + 1;
                        last.reason = reason;
                        last.saveEst = (last.saveEst || 0) + saveEst;
                    }
                    else {
                        ses.warns.push({ key: warnKey, reason, saveEst, firstWord, ts: now, count: 1 });
                    }
                }
                else {
                    ses.warns.push({ key: warnKey, reason, saveEst, firstWord, ts: now, count: 1 });
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
            _ledgerBufferTimer = setTimeout(_flushLedgerBuffer, LEDGER_BUFFER_FLUSH_MS);
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
