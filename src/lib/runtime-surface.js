// @ts-nocheck
export function buildStatusPayload({ selection, tiersData, currentModel, creditPercent, version, todos, }) {
    const activeSlot = selection?.active_slot || "brain";
    const todoList = Array.isArray(todos) ? todos : [];
    const pendingTodos = todoList.filter(t => t?.status === "pending").length;
    const totalTodos = todoList.length;
    const current = tiersData?.trinity?.[activeSlot]?.oc || currentModel || "";
    return {
        enabled: selection?.enabled !== false,
        active_slot: activeSlot,
        enforce: selection?.delegation_enforce !== false,
        flow_enforcer: selection?.flow_enabled !== false,
        flow_extract_todos: selection?.flow_enforce === true,
        tdd_enforcer: selection?.tdd_enforce === true,
        tdd_strict: selection?.tdd_strict !== false,
        thinking: selection?.thinking_level || fallbackThinking || "brief",
        current_model: current,
        credit_percent: creditPercent,
        version,
        todos: { total: totalTodos, pending: pendingTodos },
    };
}
export function buildSavingsPayload({ lifetime, session, }) {
    const telemetry = lifetime?.telemetry || {};
    return {
        lifetime: {
            delegation_usd: Number(lifetime?.ltTasks || 0),
            cache_usd: Number(lifetime?.ltCache || 0),
            missed_context7_usd: Number(lifetime?.missedC7 || 0),
            total_warns: Number(lifetime?.count || 0),
        },
        current_session: {
            delegation_usd: Number(lifetime?.sesTasks || 0),
            cache_usd: Number(session?.cache_savings_usd || 0),
            warns_count: Array.isArray(session?.warns) ? session.warns.length : 0,
            tool_breakdown: lifetime?.sesToolBreakdown || {},
        },
        telemetry: {
            lifetime_events: Number(telemetry?.lifetime_events ?? telemetry?.events ?? 0),
            current_session_events: Number(telemetry?.current_session_events ?? telemetry?.session_events ?? session?.telemetry?.events ?? 0),
            storage_bytes_estimate: Number(telemetry?.storage_bytes_estimate || 0),
            retained_sessions: Number(telemetry?.retained_sessions || 0),
            tool_counts: telemetry?.tool_counts || {},
            tier_counts: telemetry?.tier_counts || {},
            slot_counts: telemetry?.slot_counts || {},
            kind_counts: telemetry?.kind_counts || {},
            prompt_size_buckets: telemetry?.prompt_size_buckets || {},
            output_size_buckets: telemetry?.output_size_buckets || {},
            duration_buckets: telemetry?.duration_buckets || {},
            result_counts: telemetry?.result_counts || {},
            cache_hit_counts: telemetry?.cache_hit_counts || { hit: 0, miss: 0 },
            enforcement_counts: telemetry?.enforcement_counts || {},
            flow_counts: telemetry?.flow_counts || {},
            tdd_counts: telemetry?.tdd_counts || {},
            last_seen: telemetry?.last_seen || null,
            last_compacted_at: telemetry?.last_compacted_at || null,
        },
        cache_hits_this_session: Number(session?.cache_hits?.length || 0),
        trend: lifetime?.sesTrend || "stable",
        savings_rate_per_hour: Number(lifetime?.sesRatePerHour || 0),
    };
}
export function buildSessionCheckout({ sessionId, metrics, session, flowWarns, }) {
    const warns = Array.isArray(session?.warns) ? session.warns : [];
    const rankedOps = warns
        .map((w) => ({
        tool: String(w?.tool || "unknown"),
        reason: String(w?.reason || ""),
        savings_usd: Number(w?.est_savings_usd || 0),
        at: w?.at || null,
    }))
        .sort((a, b) => b.savings_usd - a.savings_usd)
        .slice(0, 3);
    const summary = {
        session_id: sessionId,
        duration_seconds: Number(metrics?.sesDuration || 0),
        duration: metrics?.sesDurationFormatted || "0h 0m 0s",
        cost_usd: Number(session?.cost_usd || 0),
        savings: {
            delegation_usd: Number(metrics?.sesTasks || 0),
            cache_usd: Number(session?.cache_savings_usd || 0),
            total_usd: Number((metrics?.sesTasks || 0) + Number(session?.cache_savings_usd || 0)),
        },
        tools: {
            breakdown: metrics?.sesToolBreakdown || {},
            top_expensive_operations: rankedOps,
        },
        model_split: metrics?.sesModelTurns || { brain: 0, worker: 0 },
        trend_vs_previous_sessions: metrics?.sesTrend || "stable",
        flow_violations: flowWarns,
    };
    return {
        summary,
        report: {
            type: "session-checkout",
            summary: `Session checkout ${sessionId}: $${Number(summary.savings.total_usd || 0).toFixed(3)} saved`,
            findings: rankedOps.map((op) => ({
                severity: "info",
                topic: op.tool,
                detail: `${op.reason} ($${op.savings_usd.toFixed(6)})`,
            })),
            metrics: {
                duration_seconds: summary.duration_seconds,
                cost_usd: summary.cost_usd,
                delegation_savings_usd: summary.savings.delegation_usd,
                cache_savings_usd: summary.savings.cache_usd,
                total_savings_usd: summary.savings.total_usd,
                trend: summary.trend_vs_previous_sessions,
                brain_turns: summary.model_split.brain || 0,
                worker_turns: summary.model_split.worker || 0,
                telemetry_events: Number(session?.telemetry?.events || 0),
                telemetry_storage_bytes_estimate: Number(session?.telemetry?.storage_bytes_estimate || 0),
            },
            narrative: JSON.stringify(summary),
            tags: ["session", "checkout"],
        },
        rankedOps,
    };
}
export function diagnoseStructuredFromText(raw, creditPercent = 0) {
    const text = String(raw || "");
    const lines = text.split("\n");
    const files = [];
    const model_probes = [];
    const suggestions = [];
    let credit = { percent: Number(creditPercent || 0), ok: true, fix: null };
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        if (trimmed.includes("→"))
            suggestions.push(trimmed.replace(/^→\s*/, ""));
        if (/slot/i.test(trimmed) && /(brain|medium|cheap)/i.test(trimmed)) {
            model_probes.push({ slot: trimmed, model: "", ok: trimmed.includes("✅"), fix: trimmed.includes("→") ? trimmed.split("→")[1].trim() : undefined });
        }
        if (/model-tiers\.json|opencode\.json|delegation-state\.json|auth\.json/i.test(trimmed)) {
            files.push({ path: trimmed, exists: trimmed.includes("✅"), ok: trimmed.includes("✅"), fix: trimmed.includes("→") ? trimmed.split("→")[1].trim() : undefined });
        }
        if (/credit/i.test(trimmed)) {
            const m = trimmed.match(/(\d+)%/);
            if (m)
                credit.percent = Number(m[1]);
            credit.ok = trimmed.includes("✅");
            credit.fix = trimmed.includes("→") ? trimmed.split("→")[1].trim() : null;
        }
    }
    return {
        config_valid: !text.includes("❌"),
        files,
        model_probes,
        credit,
        locks_clean: true,
        suggestions,
    };
}
export function projectStructuredFromText(raw, selection, creditPercent = 0) {
    const text = String(raw || "");
    const m1 = text.match(/Brain[^0-9]*(\d+)%/i);
    const m2 = text.match(/Worker[^0-9]*(\d+)%/i);
    const brainPct = m1 ? Number(m1[1]) : 0;
    const workerPct = m2 ? Number(m2[1]) : 0;
    const lines = text.split("\n");
    const suggestions = lines.filter((l) => l.includes("💡")).map((l) => l.replace(/^.*💡\s*/, "").trim());
    return {
        brain_pct: brainPct,
        worker_pct: workerPct,
        enforcement_status: selection?.delegation_enforce ? "enforce" : "warn",
        flow_status: selection?.flow_enabled !== false ? "on" : "off",
        credit_percent: Number(creditPercent || 0),
        suggestions,
    };
}
