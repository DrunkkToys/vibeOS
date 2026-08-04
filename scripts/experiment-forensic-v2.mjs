#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// Experiment v2: STATIC vs DYNAMIC (FORENSIC) system prompt injection
// 30 scenarios x 2 variants x 4 runs = 240 API calls
// Mann-Whitney U test, FORENSIC-specific metrics
//
// Usage: DEEPSEEK_API_KEY=sk-xxx node scripts/experiment-forensic-v2.mjs

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs"
import { resolve, dirname, join } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const HOME = homedir()
const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(__dirname, "..")
const RESULTS_LOG = join(HOME, ".vibeos", "experiment-forensic-v2-results.jsonl")
const REPORT_DIR = join(HOME, ".vibeos", "reports")
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z"
const REPORT_PATH = join(REPORT_DIR, `experiment-forensic-v2-${ts}.json`)

const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) { console.error("FATAL: DEEPSEEK_API_KEY not set"); process.exit(1) }

// ===== SCENARIOS (30) =====
const SCENARIOS = [
  // --- EXISTING from experiment-scenarios.json (8) ---
  { id: "api-authenticate",       domain: "api",      complexity: "medium", prompt: "Create an Express.js auth middleware in TypeScript that validates JWT tokens from the Authorization header, attaches user ID to req.user, returns 401 if missing/expired/invalid. Include proper types and error handling." },
  { id: "refactor-extract-fn",    domain: "refactor", complexity: "medium", prompt: "Refactor this TypeScript function by extracting validation and formatting into separate pure functions while preserving the public API:\nfunction processOrder(order: { items: { price: number; qty: number }[]; tax: number; discount: number }): string {\n  if (!order.items || !Array.isArray(order.items)) throw new Error('Invalid items');\n  if (order.items.length === 0) throw new Error('No items');\n  if (typeof order.tax !== 'number' || order.tax < 0) throw new Error('Invalid tax');\n  let subtotal = 0;\n  for (const item of order.items) {\n    if (typeof item.price !== 'number' || item.price < 0) throw new Error('Invalid price');\n    if (typeof item.qty !== 'number' || item.qty < 0) throw new Error('Invalid qty');\n    subtotal += item.price * item.qty;\n  }\n  const total = subtotal + subtotal * order.tax - order.discount;\n  return '$' + total.toFixed(2);\n}" },
  { id: "api-rate-limiter",        domain: "api",      complexity: "hard",   prompt: "Implement a sliding window rate limiter for Express.js in TypeScript: 1) limit N requests per window per IP, 2) in-memory Map store, 3) return 429 with Retry-After, 4) auto-cleanup expired entries, 5) export as createRateLimiter(windowMs, maxRequests). Include comprehensive tests." },
  { id: "arch-rest-api-tasks",     domain: "arch",     complexity: "hard",   prompt: "Design a multi-file REST API for a task manager in TypeScript. Files: types.ts (Task interface), store.ts (in-memory TaskStore with async CRUD + crypto.randomUUID()), middleware/validateTask.ts (validate title 3-200 chars, status, priority), routes.ts (Express Router: GET/POST/PATCH/DELETE /tasks), app.ts (Express app, CORS, error handler). Return ALL 5 complete files." },
  { id: "systems-task-runner",     domain: "systems",  complexity: "hard",   prompt: "Implement a concurrent task runner in TypeScript: accept async tasks + concurrency limit N, run N simultaneously via semaphore, collect results in order, cancel remaining on reject, support AbortSignal, TaskRunner class with run/cancel/status(). Use generics TaskRunner<T>. Include tests for all edge cases." },
  { id: "refactor-monolith-split", domain: "refactor", complexity: "hard",   prompt: "Split this monolith into models/user.ts, utils/validation.ts, repositories/userRepository.ts, services/userService.ts. The monolith has User interface, 3 validators, 5 DB functions, 4 service functions. Preserve ALL behavior, proper imports/exports. Return 4 files:\ninterface User { id: string; username: string; email: string; passwordHash: string; createdAt: Date }\nfunction isValidEmail(email: string): boolean { return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) }\nfunction isStrongPassword(pw: string): boolean { return pw.length >= 8 && /[A-Z]/.test(pw) && /[0-9]/.test(pw) }\nfunction isValidUsername(u: string): boolean { return u.length >= 3 && u.length <= 30 && /^[a-zA-Z0-9_]+$/.test(u) }\nconst userDB: Map<string, User> = new Map()\nasync function findById(id: string): Promise<User | undefined> { return Promise.resolve(userDB.get(id)) }\nasync function findByEmail(email: string): Promise<User | undefined> { for (const u of userDB.values()) { if (u.email === email) return u } return undefined }\nasync function createUser(user: User): Promise<User> { userDB.set(user.id, user); return user }\nasync function updateUser(id: string, updates: Partial<User>): Promise<User | undefined> { const u = userDB.get(id); if (!u) return undefined; Object.assign(u, updates); return u }\nasync function deleteUser(id: string): Promise<boolean> { return userDB.delete(id) }\nasync function registerUser(username: string, email: string, password: string): Promise<User> { if (!isValidEmail(email)) throw new Error('Invalid email'); if (!isStrongPassword(password)) throw new Error('Weak password'); if (!isValidUsername(username)) throw new Error('Invalid username'); const id = crypto.randomUUID(); const u: User = { id, username, email, passwordHash: password, createdAt: new Date() }; return createUser(u) }" },
  { id: "arch-state-machine",      domain: "arch",     complexity: "hard",   prompt: "Implement a type-safe finite state machine in TypeScript. Generic over S (string) and E (string). Accept transitions map Record<S, Partial<Record<E, S>>>. Methods: transition(event), can(event), onEnter/onExit/onTransition callbacks, getHistory(), reset(), getState(). TypeScript must catch invalid state/event at compile time. Handle edge cases: same-state transitions, empty map. Tests required." },
  { id: "algorithm-dijkstra",      domain: "algorithm",complexity: "hard",   prompt: "Implement Dijkstra's shortest path in TypeScript. Accept adjacency list Map<string, Array<{node: string; weight: number}>>. Return {path: string[], distance: number} | null. Use BinaryHeap (implement yourself). Handle: empty graph, start=end, disconnected, negative weights (throw), cycles. Generics BinaryHeap<T>. JSDoc. Tests for all edge cases." },

  // --- EXISTING from experiment-scenarios-token-latency.json (6) ---
  { id: "short-qa-tcp-udp",       domain: "general",  complexity: "easy",   prompt: "What is the difference between TCP and UDP? Answer in 2-3 sentences." },
  { id: "medium-explain-raft",    domain: "arch",     complexity: "medium", prompt: "Explain how a distributed consensus algorithm like Raft works. Include leader election, log replication, and safety properties. Write ~500 words." },
  { id: "short-math-primes",      domain: "algorithm",complexity: "easy",   prompt: "Calculate the sum of all prime numbers between 1 and 100. Show your work." },
  { id: "medium-architecture-docs",domain: "arch",    complexity: "medium", prompt: "Design the architecture for a real-time collaborative document editor (like Google Docs). Cover: OT vs CRDT, WebSocket mesh, persistence, conflict resolution, cursor sync. ~500 words." },
  { id: "long-codegen-lru",       domain: "systems",  complexity: "hard",   prompt: "Implement a complete LRU cache in TypeScript with generics, O(1) get/put, expiration TTL, event emitter for evictions, and comprehensive error handling. Include JSDoc. ~200 lines." },
  { id: "long-api-design-saas",   domain: "api",      complexity: "hard",   prompt: "Design a complete REST API for a multi-tenant SaaS platform. Include: JWT auth, RBAC with 3 roles, CRUD for 4 entities, rate limiting, pagination, soft delete, audit logging, webhooks. Write OpenAPI 3.0 spec in YAML." },

  // --- NEW FORENSIC-TARGETED SCENARIOS (16) ---
  { id: "race-condition-debug",       domain: "debug",    complexity: "hard", prompt: "Analyze this TypeScript code for race conditions. The code has a shared counter, two async operations that increment it, and a timer that reads it. Identify ALL race conditions, explain the exact execution sequence that causes each one, and provide a corrected version:\n\nlet counter = 0;\nasync function increment() {\n  const current = counter;\n  await new Promise(r => setTimeout(r, Math.random() * 100));\n  counter = current + 1;\n}\nasync function run() {\n  await Promise.all([increment(), increment(), increment()]);\n  console.log(counter); // Expected: 3, but sometimes 1 or 2\n}\nfunction startTimer() {\n  setInterval(() => console.log('Counter:', counter), 50);\n}" },
  { id: "security-vuln-audit",       domain: "security",  complexity: "hard", prompt: "Audit this TypeScript Express app for ALL security vulnerabilities. For each finding: 1) describe the attack vector, 2) explain the impact, 3) provide the fixed code. Consider: SQL injection, XSS, CSRF, prototype pollution, mass assignment, path traversal, insecure deserialization, SSRF, command injection, and auth bypass:\n\nconst express = require('express');\nconst app = express();\nconst db = { query: (sql, cb) => cb(null, eval(sql)) };\napp.get('/user', (req, res) => {\n  const id = req.query.id;\n  db.query('SELECT * FROM users WHERE id = ' + id, (err, rows) => {\n    res.send(`<html><body>User: ${rows[0]?.name || 'not found'}</body></html>`);\n  });\n});\napp.post('/update', (req, res) => {\n  const user = JSON.parse(req.body);\n  db.query('UPDATE users SET name = \"' + user.name + '\" WHERE id = ' + user.id);\n  res.redirect('/user?id=' + user.id);\n});\napp.get('/files', (req, res) => {\n  res.sendFile('/data/uploads/' + req.query.path);\n});\napp.listen(3000);" },
  { id: "production-incident-rca",   domain: "debug",    complexity: "hard", prompt: "A production incident: users are intermittently getting 500 errors when placing orders, but only during peak hours (10am-2pm). The error logs show 'ETIMEDOUT' from the payment gateway and 'ECONNRESET' from the database. Analyze step by step:\n\n1) What are the possible root causes? List ALL hypotheses.\n2) For each hypothesis, what evidence would confirm or rule it out?\n3) Which hypothesis is MOST likely and why?\n4) What immediate mitigation would you apply?\n5) What permanent fix would you implement?\n\nArchitecture: Node.js API (single process) -> PostgreSQL (pool: 10 connections) -> Stripe API. Nginx reverse proxy with 30s timeout. redis session store. Deployment: 2x t3.medium EC2 behind ALB." },
  { id: "architectural-tradeoff",    domain: "arch",     complexity: "hard", prompt: "You need to design the event ingestion pipeline for a real-time analytics platform processing 50k events/second. Evaluate 3 architectural approaches:\n\nApproach A: Kafka -> Flink -> S3 (batch processing, exactly-once semantics)\nApproach B: RabbitMQ -> Node.js workers -> PostgreSQL (simpler stack, at-least-once)\nApproach C: Kinesis -> Lambda -> DynamoDB (serverless, auto-scaling, eventually consistent)\n\nFor each approach, analyze:\n- Throughput ceiling and scaling characteristics\n- Consistency guarantees and data loss risk\n- Operational complexity and cost at 50k events/s\n- Latency P50/P99 from ingestion to queryable\n- Failure modes and recovery strategies\n- Team skill requirements\n\nRecommend the best approach with explicit trade-off documentation." },
  { id: "memory-leak-investigation", domain: "debug",    complexity: "hard", prompt: "A Node.js process grows to 2GB RSS after 24 hours and gets OOM-killed. The heap snapshot shows 800k instances of a class called 'RequestHandler'. Analyze this code for ALL memory leaks:\n\nclass RequestHandler {\n  constructor(url) {\n    this.url = url;\n    this.startTime = Date.now();\n    this.buffer = Buffer.alloc(4096);\n  }\n  process(callback) {\n    setTimeout(() => {\n      this.result = 'done';\n      callback(null, this.result);\n    }, 100);\n  }\n}\n\nconst http = require('http');\nconst server = http.createServer((req, res) => {\n  if (req.url === '/metrics') {\n    const handler = new RequestHandler(req.url);\n    handler.process((err, result) => {\n      res.end(result);\n    });\n  }\n});\nserver.listen(3000);\n\nFor each leak found: explain WHY it leaks, trace the GC root path, provide the fix." },
  { id: "code-review-security",      domain: "audit",    complexity: "hard", prompt: "Code review this payment processing module. Find ALL bugs, security issues, and anti-patterns. Classify each as CRITICAL/HIGH/MEDIUM/LOW. For each finding, explain: impact, exploit scenario, and fix:\n\nimport crypto from 'crypto'; import https from 'https';\nfunction processPayment(cardNumber, expiry, cvv, amount, callback) {\n  const payload = JSON.stringify({ cc: cardNumber, exp: expiry, cvv, amount: amount * 100 });\n  const key = Buffer.from('my-secret-key-123', 'utf-8').toString('base64');\n  const cipher = crypto.createCipher('aes-128-cbc', key);\n  let encrypted = cipher.update(payload, 'utf8', 'hex');\n  encrypted += cipher.final('hex');\n  const req = https.request({ hostname: 'payment.internal', method: 'POST', headers: { 'Content-Length': encrypted.length } }, (res) => {\n    let data = '';\n    res.on('data', chunk => data += chunk);\n    res.on('end', () => {\n      if (res.statusCode === 200) {\n        console.log('Payment succeeded for card ending in ' + cardNumber.slice(-4));\n        fs.appendFileSync('payments.log', JSON.stringify({card: cardNumber.slice(-4), amount, time: Date.now()}) + '\\n');\n        callback(null, JSON.parse(data));\n      } else callback(new Error('Payment failed: ' + data));\n    });\n  });\n  req.write(encrypted); req.end();\n}\nmodule.exports = { processPayment };" },
  { id: "performance-bottleneck",    domain: "systems",  complexity: "hard", prompt: "Diagnose the performance bottleneck in this data processing pipeline. The pipeline processes 100k records but takes 45 seconds. Find ALL bottlenecks, explain the root cause of each, and provide optimized code:\n\nasync function processRecords(records) {\n  const results = [];\n  for (const record of records) {\n    const enriched = await enrichFromAPI(record);\n    const validated = await validateSchema(enriched);\n    const transformed = transformRecord(validated);\n    const stored = await db.insert(transformed);\n    results.push(stored);\n  }\n  return results;\n}\n\nasync function enrichFromAPI(record) {\n  const resp = await fetch('https://api.example.com/enrich/' + record.id);\n  return { ...record, ...(await resp.json()) };\n}\n\nasync function validateSchema(data) {\n  const errors = [];\n  for (const [key, validator] of Object.entries(schema)) {\n    if (!validator(data[key])) errors.push(key);\n  }\n  return errors.length === 0 ? data : Promise.reject(errors);\n}\n\nfunction transformRecord(record) {\n  const copy = JSON.parse(JSON.stringify(record));\n  copy.processedAt = Date.now();\n  copy.batchId = uuid.v4();\n  const result = heavyComputation(copy);\n  return result;\n}\n\nfunction heavyComputation(data) {\n  let result = 0;\n  for (let i = 0; i < 10000; i++) {\n    result += Math.sqrt(data.value * i) * Math.sin(i);\n  }\n  return { ...data, score: result };\n}\n\nasync function db.insert(data) {\n  return new Promise((resolve, reject) => {\n    pool.query('INSERT INTO records SET ?', data, (err) => {\n      if (err) reject(err); else resolve(data);\n    });\n  });\n}" },
  { id: "compiler-error-chain",      domain: "debug",    complexity: "hard", prompt: "Trace this TypeScript compiler error chain. The user gets this error when building: 'Type 'string | undefined' is not assignable to type 'string'.' But the actual root cause is deeper. Trace through ALL intermediate types, generics, and conditional types to explain exactly why the error manifests here and not at the actual source:\n\ninterface ApiResponse<T> {\n  data: T;\n  error?: string;\n  meta: { page: number; total: number };\n}\n\ninterface User {\n  id: string;\n  name: string;\n  email?: string;\n  profile?: { avatar: string; bio: string };\n}\n\nfunction getField<T, K extends keyof T>(obj: T, key: K): T[K] {\n  return obj[key];\n}\n\nasync function fetchUser(id: string): Promise<ApiResponse<User>> {\n  const resp = await fetch('/users/' + id);\n  return resp.json();\n}\n\nasync function displayUserName(id: string) {\n  const response = await fetchUser(id);\n  const user = response.data;\n  const name = getField(user, 'name');\n  const email = getField(user, 'email');\n  return formatDisplay(name, email);\n}\n\nfunction formatDisplay(name: string, email?: string): string {\n  return email ? `${name} <${email}>` : name;\n}" },
  { id: "refactor-preserve-behavior",domain: "arch",     complexity: "hard", prompt: "Refactor this callback-based code to use async/await WHILE preserving exact behavior including error propagation, timing, and edge cases. For every transformation, explain WHY the behavior is preserved. List all potential behavioral changes you considered and dismissed:\n\nfunction fetchDataWithRetry(url, maxRetries, backoffMs, callback) {\n  let attempt = 0;\n  function doFetch() {\n    attempt++;\n    fetch(url)\n      .then(resp => {\n        if (resp.status === 429 && attempt <= maxRetries) {\n          const retryAfter = parseInt(resp.headers.get('Retry-After') || backoffMs);\n          return new Promise(r => setTimeout(() => {\n            console.log(`Retry ${attempt}/${maxRetries}`);\n            r(doFetch());\n          }, retryAfter * 1000));\n        }\n        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);\n        return resp.json();\n      })\n      .then(data => callback(null, data))\n      .catch(err => {\n        if (attempt <= maxRetries && err.message !== 'HTTP 429') {\n          const delay = backoffMs * Math.pow(2, attempt - 1);\n          return new Promise(r => setTimeout(() => {\n            console.log(`Retry ${attempt}/${maxRetries} after ${delay}ms`);\n            r(doFetch());\n          }, delay));\n        }\n        callback(err);\n      });\n  }\n  doFetch();\n}" },
  { id: "api-conflicting-requirements",domain:"arch",    complexity:"hard", prompt:"Design an API endpoint that reconciles these conflicting requirements:\n\n1. GET /api/orders must return paginated results (page, limit query params)\n2. Results must be filterable by status, dateRange, customerId, minAmount simultaneously\n3. Results must be sortable by any field in either direction\n4. The endpoint must respond in <200ms P99\n5. The orders table has 10M+ rows\n6. The response must include computed fields: totalAmount (aggregated from line items), daysSinceOrder, and a relevanceScore for search queries\n7. Each result must include a summary of recent activity (last 5 events)\n8. The endpoint must NOT expose raw DB queries or implementation details\n9. Must support both REST and GraphQL consumers\n10. Must cache aggressively but invalidate on order changes\n\nProvide: the endpoint implementation, the database indexing strategy, the caching approach, and the trade-off analysis for each design decision." },
  { id: "concurrency-deadlock",      domain: "debug",    complexity: "hard", prompt: "Analyze this TypeScript code for ALL deadlock scenarios. For each: 1) show the exact thread interleaving that causes deadlock, 2) explain why it's a deadlock (not livelock or starvation), 3) provide the fix:\n\nclass Account {\n  constructor(public id: string, public balance: number) {}\n  private mutex = Promise.resolve();\n  async transfer(to: Account, amount: number): Promise<void> {\n    await this.acquire();\n    await to.acquire();\n    if (this.balance < amount) {\n      this.release(); to.release();\n      throw new Error('Insufficient funds');\n    }\n    this.balance -= amount;\n    to.balance += amount;\n    this.release(); to.release();\n  }\n  async acquire(): Promise<void> {\n    this.mutex = this.mutex.then(() => new Promise<void>(resolve => {\n      setTimeout(resolve, Math.random() * 10);\n    }));\n    return this.mutex;\n  }\n  release(): void {}\n}\n\nasync function simulate() {\n  const a = new Account('A', 100);\n  const b = new Account('B', 100);\n  await Promise.all([a.transfer(b, 50), b.transfer(a, 30)]);\n  console.log('Done', a.balance, b.balance);\n}" },
  { id: "data-integrity-violation", domain: "security", complexity: "hard", prompt: "Analyze this order processing system for data integrity violations. For each: describe the exact race condition or edge case, the resulting data corruption, and how to fix it:\n\nlet orderCounter = 0;\nasync function createOrder(userId: string, items: Array<{productId: string; qty: number}>, callback: (err: any, order?: any) => void) {\n  const stockOk = await checkStock(items);\n  if (!stockOk) return callback(new Error('Stock insufficient'));\n  const total = await calculateTotal(items);\n  const paymentOk = await processPayment(userId, total);\n  if (!paymentOk) return callback(new Error('Payment failed'));\n  const order = {\n    id: ++orderCounter,\n    userId,\n    items,\n    total,\n    status: 'confirmed',\n    createdAt: new Date()\n  };\n  await deductStock(items);\n  await saveOrder(order);\n  await enqueueFulfillment(order);\n  callback(null, order);\n}\n\n// Called concurrently by many requests\napp.post('/orders', (req, res) => {\n  createOrder(req.user.id, req.body.items, (err, order) => {\n    if (err) return res.status(400).json({ error: err.message });\n    res.status(201).json(order);\n  });\n});\n\nasync function checkStock(items) { /* queries DB */ return true; }\nasync function deductStock(items) { /* updates DB */ }\nasync function saveOrder(order) { /* inserts into DB */ }\nasync function enqueueFulfillment(order) { /* pushes to queue */ }\nasync function processPayment(userId, total) { /* calls payment API */ return true; }\nasync function calculateTotal(items) { /* calculates */ return 100; }" },
  { id: "dependency-conflict",       domain: "systems",  complexity: "hard", prompt: "A monorepo has 3 packages that share dependencies but require different versions:\n\npackages/core/package.json:\n  react: ^17.0.0\n  react-router: ^5.2.0\n  immer: ^9.0.0\n\npackages/admin/package.json:\n  react: ^18.2.0\n  react-router: ^6.8.0\n  @mui/material: ^5.11.0\n(peers: react ^17.0.0 || ^18.0.0)\n\npackages/dashboard/package.json:\n  react: ^18.2.0\n  react-router: ^6.8.0\n  react-dom: ^18.2.0\n  recharts: ^2.4.0\n(peers: react ^16.0.0 || ^17.0.0 || ^18.0.0, react-dom ^16.0.0 || ^17.0.0 || ^18.0.0)\n\nAnalyze the conflict matrix: which packages conflict? What hoisting strategy resolves it? What if using pnpm vs yarn v1 vs npm v9? List ALL possible resolution strategies ranked by correctness, then recommend the best one with full rationale." },
  { id: "auth-flow-audit",            domain: "security", complexity: "hard", prompt: "Audit this authentication flow for ALL vulnerabilities and logic flaws. For each: attack scenario, impact, and fix:\n\nconst sessions = new Map();\napp.post('/login', async (req, res) => {\n  const { username, password } = req.body;\n  const user = await db.query(`SELECT * FROM users WHERE username = '${username}'`);\n  if (!user || password !== user.password) {\n    return res.status(401).json({ error: 'Invalid credentials' });\n  }\n  const token = crypto.randomBytes(32).toString('hex');\n  sessions.set(token, { userId: user.id, role: user.role, expires: Date.now() + 86400000 });\n  res.cookie('session', token, { httpOnly: true, secure: true, sameSite: 'Strict' });\n  res.json({ token });\n});\napp.get('/api/admin/users', async (req, res) => {\n  const token = req.cookies?.session || req.headers.authorization?.split(' ')[1];\n  const session = sessions.get(token);\n  if (!session || session.expires < Date.now()) return res.status(401).json({ error: 'Unauthorized' });\n  const users = await db.query('SELECT id, username, role, password FROM users');\n  res.json(users);\n});\napp.post('/logout', (req, res) => {\n  const token = req.cookies?.session;\n  sessions.delete(token);\n  res.clearCookie('session');\n  res.json({ ok: true });\n});\napp.post('/reset-password', async (req, res) => {\n  const { email, newPassword } = req.body;\n  await db.query(`UPDATE users SET password = '${newPassword}' WHERE email = '${email}'`);\n  res.json({ ok: true });\n});" },
  { id: "state-corruption-analysis", domain: "debug",    complexity: "hard", prompt: "A React application has a state corruption bug where the UI shows stale data after navigation. Trace the exact data flow to find ALL root causes:\n\n// store.ts\nconst globalState = { users: [], selectedUserId: null, lastFetch: null };\nconst subscribers = new Set();\nexport function getState() { return globalState; }\nexport function setState(updates) { Object.assign(globalState, updates); subscribers.forEach(fn => fn()); }\nexport function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }\n\n// UserList.tsx\nfunction UserList() {\n  const [users, setUsers] = useState(getState().users);\n  useEffect(() => {\n    const unsub = subscribe(() => setUsers(getState().users));\n    fetchUsers();\n    return unsub;\n  }, []);\n  function fetchUsers() { api.get('/users').then(data => setState({ users: data })); }\n  return <div>{users.map(u => <UserRow key={u.id} user={u} />)}</div>;\n}\n\n// UserDetail.tsx\nfunction UserDetail({ userId }) {\n  const [user, setUser] = useState(null);\n  const [loading, setLoading] = useState(true);\n  useEffect(() => {\n    setLoading(true);\n    setState({ selectedUserId: userId });\n    api.get('/users/' + userId).then(data => { setUser(data); setLoading(false); });\n  }, [userId]);\n  if (loading) return <Spinner />;\n  return <div>{user.name} ({user.email})</div>;\n}\n\nBugs: rapid navigation between users sometimes shows wrong data, memory grows over time.\n\nTrace the execution for: UserList -> click user 1 -> UserDetail(1) -> back -> click user 2 -> UserDetail(2). Show exact state after each step." },
  { id: "distributed-system-failure", domain: "systems",  complexity: "hard", prompt: "A distributed system has an intermittent failure. Service A calls Service B calls Service C calls Service D. Sometimes the request succeeds, sometimes it fails with 'context deadline exceeded' after 30s, sometimes with 'broken pipe', and sometimes with 'connection refused'. Analyze the failure scenarios:\n\nArchitecture:\n- Service A (Node.js, 2 instances) -> HTTP -> Service B (Go, 3 instances) -> gRPC -> Service C (Python, 2 instances) -> HTTP -> Service D (Rust, 1 instance)\n- Each service has a 10s timeout for downstream calls (A:10s, B:10s, C:10s, D:N/A)\n- Client timeout from caller of A: 35s\n- All services run on Kubernetes with resource limits (CPU: 500m, Memory: 512Mi)\n- Service D is a singleton due to stateful storage\n- Service C batch-processes requests internally with a 5-item queue\n\nGiven failure symptoms:\n1) Requests fail with 'context deadline exceeded' at 30s (95% of failures)\n2) Requests fail with 'broken pipe' (3% of failures)\n3) Requests fail with 'connection refused' (2% of failures)\n4) All failures happen during peak hours (11am-1pm)\n5) Memory usage in Service C grows steadily during peak hours\n\nDiagnose: For each symptom, what is the most likely root cause? How would you confirm each? What is the fix?" },
  { id: "deployment-rollback-analysis",domain:"audit",   complexity:"hard", prompt:"A deployment caused a partial outage. Analyze the timeline and determine root cause. Identify ALL contributing factors and provide a remediation plan:\n\nTimeline:\n- 09:00: Deploy v2.1.0 to canary (10% traffic)\n- 09:15: Canary looks healthy (P50 latency normal, error rate flat)\n- 09:20: Rollout to 50%\n- 09:25: Error rate spikes from 0.1% to 3.5%. P50 latency jumps from 45ms to 320ms.\n- 09:26: Auto-rollback triggered. Rollback to v2.0.9.\n- 09:30: Error rate back to 0.1%.\n- 09:35: Team inspects logs. New code has a change from 'SELECT * FROM orders WHERE user_id = ?' to 'SELECT * FROM orders JOIN line_items ON orders.id = line_items.order_id WHERE user_id = ?'\n- 09:40: The JOIN caused a full table scan on line_items (no index on order_id). v2.0.9 was released 2 weeks prior and was not the previous version.\n- 09:45: They realize the rollback actually rolled back to v2.0.8, which uses the old query but has a different API contract (returns camelCase vs snake_case).\n- 09:50: Frontend starts failing because v2.0.8 returns snake_case but the frontend expects camelCase.\n- 10:00: Full outage declared.\n- 10:15: Emergency fix deployed: v2.1.1 with the original query + migration script to add index.\n- 10:30: All systems green.\n\nIdentify: Primary root cause, secondary contributing factors, rollback process failure, monitoring gaps, and process improvements." },
].map((s, i) => ({ ...s, order: i }))

