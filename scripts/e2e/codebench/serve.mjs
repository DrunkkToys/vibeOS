// SPDX-License-Identifier: MIT
import { spawn } from "node:child_process"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function startServer(opencode, { cwd, env, pure = false, timeoutMs = 60000 }) {
  const args = ["serve", "--port", "0"]
  if (pure) args.push("--pure")
  const t = tethered(opencode, args)
  const child = spawn(t.command, t.args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
  const stop = () => { try { child.kill("SIGTERM") } catch {} }
  return new Promise((resolve, reject) => {
    let buf = ""
    const timer = setTimeout(() => { stop(); reject(new Error("opencode serve did not start")) }, timeoutMs)
    const onData = (d) => {
      buf += String(d)
      const m = buf.match(/listening on (http:\/\/\S+)/)
      if (!m) return
      clearTimeout(timer)
      resolve({ url: m[1].replace(/\/$/, ""), stop })
    }
    child.stdout.on("data", onData)
    child.stderr.on("data", onData)
    child.on("exit", () => { clearTimeout(timer); reject(new Error(`opencode serve exited: ${buf.slice(-300)}`)) })
  })
}

export function serverApi(url, directory) {
  const call = async (path, init = {}) => {
    const r = await fetch(url + path, { ...init, headers: { "x-opencode-directory": directory, "content-type": "application/json", ...(init.headers || {}) } })
    return r.json()
  }
  return {
    status: () => call("/session/status"),
    messages: (sid) => call(`/session/${sid}/message`),
    abort: (sid) => call(`/session/${sid}/abort`, { method: "POST" }).catch(() => null),
  }
}

export async function waitIdle(fetchStatus, sid, { pollMs = 5000, quietPolls = 4, timeoutMs = 1500000 } = {}) {
  const t0 = Date.now()
  let quiet = 0
  while (Date.now() - t0 < timeoutMs) {
    let type = "idle"
    try { type = (await fetchStatus())?.[sid]?.type || "idle" } catch { type = "unknown" }
    quiet = type === "idle" ? quiet + 1 : 0
    if (quiet >= quietPolls) return { idle: true, elapsedMs: Date.now() - t0 }
    await sleep(pollMs)
  }
  return { idle: false, elapsedMs: Date.now() - t0 }
}

export function toolEventLines(messages) {
  const lines = []
  for (const m of messages || []) {
    for (const part of m?.parts || []) {
      if (part?.type === "tool") lines.push(JSON.stringify({ type: "tool_use", part }))
    }
  }
  return lines.join("\n")
}

export function continuationCount(messages, sentPrompts) {
  const keys = sentPrompts.map((p) => String(p).slice(0, 40))
  return (messages || []).filter((m) => m?.info?.role === "user").filter((m) => {
    const t = (m.parts || []).filter((p) => p?.type === "text").map((p) => p.text).join("\n").replace(/^["'\s]+/, "")
    return !keys.some((k) => t.startsWith(k))
  }).length
}

const TETHER = `"$0" "$@" & c=$!
trap 'kill -9 $c 2>/dev/null; exit 143' TERM INT HUP
while kill -0 $c 2>/dev/null; do
  kill -0 $TETHER_PARENT 2>/dev/null || { kill -9 $c 2>/dev/null; exit 137; }
  sleep 1 & wait $!
done
wait $c`

export function tethered(command, args, parentPid = process.pid) {
  return { command: "/bin/sh", args: ["-c", TETHER.replace("$TETHER_PARENT", String(parentPid)), command, ...args] }
}
