import { getDb, initDb } from "../lib/db.js"
import { randomBytes } from "node:crypto"

const MASTER_KEY = process.env.VIBEOS_API_MASTER_KEY || randomBytes(32).toString("hex")
const SEAT_NAME = process.env.SEAT_NAME || "vibeOS Default"
const SEAT_EMAIL = process.env.SEAT_EMAIL || ""

initDb()
const db = getDb()

const existing = db.prepare("SELECT COUNT(*) as count FROM seats").get()
if (existing.count > 0) {
  console.log("[seed] Database already has seats, skipping")
  process.exit(0)
}

const seatResult = db.prepare("INSERT INTO seats (name, email) VALUES (?, ?)").run(SEAT_NAME, SEAT_EMAIL || null)
console.log(`[seed] Created seat: ${SEAT_NAME} (id: ${seatResult.lastInsertRowid})`)

const token = "vos_" + randomBytes(32).toString("hex")
const tokenResult = db.prepare("INSERT INTO api_tokens (token, seat_id, label) VALUES (?, ?, ?)").run(token, seatResult.lastInsertRowid, "default")

console.log(`[seed] Created API token: ${token}`)
console.log(`[seed] Master key: ${MASTER_KEY}`)
console.log("")
console.log("IMPORTANT: Save these credentials!")
console.log(`  VIBEOS_API_MASTER_KEY=${MASTER_KEY}`)
console.log(`  VIBEOS_API_TOKEN=${token}`)
console.log(`  API_URL=http://localhost:3000`)