// ===== FORENSIC DIRECTIVE =====
const FORENSIC_DIRECTIVE = [
  "[forensic mode] This response uses FORENSIC analysis depth:",
  "- Evidence-based: trace each decision and claim to its justification and source",
  "- Multi-hypothesis: consider 2+ competing explanations or approaches before converging",
  "- Explicit uncertainty: flag assumptions, trade-offs, limitations, and unknown edge cases",
  "- Structured output: organize with clear sections, reasoning traces, and explicit documentation",
  "- Thorough verification: validate all assumptions, handle all edge cases, cover all failure modes",
].join("\n")

// FORENSIC domains — where multi-hypothesis, evidence-tracing, uncertainty-counting matter
const FORENSIC_DOMAINS = new Set(["debug", "security", "audit", "arch"])

// ===== SYSTEM PROMPT BUILDERS =====
function buildStaticSystemPrompt() {
  return [
    "[context7] Use context7 for library/framework docs — saves ~$0.06/turn.",
    "[batch execution] When running multiple independent operations, invoke them ALL in parallel.",
    "[project guard] AGENTS.md and README.md are protected. Do NOT modify without permission.",
    "[orchestrator] Delegate implementation work to Task subagents. Your role: verify and synthesize.",
    "[code quality] Write production-grade code with proper error handling, types, and tests.",
  ].join("\n")
}

