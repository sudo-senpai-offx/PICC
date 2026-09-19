// PICC passive income catalog — verified against public sources (2026).
// Includes only services that were confirmed alive at verification time;
// dead/broken platforms (Peer2Profit, PacketShare, SpeedShare, Wipter,
// AntGain, GagaNode, earn.cc, WizardGain) and the excluded families
// (bandwidth/depin/storage/compute — see CONTEXT.md:31-33 and
// docs/adr/0002-bandwidth-suite-rejected.md) are intentionally excluded.
export interface CatalogEntry {
  id: string
  name: string
  category:
    | "crypto"
    | "nft"
    | "p2p"
    | "agent"
    | "interest"
    | "dividend"
    | "rental"
    | "content"
    | "trading"
  residential: boolean
  vps: boolean
  payout: string
  url: string
  note?: string
}

export const STREAM_CATEGORY_LABELS: Record<string, string> = {
  dividend: "Dividends",
  interest: "Interest",
  affiliate: "Affiliate",
  content: "Content",
  rental: "Rental",
  p2p: "P2P Lending",
  crypto: "Crypto & Staking",
  defi: "DeFi & Yield",
  nft: "NFT & Royalties",
  agent: "AI Agent",
  trading: "Trading Platform"
}

export const CRYPTO_APPS: CatalogEntry[] = [
  { id: "luno", name: "Luno", category: "crypto", residential: false, vps: false, payout: "Bank, FPX", url: "https://www.luno.com/my", note: "SC-registered DAX. Buy & hold BTC/ETH; no local staking product — log gains as manual balance." },
  { id: "mx-global", name: "MX Global", category: "crypto", residential: false, vps: false, payout: "Bank, FPX", url: "https://mxglobal.com.my", note: "SC-registered DAX (Binance is an investor). BTC/ETH/USDT pairs." },
  { id: "hata", name: "HATA Digital", category: "crypto", residential: false, vps: false, payout: "Bank", url: "https://www.hata.io", note: "SC-registered DAX (2026 list)." },
  { id: "sinegy", name: "SINEGY DAX", category: "crypto", residential: false, vps: false, payout: "Bank", url: "https://sinegy.com", note: "SC-registered DAX based in Penang." },
  { id: "kinetic", name: "Kinetic DAX", category: "crypto", residential: false, vps: false, payout: "Bank", url: "https://kineticdax.com", note: "SC-registered DAX in KL." },
  { id: "staking-defi", name: "Staking / DeFi yield", category: "crypto", residential: false, vps: false, payout: "Crypto", url: "https://www.stakingrewards.com", note: "On-chain staking (ETH ~2–3.5%, SOL ~5–6% mid-2026). NOT offered by SC-registered MY exchanges — unregulated locally, use at your own risk." }
]

export const DEFI_APPS: CatalogEntry[] = [
  { id: "defi-supply", name: "DeFi lending supply (Aave/Compound)", category: "crypto", residential: false, vps: false, payout: "Crypto", url: "https://defillama.com", note: "Supply stablecoins for 3–10% APY. Track real pools in OMNI-FIN via the built-in DeFiLlama yield monitor." },
  { id: "lsd-liquid-staking", name: "Liquid staking (Lido/Rocket Pool)", category: "crypto", residential: false, vps: false, payout: "Crypto", url: "https://lido.fi", note: "stETH/rETH accrue staking rewards while staying tradable. Shown in the built-in yield monitor." },
  { id: "basis-yield", name: "Basis yield (Delta-neutral farming)", category: "crypto", residential: false, vps: false, payout: "Crypto", url: "https://defillama.com/yields", note: "Ethena sUSDe etc. Payouts depend on funding + basis; risk of depeg. Advanced — start small." }
]

export const NFT_APPS: CatalogEntry[] = [
  { id: "nft-royalties", name: "NFT artist royalties", category: "nft", residential: false, vps: false, payout: "Crypto (ETH)", url: "https://opensea.io", note: "On-chain royalties (0.5–10%) on secondary sales. Zero ongoing effort once a collection sells." },
  { id: "nft-gen-royalties", name: "Generative art royalties", category: "nft", residential: false, vps: false, payout: "Crypto (ETH)", url: "https://fxhash.xyz", note: "fxhash/Art Blocks pay per-mint + resale royalties for generative works." },
  { id: "ordinals", name: "Bitcoin Ordinals / inscriptions", category: "nft", residential: false, vps: false, payout: "Crypto (BTC)", url: "https://ordinals.com", note: "Inscribe once, resale royalties are manual — track as a manual stream, not a standing source." }
]

