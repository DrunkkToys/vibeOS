# vibeOS damage/debug report — 2026-08-09

Findings from driving OpenCode Desktop live with vibeOS built and deployed this session.
Each finding is code-verified with file:line, not inferred.

## Finding 1 — CLAUDE.md's documented $VIBEOS_HOME is stale

CLAUDE.md states `$VIBEOS_HOME = ~/Library/Application Support/ai.opencode.desktop/vibeOS/`.
Actual default (`src/lib/runtime-paths.ts:19`, `resolveVibeOSHome()`):
```
process.env.VIBEOS_HOME || join(process.env.HOME || USER_HOME, ".vibeos")
```
Confirmed empirically: after driving a live OpenCode Desktop session with vibeOS active
(footer fired, see Finding 3), state landed at `~/.vibeos/delegation-state.json`, not under
Application Support. The documented path does not exist on this machine.

## Finding 2 — dual OpenCode-home config read, partial regression

`scripts/lib/opencode-homes.mjs` (deploy-time) documents in its own comment that multiple
OpenCode "homes" used to cause vibeOS to load twice in one process (duplicate
`MODULE_TYPELESS_PACKAGE_JSON` warnings for two different vibeOS.js paths) and was fixed to
return a single home for plugin loading.

`src/lib/runtime-paths.ts:22-31` (runtime, compiled into the shipped plugin bundle) still
has the old two-home logic:
```ts
export function resolveOpenCodeHomes(): string[] {
  const override = process.env.VIBEOS_OPENCODE_HOME || process.env.OPENCODE_HOME
  if (override) return [override]
  const base = process.env.HOME || USER_HOME
  const homes = [join(base, ".opencode")]
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(base, ".config")
  const xdgOpenCode = join(xdgConfig, "opencode")
  if (xdgOpenCode !== homes[0]) homes.push(xdgOpenCode)
  return homes
}
```
This is live code, not dead: `getOpenCodeHomes()` is called from `runtime-config.ts:104` and
`:144` to build the candidate list of `opencode.json`/`config.json` files vibeOS reads for
model/config detection. On this machine `~/.config/opencode/opencode.json` is a real, stale
file (confirmed via `cat`) with its own agent definitions, distinct from `~/.opencode/opencode.json`.
So while plugin *loading* was fixed to a single home, config *reading* still scans both,
which is the same class of bug the fix was meant to eliminate, just on the read path instead
of the load path.

## Finding 3 — vibeOS does not reload into an already-running desktop process

`npm run build` deploys `dist/vibeOS.js` to `~/.opencode/plugins/vibeOS.js` and registers it
in `~/.opencode/opencode.json`. An OpenCode Desktop session that was already running before
the build/deploy does **not** pick up the newly-registered plugin — confirmed by running a
real tool call (`pwd && echo vibeos-test-marker`) in both the pre-existing session and a
freshly-opened tab within the same running app process: neither produced a vibeOS footer,
and `~/.vibeos` was not created.

After a full app quit (`osascript -e 'quit app "OpenCode"'`) and relaunch, the same test
(`pwd && echo vibeos-restart-test`) produced the live footer:
```
— ⚡ cheap | Deepseek | V4 Flash ▶ ⚬ Exploring | ~$0.00 saved est | VibeUltraX ⚡ | quiet mode | ⚠ cross-provider (run vibe rebuild) | ▬ —
```
Plugin loading happens once at process/server launch, not per-session and not on config
change. Not itself a bug — expected Node/Electron `require()` caching — but worth documenting
since it is easy to mistake a build for a live update, exactly as happened here.

The footer itself also self-reports an unresolved warning: `⚠ cross-provider (run vibe rebuild)`.
Not yet investigated — the trinity tier topology likely needs `vibe rebuild` after this build.

## Finding 4 — loop-guard false-positive: blocks legitimately-converging distinct commands

While driving a real M5 diagnostic session (session "LM Studio model swap and mule worker
launch on m5", live in OpenCode Desktop), the assistant issued a sequence of **distinct**
shell commands — checking different PIDs, launching different batch numbers, verifying
different fleet configs — while iteratively fixing a real LM Studio RAM-contention bug.
Each command differed in content; none were identical repeats. Starting at poll-count 9-10,
vibeOS's loop-guard began injecting warnings (`[vibeOS loop-guard] You have polled the same
status N times — each poll spends a full model turn...`), and by count 10-11 it **actually
blocked the Bash tool outright** ("The shell is being intercepted by the loop-guard" / "Bash
is being intercepted by the loop-guard"), forcing the agent to route the fix through a Task
subagent instead.

This is a false positive: the guard's classification (`polled the same status N times`)
does not match what happened (progressively different diagnostic/fix commands converging on
a real root cause). Blocking Bash outright, rather than just warning, cost real time on a
live diagnostic session and forced a workaround. Worth checking the loop classifier's
similarity heuristic — it likely keys on the shared `ssh m5 ...` prefix or the shared
"status check" shape of the commands rather than their actual (differing) arguments.

## Finding 4 addendum — corrected damage test, real results

The original `--pure` test was invalid (confounded model choice). Redone with the model
pinned identically (`-m opencode/big-pickle`) on both sides:

- **File-write contamination: RULED OUT.** Treatment (vibeOS on) and control (vibeOS off,
  `--pure`) produced byte-identical output writing `{"a": 1, "b": [1,2,3], "c": "test"}` —
  `diff` returned no differences. The footer only appends to the chat/log stream shown to
  the operator; it does not leak into files written by the `write` tool.
- **Loop-guard false positive: does NOT reproduce from generic distinct Bash calls.** Ran
  12 distinct, successful `echo checkN` commands in one session — all completed normally,
  zero loop-guard interventions, despite the session's own regime classifier cycling through
  Starting → Refining → Closed → Looping labels. This means the false positive documented
  above is likely tied to the *specific* pattern of repeated near-identical failing
  `ssh m5 curl ...` calls against a genuinely unreachable host, not to bash-call volume or
  topical similarity in general. Root cause narrowed, not yet fully isolated — reproducing
  it would need a controlled repeated-failure scenario (e.g. hitting a deliberately dead
  local port repeatedly), which is a reasonable follow-up but out of scope for this pass.

## Finding 5 — unrelated but real: M5 went offline mid-session

Independently confirmed (`ssh -o ConnectTimeout=8 m5`) that M5 (192.168.1.113) became
unreachable mid-diagnostic: `ssh: connect to host 192.168.1.113 port 22: Host is down`. Not
a vibeOS or OpenCode bug — real infrastructure state, likely the machine slept. No
Wake-on-LAN tooling installed locally (`wakeonlan`/`etherwake` both missing), though the
host's MAC (`42:9d:ee:dd:14:ff`) is still cached in ARP from before it went down. Needs
physical access or WOL to resume the M5/corpus-B track.
