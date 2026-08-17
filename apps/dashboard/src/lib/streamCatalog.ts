// PICC passive income catalog — verified against public sources (2026).
// Includes only services that were confirmed alive at verification time;
// dead/broken platforms (Peer2Profit, PacketShare, SpeedShare, Wipter,
// AntGain, GagaNode, earn.cc, WizardGain) are intentionally excluded.
export interface CatalogEntry {
  id: string
  name: string
  category:
    | "bandwidth"
    | "depin"
    | "storage"
    | "compute"
    | "crypto"
    | "nft"
    | "p2p"
    | "agent"
    | "interest"
    | "dividend"
    | "rental"
    | "content"
    | "other"
  residential: boolean
  vps: boolean
  payout: string
  url: string
  note?: string
}

export const STREAM_CATEGORY_LABELS: Record<string, string> = {
  bandwidth: "Bandwidth",
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
  other: "Other"
}

export const BANDWIDTH_APPS: CatalogEntry[] = [
  { id: "honeygain", name: "Honeygain", category: "bandwidth", residential: true, vps: false, payout: "PayPal, Crypto", url: "https://dashboard.honeygain.com", note: "Direct API collector built into PICC." },
  { id: "earnapp", name: "EarnApp", category: "bandwidth", residential: true, vps: false, payout: "PayPal, Amazon Gift Card, Wise", url: "https://earnapp.com", note: "Desktop/Android app. ToS prohibits Docker, VMs, hosting services and home servers — keep it off the Pi node; track as a desktop-only stream." },
  { id: "iproyal", name: "IPRoyal Pawns", category: "bandwidth", residential: true, vps: false, payout: "PayPal, Crypto, Bank", url: "https://pawns.app" },
  { id: "packetstream", name: "PacketStream", category: "bandwidth", residential: true, vps: false, payout: "PayPal", url: "https://packetstream.io" },
  { id: "traffmonetizer", name: "Traffmonetizer", category: "bandwidth", residential: true, vps: true, payout: "USDT, PayPal", url: "https://traffmonetizer.com", note: "ToS says residential; VPS accepted in practice." },
  { id: "repocket", name: "Repocket", category: "bandwidth", residential: true, vps: true, payout: "PayPal, Wise, Crypto", url: "https://repocket.com", note: "VPS accepted at lower rates; max 5 devices/sessions per account; min payout $10." },
  { id: "earnfm", name: "EarnFM", category: "bandwidth", residential: true, vps: true, payout: "Crypto", url: "https://earn.fm" },
  { id: "proxyrack", name: "ProxyRack", category: "bandwidth", residential: true, vps: true, payout: "PayPal, Crypto", url: "https://peer.proxyrack.com" },
  { id: "mysterium", name: "Mysterium / MystNodes", category: "bandwidth", residential: false, vps: true, payout: "Crypto (MYST)", url: "https://mystnodes.co" },
  { id: "grass", name: "Grass", category: "bandwidth", residential: true, vps: false, payout: "Crypto", url: "https://app.grass.io" },
  { id: "gradient", name: "Gradient Network", category: "bandwidth", residential: true, vps: false, payout: "Crypto", url: "https://app.gradient.network" },
  { id: "nodepay", name: "Nodepay", category: "bandwidth", residential: true, vps: false, payout: "Crypto", url: "https://app.nodepay.ai" },
  { id: "dawn", name: "Dawn Internet", category: "bandwidth", residential: true, vps: false, payout: "Crypto", url: "https://dawninternet.com" },
  { id: "bytebenefit", name: "ByteBenefit", category: "bandwidth", residential: true, vps: false, payout: "PayPal, Stripe", url: "https://bytebenefit.io" },
  { id: "bytelixir", name: "ByteLixir", category: "bandwidth", residential: true, vps: true, payout: "Crypto", url: "https://bytelixir.com" },
  { id: "passiveapp", name: "PassiveApp", category: "bandwidth", residential: true, vps: true, payout: "Crypto, PayPal", url: "https://passiveapp.com" },
  { id: "titan", name: "Titan Network", category: "bandwidth", residential: true, vps: false, payout: "Crypto", url: "https://edge.titannet.info" },
  { id: "urnetwork", name: "URnetwork", category: "bandwidth", residential: true, vps: false, payout: "Crypto", url: "https://ur.io" },
  { id: "spide", name: "Spide", category: "bandwidth", residential: true, vps: false, payout: "Crypto", url: "https://spide.network" },
  { id: "teneo", name: "Teneo Protocol", category: "bandwidth", residential: true, vps: false, payout: "Crypto", url: "https://dashboard.teneo.pro" },
  { id: "anyone", name: "Anyone Protocol", category: "bandwidth", residential: false, vps: true, payout: "Crypto", url: "https://anyone.io" },
  { id: "proxybase", name: "ProxyBase", category: "bandwidth", residential: false, vps: true, payout: "Crypto, USDC", url: "https://peer.proxybase.org" },
  { id: "proxylite", name: "ProxyLite", category: "bandwidth", residential: false, vps: true, payout: "Crypto, PayPal", url: "https://proxylite.ru" },
  { id: "presearch", name: "Presearch", category: "bandwidth", residential: false, vps: true, payout: "Crypto", url: "https://presearch.com" },
  { id: "gridlink", name: "GridLink", category: "bandwidth", residential: true, vps: false, payout: "USDC (Solana)", url: "https://gridlink.network", note: "Android app — idle phones act as bandwidth relay nodes; ~$0.003/MB settled on-chain." },
  { id: "openloop", name: "OpenLoop", category: "bandwidth", residential: true, vps: false, payout: "Crypto (OPL)", url: "https://openloop.so", note: "Solana DePIN — share unused bandwidth via browser extension; $15M+ raised." },
  { id: "hivello", name: "Hivello", category: "bandwidth", residential: true, vps: true, payout: "Crypto", url: "https://hivello.com", note: "One app to earn across multiple DePIN networks; monetizes idle CPU." },
  { id: "blockmesh", name: "BlockMesh", category: "bandwidth", residential: true, vps: false, payout: "Crypto", url: "https://blockmesh.io", note: "Passive earning via browser extension — low-touch, minimal effort." }
]

