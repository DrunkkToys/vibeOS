class PatternStore {
  constructor() {
    this.patterns = { friction: {}, routines: {} }
    this.recentToolEvents = []
    this.MAX_PATTERNS = 50
    this.MAX_RECENT = 20
    this.REPEAT_THRESHOLD = 3
  }

  recordPattern(kind, key, summary, meta = {}) {
    const target = kind === "routine" ? this.patterns.routines : this.patterns.friction
    const now = new Date().toISOString()

    const row = target[key] || {
      kind,
      summary,
      count: 0,
      sessions: [],
      firstSeen: now,
      lastSeen: null,
      meta: {},
    }

    row.count = Number(row.count || 0) + 1
    row.lastSeen = now
    row.sessions = [...new Set([...(row.sessions || []), meta.sessionId || "unknown"])].slice(-10)
    if (meta) {
      row.meta = { ...row.meta, ...meta }
    }

    target[key] = row

    if (Object.keys(target).length > this.MAX_PATTERNS) {
      const sorted = Object.entries(target).sort((a, b) => (a[1].lastSeen || "").localeCompare(b[1].lastSeen || ""))
      const toRemove = sorted.slice(0, Object.keys(target).length - this.MAX_PATTERNS)
      for (const [k] of toRemove) delete target[k]
    }

    return row
  }

  observeToolEvent(toolName, input, output, directory) {
    const normalized = {
      tool: toolName,
      timestamp: Date.now(),
      target: this.extractTarget(toolName, input),
      directory,
    }

    this.recentToolEvents.push(normalized)
    if (this.recentToolEvents.length > this.MAX_RECENT) {
      this.recentToolEvents = this.recentToolEvents.slice(-this.MAX_RECENT)
    }

    const patterns = []

    const repeated = this.detectRepeatedToolCalls()
    if (repeated) {
      patterns.push(this.recordPattern("friction", repeated.key, repeated.summary, { tool: toolName }))
    }

    const verification = this.detectPostEditVerification(output)
    if (verification) {
      patterns.push(this.recordPattern(
        verification.success ? "routine" : "friction",
        verification.key,
        verification.summary,
        { tool: toolName }
      ))
    }

    return patterns
  }

  detectRepeatedToolCalls() {
    if (this.recentToolEvents.length < this.REPEAT_THRESHOLD) return null

    const recent = this.recentToolEvents.slice(-this.REPEAT_THRESHOLD)
    const key = `${recent[0].tool}:${recent[0].target}`

    if (recent.every(e => `${e.tool}:${e.target}` === key)) {
      return {
        key,
        summary: `Repeated ${recent[0].tool} on ${recent[0].target} (${this.REPEAT_THRESHOLD}x)`,
        tool: recent[0].tool,
        target: recent[0].target,
      }
    }

    return null
  }

  detectPostEditVerification(output) {
    if (!output) return null

    const isBuild = /build|compile|lint|typecheck/i.test(output)
    const isSuccess = /success|passed|no errors|0 failed/i.test(output)
    const isFailure = /error|failed|failed|syntax|cannot find/i.test(output)

    if (isBuild) {
      return {
        key: `post_edit_${isSuccess ? "success" : "failure"}`,
        summary: isSuccess ? "Post-edit verification passed" : "Post-edit verification failed",
        success: isSuccess,
      }
    }

    return null
  }

  extractTarget(toolName, input) {
    if (!input) return "unknown"
    if (typeof input === "string") return input.substring(0, 100)
    if (typeof input === "object") {
      return input.filePath || input.file_path || input.command || input.url || JSON.stringify(input).substring(0, 100)
    }
    return "unknown"
  }

  getPatterns(kind = null) {
    if (kind === "friction") return Object.values(this.patterns.friction)
    if (kind === "routine") return Object.values(this.patterns.routines)
    return [...Object.values(this.patterns.friction), ...Object.values(this.patterns.routines)]
  }

  getLearnedExploratoryWords() {
    const words = new Set()
    for (const pattern of Object.values(this.patterns.friction)) {
      if (pattern.meta?.firstWord && pattern.count >= 2) {
        words.add(pattern.meta.firstWord)
      }
    }
    return [...words]
  }

  clear() {
    this.patterns = { friction: {}, routines: {} }
    this.recentToolEvents = []
  }

  toJSON() {
    return {
      friction: this.patterns.friction,
      routines: this.patterns.routines,
      recent_events: this.recentToolEvents.length,
    }
  }
}

export { PatternStore }
