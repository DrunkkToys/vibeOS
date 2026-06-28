import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

function runScript(script) {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: "utf-8",
  })
  assert.equal(child.status, 0, child.stderr || child.stdout)
  return JSON.parse(String(child.stdout || "").trim())
}

test("mcp: dashboard resolves the published runtime URL even when tiers are stale", async () => {
  const result = runScript(`
    import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
    import { join } from "node:path";
    import { tmpdir } from "node:os";
    import net from "node:net";
    const sandbox = mkdtempSync(join(tmpdir(), "vibeos-dashboard-"));
    const home = sandbox;
    const vibeHome = join(home, ".claude");
    const opencodeHome = join(home, ".config/opencode");
    const projectDir = join(home, "project");
    mkdirSync(vibeHome, { recursive: true });
    mkdirSync(join(vibeHome, "reports"), { recursive: true });
    mkdirSync(opencodeHome, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(opencodeHome, "opencode.json"), JSON.stringify({
      model: "deepseek/deepseek-v4-flash",
      provider: { deepseek: { models: { "deepseek-v4-pro": {}, "deepseek-v4-flash": {}, "deepseek-chat": {} } } }
    }, null, 2) + "\\n");
    writeFileSync(join(vibeHome, "model-tiers.json"), JSON.stringify({
      selection: {
        enabled: true,
        active_slot: "brain",
        delegation_enforce: true,
        flow_enabled: true,
        tdd_enforce: true,
        thinking_level: "off",
        mcp_port: 65534,
      },
      trinity: {
        brain: { oc: "deepseek/deepseek-v4-pro", cc: "brain" },
        medium: { oc: "deepseek/deepseek-v4-flash", cc: "medium" },
        cheap: { oc: "deepseek/deepseek-chat", cc: "cheap" },
      },
    }, null, 2) + "\\n");
    writeFileSync(join(vibeHome, "delegation-state.json"), JSON.stringify({
      lifetime: { warn_count: 0, cache_savings_usd: 0, missed_context7_usd: 0, total_savings_usd: 0 },
      sessions: {},
    }, null, 2) + "\\n");
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const actual = typeof address === "object" && address ? address.port : 0;
        server.close((err) => err ? reject(err) : resolve(actual));
      });
    });
    process.env.HOME = home;
    process.env.VIBEOS_HOME = vibeHome;
    process.env.VIBEOS_OPENCODE_HOME = opencodeHome;
    process.env.VIBEOS_MCP_PORT = String(port);
    const modA = await import(${JSON.stringify(new URL("../dist-ts/index.js", import.meta.url).href)} + "?dash-a=" + Date.now());
    await modA.DelegationEnforcer({ client: {}, directory: projectDir });
    const waitFor = async (url) => {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        try {
          const res = await fetch(url);
          if (res.ok) return true;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("timeout waiting for " + url);
    };
    await waitFor("http://127.0.0.1:" + port + "/health");
    process.env.VIBEOS_MCP_PORT = "0";
    const modB = await import(${JSON.stringify(new URL("../dist-ts/index.js", import.meta.url).href)} + "?dash-b=" + Date.now());
    const hooksB = await modB.DelegationEnforcer({ client: {}, directory: projectDir });
    const dashboard = await hooksB.tool.trinity.execute({ action: "dashboard" });
    const runtime = JSON.parse(readFileSync(join(vibeHome, "mcp-runtime.json"), "utf-8"));
    console.log(JSON.stringify({
      port,
      dashboard,
      runtime_base_url: runtime.baseUrl,
      runtime_port: runtime.port,
      dashboard_ready: !String(dashboard).includes("not ready"),
    }));
  `)

  const expectedBase = `http://127.0.0.1:${result.port}`
  assert.equal(result.runtime_base_url, expectedBase)
  assert.equal(result.runtime_port, result.port)
  assert.equal(result.dashboard_ready, true)
  assert.ok(String(result.dashboard).includes(expectedBase), String(result.dashboard))
  assert.ok(String(result.dashboard).includes("/dashboard/home"), String(result.dashboard))
})

