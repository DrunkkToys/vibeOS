// SPDX-License-Identifier: MIT
// @ts-nocheck
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const CLAIM_PATTERNS = [
    /(?:I|we|the)\s+(?:pushed|released|merged|deployed|fixed|wrote|implemented|completed|committed)\b/i,
    /(?:tests?|build|CI|checks?|suite|output|result)\s+(?:is\s+|are\s+)?(?:pass(?:ing|ed|es)?|green|clean|succeed|stable|positive)/i,
    /v\d+\.\d+\.\d+/,
    /\d+\s*(?:test|spec)s?\s*(?:pass|passing)/i,
    /(?:exit\s*code\s*0|0\s*errors|0\s*failures)/i,
];
export function extractClaimMatches(text) {
    if (!text || typeof text !== "string")
        return [];
    const claims = [];
    const lines = String(text).split("\n");
    for (let i = 0; i < lines.length; i++) {
        for (const pat of CLAIM_PATTERNS) {
            if (pat.test(lines[i])) {
                claims.push({ line: i + 1, text: lines[i].trim().substring(0, 120), pattern: pat.source });
                break;
            }
        }
    }
    return claims;
}
function loadRecentCascadeRuns(vibeHome) {
    try {
        const cascadeFile = join(vibeHome, "cascade-audit", "cascade-audit.jsonl");
        if (!existsSync(cascadeFile))
            return [];
        const raw = readFileSync(cascadeFile, "utf-8");
        if (!raw || typeof raw !== "string")
            return [];
        return raw.trim().split("\n").filter(Boolean).slice(-30).map(l => {
            try {
                return JSON.parse(l);
            }
            catch {
                return null;
            }
        }).filter(Boolean);
    }
    catch {
        return [];
    }
}
export function evaluateClaimVerification({ text, vibeHome = process.env.VIBEOS_HOME || join(process.env.HOME || "", ".claude"), now = Date.now(), windowMs = 120000, }) {
    const claims = extractClaimMatches(text);
    if (claims.length === 0)
        return { claims, unsubstantiatedCount: 0, claimTag: "" };
    const cascadeRuns = loadRecentCascadeRuns(vibeHome);
    const substantiated = cascadeRuns.some(cr => {
        const cTs = typeof cr === "object" && cr ? (cr._ts || "") : "";
        return Boolean(cTs) && Math.abs(new Date(cTs).getTime() - now) < windowMs;
    });
    return {
        claims,
        unsubstantiatedCount: substantiated ? 0 : claims.length,
        claimTag: substantiated ? "✓" : `⚠${claims.length}`,
    };
}
