// @ts-nocheck
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, readdirSync, rmSync, openSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { USER_HOME, loadSelection, updateState, testReminderSeen, } from "./state.js";
import { extractExports, generateTestCaseNames, inferFunctionParams, inferTypeFromName, _langComment, buildQualityAssertionsForFunc, isSkeletonUseless } from "../utils/tdd-helpers.js";
import TEST_SKELETONS from "./test-skeletons.js";
export { extractExports, generateTestCaseNames, inferFunctionParams, inferTypeFromName, _langComment, buildQualityAssertionsForFunc, isSkeletonUseless, TEST_SKELETONS };
let _detectedFramework = null;
let directory = undefined;
const SOURCE_EXT_RE = /\.(py|js|ts|mjs|tsx|jsx|cjs|mts|sh|go|rs|rb|java|kt)$/i;
const SKIP_PATH_RE = /(\/(node_modules|\.venv|dist|build|__pycache__)\/|\/(tests?|spec)\/|test_[^/]+\.py$|_test\.py$|\.test\.[a-z]+$|\.spec\.[a-z]+$|\.config\/opencode\/plugins\/)/i;
function _detectTestFramework() {
    if (_detectedFramework)
        return _detectedFramework;
    let framework = null;
    let testExt = null;
    try {
        const root = directory || process.cwd();
        const pkgPath = join(root, "package.json");
        if (existsSync(pkgPath)) {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            const testScript = String(pkg?.scripts?.test || "");
            const deps = { ...pkg?.devDependencies, ...pkg?.dependencies };
            if (testScript.includes("vitest") || deps["vitest"]) {
                framework = "vitest";
                testExt = "ts";
            }
            else if (testScript.includes("jest") || deps["jest"]) {
                framework = "jest";
                testExt = "js";
            }
            else if (testScript.includes("mocha") || deps["mocha"]) {
                framework = "mocha";
                testExt = "js";
            }
            else if (/node\s+--test/.test(testScript)) {
                framework = "node-test";
                testExt = "js";
            }
        }
        if (!framework) {
            const testDirs = ["src/tests", "tests", "test", "__tests__"];
            for (const td of testDirs) {
                const dirPath = join(root, td);
                if (!existsSync(dirPath))
                    continue;
                const files = readdirSync(dirPath).filter(f => /\.test\./.test(f) || /\.spec\./.test(f));
                if (files.length > 0) {
                    const content = readFileSync(join(dirPath, files[0]), "utf-8");
                    if (/from\s+['"]node:test['"]/.test(content)) {
                        framework = "node-test";
                        testExt = files[0].split(".").pop();
                        break;
                    }
                    if (/from\s+['"]vitest['"]/.test(content)) {
                        framework = "vitest";
                        testExt = files[0].split(".").pop();
                        break;
                    }
                    if (/require\(['"]@jest\/globals['"]\)/.test(content)) {
                        framework = "jest";
                        testExt = files[0].split(".").pop();
                        break;
                    }
                }
            }
        }
    }
    catch (e) {
        console.error(`[vibeOS] [tdd] framework detection failed: ${e.message}`);
    }
    _detectedFramework = { framework, testExt };
    console.error(`[vibeOS] [tdd] detected test framework: ${framework || "default"} (ext: ${testExt || "match source"})`);
    return _detectedFramework;
}
// Cross-process lock directory for test file creation coordination.
const ENFORCEMENT_LOCK_DIR = join(USER_HOME, ".claude/.enforcement-lock");
const LOCK_EXPIRE_MS = 30_000;
// Cross-process cooldown to avoid duplicate enforcement across processes.
const ENFORCEMENT_COOLDOWN_FILE = join(USER_HOME, ".claude/.enforcement-cooldown.jsonl");
const COOLDOWN_MS = 60_000;
// Per-process recursion guard.
const _enforcementCooldown = new Set();
function _acquireLock(testPath) {
    try {
        mkdirSync(ENFORCEMENT_LOCK_DIR, { recursive: true });
        const hash = createHash("sha256").update(testPath).digest("hex").slice(0, 16);
        const lockPath = join(ENFORCEMENT_LOCK_DIR, `${hash}.lock`);
        try {
            openSync(lockPath, "wx");
            return true;
        }
        catch (err) {
            if (err.code !== "EEXIST")
                return false;
            try {
                const st = statSync(lockPath);
                if (Date.now() - st.mtimeMs >= LOCK_EXPIRE_MS) {
                    rmSync(lockPath, { force: true });
                    try {
                        openSync(lockPath, "wx");
                        return true;
                    }
                    catch { }
                }
            }
            catch { }
            return false;
        }
    }
    catch {
        return false;
    }
}
function _releaseLock(testPath) {
    try {
        const hash = createHash("sha256").update(testPath).digest("hex").slice(0, 16);
        const lockPath = join(ENFORCEMENT_LOCK_DIR, `${hash}.lock`);
        rmSync(lockPath);
    }
    catch { }
}
function _isInCooldown(testPath) {
    try {
        if (!existsSync(ENFORCEMENT_COOLDOWN_FILE))
            return false;
        const hash = createHash("sha256").update(testPath).digest("hex").slice(0, 16);
        const lines = readFileSync(ENFORCEMENT_COOLDOWN_FILE, "utf-8").trim().split("\n").filter(Boolean);
        const now = Date.now();
        for (const line of lines) {
            try {
                const { h, ts } = JSON.parse(line);
                if (h === hash && (now - ts) < COOLDOWN_MS)
                    return true;
            }
            catch { }
        }
        return false;
    }
    catch {
        return false;
    }
}
function _recordCooldown(testPath) {
    try {
        mkdirSync(dirname(ENFORCEMENT_COOLDOWN_FILE), { recursive: true });
        const hash = createHash("sha256").update(testPath).digest("hex").slice(0, 16);
        const entry = JSON.stringify({ h: hash, ts: Date.now() }) + "\n";
        appendFileSync(ENFORCEMENT_COOLDOWN_FILE, entry);
        // Prune old entries to keep file bounded
        const lines = readFileSync(ENFORCEMENT_COOLDOWN_FILE, "utf-8").trim().split("\n").filter(Boolean);
        if (lines.length > 500) {
            writeFileSync(ENFORCEMENT_COOLDOWN_FILE, lines.slice(-200).join("\n") + "\n");
        }
    }
    catch { }
}
export function buildTestSkeleton(filePath, sourceContent = "", options = {}) {
    const fw = _detectTestFramework();
    if (!filePath || typeof filePath !== "string")
        return null;
    if (!SOURCE_EXT_RE.test(filePath))
        return null;
    if (SKIP_PATH_RE.test(filePath))
        return null;
    const m = filePath.match(/([^/]+)\.([^.]+)$/);
    if (!m)
        return null;
    const [, name, ext] = m;
    const extLower = ext.toLowerCase();
    const skeletonFn = TEST_SKELETONS[extLower];
    if (!skeletonFn)
        return null;
    const strict = options.strict !== undefined ? options.strict : true;
    const quality = options.quality !== undefined ? options.quality : true;
    const m2 = filePath.match(/^(.*\/)?([^/]+)\.([^.]+)$/);
    const dir = m2 ? (m2[1] || "") : "";
    let testPath;
    switch (extLower) {
        case "py":
            testPath = dir + "tests/test_" + name + ".py";
            break;
        case "sh":
            testPath = dir + "tests/test_" + name + ".sh";
            break;
        case "js":
        case "mjs":
        case "ts":
        case "jsx":
        case "tsx":
        case "cjs":
        case "mts":
            testPath = dir + "tests/" + name + ".test." + ext;
            break;
        case "go":
            testPath = dir + name + "_test.go";
            break;
        case "rs":
            testPath = dir + "tests/" + name + "_test.rs";
            break;
        case "rb":
            testPath = dir + "test/" + name + "_test.rb";
            break;
        case "java":
        case "kt":
            testPath = dir + "src/test/" + name.charAt(0).toUpperCase() + name.slice(1) + "Test." + ext;
            break;
        default: return null;
    }
    if (fw?.testExt) {
        testPath = testPath.replace(new RegExp("\\.[^.]+$"), "." + fw.testExt);
    }
    const exports = extractExports(sourceContent, extLower);
    return { path: testPath, content: skeletonFn(name, exports, "full", strict, quality, sourceContent), dir: dirname(testPath) };
}
export function enforceTestFile(filePath) {
    console.error(`[vibeOS] [tdd-enforce] enforceTestFile called for ${filePath}`);
    let sourceContent = "";
    try {
        if (existsSync(filePath)) {
            sourceContent = readFileSync(filePath, "utf-8");
        }
    }
    catch { }
    const sel = loadSelection();
    const skeleton = buildTestSkeleton(filePath, sourceContent, { strict: sel.tdd_strict !== false, quality: sel.tdd_quality !== false });
    if (!skeleton)
        return null;
    if (existsSync(skeleton.path))
        return null;
    if (_enforcementCooldown.has(skeleton.path))
        return null;
    if (_isInCooldown(skeleton.path))
        return null;
    if (!_acquireLock(skeleton.path))
        return null;
    try {
        mkdirSync(skeleton.dir, { recursive: true });
        writeFileSync(skeleton.path, skeleton.content);
        _enforcementCooldown.add(skeleton.path);
        _recordCooldown(skeleton.path);
        // Record extended telemetry in state file
        try {
            updateState((state) => {
                state.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" };
                state.lifetime.tdd_enforced = (state.lifetime.tdd_enforced || 0) + 1;
                state.lifetime.tdd_skeletons_created = (state.lifetime.tdd_skeletons_created || 0) + 1;
                if (sel.tdd_strict !== false) {
                    state.lifetime.tdd_strict_fail_templates_created = (state.lifetime.tdd_strict_fail_templates_created || 0) + 1;
                }
                if (sel.tdd_quality !== false) {
                    state.lifetime.tdd_quality_templates_created = (state.lifetime.tdd_quality_templates_created || 0) + 1;
                }
                state.lifetime.last_updated = new Date().toISOString();
                return state;
            });
        }
        catch { }
        let resultPath = skeleton.path;
        // Anti-useless-run guard: warn if content is only placeholders
        const useless = isSkeletonUseless(skeleton.content);
        if (useless) {
            console.error(`[vibeOS] ⚠ TDD skeleton at ${skeleton.path} has no real assertions. Run \`trinity tdd strict off\` or add manual tests.`);
        }
        console.error(`[vibeOS] [tdd-enforce] Created skeleton: ${skeleton.path}`);
        return resultPath;
    }
    catch (err) {
        console.error(`[vibeOS] [tdd-enforce] Failed to create ${skeleton.path}: ${err.message}`);
        return null;
    }
    finally {
        _releaseLock(skeleton.path);
    }
}
export function buildTestReminder(filePath) {
    if (!filePath || typeof filePath !== "string")
        return null;
    if (!SOURCE_EXT_RE.test(filePath))
        return null;
    if (SKIP_PATH_RE.test(filePath))
        return null;
    if (testReminderSeen.has(filePath))
        return null;
    testReminderSeen.add(filePath);
    const m = filePath.match(/([^/]+)\.([^.]+)$/);
    if (!m)
        return null;
    const [, name, ext] = m;
    let suggest;
    switch (ext.toLowerCase()) {
        case "py":
            suggest = `tests/test_${name}.py`;
            break;
        case "sh":
            suggest = `tests/test_${name}.sh`;
            break;
        case "js":
        case "mjs":
        case "ts":
        case "jsx":
        case "tsx":
            suggest = `tests/${name}.test.${ext}`;
            break;
        case "go":
            suggest = `${name}_test.go`;
            break;
        default: suggest = "co-located test file";
    }
    return `🧪 Changed ${filePath} — add test at ${suggest} before completing.`;
}
