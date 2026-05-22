// @ts-nocheck
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, copyFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { withFileLock, safeJsonParse } from "./state.js";
const USER_HOME = (() => { try {
    return homedir();
}
catch {
    return tmpdir();
} })();
// Report data:
//   meta: { id, project, fingerprint, type, created, sessionId }
//   summary: string
//   findings: [{ severity, topic, detail }]
//   metrics: { [key]: number }
//   narrative: string (markdown)
//   tags: string[]
export const REPORTS_DIR = join(USER_HOME, ".claude/reports");
export const REPORTS_INDEX = join(REPORTS_DIR, "index.json");
const _OC_SID = "opencode-" + (process.pid || "x") + "-" + Date.now();
export let currentProjectFingerprint = "";
export let currentProjectName = "";
export function setReportingContext({ fingerprint, projectName } = {}) {
    if (fingerprint !== undefined)
        currentProjectFingerprint = fingerprint;
    if (projectName !== undefined)
        currentProjectName = projectName;
}
function _handleStateCorruption(path) {
    const backupDir = join(USER_HOME, ".claude", ".backups");
    mkdirSync(backupDir, { recursive: true });
    const backupPath = join(backupDir, basename(path) + ".corrupted." + Date.now());
    try {
        copyFileSync(path, backupPath);
    }
    catch { }
}
function readJsonOrEmpty(filePath) {
    try {
        if (!existsSync(filePath))
            return {};
        const st = statSync(filePath);
        if (st.size > 10485760) {
            _handleStateCorruption(filePath);
            return {};
        }
        return safeJsonParse(readFileSync(filePath, "utf-8"));
    }
    catch {
        _handleStateCorruption(filePath);
        return {};
    }
}
export function reportsIndex() {
    const idx = readJsonOrEmpty(REPORTS_INDEX);
    if (!idx || !Array.isArray(idx.reports))
        return { reports: [] };
    return idx;
}
export function saveReportsIndex(idx) {
    try {
        withFileLock(REPORTS_INDEX, () => {
            mkdirSync(REPORTS_DIR, { recursive: true });
            writeFileSync(REPORTS_INDEX, JSON.stringify(idx, null, 2) + "\n");
        });
    }
    catch (err) {
        console.error(`[vibeOS] reports index write failed: ${err.message}`);
    }
}
export function generateReportId(type, fp) {
    const ts = new Date().toISOString().replace(/[:-]/g, "").replace(/\..+/, "");
    const rnd = Math.random().toString(36).slice(2, 6);
    return `${ts}-${(fp || "unknown").slice(0, 6)}-${type}-${rnd}`;
}
// Dedup: skip save if last report of same type has identical summary within 5 min
const _reportDedupWindow = new Map();
function _wouldBeDuplicate(type, summary) {
    if (typeof summary !== "string")
        return false;
    const trunc = Math.min(summary.length, 240);
    const key = `${type || ""}::${summary.slice(0, trunc)}`;
    const last = _reportDedupWindow.get(key);
    if (last && (Date.now() - last) < 5 * 60 * 1000)
        return true;
    _reportDedupWindow.set(key, Date.now());
    if (_reportDedupWindow.size > 200) {
        const oldest = [..._reportDedupWindow.entries()].sort((a, b) => a[1] - b[1])[0];
        if (oldest)
            _reportDedupWindow.delete(oldest[0]);
    }
    return false;
}
// Prune old reports: delete >90d, keep max 200
function _pruneReports() {
    try {
        const idx = reportsIndex();
        const now = Date.now();
        const keep = [];
        for (const r of idx.reports) {
            const created = new Date(r.created).getTime();
            if (isNaN(created))
                continue;
            // >90d: delete
            if (now - created > 90 * 24 * 3600 * 1000) {
                try {
                    rmSync(join(REPORTS_DIR, `${r.id}.json`));
                }
                catch { }
                continue;
            }
            keep.push(r);
        }
        // Keep max 200 (newest)
        const pruned = keep.sort((a, b) => b.created.localeCompare(a.created)).slice(0, 200);
        if (pruned.length !== idx.reports.length) {
            idx.reports = pruned;
            saveReportsIndex(idx);
            console.error(`[vibeOS] reports pruned: ${idx.reports.length} kept (from ${keep.length})`);
        }
    }
    catch (err) {
        console.error(`[vibeOS] reports prune failed: ${err.message}`);
    }
}
// Auto-parse findings (string → array) for callers that pass plain text directly to saveReport
function _parseFindings(v) {
    if (Array.isArray(v))
        return v;
    if (typeof v !== "string" || !v.trim())
        return [];
    try {
        return JSON.parse(v);
    }
    catch { }
    const result = [];
    for (const line of v.split("\n").map(l => l.trim()).filter(Boolean)) {
        const m = line.match(/^(warn|info|hint)\s*:\s*(.+?)\s*:\s*(.+)/i);
        if (m)
            result.push({ severity: m[1].toLowerCase(), topic: m[2].trim(), detail: m[3].trim() });
        else
            result.push({ severity: "info", topic: "Note", detail: line });
    }
    return result;
}
function _parseMetrics(v) {
    if (v && typeof v === "object" && !Array.isArray(v))
        return v;
    if (typeof v !== "string" || !v.trim())
        return {};
    try {
        return JSON.parse(v);
    }
    catch { }
    const result = {};
    for (const line of v.split("\n").map(l => l.trim()).filter(Boolean)) {
        const m = line.match(/^([\w-]+)\s*=\s*([\d.]+)/);
        if (m)
            result[m[1]] = parseFloat(m[2]);
    }
    return result;
}
export function saveReport({ type = "manual", summary = "", findings = null, metrics = null, narrative = "", tags = [], fingerprint = null } = {}) {
    // Auto-parse findings + metrics (supports array, JSON string, plain-text lines)
    const parsedFindings = _parseFindings(findings);
    const parsedMetrics = _parseMetrics(metrics);
    // Dedup: skip if last same-type report has same summary within 5 min
    if (_wouldBeDuplicate(type, summary))
        return null;
    const fp = fingerprint || currentProjectFingerprint || "unknown";
    const id = generateReportId(type, fp);
    const report = {
        meta: { id, project: currentProjectName || "unknown", fingerprint: fp, type, created: new Date().toISOString(), sessionId: _OC_SID },
        summary, findings: parsedFindings, metrics: parsedMetrics, narrative, tags,
    };
    try {
        withFileLock(REPORTS_INDEX, () => {
            mkdirSync(REPORTS_DIR, { recursive: true });
            writeFileSync(join(REPORTS_DIR, `${id}.json`), JSON.stringify(report, null, 2) + "\n");
            const idx = reportsIndex();
            const _sum = (summary || "").slice(0, 80);
            idx.reports.push({ id, type, project: report.meta.project, fingerprint: fp, created: report.meta.created, summary: _sum });
            writeFileSync(REPORTS_INDEX, JSON.stringify(idx, null, 2) + "\n");
        });
    }
    catch (err) {
        console.error(`[vibeOS] report/index write failed: ${err.message}`);
        return null;
    }
    // Opportunistic TTL prune (once per process ≈ every save)
    _pruneReports();
    return id;
}
export function listReports({ type, project, hours = 168, fingerprint } = {}) {
    const cutoff = Date.now() - hours * 3600 * 1000;
    const idx = reportsIndex();
    return idx.reports.filter(r => {
        if (type && r.type !== type)
            return false;
        if (project && r.project !== project)
            return false;
        if (fingerprint && r.fingerprint !== fingerprint)
            return false;
        const created = new Date(r.created).getTime();
        if (isNaN(created) || created < cutoff)
            return false;
        return true;
    }).sort((a, b) => b.created.localeCompare(a.created));
}
export function readReport(id) {
    if (!id)
        return null;
    if (!/^[\w-]+$/.test(String(id)))
        return null;
    const path = join(REPORTS_DIR, `${id}.json`);
    try {
        if (!existsSync(path))
            return null;
        return safeJsonParse(readFileSync(path, "utf-8"));
    }
    catch {
        return null;
    }
}