export const DEPIN_APPS: CatalogEntry[] = [
  { id: "helium", name: "Helium", category: "depin", residential: true, vps: false, payout: "Crypto (HNT)", url: "https://helium.com" },
  { id: "deeper", name: "Deeper Network", category: "depin", residential: true, vps: false, payout: "Crypto (DPR)", url: "https://deeper.network" },
  { id: "sentinel", name: "Sentinel dVPN", category: "depin", residential: false, vps: true, payout: "Crypto (DVPN)", url: "https://sentinel.co" },
  { id: "theta-edge", name: "Theta Edge Node", category: "depin", residential: false, vps: true, payout: "Crypto (TFUEL)", url: "https://thetatoken.org" },
  { id: "silencio", name: "Silencio", category: "depin", residential: true, vps: false, payout: "Crypto", url: "https://www.silencio.network", note: "Mobile app — earn by mapping noise levels. Phone can stay in your pocket." },
  { id: "coin-app", name: "COIN (XYO)", category: "depin", residential: true, vps: false, payout: "Crypto (COIN/XYO)", url: "https://www.coinapp.co", note: "Location-data rewards via the COIN mobile app; $10M+ paid out historically." },
  { id: "denet-watcher", name: "DeNet Watcher", category: "depin", residential: true, vps: false, payout: "Crypto", url: "https://denet.app", note: "Turn a phone into a storage watcher node for passive income." },
  { id: "rustchain", name: "RustChain", category: "depin", residential: true, vps: false, payout: "Crypto", url: "https://rustchain.io", note: "Proof-of-Antiquity chain for vintage hardware — old machines outmine new ones. AI-powered hardware fingerprinting." },
  { id: "solar-mining", name: "Project Solar Mining", category: "depin", residential: true, vps: false, payout: "Crypto (BTC)", url: "https://github.com/satoshiokaeritai/Project-Solar-Mining", note: "Open-source — mine BTC with excess solar from home panels." }
]

export const STORAGE_APPS: CatalogEntry[] = [
  { id: "storj", name: "Storj", category: "storage", residential: false, vps: true, payout: "Crypto (STORJ)", url: "https://storj.dev", note: "Nodes on the same /24 subnet share allocation." }
]

export const COMPUTE_APPS: CatalogEntry[] = [
  { id: "io-net", name: "io.net", category: "compute", residential: false, vps: true, payout: "Crypto", url: "https://io.net", note: "Requires a GPU." },
  { id: "nosana", name: "Nosana", category: "compute", residential: false, vps: true, payout: "Crypto", url: "https://nosana.io", note: "Requires a GPU, 50GB+ storage." },
  { id: "salad", name: "Salad", category: "compute", residential: true, vps: false, payout: "PayPal, Gift Cards", url: "https://salad.io", note: "Requires a GPU." },
  { id: "vast-ai", name: "Vast.ai", category: "compute", residential: false, vps: true, payout: "Crypto, Bank", url: "https://cloud.vast.ai", note: "Rent out idle GPUs." },
  { id: "golem", name: "Golem Network", category: "compute", residential: false, vps: true, payout: "Crypto (GLM)", url: "https://golem.network" },
  { id: "flux", name: "Flux", category: "compute", residential: false, vps: true, payout: "Crypto (FLUX)", url: "https://runonflux.io", note: "220GB+ storage." }
]

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

export const CATALOG = [
  ...BANDWIDTH_APPS,
  ...DEPIN_APPS,
  ...STORAGE_APPS,
  ...COMPUTE_APPS,
  ...CRYPTO_APPS,
  ...DEFI_APPS,
  ...NFT_APPS,
  ...P2P_APPS,
  ...AGENT_APPS,
  ...INTEREST_APPS,
  ...DIVIDEND_APPS,
  ...CONTENT_APPS,
  ...RENTAL_APPS
]

