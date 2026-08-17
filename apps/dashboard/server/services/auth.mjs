// PICC local auth — fully self-hosted accounts.
// Users and session tokens live in server/data as JSON (scrypt-hashed
// passwords). No external identity provider is required.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import { mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
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

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

async function writeJSON(file, value) {
  try {
    await writeFile(file, JSON.stringify(value, null, 2), "utf8")
    return true
  } catch (err) {
    // ENOENT happens when the data dir was created after import time (tests,
    // or a fresh machine where the parent was never made). Ensure it exists
    // and retry once instead of silently dropping the write.
    if (err && err.code === "ENOENT") {
      try {
        mkdirSync(dirname(file), { recursive: true })
        await writeFile(file, JSON.stringify(value, null, 2), "utf8")
        return true
      } catch (retryErr) {
        console.warn(`[picc-auth] write failed ${file}:`, retryErr.message)
        return false
      }
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
  await saveUsers(users)

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
  const data = await readJSON(SESSIONS_FILE, { sessions: {} })
  const sessions = data.sessions ?? {}
  sessions[token] = { userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS }
  await writeJSON(SESSIONS_FILE, { sessions })
  return token
}

export async function verifyToken(token) {
  if (!token) return null
  const data = await readJSON(SESSIONS_FILE, { sessions: {} })
  const sessions = data.sessions ?? {}
  const s = sessions[token]
  if (!s) return null
  if (Date.now() > s.expiresAt) {
    delete sessions[token]
    await writeJSON(SESSIONS_FILE, { sessions })
    return null
  }
  return s.userId
}

export async function revokeToken(token) {
  if (!token) return
  const data = await readJSON(SESSIONS_FILE, { sessions: {} })
  const sessions = data.sessions ?? {}
  if (sessions[token]) {
    delete sessions[token]
    await writeJSON(SESSIONS_FILE, { sessions })
  }
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
