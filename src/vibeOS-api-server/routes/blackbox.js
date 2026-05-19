import { ResolutionTracker, SUB_REGIMES, extractFeatures } from "../lib/blackbox.js"
import { getDb } from "../lib/db.js"

const trackers = new Map()

function loadTrackerFromDb(sessionId) {
  try {
    const db = getDb()
    const row = db.prepare("SELECT state_json FROM blackbox_sessions WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1").get(sessionId)
    if (row?.state_json) {
      const data = JSON.parse(row.state_json)
      return ResolutionTracker.deserialize(data)
    }
  } catch (err) {
    console.error(`[blackbox] loadTrackerFromDb failed for ${sessionId}: ${err.message}`)
  }
  return null
}

function saveTrackerToDb(sessionId, projectId, tracker) {
  try {
    const db = getDb()
    const stateJson = JSON.stringify(tracker.serialize())
    const outcome = tracker.getOutcomeHistory().slice(-1)[0]?.outcome || null
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO blackbox_sessions (session_id, project_id, state_json, outcome, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        state_json = excluded.state_json,
        project_id = COALESCE(excluded.project_id, blackbox_sessions.project_id),
        outcome = COALESCE(excluded.outcome, blackbox_sessions.outcome),
        updated_at = excluded.updated_at
    `).run(sessionId, projectId || null, stateJson, outcome, now, now)
  } catch (err) {
    console.error(`[blackbox] saveTrackerToDb failed for ${sessionId}: ${err.message}`)
  }
}

function getOrCreateTracker(sessionId, projectId) {
  let tracker = trackers.get(sessionId)
  if (!tracker) {
    tracker = loadTrackerFromDb(sessionId) || new ResolutionTracker(sessionId, projectId)
    trackers.set(sessionId, tracker)
  }
  if (projectId && !tracker.projectId) {
    tracker.projectId = projectId
  }
  return tracker
}

export async function blackboxRoutes(fastify) {
  fastify.post("/api/v1/blackbox/analyze", async (request, reply) => {
    const { session_id, project_id, user_text, features, action, entropy, uncertainty, embedding } = request.body || {}

    if (!user_text && !features && !action) {
      return reply.code(400).send({ error: "user_text is required" })
    }

    const sid = session_id || "default"
    const tracker = getOrCreateTracker(sid, project_id)

    const derivedFeatures = typeof features === "object" && !Array.isArray(features) && Object.keys(features || {}).length > 0
      ? features
      : extractFeatures(user_text)

    const state = tracker.update({
      userText: user_text || "",
      features: derivedFeatures,
      actions: typeof action === "string" ? [action] : (Array.isArray(action) ? action : []),
      entropy: entropy ?? 1.0,
      uncertainty: uncertainty ?? 50,
      embedding: embedding || null,
    })

    saveTrackerToDb(sid, project_id, tracker)

    return {
      ...state,
      session_id: sid,
      project_id: project_id || tracker.projectId || null,
      features: derivedFeatures,
    }
  })

  fastify.post("/api/v1/blackbox/state", async (request, reply) => {
    const { session_id, project_id } = request.body || {}
    const sid = session_id || "default"
    const tracker = getOrCreateTracker(sid, project_id)

    return {
      ...tracker.getState(),
      session_id: sid,
      project_id: project_id || tracker.projectId || null,
    }
  })

  fastify.post("/api/v1/blackbox/reset", async (request, reply) => {
    const { session_id } = request.body || {}
    const sid = session_id || "default"
    trackers.delete(sid)
    try {
      getDb().prepare("DELETE FROM blackbox_sessions WHERE session_id = ?").run(sid)
    } catch {}
    return { ok: true, message: "tracker reset" }
  })

  fastify.get("/api/v1/blackbox/regimes", async (request, reply) => {
    return { regimes: SUB_REGIMES }
  })

  fastify.get("/api/v1/blackbox/project-sessions", async (request, reply) => {
    const { project_id } = request.query || {}
    if (!project_id) {
      return reply.code(400).send({ error: "project_id query parameter is required" })
    }
    try {
      const db = getDb()
      const rows = db.prepare(
        "SELECT session_id, created_at, updated_at, outcome FROM blackbox_sessions WHERE project_id = ? ORDER BY updated_at DESC LIMIT 50"
      ).all(project_id)
      return { project_id, sessions: rows }
    } catch (err) {
      return reply.code(500).send({ error: "failed to query sessions" })
    }
  })

  fastify.post("/api/v1/blackbox/outcome", async (request, reply) => {
    const { session_id, outcome } = request.body || {}
    if (!session_id || !outcome) {
      return reply.code(400).send({ error: "session_id and outcome are required" })
    }
    const sid = session_id
    const tracker = trackers.get(sid)
    if (tracker) {
      tracker.recordOutcome(outcome)
    }
    try {
      const db = getDb()
      db.prepare("UPDATE blackbox_sessions SET outcome = ?, updated_at = ? WHERE session_id = ?")
        .run(outcome, new Date().toISOString(), sid)
    } catch {}
    return { ok: true, session_id: sid, outcome }
  })

  fastify.post("/api/v1/blackbox/calibrate", async (request, reply) => {
    const { project_id } = request.body || {}
    const pid = project_id || "global"
    try {
      const db = getDb()
      const sessions = db.prepare(
        "SELECT state_json, outcome FROM blackbox_sessions WHERE project_id = ? AND outcome IS NOT NULL"
      ).all(pid)

      if (sessions.length < 3) {
        return reply.code(400).send({
          error: "need at least 3 sessions with outcomes to calibrate",
          samples: sessions.length,
        })
      }

      const outcomes = sessions.map(s => JSON.parse(s.state_json))
      const loopSessions = outcomes.filter(o => {
        try {
          const state = typeof o === "string" ? JSON.parse(o) : o
          return state?.is_looping
        } catch { return false }
      })
      const positiveOutcomes = sessions.filter(s => s.outcome === "positive").length
      const total = sessions.length

      const weights = {
        momentum: [-0.3, 0.5, 0.2],
        subRegime: {
          CONVERGING: -0.10,
          CLOSED: -0.10,
          DIVERGENT: +0.15,
          REFINING: 0.00,
          EXPLORING: +0.10,
          LOOPING: +0.15,
          INIT: +0.05,
        },
        loopJaccard: loopSessions.length > 0 ? 0.6 - (loopSessions.length / total) * 0.1 : 0.6,
        closureConfidence: positiveOutcomes > 0 ? 0.7 - (positiveOutcomes / total) * 0.1 : 0.7,
      }

      db.prepare(`
        INSERT INTO blackbox_calibration (project_id, weights_json, samples_used, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          weights_json = excluded.weights_json,
          samples_used = excluded.samples_used,
          updated_at = excluded.updated_at
      `).run(pid, JSON.stringify(weights), total, new Date().toISOString())

      const tracker = [...trackers.values()].find(t => t.projectId === pid)
      if (tracker) {
        tracker.setCalibratedWeights(weights)
      }

      return { ok: true, project_id: pid, samples: total, weights }
    } catch (err) {
      return reply.code(500).send({ error: `calibration failed: ${err.message}` })
    }
  })

  fastify.get("/api/v1/blackbox/calibration", async (request, reply) => {
    const { project_id } = request.query || {}
    const pid = project_id || "global"
    try {
      const db = getDb()
      const row = db.prepare(
        "SELECT weights_json, samples_used, updated_at FROM blackbox_calibration WHERE project_id = ?"
      ).get(pid)
      if (!row) {
        return { project_id: pid, calibrated: false, message: "no calibration data yet" }
      }
      return {
        project_id: pid,
        calibrated: true,
        weights: JSON.parse(row.weights_json),
        samples_used: row.samples_used,
        updated_at: row.updated_at,
      }
    } catch (err) {
      return reply.code(500).send({ error: `failed to read calibration: ${err.message}` })
    }
  })
}
