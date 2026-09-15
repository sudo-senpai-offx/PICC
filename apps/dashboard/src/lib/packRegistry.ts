// S5 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md (T5.1–T5.2): typed client for the
// pack registry read surface + the ONLY HTTP exit from stopped-at-human.
//
// Honesty rules carried into the UI:
//   - the payload is server-observed truth; nothing here synthesizes step
//     status (a failed fetch renders "registry unreachable", never a guess);
//   - the §8.5 caps ride in the payload (server env truth, read-only) — the
//     browser never guesses max RAM/CPU/storage;
//   - ack is the only legal exit from stopped-at-human and the server records
//     doneBy:"human" — the client only POSTs the handoff.
import { post, request } from "./api"

export type PackStepKind = "run" | "l-class"
export type PackStepStatus = "idle" | "running" | "stopped-at-human" | "skipped-unconfigured" | "blocked"

export interface PackStepEnvelope {
  tier: string
  cadenceMs: number
  rpmCeiling: number
  needs: string
}

// T6.2 — the structured manual-login workflow the server observed (owner Q2:
// manual login is PROMPTED with steps + ack, never auto-detected/automated).
// "capture" (owner decision 2026-09-15): the PICC-side session-capture
// kill-switch pathway — a PICC-settings action, NOT a handoff; the strip
// renders it on skipped-unconfigured steps without an ack button (the toggle
// re-arms it, never the ack).
// Null = the latest observation carried no pathway (nothing to do for the
// human); the strip renders only the ack button in that case.
export interface PackPathway {
  need: "login" | "re-login" | "capture"
  prompt: string
  steps: string[]
}

export interface PackStep {
  id: string
  label: string
  kind: PackStepKind
  envelope: PackStepEnvelope
  status: PackStepStatus
  lastObservedAt: string | null
  lastError: string | null
  detail: string | null
  acknowledgedBy: string | null
  pathway: PackPathway | null
  evidence: { ts: string; status: string; detail: string; observed: unknown }[]
}

export interface PackDef {
  id: string
  label: string
  gateSet: string[]
  steps: PackStep[]
}

export interface PackRegistry {
  version: number
  updatedAt: string
  totalBudgetUsd: number
  capExBudgetUsd: number
  env: string
  ownerCountry: string
  packs: PackDef[]
}

// §8.5 caps — server env truth (PICC_RESOURCE_*), conservative defaults.
export interface PackResourceCaps {
  maxRamMb: number
  maxCpuPct: number
  maxStorageMb: number
}

export interface PackRegistryPayload {
  ok: boolean
  registry: PackRegistry
  caps: PackResourceCaps
}

// Public read (same view the strip polls unauthenticated) — no token needed;
// only the ack POST below is auth-gated.
export function getPackRegistry(): Promise<PackRegistryPayload> {
  return request<PackRegistryPayload>("/packs/registry")
}

export function ackPackStep(
  packId: string,
  stepId: string,
  token?: string
): Promise<{ ok: boolean; step: PackStep }> {
  return post<{ ok: boolean; step: PackStep }>("/packs/ack", { packId, stepId }, token)
}

/** Envelope fact line for a step: tier · cadence · rpm ceiling (observed config). */
export function envelopeFactLine(e: PackStepEnvelope): string {
  const cadence = e.cadenceMs >= 60_000 ? `${Math.round(e.cadenceMs / 60_000)}min` : `${e.cadenceMs}ms`
  return `${e.tier} · every ${cadence} · ≤${e.rpmCeiling} rpm`
}