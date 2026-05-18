// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = join(__dirname, "flow-rules.json");
export function resolveRulesPath() {
    return RULES_PATH;
}
const STATE_FILE = join(homedir(), ".claude/delegation-state.json");
const FLOW_TODO_FILE = join(homedir(), ".claude/flow-todo-queue.jsonl");
const MAX_FLOW_TODOS = 200;
const _flowWarnsSeen = new Set();
let _flowStateWriter = null;
export function setFlowStateWriter(fn) {
    _flowStateWriter = fn;
}
let _cachedRules = null;
let _rulesMtime = 0;
function loadRules() {
    const rulesPath = resolveRulesPath();
    try {
        const mtime = _cachedRules ? statSync(rulesPath).mtimeMs : 0;
        if (_cachedRules && mtime === _rulesMtime)
            return _cachedRules;
        if (!existsSync(rulesPath)) {
            _cachedRules = [];
            return _cachedRules;
        }
        const j = JSON.parse(readFileSync(rulesPath, "utf-8"));
        _cachedRules = j.rules || [];
        _rulesMtime = mtime;
        return _cachedRules;
    }
    catch {
        _cachedRules = [];
        return _cachedRules;
    }
}
function recordFlowWarn(hit) {
    try {
        let state = {};
        if (existsSync(STATE_FILE)) {
            try {
                state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
            }
            catch { }
        }
        else {
            mkdirSync(dirname(STATE_FILE), { recursive: true });
        }
        state.flow_warns ??= [];
        state.flow_warns.push({
            at: new Date().toISOString(),
            sid: process.pid || "?",
            rule_id: hit.id,
            severity: hit.severity,
            filePath: hit.filePath,
            description: hit.description,
        });
        if (state.flow_warns.length > 500) {
            state.flow_warns = state.flow_warns.slice(-500);
        }
        if (_flowStateWriter) {
            _flowStateWriter(state);
        }
        else {
            writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        }
    }
    catch { }
}
export function checkFlowRules({ tool, filePath, content }) {
    const rules = loadRules();
    const hits = [];
    const toolName = String(tool || "").trim().toLowerCase();
    for (const rule of rules) {
        const triggerName = String(rule.trigger || "").trim().toLowerCase();
        if (triggerName !== toolName)
            continue;
        const target = toolName === "write" ? (filePath || "") : (content || filePath || "");
        let re;
        try {
            re = new RegExp(rule.pattern);
        }
        catch {
            continue;
        }
        if (!re.test(target))
            continue;
        const key = `${rule.id}::${filePath || ""}`;
        if (_flowWarnsSeen.has(key)) {
            hits.push({ ...rule, filePath, deduped: true });
            continue;
        }
        _flowWarnsSeen.add(key);
        const hit = { ...rule, filePath, deduped: false };
        hits.push(hit);
        recordFlowWarn(hit);
    }
    return hits;
}
export function getFlowWarns() {
    try {
        if (!existsSync(STATE_FILE))
            return [];
        const s = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
        return s?.flow_warns || [];
    }
    catch {
        return [];
    }
}
export function getSessionFlowCounts() {
    const counts = { warn: 0, hint: 0, flag: 0 };
    for (const key of _flowWarnsSeen) {
        const rules = loadRules();
        const [ruleId] = key.split("::");
        const rule = rules.find((r) => r.id === ruleId);
        if (rule && counts[rule.severity] !== undefined)
            counts[rule.severity]++;
    }
    return counts;
}
export function resetForTest(rules) {
    _cachedRules = rules;
    _flowWarnsSeen.clear();
    // Sync mtime so loadRules() returns test rules instead of reloading from file.
    try {
        _rulesMtime = statSync(resolveRulesPath()).mtimeMs;
    }
    catch { }
}
export function resetAll() {
    _flowWarnsSeen.clear();
    _cachedRules = null;
    _rulesMtime = 0;
}
export function addFlowRule(rule) {
    const rules = loadRules();
    rules.push(rule);
    writeFileSync(resolveRulesPath(), JSON.stringify({ rules }, null, 2), "utf-8");
    _cachedRules = rules;
    _rulesMtime = statSync(resolveRulesPath()).mtimeMs;
}
export function recordFlowTodo({ filePath, content }) {
    try {
        mkdirSync(dirname(FLOW_TODO_FILE), { recursive: true });
        // Extract TODO/FIXME lines from content (line-by-line for reliability).
        const todoRe = /(TODO|FIXME|HACK)[\s:]+(.+)$/i;
        const todos = [];
        for (const line of content.split("\n")) {
            const m = line.match(todoRe);
            if (m) {
                todos.push({ type: m[1], text: m[2].trim() });
            }
        }
        if (todos.length === 0)
            return 0;
        const entry = JSON.stringify({
            at: new Date().toISOString(),
            filePath,
            todos,
        }) + "\n";
        appendFileSync(FLOW_TODO_FILE, entry);
        // Prune to keep file bounded.
        try {
            const lines = readFileSync(FLOW_TODO_FILE, "utf-8").trim().split("\n").filter(Boolean);
            if (lines.length > MAX_FLOW_TODOS) {
                writeFileSync(FLOW_TODO_FILE, lines.slice(-Math.floor(MAX_FLOW_TODOS / 2)).join("\n") + "\n");
            }
        }
        catch { }
        console.error(`[flow-enforcer] 📋 Extracted ${todos.length} TODO(s) from ${filePath} → flow-todo-queue.jsonl`);
        return todos.length;
    }
    catch {
        return 0;
    }
}