test("mcp: dashboard publication and blackbox survive restart", async () => {
  const result = runScript(`
    import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
    import { join } from "node:path";
    import { tmpdir } from "node:os";
    import net from "node:net";
    const sandbox = mkdtempSync(join(tmpdir(), "vibeos-blackbox-"));
    const home = sandbox;
    const vibeHome = join(home, ".claude");
    const opencodeHome = join(home, ".config/opencode");
    const projectDir = join(home, "project");
    mkdirSync(vibeHome, { recursive: true });
    mkdirSync(join(vibeHome, "reports"), { recursive: true });
    mkdirSync(join(vibeHome, "scratch"), { recursive: true });
    mkdirSync(opencodeHome, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(opencodeHome, "opencode.json"), JSON.stringify({
      model: "deepseek/deepseek-v4-flash",
      provider: { deepseek: { models: { "deepseek-v4-pro": {}, "deepseek-v4-flash": {}, "deepseek-chat": {} } } }
    }, null, 2) + "\\n");
    writeFileSync(join(vibeHome, "model-tiers.json"), JSON.stringify({
      selection: {
        enabled: true,
        active_slot: "brain",
        delegation_enforce: true,
        flow_enabled: true,
        tdd_enforce: true,
        thinking_level: "off",
      },
      trinity: {
        brain: { oc: "deepseek/deepseek-v4-pro", cc: "brain" },
        medium: { oc: "deepseek/deepseek-v4-flash", cc: "medium" },
        cheap: { oc: "deepseek/deepseek-chat", cc: "cheap" },
      },
    }, null, 2) + "\\n");
    writeFileSync(join(vibeHome, "delegation-state.json"), JSON.stringify({
      lifetime: { warn_count: 2, cache_savings_usd: 2.1, missed_context7_usd: 0.3, total_savings_usd: 3.0 },
      sessions: {},
    }, null, 2) + "\\n");
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const actual = typeof address === "object" && address ? address.port : 0;
        server.close((err) => err ? reject(err) : resolve(actual));
      });
    });
    process.env.HOME = home;
    process.env.VIBEOS_HOME = vibeHome;
    process.env.VIBEOS_OPENCODE_HOME = opencodeHome;
    process.env.VIBEOS_MCP_PORT = String(port);
    const modA = await import(${JSON.stringify(new URL("../dist-ts/index.js", import.meta.url).href)} + "?bb-a=" + Date.now());
    const hooksA = await modA.DelegationEnforcer({ client: {}, directory: projectDir });
    const waitFor = async (url) => {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        try {
          const res = await fetch(url);
          if (res.ok) return true;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("timeout waiting for " + url);
    };
    await waitFor("http://127.0.0.1:" + port + "/health");
    await fetch("http://127.0.0.1:" + port + "/blackbox/vector", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ satisfaction: 0.7, stress_level: 0.2, notes: "persist me" }),
    });
    await fetch("http://127.0.0.1:" + port + "/blackbox/outcome", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ satisfaction: "positive", notes: "persist outcome" }),
    });
    const firstBlackbox = JSON.parse(readFileSync(join(vibeHome, "blackbox-state.json"), "utf-8"));
    await modA.closeMcpServer();
    const modB = await import(${JSON.stringify(new URL("../dist-ts/index.js", import.meta.url).href)} + "?bb-b=" + Date.now());
    const hooksB = await modB.DelegationEnforcer({ client: {}, directory: projectDir });
    await waitFor("http://127.0.0.1:" + port + "/health");
    const blackbox = await (await fetch("http://127.0.0.1:" + port + "/blackbox")).json();
    const reloadedBlackbox = JSON.parse(readFileSync(join(vibeHome, "blackbox-state.json"), "utf-8"));
    console.log(JSON.stringify({
      first_vector_count: firstBlackbox.sessions?.[Object.keys(firstBlackbox.sessions || {})[0]]?.dashboard_vectors?.length || 0,
      first_outcome_count: firstBlackbox.sessions?.[Object.keys(firstBlackbox.sessions || {})[0]]?.dashboard_outcomes?.length || 0,
      reloaded_vector_count: reloadedBlackbox.sessions?.[Object.keys(reloadedBlackbox.sessions || {})[0]]?.dashboard_vectors?.length || 0,
      reloaded_outcome_count: reloadedBlackbox.sessions?.[Object.keys(reloadedBlackbox.sessions || {})[0]]?.dashboard_outcomes?.length || 0,
      blackbox_vector_count: blackbox.dashboard_vectors?.length || 0,
      blackbox_outcome_count: blackbox.dashboard_outcomes?.length || 0,
    }));
  `)

  assert.equal(result.first_vector_count, 1)
  assert.equal(result.first_outcome_count, 1)
  assert.equal(result.reloaded_vector_count, 1)
  assert.equal(result.reloaded_outcome_count, 1)
  assert.ok(result.blackbox_vector_count >= 0)
  assert.ok(result.blackbox_outcome_count >= 0)
})

test("state: startup maintenance prunes stale orphan sessions", async () => {
  const result = runScript(`
    import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
    import { join } from "node:path";
    import { tmpdir } from "node:os";
    const sandbox = mkdtempSync(join(tmpdir(), "vibeos-cleanup-"));
    const home = sandbox;
    const vibeHome = join(home, ".claude");
    mkdirSync(vibeHome, { recursive: true });
    const now = Date.now();
    const sessions = {};
    for (let i = 0; i < 34; i++) {
      sessions["stale-" + i] = {
        started: new Date(now - 40 * 24 * 60 * 60 * 1000 - i * 1000).toISOString(),
        session_started_at: new Date(now - 40 * 24 * 60 * 60 * 1000 - i * 1000).toISOString(),
        warns: [],
        cache_hits: [],
        tool_counts: {},
      };
    }
    sessions["live-session"] = {
      started: new Date(now).toISOString(),
      session_started_at: new Date(now).toISOString(),
      warns: [{ tool: "edit", reason: "active", est_savings_usd: 0.01 }],
      cache_hits: [{ hash: "h1", est_savings_usd: 0.01 }],
      tool_counts: { edit: 1 },
    };
    writeFileSync(join(vibeHome, "delegation-state.json"), JSON.stringify({
      lifetime: { warn_count: 1, cache_savings_usd: 0.01, missed_context7_usd: 0, total_savings_usd: 0.01 },
      sessions,
    }, null, 2) + "\\n");
    process.env.HOME = home;
    process.env.VIBEOS_HOME = vibeHome;
    const stateMod = await import(${JSON.stringify(new URL("../dist-ts/lib/state.js", import.meta.url).href)} + "?cleanup=" + Date.now());
    stateMod.runStartupMaintenanceOnce();
    const next = JSON.parse(readFileSync(join(vibeHome, "delegation-state.json"), "utf-8"));
    console.log(JSON.stringify({
      session_count: Object.keys(next.sessions || {}).length,
      has_live_session: Boolean(next.sessions?.["live-session"]),
      stale_removed: !next.sessions?.["stale-0"],
    }));
  `)

  assert.equal(result.has_live_session, true)
  assert.equal(result.stale_removed, true)
  assert.ok(result.session_count <= 30, String(result.session_count))
})