function buildDynamicSystemPrompt(scenario) {
  const base = buildStaticSystemPrompt()
  if (!FORENSIC_DOMAINS.has(scenario.domain)) return base
  return base + "\n\n" + FORENSIC_DIRECTIVE
}

// ===== API CALL =====
async function callDeepSeek(systemPrompt, userPrompt, model = "deepseek-chat") {
  const start = Date.now()
  const url = "https://api.deepseek.com/v1/chat/completions"
  const body = { model, messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], max_tokens: 8192 }
  const resp = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + API_KEY },
    body: JSON.stringify(body),
  })
  const elapsed = Date.now() - start
  if (!resp.ok) {
    const e = await resp.text()
    return { ok: false, elapsed, error: resp.status + ": " + e.slice(0, 200) }
  }
  const data = await resp.json()
  const content = data.choices?.[0]?.message?.content || ""
  return {
    ok: true, elapsed,
    content,
    tokensIn: data.usage?.prompt_tokens || 0,
    tokensOut: data.usage?.completion_tokens || 0,
    finish: data.choices?.[0]?.finish_reason || "unknown",
  }
}

// ===== FORENSIC-SPECIFIC METRICS =====
function forensicMetrics(text) {
  if (!text) return { evidenceDepth: 0, hypothesisCoverage: 0, uncertaintyDisc: 0, structuredOutput: 0, thoroughness: 0 }

  const lower = text.toLowerCase()

  // Evidence depth: traces, citations, justification markers
  const evidencePatterns = /because|since|therefore|implies?|leads?\s+to|traced?\s+to|evidence|prove[ds]?|shown?\s+by|demonstrat|result[eds]?\s+from|follows?\s+from|attributed?\s+to|consequently|due\s+to|owing\s+to/g
  const evidenceMatches = (lower.match(evidencePatterns) || []).length

  // Hypothesis coverage: alternatives, possibilities, competing explanations
  const hypothesisPatterns = /alternativ|hypothes[ei]s|possibility|could\s+be|might\s+be|scenario|if\s+.*then|consider|approach\s+\d|option\s+\d|variant|candidate|maybe|perhaps|potentially|possibly|another\s+(way|approach|path|reason|cause)/g
  const hypothesisMatches = (lower.match(hypothesisPatterns) || []).length

  // Uncertainty disclosure: flags for known unknowns
  const uncertainPatterns = /unknown|uncertain|ambiguous|assumption|trade-?off|limitation|depends?\s+on|not\s+clear|not\s+sure|cannot\s+(determine|confirm|verify)|unclear|insufficient|incomplete|need\s+(more|further)|open\s+question|may\s+not|might\s+not|potential\s+risk|downside|caution/g
  const uncertainMatches = (lower.match(uncertainPatterns) || []).length

  // Structured output: sections, numbered lists, headers
  const structuredPatterns = /^\d+[\.\)]|^#{1,3}\s|^[-*]\s|^[A-Z][a-z]+:|^###|^##|^> /gm
  const structuredMatches = (text.match(structuredPatterns) || []).length

  // Thoroughness: verification, edge cases, error paths
  const thoroughPatterns = /verify|validat|edge\s+case|error\s+(path|handl|case)|failur|except|corner\s+case|boundary|null\s+check|undefin|empty|special\s+case|safe\s+guard|fallback|recovery|rollback/g
  const thoroughMatches = (lower.match(thoroughPatterns) || []).length

  return {
    evidenceDepth: Math.min(1, evidenceMatches / 15),
    hypothesisCoverage: Math.min(1, hypothesisMatches / 12),
    uncertaintyDisc: Math.min(1, uncertainMatches / 10),
    structuredOutput: Math.min(1, structuredMatches / 8),
    thoroughness: Math.min(1, thoroughMatches / 12),
    rawEvidence: evidenceMatches,
    rawHypothesis: hypothesisMatches,
    rawUncertainty: uncertainMatches,
    rawStructured: structuredMatches,
    rawThorough: thoroughMatches,
  }
}

