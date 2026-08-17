// Amazon SP-API (Selling Partner API) — read-only competitor data.
// Search the Catalog (v2022-04-01) by keyword and pull competitive pricing
// (v2022-05-01) for the resulting ASINs. Returns real competitor intel when
// credentials are configured, and an honest `source: "unconfigured"` result
// otherwise — never fake data.
//
// Credentials (see docs/SETUP.md):
//   SP_AMAZON_CLIENT_ID / SP_AMAZON_CLIENT_SECRET  — LWA application (Seller Central → Develop Apps)
//   SP_AMAZON_REFRESH_TOKEN                         — generated during app authorization
//   SP_AMAZON_ACCESS_KEY / SP_AMAZON_SECRET_KEY     — IAM user/role keys for AWS SigV4
//   SP_AMAZON_MARKETPLACE                           — e.g. "US" (default) or "MY"/"SG"/"GB"/...
import { createHmac, createHash } from "node:crypto"
import { env } from "../config.mjs"
import { productSearch } from "./serper.mjs"

// ---------------------------------------------------------------------------
// Marketplace → SP-API region (endpoint + AWS signing region)
// ---------------------------------------------------------------------------

const MARKETPLACES = {
  US: { id: "ATVPDKIKX0DER", region: "na" },
  CA: { id: "A2EUQ1WTGCTBG2", region: "na" },
  MX: { id: "A1AM78C64UM0Y8", region: "na" },
  BR: { id: "A2Q3Y263D00KWC", region: "na" },
  GB: { id: "A1F83G8C2ARO7P", region: "eu" },
  DE: { id: "A1PA6795UKMFR9", region: "eu" },
  FR: { id: "A13V1IB3VIYZZH", region: "eu" },
  ES: { id: "A1RKKUPIHCS9HS", region: "eu" },
  IT: { id: "APJ6JRA9NG5V4", region: "eu" },
  NL: { id: "A1805IZSGTT6HS", region: "eu" },
  SE: { id: "A2NODRKZP88ZB9", region: "eu" },
  PL: { id: "A1C3SOZ7AR7F6", region: "eu" },
  BE: { id: "A33AVAJ2PDY3EV", region: "eu" },
  TR: { id: "A33HTAJU8BZJY", region: "eu" },
  AE: { id: "A2VIGQ35RCS4UG", region: "fe" },
  IN: { id: "A21TJRUUN4KGV", region: "fe" },
  JP: { id: "A1VC38T7YXB528", region: "fe" },
  AU: { id: "A39IBJ37TRP1C6", region: "fe" },
  SG: { id: "A19VAU5U5O7R8", region: "fe" }
}

const REGIONS = {
  na: { endpoint: "https://sellingpartnerapi-na.amazon.com", awsRegion: "us-east-1" },
  eu: { endpoint: "https://sellingpartnerapi-eu.amazon.com", awsRegion: "eu-west-1" },
  fe: { endpoint: "https://sellingpartnerapi-fe.amazon.com", awsRegion: "us-west-2" }
}

export function amazonConfigured() {
  return Boolean(
    env.amazonClientId &&
      env.amazonClientSecret &&
      env.amazonRefreshToken &&
      env.amazonAccessKey &&
      env.amazonSecretKey
  )
}

export function marketplaceFor(code) {
  const key = String(code || "US").toUpperCase()
  const mp = MARKETPLACES[key]
  if (!mp) throw new Error(`unsupported marketplace "${key}" (use ${Object.keys(MARKETPLACES).join(", ")})`)
  return mp
}

// ---------------------------------------------------------------------------
// LWA token (cached until expiry)
// ---------------------------------------------------------------------------

let tokenCache = null // { token, expiresAt }

export async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token
  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.amazonClientId,
      client_secret: env.amazonClientSecret,
      refresh_token: env.amazonRefreshToken
    }).toString()
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`Amazon LWA token failed: ${res.status} ${data.error_description ?? data.error ?? "unknown"}`)
  }
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000 }
  return tokenCache.token
}

