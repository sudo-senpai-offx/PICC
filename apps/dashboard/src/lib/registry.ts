// ---------------------------------------------------------------------
// Classification registry — PICC income-stream families (UI-reskin REQ-A).
//
// Single frontend authority mapping every income-stream family to its
// owning ministry + sub-domain. Frontend navigation, hub drill-downs, and
// theming derive from this table; adding a future suite is a registry
// entry, not a refactor. Locked mapping: CONTEXT.md:57-65.
//
// The server's site-category registry (server/services/suites.mjs) is the
// authority for *browser-site* classification (trading site -> trading
// suite). THIS registry is the authority for *income-stream* families.
// ---------------------------------------------------------------------
import type { SuiteId } from "./suites"

export type FamilyId =
  | "crypto"
  | "defi"
  | "p2p"
  | "dividend"
  | "interest"
  | "content"
  | "agent"
  | "affiliate"
  | "rental"
  | "nft"
  | "uncategorized"

export type FamilyStatus = "active" | "coming-soon" | "unconfigured"

export interface FamilyEntry {
  familyId: FamilyId
  label: string
  owningMinistry: SuiteId
  /** Room key within the owning ministry (must exist in INNER_NAV). */
  subDomain: string
  status: FamilyStatus
  /** Graduation policy reference (CONTEXT.md:36-39). */
  graduationRef: string
}

/** Family -> ministry mapping. Locked decision: CONTEXT.md:57-65. */
export const FAMILIES: FamilyEntry[] = [
  // Trading ministry
  {
    familyId: "crypto",
    label: "Crypto & Staking",
    owningMinistry: "trading",
    subDomain: "dashboard",
    status: "active",
    graduationRef: "CONTEXT.md:36-39"
  },
  // Earnings ministry (income streams + honest fallback)
  {
    familyId: "dividend",
    label: "Dividends",
    owningMinistry: "earnings",
    subDomain: "dashboard",
    status: "active",
    graduationRef: "CONTEXT.md:36-39"
  },
  {
    familyId: "interest",
    label: "Interest",
    owningMinistry: "earnings",
    subDomain: "dashboard",
    status: "active",
    graduationRef: "CONTEXT.md:36-39"
  },
  {
    familyId: "content",
    label: "Content",
    owningMinistry: "earnings",
    subDomain: "dashboard",
    status: "active",
    graduationRef: "CONTEXT.md:36-39"
  },
  {
    familyId: "agent",
    label: "AI Agent",
    owningMinistry: "earnings",
    subDomain: "dashboard",
    status: "active",
    graduationRef: "CONTEXT.md:36-39"
  },
  {
    familyId: "uncategorized",
    label: "Uncategorized",
    owningMinistry: "earnings",
    subDomain: "dashboard",
    status: "unconfigured",
    graduationRef: "CONTEXT.md:36-39"
  },
  // Intelligence ministry (analysis-heavy families)
  {
    familyId: "defi",
    label: "DeFi & Yield",
    owningMinistry: "intelligence",
    subDomain: "dashboard",
    status: "active",
    graduationRef: "CONTEXT.md:36-39"
  },
  {
    familyId: "p2p",
    label: "P2P Lending",
    owningMinistry: "intelligence",
    subDomain: "dashboard",
    status: "active",
    graduationRef: "CONTEXT.md:36-39"
  },
  {
    familyId: "affiliate",
    label: "Affiliate",
    owningMinistry: "intelligence",
    subDomain: "dashboard",
    status: "active",
    graduationRef: "CONTEXT.md:36-39"
  },
  {
    familyId: "rental",
    label: "Rental",
    owningMinistry: "intelligence",
    subDomain: "dashboard",
    status: "coming-soon",
    graduationRef: "CONTEXT.md:36-39"
  },
  {
    familyId: "nft",
    label: "NFT & Royalties",
    owningMinistry: "intelligence",
    subDomain: "dashboard",
    status: "coming-soon",
    graduationRef: "CONTEXT.md:36-39"
  }
]

const BY_ID = new Map(FAMILIES.map((f) => [f.familyId, f]))

export function familyEntry(id: FamilyId | string | null | undefined): FamilyEntry | null {
  if (!id) return null
  const entry = BY_ID.get(id as FamilyId)
  return entry ?? null
}

/** Owning ministry for a family, or null for unknown ids. */
export function familyToSuite(id: FamilyId | string): SuiteId | null {
  return familyEntry(id)?.owningMinistry ?? null
}

/** Every family id owned by a ministry (unconfigured fallback included). */
export function suiteToFamilies(suiteId: SuiteId): FamilyId[] {
  return FAMILIES.filter((f) => f.owningMinistry === suiteId).map((f) => f.familyId)
}

/** Human label for a family, or null for unknown ids. */
export function familyLabel(id: FamilyId | string | null | undefined): string | null {
  return familyEntry(id)?.label ?? null
}