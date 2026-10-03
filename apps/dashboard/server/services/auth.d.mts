/**
 * Typed surface for `auth.mjs`, for the CLIENT tests that drive it.
 *
 * This declaration exists for the same reason as `decision.d.mts`,
 * `authorityModel.d.mts`, `ceremonyGates.d.mts` and `ceremonyState.d.mts`:
 * `auth.mjs` is plain `.mjs`, so a TypeScript importer would otherwise get
 * TS7016 and an `any` at the call site — which is the worst possible outcome in
 * this one place, because the whole point of the importer is to check that a
 * credential is shaped the way the server actually accepts it. An `any` return
 * would make `await verifyUser(header) === null` compile for ANY argument,
 * including a malformed one, and the test would assert nothing.
 *
 * SCOPE IS DELIBERATELY MINIMAL. Only the two entry points a client-side test
 * needs are declared. `auth.mjs` exports the whole session surface — signup,
 * signin, signout, key derivation, store writers, `AuthStoreUnavailable` — and
 * none of that belongs in a client's hands; widening this file to mirror the
 * module would make the declaration a second, drifting copy of the service.
 *
 * THE NULL CONTRACT IS THE PART WORTH TYPING PRECISELY, so it is restated here
 * rather than left implicit:
 *
 *   - `verifyUser` returns the AUTHENTICATED USER'S ID (a string), not a user
 *     object. `resolveAuthUser` is the entry point that returns a user. Callers
 *     that want the id therefore cannot accidentally treat the result as a
 *     profile.
 *   - It returns `null` for "cannot vouch", and `null` covers BOTH "no such
 *     session" and "the store could not be read" (`verifyToken` flattens a store
 *     fault to `null` on purpose, so that the many callers wanting a boolean
 *     never start throwing). So a `null` is not evidence the credential was
 *     rejected — it is evidence nothing was vouched for. The strict variants
 *     exist for callers that must tell those apart.
 *   - It NEVER throws for a malformed or absent header, which is what lets a
 *     caller pass `req.headers.authorization` straight through.
 */

/**
 * Resolve a `Bearer <token>` header to the authenticated user's id.
 *
 * Returns the user id on success and `null` for every negative, including an
 * absent, empty, or non-`Bearer ` header and an unreadable session store.
 */
export function verifyUser(authorizationHeader: string | undefined | null): Promise<string | null>

/** The same lookup by bare token. `null` for every negative, and never throws. */
export function verifyToken(token: string | undefined | null): Promise<string | null>

/**
 * The strict form of {@link verifyToken}: a store fault is reported rather than
 * flattened to `null`, so a caller can tell "no such session" from "the store
 * could not be read". Rejects with `AuthStoreUnavailable` when undeterminable.
 */
export function verifyTokenStrict(token: string | undefined | null): Promise<string | null>