// ---------------------------------------------------------------------------
// AWS SigV4 signing (deterministic pure function — unit-tested)
// ---------------------------------------------------------------------------

const encode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())

function hmac(key, data) {
  return createHmac("sha256", key).update(data, "utf8").digest()
}

function sha256Hex(data) {
  return createHash("sha256").update(data, "utf8").digest("hex")
}

/**
 * Build the SigV4 Authorization header for an SP-API request.
 * @param {{ accessKey: string, secretKey: string, awsRegion: string, host: string, method: string, path: string, query: Record<string,string>, body: string, amzDate: string }} o
 */
export function signRequest({ accessKey, secretKey, awsRegion, host, method, path, query = {}, body = "", amzDate }) {
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encode(k)}=${encode(query[k])}`)
    .join("&")
  const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`
  const signedHeaders = "host;x-amz-date"
  const payloadHash = sha256Hex(body)
  const canonicalRequest = `${method}\n${path}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const dateStamp = amzDate.slice(0, 8)
  const scope = `${dateStamp}/${awsRegion}/execute-api/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`
  const kDate = hmac(`AWS4${secretKey}`, dateStamp)
  const kRegion = hmac(kDate, awsRegion)
  const kService = hmac(kRegion, "execute-api")
  const kSigning = hmac(kService, "aws4_request")
  const signature = hmac(kSigning, stringToSign).toString("hex")
  return `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

