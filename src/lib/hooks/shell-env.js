// @ts-nocheck
import { currentTier, currentModel } from '../state.js';
import { _refreshModel } from '../pricing.js';
let directory = '';
export const setShellDirectory = (dir) => { directory = dir || ''; };
export const onShellEnv = async (_input, output) => {
    try {
        _refreshModel(directory || process.cwd());
        if (!output) output = {};
        output.env ??= {};
        output.env.OPENCODE_MODEL_TIER = currentTier || "unknown";
        output.env.OPENCODE_MODEL = currentModel || "unknown";
    }
    catch (e) {
        console.error("[vibeOS] shell.env error:", e);
    }
};
