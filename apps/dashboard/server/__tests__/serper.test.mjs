import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { env } from "../config.mjs"
import { news, productSearch, researchTopic } from "../services/serper.mjs"

function resetEnv() {
  env.serperApiKey = ""
}

describe("Serper service error attribution", () => {
  let envSnap
  beforeEach(() => {
    envSnap = { ...env }
    resetEnv()
  })
  afterEach(() => {
    for (const k of Object.keys(envSnap)) env[k] = envSnap[k]
    vi.unstubAllGlobals()
  })

  function rejectRes(status, body) {
    return vi.fn(async () => ({
      ok: false,
      status,
      json: async () => body
    }))
  }

  it("returns [] when Serper is not configured (no fetch attempted)", async () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    await expect(news("bitcoin", 3)).resolves.toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("400 with a JSON message attributes the failure to the key/quota AND the endpoint", async () => {
    env.serperApiKey = "key"
    vi.stubGlobal(
      "fetch",
      rejectRes(400, { message: "Invalid API key" })
    )
    await expect(news("bitcoin", 3)).rejects.toThrow(
      /Serper news 400.*Invalid API key.*SERPER_API_KEY/
    )
  })

  it("429 (quota/rate limit) carries the key/quota hint", async () => {
    env.serperApiKey = "key"
    vi.stubGlobal("fetch", rejectRes(429, {}))
    await expect(news("bitcoin", 3)).rejects.toThrow(
      /Serper news 429.*SERPER_API_KEY/
    )
  })

  it("non key/quota status (500) keeps endpoint + status but no key hint", async () => {
    env.serperApiKey = "key"
    vi.stubGlobal("fetch", rejectRes(500, { error: "upstream boom" }))
    await expect(news("bitcoin", 3)).rejects.toThrow(
      /Serper news 500.*upstream boom/
    )
    await expect(news("bitcoin", 3)).rejects.not.toThrow(/SERPER_API_KEY/)
  })

  it("success path still trims news results into the standard shape", async () => {
    env.serperApiKey = "key"
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        news: [
          { title: "A", link: "https://x/a", snippet: "s1" },
          { title: "B", link: "https://x/b" },
          { title: "", link: "https://x/c" }
        ]
      })
    })))
    const results = await news("bitcoin", 3)
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      title: "A",
      link: "https://x/a",
      snippet: "s1",
      source: "",
      date: ""
    })
    // The untrimmed (no-title) entry is dropped.
    expect(results.some((r) => r.link === "https://x/c")).toBe(false)
  })
})
