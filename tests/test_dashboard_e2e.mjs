import { describe, it, before, after } from "node:test"
import assert from "node:assert"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { spawn } from "node:child_process"

let chromium, serverProc, port, browser, page

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const TEST = join(tmpdir(), "vibeos-e2e-" + Date.now())
const CLAUDE = join(TEST, ".claude")

function setupState() {
  mkdirSync(CLAUDE, { recursive: true })
  writeFileSync(join(CLAUDE, "model-tiers.json"), JSON.stringify({
    selection: { enabled: true, active_slot: "medium", delegation_enforce: true, flow_enabled: true, flow_enforce: true, tdd_enforce: false, tdd_strict: false, thinking_level: "brief" },
    trinity: { brain: { oc: "deepseek/deepseek-v4-pro" }, medium: { oc: "deepseek/deepseek-v4-flash" }, cheap: { oc: "deepseek/deepseek-chat" } }
  }, null, 2) + "\n")
  writeFileSync(join(CLAUDE, "delegation-state.json"), JSON.stringify({
    sessions: { "e2e-001": { started: new Date().toISOString(), cost_usd: 1.25, cache_savings_usd: 0.05, warns: [{ tool: "write", est_savings_usd: 0.01 }] } }
  }, null, 2) + "\n")
}

describe("dashboard-e2e", () => {
  before(async () => {
    setupState()
    try {
      const p = await import("playwright")
      chromium = p.chromium
    } catch {
      throw new Error("playwright not installed. Run: npx playwright install chromium")
    }

    await new Promise((resolve, reject) => {
      serverProc = spawn("node", [join(ROOT, "scripts", "dashboard-server.mjs")], {
        env: { ...process.env, HOME: TEST, PORT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      })
      let stderr = ""
      serverProc.stderr.on("data", (c) => {
        stderr += String(c)
        const m = stderr.match(/Dashboard server on http:\/\/127\.0\.0\.1:(\d+)/)
        if (m) { port = Number(m[1]); resolve() }
      })
      serverProc.on("error", reject)
      setTimeout(() => { if (!port) reject(new Error("server start timeout: " + stderr)) }, 10000)
    })

    assert.ok(port, "port should be assigned")
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] })
    page = await browser.newPage()
    page.setDefaultTimeout(5000)
  })

  after(async () => {
    try { await browser?.close() } catch {}
    try { serverProc?.kill() } catch {}
    try { rmSync(TEST, { recursive: true, force: true }) } catch {}
  })

  it("page loads, SSE connects, and status card renders", async () => {
    await page.goto("http://127.0.0.1:" + port, { waitUntil: "domcontentloaded" })
    assert.strictEqual(await page.title(), "vibeOS Dashboard")
    await page.waitForSelector(".indicator.connected", { timeout: 10000 })
    const cardText = await page.textContent(".card")
    assert.ok(cardText && (cardText.includes("Status") || cardText.includes("loading")),
      "status card should exist")
  })

  it("header shows vibeOS branding", async () => {
    const h1 = await page.textContent("header .header-title h1")
    assert.ok(h1 && h1.includes("vibeOS"), "h1 should contain vibeOS")
  })

  it("shows on/off toggle button in header", async () => {
    const sel = "header .bracket-btn.on, header .bracket-btn.off"
    const btn = await page.waitForSelector(sel)
    assert.ok(btn, "should have toggle button")
  })

  it("Controls tab shows slot buttons", async () => {
    await page.click("button.tab:nth-child(2)")
    await page.waitForSelector(".control-group:first-of-type .bracket-btn")
    const btns = await page.locator(".control-group:first-of-type .bracket-btn").count()
    assert.ok(btns >= 3, "should have 3+ slot buttons, got " + btns)
  })

  it("tab navigation switches to Reports", async () => {
    await page.click("button.tab:nth-child(3)")
    await page.waitForSelector(".reports-layout")
    const h3 = await page.textContent(".card-full h3")
    assert.ok(h3 && h3.includes("Reports"), "should show Reports heading")
  })

  it("tab navigation switches to Blackbox", async () => {
    await page.click("button.tab:nth-child(4)")
    await page.waitForSelector(".card-full .bracket-btn")
    const h3 = await page.textContent(".card-full h3")
    assert.ok(h3 && h3.includes("Blackbox"), "should show Blackbox heading")
  })

  it("theme toggle switches light/dark", async () => {
    await page.click("button.tab:first-child")
    await page.waitForSelector(".theme-toggle")
    await page.click(".theme-toggle")
    const theme = await page.getAttribute("div.app", "data-theme")
    assert.strictEqual(theme, "light")
    await page.click(".theme-toggle")
    const theme2 = await page.getAttribute("div.app", "data-theme")
    assert.strictEqual(theme2, "dark")
  })
})