export const P2P_APPS: CatalogEntry[] = [
  { id: "funding-circle", name: "Funding Societies", category: "p2p", residential: false, vps: false, payout: "Bank transfer", url: "https://www.fundingsocieties.com.my", note: "Malaysia SC-licensed P2P SME lending; ~7–13% target returns with default risk. Auto-reinvest available." },
  { id: "selangor-kuasa", name: "Selangor Kuasa (SKS)", category: "p2p", residential: false, vps: false, payout: "Bank transfer", url: "https://www.selangorkuasa.com", note: "SC-licensed P2P Islamic financing platform." },
  { id: "pitik", name: "Pitik.ai", category: "p2p", residential: false, vps: false, payout: "Bank transfer", url: "https://pitik.ai", note: "SC-licensed agritech P2P for poultry/livestock financing." },
  { id: "stashaway", name: "StashAway Simple", category: "p2p", residential: false, vps: false, payout: "Bank transfer", url: "https://www.stashaway.sg", note: "Not P2P but fixed-income cash management (~3–4% p.a.) — a low-effort parking yield." },
  { id: "peerberry", name: "PeerBerry", category: "p2p", residential: false, vps: false, payout: "Bank transfer", url: "https://peerberry.com", note: "EU P2P lending marketplace; €10M+ interest paid out historically. Default risk applies." },
  { id: "brdge", name: "BRDGE", category: "p2p", residential: false, vps: false, payout: "Bank transfer", url: "https://brdge.co", note: "Singapore-based SME lending marketplace." },
  { id: "8lends", name: "8lends", category: "p2p", residential: false, vps: false, payout: "Crypto (USDC)", url: "https://8lends.com", note: "Web3 crowdlending — real-world business loans settled on-chain." },
  { id: "prosper", name: "Prosper", category: "p2p", residential: false, vps: false, payout: "Bank transfer", url: "https://www.prosper.com", note: "US P2P lending marketplace." }
]

export const AGENT_APPS: CatalogEntry[] = [
  { id: "agi-trading", name: "Paper-trading signal agent", category: "agent", residential: false, vps: true, payout: "n/a", url: "/simulator", note: "PICC's own multi-model prediction + paper ledger. No capital needed — validate a strategy before risking anything." },
  { id: "n8n-automation", name: "n8n income automations", category: "agent", residential: false, vps: true, payout: "n/a", url: "https://n8n.io", note: "Free workflow templates included in infra/n8n/workflows (staking monitor, trading signal, DePIN aggregator)." },
  { id: "automatad", name: "Automatad", category: "agent", residential: false, vps: false, payout: "Crypto (ATA)", url: "https://automatad.com", note: "Users earn ATA for contributing browsing data via browser extension. Not a VPS node." },
  { id: "aigen", name: "AIGEN Protocol", category: "agent", residential: false, vps: true, payout: "Crypto (USDC/ETH)", url: "https://aigen.dev", note: "Permissionless on-chain bounty protocol for AI agents — 0.5% fee vs 5–20% on competitors. Live on Base + Optimism, MIT open source." },
  { id: "cashclaw", name: "CashClaw", category: "agent", residential: false, vps: true, payout: "Crypto", url: "https://github.com/ertugrulakben/cashclaw", note: "13 OpenClaw skills turning AI agents into freelance operators (SEO audits, content, leads, landing pages)." },
  { id: "ash", name: "ash", category: "agent", residential: false, vps: true, payout: "Crypto credits", url: "https://github.com/doheon/ash", note: "Distributed P2P AI coding-agent network — share idle compute, earn credits, fully self-hosted." },
  { id: "yappr", name: "yappr", category: "agent", residential: false, vps: true, payout: "Crypto", url: "https://yappr.xyz", note: "Self-funding AI agent that lives on X — answers @mentions with skills you write; pays its own data costs from token fees." },
  { id: "agora", name: "Agora", category: "agent", residential: false, vps: true, payout: "Crypto ($THREE)", url: "https://agora.xyz", note: "Living agent + human economy — browse the job board, claim on-chain work, post bounties." }
]

// ---------------------------------------------------------------------
// Category A — fully passive (one-time setup, money works)
// ---------------------------------------------------------------------
export const INTEREST_APPS: CatalogEntry[] = [
  { id: "cds", name: "Certificates of Deposit", category: "interest", residential: false, vps: false, payout: "Bank transfer", url: "https://www.depositaccounts.com", note: "Time deposits ~4% APY. Log as a manual stream — low effort, insured." },
  { id: "money-market", name: "Money Market Accounts", category: "interest", residential: false, vps: false, payout: "Bank transfer", url: "https://www.depositaccounts.com", note: "Higher APY than savings with fund access. Manual tracking." },
  { id: "t-bills", name: "T-Bills", category: "interest", residential: false, vps: false, payout: "Bank transfer", url: "https://www.treasurydirect.gov", note: "Government-backed short-term securities; ~4%+ yields. Pair with n8n for maturity reminders." }
]

export const DIVIDEND_APPS: CatalogEntry[] = [
  { id: "dividend-etfs", name: "Dividend ETFs", category: "dividend", residential: false, vps: false, payout: "Bank transfer", url: "https://finance.yahoo.com", note: "Diversified dividend portfolios — track them in the Financial Twin." },
  { id: "bond-funds", name: "Bond Funds", category: "dividend", residential: false, vps: false, payout: "Bank transfer", url: "https://finance.yahoo.com", note: "Diversified fixed-income. Model distributions in the Financial Twin." },
  { id: "index-funds", name: "Index Funds", category: "dividend", residential: false, vps: false, payout: "Bank transfer", url: "https://finance.yahoo.com", note: "Passive index tracking (S&P 500 etc.). Model growth in the Financial Twin." }
]

