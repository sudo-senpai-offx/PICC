// WS-7 slice C — the users store's READ-MODIFY-WRITE must be atomic.
//
// WHY THIS FILE EXISTS. `createAccount` read users.json OUTSIDE the write lock:
//
//     const users = await readUsersStrict()        // <- outside withLock
//     if (users.some((u) => u.email === em)) return { error: "… already exists." }
//     users.push({ …, passwordHash: hashPassword(password, salt) })
//     const written = await withLock(USERS_FILE, () => saveUsers(users))
//
// so two signups that overlap both load the SAME snapshot, each appends to its
// own copy, and the second writer's whole-file overwrite destroys the first
// account — salt and scrypt password hash included. A password hash is not
// re-obtainable the way a session is: the user is told they have an account,
// cannot log in, and cannot be told which email it was created under.
//
// The window is not narrow. `scryptSync(N=16384)` between the read and the
// locked write costs tens of milliseconds of BLOCKED event loop, and every
// signup that starts in the same tick has already issued its read by then — so
// the two snapshots are reliably identical rather than rarely identical. That is
// why this test fires several at once instead of arranging a two-way race by
// hand: N concurrent calls make the stale snapshot the NORMAL case, not a
// timing accident that a loaded box can hide.
//
// The fix is the shape the rest of auth.mjs already uses for sessions: read,
// decide and write INSIDE one `withLock`, so the snapshot a writer persists is
// the snapshot it read.
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
// WS-7 slice A: the auth store is redirected through the shared contract rather
// than by hand, so a misspelling here fails loudly instead of falling through
// `auth.mjs:10`'s `|| default` and writing real accounts into the live store.
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const DATA_DIR = useIsolatedStoreDir("PICC_AUTH_DATA_DIR", { prefix: "picc-auth-race" })
const USERS = join(DATA_DIR, "users.json")
const SESSIONS = join(DATA_DIR, "sessions.json")

const auth = await import("../services/auth.mjs")
const { createAccount, loginAccount, resolveAuthUser } = auth

const CONCURRENT = 6
const creds = Array.from({ length: CONCURRENT }, (_, i) => ({
  email: `race-${i}@example.test`,
  password: `race-password-${i}-long`,
  name: `Race ${i}`
}))

const usersOnDisk = () => JSON.parse(readFileSync(USERS, "utf8")).users

beforeEach(() => {
  for (const f of [USERS, SESSIONS]) rmSync(f, { force: true })
})

afterEach(() => {
  for (const f of [USERS, SESSIONS]) rmSync(f, { force: true })
})

describe("WS-7 slice C — concurrent signups cannot lose each other's account", () => {
  it("keeps EVERY account when several signups are issued at once", async () => {
    const results = await Promise.all(creds.map((c) => createAccount(c)))

    const missing = results
      .map((r, i) => (r?.token ? null : `signup ${i} (${creds[i].email}): ${r?.error ?? "no result"}`))
      .filter(Boolean)
    expect(missing, "every concurrent signup must be answered with a session").toEqual([])

    const onDisk = usersOnDisk()
    expect(
      onDisk.map((u) => u.email).sort(),
      "a read outside the write lock lets the last writer's whole-file overwrite destroy the " +
        "accounts everyone else's signup had already answered 200 for"
    ).toEqual(creds.map((c) => c.email).sort())
  })

  it("every issued token resolves to the account it was issued for", async () => {
    // The user-visible half of the same defect. A lost account is not just a
    // missing row: the token that was already handed out is live, and it
    // authenticates to nobody — so the browser holds a session it cannot use and
    // /api/auth/me's answer for it is "not authenticated".
    const results = await Promise.all(creds.map((c) => createAccount(c)))

    const mismatched = []
    for (const [i, r] of results.entries()) {
      if (!r?.token) continue
      const who = await resolveAuthUser(`Bearer ${r.token}`)
      if (who?.email !== creds[i].email) {
        mismatched.push(`token ${i} (${creds[i].email}) resolves to ${who?.email ?? "nobody"}`)
      }
    }
    expect(
      mismatched,
      "a token must authenticate to the account that was created with it; a token resolving to " +
        "nobody is the exact state the destroyed-account race produces"
    ).toEqual([])
  })

  it("no concurrent signup destroys another account's PASSWORD HASH", async () => {
    // A lost session is re-obtainable by logging in; a lost password hash is not.
    // So the assertion is not "the row exists" but "the credentials that row was
    // created with still work".
    await Promise.all(creds.map((c) => createAccount(c)))

    const rejected = []
    for (const c of creds) {
      const res = await loginAccount({ email: c.email, password: c.password })
      if (!res?.token) rejected.push(`${c.email}: ${res?.error ?? "no token"}`)
    }
    expect(
      rejected,
      "every account created during the concurrent burst must still be able to log in — a " +
        "destroyed scrypt hash is unrecoverable, unlike a destroyed session"
    ).toEqual([])
  })

  it("two concurrent signups for the SAME email create one account, not two", async () => {
    // The duplicate check is the other half of the same read-modify-write. Read
    // outside the lock, both callers see an empty list, both pass the duplicate
    // test, and both are answered 200 with a live token for the same address.
    const email = "same@example.test"
    const [a, b] = await Promise.all([
      createAccount({ email, password: "same-password-a", name: "A" }),
      createAccount({ email, password: "same-password-b", name: "B" })
    ])

    const answers = [a, b].filter((r) => r?.token)
    expect(
      answers.length,
      `exactly one signup may be answered with a session; got ${answers.length}. ` +
        `A=${JSON.stringify(a)} B=${JSON.stringify(b)}`
    ).toBe(1)
    const refused = [a, b].find((r) => !r?.token)
    expect(
      refused?.error,
      "the losing signup must be refused as a duplicate, not as a store fault or a silent success"
    ).toBe("An account with this email already exists.")
    expect(usersOnDisk().filter((u) => u.email === email)).toHaveLength(1)
  })
})

describe("WS-7 slice C — the single-threaded contract is unchanged", () => {
  it("a lone signup still works, and the store is the shape the reader expects", async () => {
    const res = await createAccount(creds[0])
    expect(res?.token).toBeTruthy()
    expect(res?.user?.email).toBe(creds[0].email)
    // The password material never travels back out.
    expect(JSON.stringify(res)).not.toContain("passwordHash")
    expect(JSON.stringify(res)).not.toContain("salt")
  })

  it("a seeded store is preserved: signup appends, it does not replace", async () => {
    // The pre-existing-row case, so a test that only ever starts from an empty
    // file cannot pass while a normal (non-first-run) install loses its accounts.
    writeFileSync(
      USERS,
      JSON.stringify({
        users: [
          {
            id: "seed",
            email: "seed@example.test",
            name: "Seed",
            salt: "s",
            passwordHash: "h",
            createdAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      }),
      "utf8"
    )
    const res = await createAccount(creds[0])
    expect(res?.token).toBeTruthy()
    expect(usersOnDisk().map((u) => u.email).sort()).toEqual([creds[0].email, "seed@example.test"].sort())
  })
})