async function signedFetch({ region, method, path, query, body }) {
  const token = await getAccessToken()
  const { endpoint, awsRegion } = REGIONS[region]
  const host = endpoint.replace(/^https:\/\//, "")
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  const authorization = signRequest({
    accessKey: env.amazonAccessKey,
    secretKey: env.amazonSecretKey,
    awsRegion,
    host,
    method,
    path,
    query,
    body: body ?? "",
    amzDate
  })
  const headers = {
    "x-amz-access-token": token,
    "x-amz-date": amzDate,
    host,
    Authorization: authorization,
    "Content-Type": "application/json"
  }
  const res = await fetch(`${endpoint}${path}${queryString(query)}`, {
    method,
    headers,
    body: method === "GET" ? undefined : body
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data.errors?.map((e) => e.message).join("; ") ?? `${res.status}`
    throw new Error(`Amazon SP-API ${method} ${path} failed: ${msg}`)
  }
  return data
}

function queryString(query) {
  const qs = Object.keys(query)
    .sort()
    .map((k) => `${encode(k)}=${encode(query[k])}`)
    .join("&")
  return qs ? `?${qs}` : ""
}

// ---------------------------------------------------------------------------
// Competitor intel
// ---------------------------------------------------------------------------

async function searchCatalog(keywords, marketplaceId) {
  const data = await signedFetch({
    region: marketplaceFor(env.amazonMarketplace).region,
    method: "GET",
    path: "/catalog/2022-04-01/items",
    query: { keywords, marketplaceIds: marketplaceId, pageSize: "10", includedData: "summaries,images,identifiers" }
  })
  return (data.items ?? []).map((it) => {
    const summaries = it.summaries?.[0] ?? {}
    const images = it.images?.[0] ?? {}
    const ids = it.identifiers?.[0]?.identifiers ?? []
    return {
      asin: it.asin,
      title: summaries.itemName ?? "",
      brand: summaries.brandName ?? "",
      image: images.images?.find((i) => i.width >= 200)?.link ?? images.images?.[0]?.link ?? "",
      marketplaces: summaries.marketplaceIds ?? []
    }
  })
}

async function competitivePricing(asins, marketplaceId) {
  if (!asins.length) return []
  const data = await signedFetch({
    region: marketplaceFor(env.amazonMarketplace).region,
    method: "GET",
    path: "/products/pricing/v2022-05-01/competitivePrice",
    query: { asins: asins.join(","), marketplaceIds: marketplaceId }
  })
  const offers = []
  for (const item of data.items ?? []) {
    if (item.status !== "Success") continue
    const summary = item.summary ?? {}
    const buyboxPrice = summary.buyBoxPrices?.[0]?.listedPrice?.Amount
    const lowest = summary.lowestPrices?.find((p) => p.condition === "New")?.listedPrice?.Amount
    const count = summary.numberOfOffers?.find((o) => o.condition === "New")?.offerCount ?? 0
    offers.push({
      asin: item.asin,
      currency: buyboxPrice ? summary.buyBoxPrices[0].listedPrice.CurrencyCode : lowest?.CurrencyCode ?? "USD",
      buyboxPrice: buyboxPrice ? Number(buyboxPrice) : null,
      lowestPrice: lowest ? Number(lowest) : null,
      offerCount: count
    })
  }
  return offers
}

/** Main entry: enrich keyword/ASIN searches with competitive pricing. */
export async function getCompetitorData({ keywords = "", asin = "" }) {
  // Not configured → fall back to Serper (Google's live view) when available,
  // otherwise an honest "unconfigured" result. Never fabricated data.
  if (!amazonConfigured()) {
    if (env.serperApiKey) {
      const query = (keywords || asin).trim().slice(0, 80)
      const hits = query ? await productSearch(`${query} amazon`, 10) : []
      return {
        source: "serper",
        competitors: hits.map((h) => ({
          asin: "",
          title: h.title,
          brand: "",
          image: h.image,
          url: h.link,
          retailer: h.source,
          currency: h.price ? priceCurrency(h.price) : null,
          buyboxPrice: h.price ? priceNumber(h.price) : null,
          lowestPrice: null,
          offerCount: 0
        })),
        note: "Live Google results via Serper (free, no Amazon account needed). Not Amazon's own catalog — link out to verify."
      }
    }
    return {
      source: "unconfigured",
      competitors: [],
      note: "Amazon SP-API is not configured. Add SP_AMAZON_* keys to apps/dashboard/.env to enable real competitor data."
    }
  }
  const mp = marketplaceFor(env.amazonMarketplace)
  let catalog = []
  if (asin) {
    catalog.push({ asin: asin.trim().toUpperCase(), title: "", brand: "", image: "" })
  } else if (keywords && keywords.trim()) {
    catalog = await searchCatalog(keywords.trim().slice(0, 80), mp.id)
  }
  if (!catalog.length) {
    return { source: "amazon", competitors: [], note: "No catalog matches found for the given keywords." }
  }
  const pricing = await competitivePricing(
    catalog.map((c) => c.asin),
    mp.id
  )
  const priceByAsin = new Map(pricing.map((p) => [p.asin, p]))
  const competitors = catalog.map((c) => {
    const p = priceByAsin.get(c.asin) ?? {}
    return {
      asin: c.asin,
      title: c.title,
      brand: c.brand,
      image: c.image,
      url: `https://www.amazon.com/dp/${c.asin}`,
      currency: p.currency ?? null,
      buyboxPrice: p.buyboxPrice ?? null,
      lowestPrice: p.lowestPrice ?? null,
      offerCount: p.offerCount ?? 0
    }
  })
  return { source: "amazon", competitors, note: "" }
}

const CURRENCY_SYMBOLS = { US$: "USD", $: "USD", RM: "MYR", "S$": "SGD", "€": "EUR", "£": "GBP" }

function priceCurrency(priceStr) {
  const sym = Object.keys(CURRENCY_SYMBOLS).find((s) => priceStr.toUpperCase().startsWith(s.toUpperCase())) ?? ""
  return CURRENCY_SYMBOLS[sym] ?? null
}

function priceNumber(priceStr) {
  const n = parseFloat(priceStr.replace(/[^0-9.,]/g, "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}