// ---------------------------------------------------------------------
// Category B — semi-passive (upfront work + maintenance)
// ---------------------------------------------------------------------
export const CONTENT_APPS: CatalogEntry[] = [
  { id: "faceless-youtube", name: "Faceless YouTube channels", category: "content", residential: false, vps: true, payout: "AdSense", url: "https://youtube.com", note: "Automated video with affiliates — pair with MoneyPrinterV2 + the n8n content pipeline." },
  { id: "newsletter", name: "Newsletter monetization", category: "content", residential: false, vps: true, payout: "Stripe", url: "https://buttondown.com", note: "Subscription content; sync revenue via the Stripe integration." },
  { id: "digital-templates", name: "Digital templates", category: "content", residential: false, vps: true, payout: "Marketplace", url: "https://www.etsy.com", note: "Sell on Etsy / Creative Market. Log royalties as manual sales." },
  { id: "stock-photography", name: "Stock photography / video", category: "content", residential: false, vps: true, payout: "Marketplace", url: "https://www.shutterstock.com", note: "Upload once, earn licensing fees. AI generation can scale volume." }
]

// ---------------------------------------------------------------------
// Category C — active (ongoing management)
// ---------------------------------------------------------------------
export const RENTAL_APPS: CatalogEntry[] = [
  { id: "rental-property", name: "Rental properties", category: "rental", residential: true, vps: false, payout: "Bank transfer", url: "https://www.airbnb.com", note: "Traditional or vacation rentals (Airbnb/Vrbo). Track expenses via Firefly III + n8n." },
  { id: "real-estate-crowdfunding", name: "Real estate crowdfunding", category: "rental", residential: false, vps: false, payout: "Bank transfer", url: "https://fundrise.com", note: "Fractional property investment — dividend distributions, passive." },
  { id: "parking-space", name: "Parking space rental", category: "rental", residential: true, vps: false, payout: "Bank transfer", url: "https://www.justpark.com", note: "Rent out unused parking. Sync bookings with n8n." }
]

// ---------------------------------------------------------------------
// Trading platforms — PICC's headless capture engine tracks session status
// and account metrics for these venues. Per-platform sync mode (auto-sync /
// don't sync / ask) is managed in the channel catalog or the capture-config
// settings. Not income streams — these are active trading platforms.
// ---------------------------------------------------------------------
export const TRADING_PLATFORM_APPS: CatalogEntry[] = [
  { id: "expertoption", name: "ExpertOption", category: "trading", residential: false, vps: false, payout: "—", url: "https://app.expertoption.com/", note: "Reference implementation: full capture + live session (liveEO). Binary options — demo-first." },
  { id: "iqoption", name: "IQ Option", category: "trading", residential: false, vps: false, payout: "—", url: "https://iqoption.com/en/login", note: "Full capture via storage-scan hook (ssid cookie). Binary options — demo-first." },
  { id: "olymptrade", name: "Olymp Trade", category: "trading", residential: false, vps: false, payout: "—", url: "https://olymptrade.com", note: "Binary options — demo-first. Capture hook pending." },
  { id: "deriv", name: "Deriv", category: "trading", residential: false, vps: false, payout: "—", url: "https://deriv.com", note: "Binary options — demo-first. Capture hook pending." },
  { id: "binance", name: "Binance", category: "trading", residential: false, vps: false, payout: "—", url: "https://www.binance.com", note: "Spot exchange. T10 research done — storage-scan keys needed for capture." },
  { id: "kucoin", name: "KuCoin", category: "trading", residential: false, vps: false, payout: "—", url: "https://www.kucoin.com", note: "Spot exchange. T10 research done — storage-scan keys needed for capture." },
  { id: "okx", name: "OKX", category: "trading", residential: false, vps: false, payout: "—", url: "https://www.okx.com", note: "Spot exchange. T10 research done — storage-scan keys needed for capture." },
  { id: "bybit", name: "Bybit", category: "trading", residential: false, vps: false, payout: "—", url: "https://www.bybit.com", note: "Derivatives exchange. T10 research done — browser session keys unknown." },
  { id: "etoro", name: "eToro", category: "trading", residential: false, vps: false, payout: "—", url: "https://www.etoro.com", note: "CFD trading. Capture hook pending." },
  { id: "plus500", name: "Plus500", category: "trading", residential: false, vps: false, payout: "—", url: "https://www.plus500.com", note: "CFD trading. Capture hook pending." }
]

export const CATALOG = [
  ...CRYPTO_APPS,
  ...DEFI_APPS,
  ...NFT_APPS,
  ...P2P_APPS,
  ...AGENT_APPS,
  ...INTEREST_APPS,
  ...DIVIDEND_APPS,
  ...CONTENT_APPS,
  ...RENTAL_APPS,
  ...TRADING_PLATFORM_APPS
]

