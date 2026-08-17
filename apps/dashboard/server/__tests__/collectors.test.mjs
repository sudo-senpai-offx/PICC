import { afterEach, describe, expect, it, vi } from "vitest"
import {
  fetchEarnAppSnapshot,
  fetchPawnsSnapshot,
  fetchRepocketSnapshot,
  fetchTraffmonetizerSnapshot
} from "../services/collectors.mjs"

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: () => Promise.resolve(body)
  }
}

function cookieHeaders(setCookieLines) {
  return {
    getSetCookie: () => setCookieLines
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Repocket collector", () => {
  it("logs in via Firebase and reads centsCredited as USD balance", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ idToken: "id-token-123" }))
      .mockResolvedValueOnce(jsonResponse({ centsCredited: 1234 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchRepocketSnapshot("me@example.com", "secret")

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain("identitytoolkit.googleapis.com")
    expect(fetchMock.mock.calls[1][1].headers["Auth-Token"]).toBe("id-token-123")
    expect(result).toMatchObject({ ok: true, platform: "Repocket", currency: "USD", balance: 12.34, payoutThreshold: 10 })
  })

  it("throws honestly when Firebase login returns no token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "INVALID_PASSWORD" })))
    await expect(fetchRepocketSnapshot("me@example.com", "wrong")).rejects.toThrow("no auth token")
  })

  it("throws when the report is missing centsCredited (API drift)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(jsonResponse({ idToken: "id-token-123" }))
        .mockResolvedValueOnce(jsonResponse({ status: "ok" }))
    )
    await expect(fetchRepocketSnapshot("me@example.com", "secret")).rejects.toThrow("centsCredited")
  })

  it("skips Firebase login when a session idToken is provided (Google accounts)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ centsCredited: 9876 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchRepocketSnapshot("", "", "eyJ.firebase.idtoken")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("api.repocket.com/api/reports/current")
    expect(init.headers["Auth-Token"]).toBe("eyJ.firebase.idtoken")
    expect(result.balance).toBe(98.76)
  })

  it("rejects a non-JWT Repocket session token without calling the API", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(fetchRepocketSnapshot("", "", "not-a-jwt")).rejects.toThrow("not a JWT")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("Pawns collector", () => {
  it("logs in via email/password then reads /users/me", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ auth_token: "pawn-jwt-123" }))
      .mockResolvedValueOnce(jsonResponse({ balance: { available: 5, pending: 1.5 }, total_earnings: 10, today_earnings: 0.5 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchPawnsSnapshot("me@example.com", "secret")

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain("/login/email")
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer pawn-jwt-123")
    expect(result).toMatchObject({ ok: true, platform: "Pawns", currency: "USD", balance: 6.5, lifetimeEarnings: 10, todayEarnings: 0.5, payoutThreshold: 5 })
  })

  it("skips login when a session JWT is provided (Google accounts)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ balance: { available: 2, pending: 0 }, total_earnings: 4 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchPawnsSnapshot("", "", "eyJ.pawns.jwt")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("/users/me")
    expect(init.headers.Authorization).toBe("Bearer eyJ.pawns.jwt")
    expect(result.balance).toBe(2)
  })

  it("rejects a non-JWT Pawns session token without calling the API", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(fetchPawnsSnapshot("", "", "not-a-jwt")).rejects.toThrow("not a JWT")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("Traffmonetizer collector", () => {
  it("reads balance from data.traffmonetizer.com get_balance with the session JWT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { balance: "3.25" } }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchTraffmonetizerSnapshot("eyJ.abc.def")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://data.traffmonetizer.com/api/app_user/get_balance")
    expect(init.headers.Authorization).toBe("Bearer eyJ.abc.def")
    expect(init.headers.Origin).toBe("https://app.traffmonetizer.com")
    expect(init.headers.Referer).toBe("https://app.traffmonetizer.com/")
    expect(result).toMatchObject({ ok: true, platform: "Traffmonetizer", currency: "USD", balance: 3.25, payoutThreshold: 10 })
  })

  it("rejects the base64 Application Token (not a JWT) without calling the API", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(fetchTraffmonetizerSnapshot("base64-not-a-jwt=")).rejects.toThrow("Local Storage")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws honestly on an expired or invalid JWT", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 })))

    await expect(fetchTraffmonetizerSnapshot("eyJ.abc.def")).rejects.toThrow("expired or invalid")
  })

  it("throws when the balance field is missing (API drift)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "ok" })))

    await expect(fetchTraffmonetizerSnapshot("eyJ.abc.def")).rejects.toThrow("missing balance")
  })
})

describe("EarnApp collector", () => {
  it("rotates XSRF then reads the balance from /money", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { headers: cookieHeaders(["xsrf-token=abc123; Path=/; HttpOnly"]) }))
      .mockResolvedValueOnce(jsonResponse({ balance: 12.5 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchEarnAppSnapshot("oauth-token")

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain("/sec/rotate_xsrf")
    const moneyUrl = fetchMock.mock.calls[1][0]
    const moneyHeaders = fetchMock.mock.calls[1][1].headers
    expect(moneyUrl).toContain("/money")
    expect(moneyHeaders.Cookie).toContain("oauth-refresh-token=oauth-token")
    expect(moneyHeaders.Cookie).toContain("xsrf-token=abc123")
    expect(moneyHeaders["X-Requested-With"]).toBe("XMLHttpRequest")
    expect(result).toMatchObject({ ok: true, platform: "EarnApp", currency: "USD", balance: 12.5, payoutThreshold: 5 })
  })

  it("falls back to a plain set-cookie header when getSetCookie is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { headers: { get: () => "xsrf-token=xyz789; Path=/" } }))
      .mockResolvedValueOnce(jsonResponse({ balance: 7.25 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchEarnAppSnapshot("oauth-token", "sess-1")
    expect(result.balance).toBe(7.25)
    expect(fetchMock.mock.calls[1][1].headers.Cookie).toContain("brd_sess_id=sess-1")
  })

  it("throws honestly on a rejected session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(jsonResponse({}, { headers: cookieHeaders(["xsrf-token=abc123"]) }))
        .mockResolvedValueOnce(jsonResponse({}, { status: 403 }))
    )
    await expect(fetchEarnAppSnapshot("bad-token")).rejects.toThrow("rejected")
  })

  it("throws when the balance field is missing (API drift)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(jsonResponse({}, { headers: cookieHeaders(["xsrf-token=abc123"]) }))
        .mockResolvedValueOnce(jsonResponse({ greeting: "hi" }))
    )
    await expect(fetchEarnAppSnapshot("oauth-token")).rejects.toThrow("missing balance")
  })
})
