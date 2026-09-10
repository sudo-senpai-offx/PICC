export interface IntegrationEntry {
  id: string
  ministry: string
  name: string
  url: string
  purpose: string
  boundary: { freeTier: string; rateLimit: string; keyRequired: boolean }
  state: "unconfigured" | "connected" | "degraded"
}

export async function fetchIntegrations(ministry?: string): Promise<IntegrationEntry[]> {
  const url = ministry ? `/api/integrations/${ministry}` : "/api/integrations"
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : (data.entries ?? [])
}