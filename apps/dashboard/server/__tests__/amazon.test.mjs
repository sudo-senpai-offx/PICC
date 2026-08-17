import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { env } from "../config.mjs"
import {
  amazonConfigured,
  marketplaceFor,
  getAccessToken,
  signRequest,
  getCompetitorData
} from "../services/amazon.mjs"

function resetEnv() {
  env.amazonClientId = env.amazonClientSecret = env.amazonRefreshToken = ""
  env.amazonAccessKey = env.amazonSecretKey = ""
  env.amazonMarketplace = "US"
  env.serperApiKey = ""
}

describe("Amazon SP-API service", () => {
  let envSnap
  beforeEach(() => {
    envSnap = { ...env }
    resetEnv()
  })
  afterEach(() => {
    for (const k of Object.keys(envSnap)) env[k] = envSnap[k]
    vi.unstubAllGlobals()
  })

  it("amazonConfigured is false without keys and true with all keys", () => {
    expect(amazonConfigured()).toBe(false)
    env.amazonClientId = env.amazonClientSecret = env.amazonRefreshToken = "a"
    env.amazonAccessKey = env.amazonSecretKey = "a"
    expect(amazonConfigured()).toBe(true)
    env.amazonSecretKey = ""
    expect(amazonConfigured()).toBe(false)
  })

  it("maps marketplaces to regions", () => {
    expect(marketplaceFor("US").region).toBe("na")
    expect(marketplaceFor("CA").region).toBe("na")
    expect(marketplaceFor("GB").region).toBe("eu")
    expect(marketplaceFor("DE").region).toBe("eu")
    expect(marketplaceFor("JP").region).toBe("fe")
    expect(marketplaceFor("AU").region).toBe("fe")
    expect(() => marketplaceFor("XX")).toThrow(/unsupported marketplace/)
  })

  it("signRequest builds a deterministic AWS4-HMAC-SHA256 header", () => {
    const header = signRequest({
      accessKey: "AKIDEXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      awsRegion: "us-east-1",
      host: "sellingpartnerapi-na.amazon.com",
      method: "GET",
      path: "/catalog/2022-04-01/items",
      query: { keywords: "passive income", marketplaceIds: "ATVPDKIKX0DER", pageSize: "10" },
      body: "",
      amzDate: "20260808T000000Z"
    })
    expect(header).toMatch(/^AWS4-HMAC-SHA256 /)
    expect(header).toContain("Credential=AKIDEXAMPLE/20260808/us-east-1/execute-api/aws4_request,")
    expect(header).toContain("SignedHeaders=host;x-amz-date,")
    expect(header).toMatch(/Signature=[0-9a-f]{64}$/)
    // Changing a query value changes the signature.
    const header2 = signRequest({
      accessKey: "AKIDEXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      awsRegion: "us-east-1",
      host: "sellingpartnerapi-na.amazon.com",
      method: "GET",
      path: "/catalog/2022-04-01/items",
      query: { keywords: "something else", marketplaceIds: "ATVPDKIKX0DER", pageSize: "10" },
      body: "",
      amzDate: "20260808T000000Z"
    })
    expect(header2).not.toBe(header)
  })

  it("caches the LWA token and refreshes after expiry", async () => {
    const tokenRes = (token, expiresIn) =>
      new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), { status: 200 })
    const fetcher = vi.fn()
    fetcher
      .mockResolvedValueOnce(tokenRes("TOKEN_A", 3600))
      .mockResolvedValueOnce(tokenRes("TOKEN_B", 3600))
    vi.stubGlobal("fetch", fetcher)

    let now = 1_000_000_000
    const realNow = Date.now
    vi.spyOn(Date, "now").mockImplementation(() => now)

    const t1 = await getAccessToken()
    expect(t1).toBe("TOKEN_A")
    const t2 = await getAccessToken()
    expect(t2).toBe("TOKEN_A")
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Advance 3700s past the cached token's expiry window (3540s lifetime + 60s margin).
    now += 3700_000
    const t3 = await getAccessToken()
    expect(t3).toBe("TOKEN_B")
    expect(fetcher).toHaveBeenCalledTimes(2)
    const call = fetcher.mock.calls[0]
    expect(call[0]).toBe("https://api.amazon.com/auth/o2/token")
    expect(call[1].body).toContain("grant_type=refresh_token")
    Date.now = realNow
  })

  it("getCompetitorData returns an honest unconfigured result without keys", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network"))))
    const res = await getCompetitorData({ keywords: "yoga mat" })
    expect(res.source).toBe("unconfigured")
    expect(res.competitors).toEqual([])
    expect(res.note).toContain("SP_AMAZON_")
  })

  it("getCompetitorData falls back to live Serper results when SP-API is off but Serper is on", async () => {
    env.serperApiKey = "test-serper-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              shopping: [
                {
                  title: "Gaiam Yoga Mat - 6mm Extra Thick",
                  link: "https://www.amazon.com/Gaiam-Yoga-Mat/dp/B0EXAMPLE",
                  price: "$24.99",
                  imageUrl: "https://m.media-amazon.com/images/I/example.jpg",
                  source: "Amazon.com"
                },
                {
                  title: "Yoga Mat with Carry Strap",
                  link: "https://www.amazon.com/Yoga-Mat/dp/B0OTHER",
                  price: "US$18.00",
                  source: "Amazon.com"
                }
              ],
              organic: []
            }),
            { status: 200 }
          )
        )
      )
    )
    const res = await getCompetitorData({ keywords: "yoga mat" })
    expect(res.source).toBe("serper")
    expect(res.competitors.length).toBe(2)
    expect(res.competitors[0].buyboxPrice).toBe(24.99)
    expect(res.competitors[0].currency).toBe("USD")
    expect(res.competitors[1].buyboxPrice).toBe(18)
    expect(res.competitors[1].url).toContain("amazon.com")
    env.serperApiKey = ""
  })
})
