// PICC local auth — fully self-hosted accounts.
// Users and session tokens live in server/data as JSON (scrypt-hashed
// passwords). No external identity provider is required.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import { mkdirSync } from "node:fs"
import { chmod, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const DATA_DIR = process.env.PICC_AUTH_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const USERS_FILE = join(DATA_DIR, "users.json")
const SESSIONS_FILE = join(DATA_DIR, "sessions.json")
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

try {
  mkdirSync(DATA_DIR, { recursive: true })
} catch {
  /* already exists */
}

// ── Write lock per file — prevents concurrent JSON writes from clobbering data
const locks = new Map()
async function withLock(file, fn) {
  while (locks.get(file)) await locks.get(file)
  let release
  const p = new Promise((r) => { release = r })
  locks.set(file, p)
  try {
    return await fn()
  } finally {
    locks.delete(file)
    release()
  }
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

// ── Store faults are NOT "no such session" ──────────────────────────────
// readJSON() above folds EVERY error into an empty fallback. For a store that
// merely answers "is this list empty", that is a harmless convenience, but for
// session/user lookup it is a lie: a transient I/O fault (a locked or renamed
// file on Windows, a short read, a truncated write) becomes "this token is
// unknown", and the browser — which treats /api/auth/me as authoritative —
// DELETES a perfectly valid session and bounces the user to /login.
//
// That is not hypothetical: it is the root cause of the WS-6 T10 terminal
// performance spec flaking on a `page.waitForSelector("[data-room='markets']")`
// timeout. The spec seeds one shared account and then drives ~96 room
// transitions; on a loaded host a single unproven answer from /api/auth/me left
// the app rendering the login page, so the markets room marker could never
// appear and the wait burned its full 30s.
//
// readJSONStrict() keeps the two apart. A file that does not exist yet still
// means "nothing stored" (a fresh install is not a fault), but any other read
// or parse failure is reported as AuthStoreUnavailable so the caller can answer
// 503 "could not tell" instead of a false 401.
export class AuthStoreUnavailable extends Error {
  constructor(message) {
    super(message)
    this.name = "AuthStoreUnavailable"
  }
}

export function isAuthStoreUnavailable(err) {
  return Boolean(err) && err.name === "AuthStoreUnavailable"
}

async function readJSONStrict(file, fallback) {
  let raw
  try {
    raw = await readFile(file, "utf8")
  } catch (err) {
    if (err && err.code === "ENOENT") return fallback
    throw new AuthStoreUnavailable(`auth store read failed (${file}): ${err?.message ?? err}`)
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new AuthStoreUnavailable(`auth store parse failed (${file}): ${err?.message ?? err}`)
  }
}

// Atomic tmp+rename persist (repo pattern, cf. notifier.mjs) with a 0600
// mode: users.json/sessions.json hold password hashes and live session
// bearer tokens — a crash mid-write must never truncate the store, and the
// files must not be world-readable on POSIX hosts.
async function writeJSON(file, value) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 })
    await rename(tmp, file)
    // rename keeps the tmp inode mode on POSIX; chmod the final path so a
    // pre-existing world-readable file from an older version is tightened too.
    try {
      await chmod(file, 0o600)
    } catch {
      /* Windows: mode bits are best-effort */
    }
    return true
  } catch (err) {
    // ENOENT happens when the data dir was created after import time (tests,
    // or a fresh machine where the parent was never made). Ensure it exists
    // and retry once instead of silently dropping the write.
    if (err && err.code === "ENOENT") {
      try {
        mkdirSync(dirname(file), { recursive: true })
        await writeFile(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 })
        await rename(tmp, file)
        try {
          await chmod(file, 0o600)
        } catch {
          /* Windows: best-effort */
        }
        return true
      } catch (retryErr) {
        try {
          await import("node:fs/promises").then((fs) => fs.rm(tmp, { force: true }))
        } catch {
          /* ignore cleanup failure */
        }
        console.warn(`[picc-auth] write failed ${file}:`, retryErr.message)
        return false
      }
    }
    try {
      await import("node:fs/promises").then((fs) => fs.rm(tmp, { force: true }))
    } catch {
      /* ignore cleanup failure */
    }
    console.warn(`[picc-auth] write failed ${file}:`, err.message)
    return false
  }
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString("hex")
}

function verifyPassword(password, salt, hash) {
  try {
    const a = Buffer.from(hashPassword(password, salt), "hex")
    const b = Buffer.from(hash, "hex")
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name ?? "", createdAt: u.createdAt }
}

async function listUsers() {
  const data = await readJSON(USERS_FILE, { users: [] })
  return Array.isArray(data.users) ? data.users : []
}

