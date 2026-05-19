#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const LEDGER_FILE = join(homedir(), ".claude", "savings-ledger.jsonl")
const BACKUP_FILE = LEDGER_FILE + ".bak"

if (!existsSync(LEDGER_FILE)) {
  console.log("No ledger file found at", LEDGER_FILE)
  process.exit(0)
}

const lines = readFileSync(LEDGER_FILE, "utf-8").split("\n").filter(Boolean)
let updated = 0
let skipped = 0

const migrated = lines.map((line) => {
  try {
    const entry = JSON.parse(line)
    if (entry.v === 2) {
      skipped++
      return line
    }
    entry.v = 2
    if (!entry.kind) {
      if (entry.toll === "cache" || entry.type === "cache" || entry.source === "cache" || entry.category === "cache") {
        entry.kind = "cache"
      } else {
        entry.kind = "delegation"
      }
    }
    updated++
    return JSON.stringify(entry)
  } catch {
    return line
  }
})

renameSync(LEDGER_FILE, BACKUP_FILE)
writeFileSync(LEDGER_FILE, migrated.join("\n") + "\n")

console.log(`Migration complete: ${updated} updated, ${skipped} skipped (already v2)`)
console.log(`Backup saved: ${BACKUP_FILE}`)