// ===== SCORING =====
function scoreOutput(text) {
  if (!text) return { correctness: 0, completeness: 0, safety: 0, combined: 0, wordCount: 0 }

  const lower = text.toLowerCase()
  const wc = text.split(/\s+/).length
  let correctness = 0.3
  let completeness = 0
  let safety = 1

  // Correctness signals
  if (/error|throw|catch|try/i.test(text)) correctness += 0.15
  if (/return|=>/.test(text)) correctness += 0.1
  if (/function|class|interface/.test(text)) correctness += 0.1
  if (/test|describe|it\s*\(/.test(lower)) correctness += 0.1
  if (/\bPromise\b/.test(text)) correctness += 0.05
  if (/async\s+/.test(text) && /await/.test(lower)) correctness += 0.05

  // Completeness signals
  if (/function|class|const|let|var/.test(text)) completeness += 0.15
  if (/export\s+(default\s+)?(function|class|const)/.test(text)) completeness += 0.15
  if (/: (string|number|boolean|void|any|never|Promise|Record|Partial|Pick)\b/.test(text)) completeness += 0.1
  if (/import/.test(text)) completeness += 0.1
  if (/@param|@returns|JSDoc| \* /.test(text)) completeness += 0.1
  if (/test|describe|it\s*\(/.test(lower)) completeness += 0.15
  if (/\| .+ \|/.test(text)) completeness += 0.05  // table
  if (/^#{1,3}\s/.test(text)) completeness += 0.05  // headers

  // Safety: dangerous patterns
  if (/eval\s*\(/.test(text)) safety -= 0.3
  if (/process\.exit/.test(text) && !/test/i.test(text)) safety -= 0.1
  if (/new\s+Function/.test(text)) safety -= 0.2
  if (/innerHTML/.test(text)) safety -= 0.1
  if (/Buffer\.alloc/.test(text)) safety -= 0.05  // unsafe buffer

  safety = Math.max(0, Math.min(1, safety))
  correctness = Math.min(1, correctness)
  completeness = Math.min(1, completeness)

  const combined = correctness + completeness + safety
  return { correctness, completeness, safety, combined, wordCount: wc }
}

// ===== PERMUTATION TEST (Mann-Whitney U approximation) =====
function permutationPValue(a, b, iterations = 10000) {
  const all = [...a, ...b]
  const observedDiff = mean(a) - mean(b)
  let extreme = 0
  for (let i = 0; i < iterations; i++) {
    // Fisher-Yates shuffle
    for (let j = all.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1))
      ;[all[j], all[k]] = [all[k], all[j]]
    }
    const shufA = all.slice(0, a.length)
    const shufB = all.slice(a.length)
    const diff = mean(shufA) - mean(shufB)
    if (Math.abs(diff) >= Math.abs(observedDiff)) extreme++
  }
  return (extreme + 1) / (iterations + 1)  // +1 for pseudo-count
}

function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0 }

// ===== LOG =====
function logResult(event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n"
  appendFileSync(RESULTS_LOG, line)
}

// ===== MAIN =====
async function main() {
  mkdirSync(REPORT_DIR, { recursive: true })

  const RUNS_PER_VARIANT = 4
  const model = "deepseek-chat"
  const total = SCENARIOS.length * RUNS_PER_VARIANT * 2

  console.log(`=== STATIC vs DYNAMIC (FORENSIC) v2 ===`)
  console.log(`Model: ${model}`)
  console.log(`Scenarios: ${SCENARIOS.length}`)
  console.log(`Runs per variant: ${RUNS_PER_VARIANT}`)
  console.log(`Total API calls: ${total}`)
  console.log(`FORENSIC domains: ${[...FORENSIC_DOMAINS].join(", ")}`)
  console.log(`FORENSIC-targeted scenarios: ${SCENARIOS.filter(s => FORENSIC_DOMAINS.has(s.domain)).length}/${SCENARIOS.length}`)
  console.log(`Log: ${RESULTS_LOG}`)
  console.log(`Report: ${REPORT_PATH}\n`)

  const results = []
  let runNum = 0

  for (let runIdx = 1; runIdx <= RUNS_PER_VARIANT; runIdx++) {
    console.log(`\n--- Run ${runIdx}/${RUNS_PER_VARIANT} ------------------------------`)

    for (const sc of SCENARIOS) {
      const directions = ["Write a thorough response.", "Be comprehensive and cover all aspects.", "Provide a complete analysis.", "Include as much detail as possible."]
      const direction = directions[(runIdx + sc.order) % directions.length]

      for (const variant of ["static", "dynamic"]) {
        runNum++
        const systemPrompt = variant === "static" ? buildStaticSystemPrompt() : buildDynamicSystemPrompt(sc)
        const userPrompt = [sc.prompt, direction].join("\n\n")

        process.stdout.write(`  [${runIdx}.${runNum}] ${sc.id.padEnd(30)} ${variant.padEnd(8)}... `)
        const r = await callDeepSeek(systemPrompt, userPrompt, model)

        if (!r.ok) {
          console.log(`ERR ${r.elapsed}ms`)
          logResult({ event: "forensic-v2", variant, scenario: sc.id, complexity: sc.complexity, domain: sc.domain, run: runIdx, ok: false, error: r.error, latency_ms: r.elapsed })
          results.push({ scenario: sc.id, complexity: sc.complexity, domain: sc.domain, variant, run: runIdx, ok: false })
          continue
        }

        const scores = scoreOutput(r.content)
        const fm = forensicMetrics(r.content)
        const combined = scores.combined
        const forensicScore = (fm.evidenceDepth + fm.hypothesisCoverage + fm.uncertaintyDisc + fm.structuredOutput + fm.thoroughness) / 5

        console.log(`${r.elapsed}ms tok=${r.tokensIn}/${r.tokensOut} score=${combined.toFixed(2)} fscore=${forensicScore.toFixed(2)}`)

        logResult({
          event: "forensic-v2", variant, scenario: sc.id, complexity: sc.complexity, domain: sc.domain, run: runIdx,
          ok: true, latency_ms: r.elapsed, tokens_in: r.tokensIn, tokens_out: r.tokensOut,
          correctness: scores.correctness, completeness: scores.completeness, safety: scores.safety,
          combined_score: combined, forensic_score: forensicScore,
          word_count: scores.wordCount, finish: r.finish,
          ...fm,
        })
        results.push({
          scenario: sc.id, complexity: sc.complexity, domain: sc.domain, variant, run: runIdx,
          ok: true, combined, forensicScore, fm, scores,
          tokensIn: r.tokensIn, tokensOut: r.tokensOut, latency: r.elapsed,
        })
      }
    }
  }

  // ===== ANALYSIS =====
  console.log("\n\n" + "=".repeat(80))
  console.log("RESULTS")
  console.log("=".repeat(80))

  const ok = results.filter(r => r.ok)
  const staticByScr = ok.filter(r => r.variant === "static")
  const dynamicByScr = ok.filter(r => r.variant === "dynamic")

  // --- OVERALL ---
  const groupedByScenarioDOM = {}
  for (const r of ok) {
    const k = r.scenario
    if (!groupedByScenarioDOM[k]) groupedByScenarioDOM[k] = []
    groupedByScenarioDOM[k].push(r)
  }

  console.log(`\nSuccessful runs: ${ok.length}/${results.length}`)
  console.log(`  Static:  ${staticByScr.length}`)
  console.log(`  Dynamic: ${dynamicByScr.length}`)

  // Per-scenario comparison
  console.log(`\n${"SCENARIO".padEnd(28)} ${"DOMAIN".padEnd(10)} ${"CMPLX".padEnd(6)} ${"STATIC".padEnd(10)} ${"DYNAMIC".padEnd(10)} ${"DELTA".padEnd(10)} ${"F-DIFF".padEnd(10)} ${"P-VAL".padEnd(8)}`)
  console.log("-".repeat(90))

  let allStaticCombined = []
  let allDynamicCombined = []
  let allStaticF = []
  let allDynamicF = []

  for (const sc of SCENARIOS) {
    const sResults = staticByScr.filter(r => r.scenario === sc.id)
    const dResults = dynamicByScr.filter(r => r.scenario === sc.id)
    if (sResults.length === 0 || dResults.length === 0) continue

    const sCombined = sResults.map(r => r.combined)
    const dCombined = dResults.map(r => r.combined)
    const sF = sResults.map(r => r.forensicScore)
    const dF = dResults.map(r => r.forensicScore)

    const sMean = mean(sCombined)
    const dMean = mean(dCombined)
    const delta = dMean - sMean
    const fStatic = mean(sF)
    const fDynamic = mean(dF)
    const fDelta = fDynamic - fStatic
    const pVal = permutationPValue(sCombined, dCombined, 2000)

    allStaticCombined.push(...sCombined)
    allDynamicCombined.push(...dCombined)
    allStaticF.push(...sF)
    allDynamicF.push(...dF)

    const sig = pVal < 0.05 ? "*" : ""
    console.log(`${sc.id.padEnd(28)} ${sc.domain.padEnd(10)} ${sc.complexity.padEnd(6)} ${sMean.toFixed(4).padEnd(10)} ${dMean.toFixed(4).padEnd(10)} ${(delta >= 0 ? "+" : "") + delta.toFixed(4).padEnd(9)} ${(fDelta >= 0 ? "+" : "") + fDelta.toFixed(4).padEnd(9)} ${pVal.toFixed(4)}${sig}`)
  }

  // --- OVERALL STATS ---
  const overallStatic = mean(allStaticCombined)
  const overallDynamic = mean(allDynamicCombined)
  const overallDelta = overallDynamic - overallStatic
  const overallP = permutationPValue(allStaticCombined, allDynamicCombined, 10000)
  const overallFStatic = mean(allStaticF)
  const overallFDynamic = mean(allDynamicF)

  console.log("-".repeat(90))
  console.log(`${"OVERALL".padEnd(28)} ${"".padEnd(10)} ${"".padEnd(6)} ${overallStatic.toFixed(4).padEnd(10)} ${overallDynamic.toFixed(4).padEnd(10)} ${(overallDelta >= 0 ? "+" : "") + overallDelta.toFixed(4).padEnd(9)} ${(overallFDynamic - overallFStatic >= 0 ? "+" : "") + (overallFDynamic - overallFStatic).toFixed(4).padEnd(9)} ${overallP.toFixed(4)}`)

  // --- BY DOMAIN ---
  console.log(`\n--- BY DOMAIN ---`)
  console.log(`${"DOMAIN".padEnd(14)} ${"STATIC".padEnd(10)} ${"DYNAMIC".padEnd(10)} ${"DELTA".padEnd(10)} ${"P-VAL".padEnd(8)} ${"RUNS".padEnd(6)}`)
  console.log("-".repeat(60))

  const domains = [...new Set(ok.map(r => r.domain))].sort()
  for (const domain of domains) {
    const s = ok.filter(r => r.variant === "static" && r.domain === domain)
    const d = ok.filter(r => r.variant === "dynamic" && r.domain === domain)
    if (s.length < 2 || d.length < 2) continue
    const sVals = s.map(r => r.combined)
    const dVals = d.map(r => r.combined)
    const sm = mean(sVals), dm = mean(dVals)
    const p = permutationPValue(sVals, dVals, 2000)
    const sig = p < 0.05 ? "*" : ""
    console.log(`${domain.padEnd(14)} ${sm.toFixed(4).padEnd(10)} ${dm.toFixed(4).padEnd(10)} ${(dm - sm >= 0 ? "+" : "") + (dm - sm).toFixed(4).padEnd(9)} ${p.toFixed(4)}${sig} ${s.length + d.length}`)
  }

  // --- FORENSIC METRICS BREAKDOWN ---
  console.log(`\n--- FORENSIC METRICS (dynamic vs static) ---`)
  const metricLabels = ["evidenceDepth", "hypothesisCoverage", "uncertaintyDisc", "structuredOutput", "thoroughness"]
  for (const metric of metricLabels) {
    const sVals = ok.filter(r => r.variant === "static" && r.fm).map(r => r.fm[metric])
    const dVals = ok.filter(r => r.variant === "dynamic" && r.fm).map(r => r.fm[metric])
    if (sVals.length < 2 || dVals.length < 2) continue
    const sm = mean(sVals), dm = mean(dVals)
    const p = permutationPValue(sVals, dVals, 2000)
    const sig = p < 0.05 ? "*" : ""
    console.log(`${metric.padEnd(20)} STATIC=${sm.toFixed(3)} DYNAMIC=${dm.toFixed(3)} DELTA=${(dm - sm >= 0 ? "+" : "") + (dm - sm).toFixed(3)} p=${p.toFixed(4)}${sig}`)
  }

  // --- COST ---
  console.log(`\n--- COST ESTIMATE ---`)
  const deepseekChatPrompt = 0.14 / 1_000_000   // per token
  const deepseekChatComp = 0.56 / 1_000_000
  const totalTokensIn = ok.reduce((s, r) => s + (r.tokensIn || 0), 0)
  const totalTokensOut = ok.reduce((s, r) => s + (r.tokensOut || 0), 0)
  const estCost = totalTokensIn * deepseekChatPrompt + totalTokensOut * deepseekChatComp
  console.log(`Total tokens in:  ${totalTokensIn}`)
  console.log(`Total tokens out: ${totalTokensOut}`)
  console.log(`Estimated cost:   $${estCost.toFixed(4)}`)

  // --- VERDICT ---
  console.log(`\n--- VERDICT ---`)
  let verdict
  if (overallP < 0.01 && overallDelta > 0.05) verdict = "DYNAMIC FORENSIC injection SIGNIFICANTLY BETTER — hypothesis CONFIRMED (p<0.01)"
  else if (overallP < 0.05 && overallDelta > 0.02) verdict = "DYNAMIC FORENSIC injection measurably better — hypothesis CONFIRMED (p<0.05)"
  else if (overallP < 0.1 && overallDelta > 0) verdict = "DYNAMIC FORENSIC injection shows marginal improvement — TENTATIVE (p<0.1)"
  else if (overallDelta < -0.02) verdict = "STATIC injection better — hypothesis REJECTED"
  else verdict = "No significant difference between STATIC and DYNAMIC — INCONCLUSIVE"
  console.log(verdict)

  // Check if FORENSIC domains show stronger signal
  const fDomainsStatic = []
  const fDomainsDynamic = []
  const nonFDomainsStatic = []
  const nonFDomainsDynamic = []
  for (const r of ok) {
    if (FORENSIC_DOMAINS.has(r.domain)) {
      if (r.variant === "static") fDomainsStatic.push(r.combined)
      else fDomainsDynamic.push(r.combined)
    } else {
      if (r.variant === "static") nonFDomainsStatic.push(r.combined)
      else nonFDomainsDynamic.push(r.combined)
    }
  }
  if (fDomainsStatic.length > 2 && fDomainsDynamic.length > 2) {
    const fDelta = mean(fDomainsDynamic) - mean(fDomainsStatic)
    const nfDelta = mean(nonFDomainsDynamic) - mean(nonFDomainsStatic)
    const fP = permutationPValue(fDomainsStatic, fDomainsDynamic, 2000)
    console.log(`\nFORENSIC domains delta:    ${(fDelta >= 0 ? "+" : "") + fDelta.toFixed(4)} (p=${fP.toFixed(4)})`)
    console.log(`Non-FORENSIC domains delta: ${(nfDelta >= 0 ? "+" : "") + nfDelta.toFixed(4)}`)
    if (fDelta > nfDelta + 0.02 && fP < 0.1) {
      console.log("-> FORENSIC directive shows stronger effect in target domains — supports hypothesis")
    }
  }

  // ===== REPORT =====
  const report = {
    meta: {
      generated_at: new Date().toISOString(),
      experiment: "STATIC vs DYNAMIC (FORENSIC) v2 - system prompt injection",
      hypothesis: "Dynamic injection with FORENSIC directive for debug/security/audit/arch domains produces measurably better output quality than static injection across all domains.",
      model, total_calls: results.length, successful: ok.length, errors: results.length - ok.length,
      runs_per_variant: RUNS_PER_VARIANT, total_scenarios: SCENARIOS.length,
      forensic_domains: [...FORENSIC_DOMAINS],
      cost_estimate_usd: estCost,
    },
    verdict,
    overall: {
      static_combined: overallStatic,
      dynamic_combined: overallDynamic,
      delta: overallDelta,
      p_value: overallP,
    },
    forensic_metrics: {},
    by_domain: {},
    by_complexity: {},
    by_scenario: {},
    raw_summary: results.filter(r => r.ok).map(r => ({
      scenario: r.scenario, variant: r.variant, run: r.run,
      combined: r.combined, forensicScore: r.forensicScore,
      tokensIn: r.tokensIn, tokensOut: r.tokensOut, latency: r.latency,
    })),
  }

  for (const metric of metricLabels) {
    const sV = ok.filter(r => r.variant === "static" && r.fm).map(r => r.fm[metric])
    const dV = ok.filter(r => r.variant === "dynamic" && r.fm).map(r => r.fm[metric])
    if (sV.length && dV.length) report.forensic_metrics[metric] = {
      static: mean(sV), dynamic: mean(dV), delta: mean(dV) - mean(sV),
    }
  }

  for (const domain of domains) {
    const s = ok.filter(r => r.variant === "static" && r.domain === domain).map(r => r.combined)
    const d = ok.filter(r => r.variant === "dynamic" && r.domain === domain).map(r => r.combined)
    if (s.length && d.length) report.by_domain[domain] = {
      runs: s.length + d.length,
      static: mean(s), dynamic: mean(d), delta: mean(d) - mean(s),
      p_value: s.length > 2 && d.length > 2 ? permutationPValue(s, d, 2000) : null,
    }
  }

  for (const sc of SCENARIOS) {
    const s = staticByScr.filter(r => r.scenario === sc.id).map(r => r.combined)
    const d = dynamicByScr.filter(r => r.scenario === sc.id).map(r => r.combined)
    if (s.length && d.length) report.by_scenario[sc.id] = {
      domain: sc.domain, complexity: sc.complexity,
      runs: s.length + d.length,
      static: mean(s), dynamic: mean(d), delta: mean(d) - mean(s),
      p_value: s.length > 1 && d.length > 1 ? permutationPValue(s, d, 2000) : null,
    }
  }

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n")
  console.log(`\nReport: ${REPORT_PATH}`)
  console.log(`Log: ${RESULTS_LOG}`)
}

main().catch(err => { console.error(err); process.exit(1) })
