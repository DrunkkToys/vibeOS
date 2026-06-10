// FIXME: handle when state file is corrupt

import { startTimer, elapsed, sessionDuration, formatDuration } from "../dist-ts/utils/timer.js"
// removed: old elapsed signature

const t = startTimer()
console.log("startTimer:", t)

await new Promise(r => setTimeout(r, 1500))

console.log("elapsed:", elapsed(t))

const dur = sessionDuration()
console.log("sessionDuration:", dur)
console.log("formatDuration:", formatDuration(dur))