async function saveUsers(users) {
  await writeJSON(USERS_FILE, { users })
}

/** True once at least one local account exists (first-run hint for the UI). */
export async function hasUsers() {
  return (await listUsers()).length > 0
}

export async function createAccount({ email, password, name }) {
  const em = String(email ?? "").trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return { error: "A valid email address is required." }
  if (typeof password !== "string" || password.length < 8) {
    return { error: "Password must be at least 8 characters." }
  }
  const users = await listUsers()
  if (users.some((u) => u.email === em)) return { error: "An account with this email already exists." }

  const id = randomBytes(12).toString("hex")
  const salt = randomBytes(16).toString("hex")
  users.push({
    id,
    email: em,
    name: String(name ?? "").trim().slice(0, 80),
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date().toISOString()
  })
  await withLock(USERS_FILE, () => saveUsers(users))

  const token = await createSession(id)
  return { user: publicUser(users[users.length - 1]), token }
}

export async function loginAccount({ email, password }) {
  const em = String(email ?? "").trim().toLowerCase()
  const users = await listUsers()
  const user = users.find((u) => u.email === em)
  if (!user) return { error: "No account found for this email. Create one first." }
  if (typeof password !== "string" || !verifyPassword(password, user.salt, user.passwordHash)) {
    return { error: "Incorrect password." }
  }
  const token = await createSession(user.id)
  return { user: publicUser(user), token }
}

async function createSession(userId) {
  const token = randomBytes(32).toString("hex")
  return withLock(SESSIONS_FILE, async () => {
    const data = await readJSON(SESSIONS_FILE, { sessions: {} })
    const sessions = data.sessions ?? {}
    sessions[token] = { userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS }
    await writeJSON(SESSIONS_FILE, { sessions })
    return token
  })
}

export async function verifyToken(token) {
  if (!token) return null
  const data = await readJSON(SESSIONS_FILE, { sessions: {} })
  const sessions = data.sessions ?? {}
  const s = sessions[token]
  if (!s) return null
  if (Date.now() > s.expiresAt) {
    await withLock(SESSIONS_FILE, async () => {
      const d = await readJSON(SESSIONS_FILE, { sessions: {} })
      const sess = d.sessions ?? {}
      delete sess[token]
      await writeJSON(SESSIONS_FILE, { sessions: sess })
    })
    return null
  }
  return s.userId
}

export async function revokeToken(token) {
  if (!token) return
  await withLock(SESSIONS_FILE, async () => {
    const data = await readJSON(SESSIONS_FILE, { sessions: {} })
    const sessions = data.sessions ?? {}
    if (sessions[token]) {
      delete sessions[token]
      await writeJSON(SESSIONS_FILE, { sessions })
    }
  })
}

export async function getUserById(id) {
  if (!id) return null
  const users = await listUsers()
  const user = users.find((u) => u.id === id)
  return user ? publicUser(user) : null
}

/**
 * Validate a `Bearer <token>` header against the local session store and
 * return the authenticated user id (or null). Replaces the Supabase verifier.
 */
export async function verifyUser(authorizationHeader) {
  if (!authorizationHeader?.startsWith("Bearer ")) return null
  return verifyToken(authorizationHeader.slice(7))
}

/**
 * Resolve a `Bearer <token>` header to its user, keeping "no such session"
 * separate from "the store could not be read".
 *
 * verifyUser() deliberately keeps its null-on-everything contract for the many
 * callers that only need a boolean and must not start throwing. This entry
 * point is for callers — /api/auth/me above all — that must not convert a store
 * fault into a false "not authenticated", because the browser treats that
 * answer as authoritative enough to delete the session.
 *
 * Returns null only when the token genuinely is not valid. Throws
 * AuthStoreUnavailable when the answer could not be determined.
 */
export async function resolveAuthUser(authorizationHeader) {
  if (!authorizationHeader?.startsWith("Bearer ")) return null
  const token = authorizationHeader.slice(7)
  if (!token) return null

  const sessionData = await readJSONStrict(SESSIONS_FILE, { sessions: {} })
  const session = (sessionData.sessions ?? {})[token]
  if (!session) return null
  // Read-only expiry check: an expired token is a genuine 401, and the cleanup
  // write stays on verifyToken()'s locked path rather than racing it here.
  if (Date.now() > session.expiresAt) return null

  const userData = await readJSONStrict(USERS_FILE, { users: [] })
  const users = Array.isArray(userData.users) ? userData.users : []
  const user = users.find((u) => u.id === session.userId)
  return user ? publicUser(user) : null
}
