import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, copyFileSync, renameSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
const USER_HOME = (() => { try {
    return homedir();
}
catch {
    return tmpdir();
} })();
function _handleStateCorruption(path) {
    const backupDir = join(USER_HOME, ".claude", ".backups");
    mkdirSync(backupDir, { recursive: true });
    const backupPath = join(backupDir, basename(path) + ".corrupted." + Date.now());
    try {
        copyFileSync(path, backupPath);
    }
    catch { }
    const logPath = join(USER_HOME, ".claude", ".state-corruption-log.jsonl");
    try {
        appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), path, backup: backupPath }) + "\n");
    }
    catch { }
}
function safeJsonParse(raw) {
    if (raw == null || raw === '')
        return null;
    try {
        return JSON.parse(raw);
    }
    catch { }
    let cleaned = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/,\s*([}\]])/g, '$1');
    try {
        return JSON.parse(cleaned);
    }
    catch (e) {
        throw e;
    }
}
const DFLT_SEL = { enabled: true, active_slot: null, thinking_level: "off", flow_enabled: false, tdd_enforce: false, tdd_strict: false, tdd_quality: true, flow_enforce: false, delegation_enforce: false };
const TIERS_FILE = join(USER_HOME, ".claude/model-tiers.json");
export function loadSelection() {
    try {
        if (!existsSync(TIERS_FILE))
            return DFLT_SEL;
        const st = statSync(TIERS_FILE);
        if (st.size > 10485760) {
            _handleStateCorruption(TIERS_FILE);
            return DFLT_SEL;
        }
        const j = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"));
        return {
            enabled: j?.selection?.enabled !== false,
            active_slot: j?.selection?.active_slot || null,
            thinking_level: j?.selection?.thinking_level || "off",
            flow_enabled: j?.selection?.flow_enabled === true,
            tdd_enforce: j?.selection?.tdd_enforce === true,
            tdd_strict: j?.selection?.tdd_strict === true,
            tdd_quality: j?.selection?.tdd_quality !== false,
            flow_enforce: j?.selection?.flow_enforce === true,
            delegation_enforce: j?.selection?.delegation_enforce === true,
        };
    }
    catch {
        _handleStateCorruption(TIERS_FILE);
        return DFLT_SEL;
    }
}
export function writeSelection(key, value) {
    try {
        const j = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"));
        j.selection[key] = value;
        const tmp = TIERS_FILE + ".tmp";
        writeFileSync(tmp, JSON.stringify(j, null, 2) + "\n");
        renameSync(tmp, TIERS_FILE);
        return true;
    }
    catch (err) {
        console.error(`[vibeOS] writeSelection failed: ${err.message}`);
        return false;
    }
}
const BLACKBOX_FILE = join(USER_HOME, ".claude/blackbox-state.json");
export function loadSessionSlot(sid) {
    try {
        if (!existsSync(BLACKBOX_FILE))
            return null;
        const j = safeJsonParse(readFileSync(BLACKBOX_FILE, "utf-8"));
        return j?.sessions?.[sid]?.active_slot || null;
    }
    catch {
        return null;
    }
}
export function writeSessionSlot(sid, slot) {
    try {
        const j = existsSync(BLACKBOX_FILE)
            ? safeJsonParse(readFileSync(BLACKBOX_FILE, "utf-8"))
            : {};
        if (!j.sessions)
            j.sessions = {};
        if (!j.sessions[sid])
            j.sessions[sid] = {};
        j.sessions[sid].active_slot = slot;
        const tmp = BLACKBOX_FILE + ".tmp";
        writeFileSync(tmp, JSON.stringify(j, null, 2) + "\n");
        renameSync(tmp, BLACKBOX_FILE);
        return true;
    }
    catch (err) {
        console.error("[vibeOS] writeSessionSlot failed: " + err.message);
        return false;
    }
}
export function loadSessionOptMode(sid) {
    try {
        if (!existsSync(BLACKBOX_FILE))
            return null;
        const j = safeJsonParse(readFileSync(BLACKBOX_FILE, "utf-8"));
        return j?.sessions?.[sid]?.optimization_mode || null;
    }
    catch {
        return null;
    }
}
export function writeSessionOptMode(sid, mode) {
    try {
        const j = existsSync(BLACKBOX_FILE)
            ? safeJsonParse(readFileSync(BLACKBOX_FILE, "utf-8"))
            : {};
        if (!j.sessions)
            j.sessions = {};
        if (!j.sessions[sid])
            j.sessions[sid] = {};
        j.sessions[sid].optimization_mode = mode;
        const tmp = BLACKBOX_FILE + ".tmp";
        writeFileSync(tmp, JSON.stringify(j, null, 2) + "\n");
        renameSync(tmp, BLACKBOX_FILE);
        return true;
    }
    catch (err) {
        console.error("[vibeOS] writeSessionOptMode failed: " + err.message);
        return false;
    }
}
export { DFLT_SEL };
