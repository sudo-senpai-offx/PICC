"""PICC agents microservice (FastAPI).

Exposes the same contracts as the n8n workflows so the dashboard can call CrewAI
directly. Run:  uvicorn server:app --port 8000

Endpoints (all decision-support only):
  POST /simulate         {"ticker","capital","risk","horizon"}       -> commentary report
  POST /analyze-listing  {"title","bullets":[],"asin"}               -> {"suggestions":[...]}
  POST /generate-content {"topic","kind"}                            -> {"draft":{...}}
"""

import json
import os
from pathlib import Path
from typing import List, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from crew import (
    PiccBountyCrew,
    PiccCashClawCrew,
    PiccContentCrew,
    PiccDepinCrew,
    PiccInvestmentCrew,
    PiccListingCrew,
    PiccResearchCrew,
    PiccStrategistCrew,
    PiccTradingCrew,
)

load_dotenv()

SETTINGS_FILE = Path(__file__).parent / "settings.json"


def _apply_settings(settings: dict) -> None:
    """Apply saved settings to the running process environment."""
    if settings.get("model"):
        os.environ["AGENTS_LLM_MODEL"] = str(settings["model"])
    if settings.get("base_url"):
        os.environ["AGENTS_LLM_BASE_URL"] = str(settings["base_url"])
    if settings.get("api_key"):
        os.environ["OPENAI_API_KEY"] = str(settings["api_key"])
    os.environ["AGENTS_LLM_ENABLED"] = "1" if settings.get("enabled", True) else "0"


def _load_settings() -> dict:
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def _effective_settings() -> dict:
    return {
        "model": os.getenv("AGENTS_LLM_MODEL", "openai/llama-3.3-70b-versatile"),
        "base_url": os.getenv("AGENTS_LLM_BASE_URL", "https://api.groq.com/openai/v1"),
        "api_key_configured": bool(os.getenv("OPENAI_API_KEY")),
        "enabled": os.getenv("AGENTS_LLM_ENABLED", "1") != "0",
    }


_apply_settings(_load_settings())

app = FastAPI(title="PICC Agents", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SimulateRequest(BaseModel):
    ticker: str = "VOO"
    capital: float = 10000
    risk: Literal["conservative", "moderate", "aggressive"] = "moderate"
    horizon: int = 10


class ListingRequest(BaseModel):
    title: str
    bullets: List[str] = Field(default_factory=list)
    asin: Optional[str] = None


class ContentRequest(BaseModel):
    topic: str
    kind: Literal["blog", "youtube_script", "affiliate_review", "social"] = "blog"


class TradingRequest(BaseModel):
    asset: str = "EUR/USD"
    price: float = 0
    direction: str = "neutral"
    confidence: float = 50
    horizon: str = "5m"
    context: str = ""


class InvestmentRequest(BaseModel):
    topic: str = "Best passive income from crypto in 2026"
    budget: float = 500
    risk: str = "moderate"


class AgentSettings(BaseModel):
    model: str = Field(default="openai/llama-3.3-70b-versatile", min_length=1)
    base_url: str = Field(default="https://api.groq.com/openai/v1", min_length=1)
    api_key: Optional[str] = Field(default="", max_length=256)
    enabled: bool = True


def _crew_enabled() -> bool:
    return os.getenv("OPENAI_API_KEY") and os.getenv("AGENTS_LLM_ENABLED", "1") != "0"


@app.get("/settings")
def get_settings() -> dict:
    return _effective_settings()


@app.post("/settings")
def save_settings(req: AgentSettings) -> dict:
    settings = {"model": req.model, "base_url": req.base_url, "api_key": req.api_key, "enabled": req.enabled}
    with open(SETTINGS_FILE, "w", encoding="utf-8") as fh:
        json.dump(settings, fh, indent=2)
    _apply_settings(settings)
    return _effective_settings()


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "agents": ["researcher", "analyst", "content_creator", "listing_analyst", "trading_strategist", "defi_analyst", "nft_royalty_analyst", "bounty_hunter", "cashclaw_hunter", "depin_optimizer", "content_strategist"],
        "llm": _effective_settings(),
    }


class ResearchRequest(BaseModel):
    topic: str = "What is a good passive income strategy in 2026?"


@app.post("/run/research")
def run_research(req: ResearchRequest) -> dict:
    """Runs the Researcher -> Analyst crew live and returns the full report."""
    if not _crew_enabled():
        return {"source": "local", "report": "Live crew disabled or no API key. Enable it in the PICC Settings page."}
    crew = PiccResearchCrew()
    result = crew.crew().kickoff(inputs={"topic": req.topic})
    return {"source": "crewai", "report": str(result)}


@app.post("/simulate")
def simulate(req: SimulateRequest) -> dict:
    if not _crew_enabled():
        return {"source": "local", "notes": "Live crew disabled or no API key."}
    crew = PiccResearchCrew()
    result = crew.crew().kickoff(
        inputs={
            "topic": (
                f"Monte Carlo projection context for {req.ticker} over {req.horizon} years, "
                f"starting capital ${req.capital:.0f}, risk tolerance {req.risk}. "
                "Provide analysis-style commentary: expected ranges, risks, and a suggested allocation."
            )
        }
    )
    return {"source": "crewai", "notes": str(result)}


@app.post("/analyze-listing")
def analyze_listing(req: ListingRequest) -> dict:
    if not _crew_enabled():
        return {
            "source": "local",
            "suggestions": [
                {
                    "id": "s-fallback",
                    "title": "AI unavailable",
                    "body": "Live listing crew disabled or no API key. Enable it in the PICC Settings page.",
                    "confidence": 0.5,
                }
            ],
        }
    crew = PiccListingCrew()
    result = crew.crew().kickoff(
        inputs={
            "title": req.title,
            "bullets": "\n".join(req.bullets) if req.bullets else "N/A",
            "asin": req.asin or "N/A",
        }
    )
    return {"source": "crewai", "suggestions": str(result)}


@app.post("/generate-content")
def generate_content(req: ContentRequest) -> dict:
    if not _crew_enabled():
        return {
            "source": "local",
            "draft": {
                "headline": f"Guide to {req.topic}",
                "script": "Live content crew disabled or no API key. Enable it in the PICC Settings page.",
                "tags": [req.topic.replace(" ", "-").lower()],
                "cta": "Subscribe for more.",
            },
        }
    crew = PiccContentCrew()
    result = crew.crew().kickoff(
        inputs={"topic": req.topic, "platform": "youtube" if req.kind == "youtube_script" else req.kind, "format": req.kind}
    )
    return {"source": "crewai", "draft": str(result)}


@app.post("/run/trading")
def run_trading(req: TradingRequest) -> dict:
    """Runs the Trading Strategist crew on a Trading Suite signal context."""
    if not _crew_enabled():
        return {"source": "local", "commentary": "Live trading crew disabled or no API key. Enable it in the PICC Settings page."}
    crew = PiccTradingCrew()
    result = crew.crew().kickoff(
        inputs={
            "asset": req.asset,
            "price": f"${req.price:,.4f}" if req.price else "N/A",
            "direction": req.direction,
            "confidence": f"{req.confidence:.0f}",
            "horizon": req.horizon,
            "context": req.context or "No additional context provided.",
        }
    )
    return {"source": "crewai", "commentary": str(result)}


@app.post("/run/investment")
def run_investment(req: InvestmentRequest) -> dict:
    """Runs the DeFi/Staking/NFT strategist crew on a passive-income question."""
    if not _crew_enabled():
        return {"source": "local", "report": "Live investment crew disabled or no API key. Enable it in the PICC Settings page."}
    crew = PiccInvestmentCrew()
    result = crew.crew().kickoff(
        inputs={
            "topic": req.topic,
            "budget": f"${req.budget:,.0f}",
            "risk": req.risk,
        }
    )
    return {"source": "crewai", "report": str(result)}


class BountyRequest(BaseModel):
    topic: str = "Which AIGEN bounties are worth pursuing right now?"


@app.post("/run/bounty")
def run_bounty(req: BountyRequest) -> dict:
    """Runs the AIGEN Bounty Hunter crew and returns the ranked shortlist."""
    if not _crew_enabled():
        return {"source": "local", "report": "Live bounty crew disabled or no API key. Enable it in the PICC Settings page."}
    crew = PiccBountyCrew()
    result = crew.crew().kickoff(inputs={"topic": req.topic})
    return {"source": "crewai", "report": str(result)}


class CashClawRequest(BaseModel):
    wallet: str = "primary"
    context: str = ""


@app.post("/run/cashclaw")
def run_cashclaw(req: CashClawRequest) -> dict:
    """Runs the CashClaw crew — crypto rewards recovery audit (claims, expiry, clawbacks)."""
    if not _crew_enabled():
        return {"source": "local", "report": "Live CashClaw crew disabled or no API key. Enable it in the PICC Settings page."}
    crew = PiccCashClawCrew()
    result = crew.crew().kickoff(inputs={"wallet": req.wallet, "context": req.context or "No recent activity provided."})
    return {"source": "crewai", "report": str(result)}


class DepinRequest(BaseModel):
    devices: str = "Honeygain, EarnApp, Grass, Gradient"
    context: str = ""


@app.post("/run/depin")
def run_depin(req: DepinRequest) -> dict:
    """Runs the DePIN optimizer crew on the user's node/device setup."""
    if not _crew_enabled():
        return {"source": "local", "report": "Live DePIN crew disabled or no API key. Enable it in the PICC Settings page."}
    crew = PiccDepinCrew()
    result = crew.crew().kickoff(inputs={"devices": req.devices, "context": req.context or "No health context provided."})
    return {"source": "crewai", "report": str(result)}


class StrategistRequest(BaseModel):
    streams: str = "Honeygain, ExpertOption demo, content affiliate, staking"
    audience: str = "beginners interested in passive income"


@app.post("/run/strategist")
def run_strategist(req: StrategistRequest) -> dict:
    """Runs the Content Strategist crew on the user's income streams."""
    if not _crew_enabled():
        return {"source": "local", "report": "Live strategist crew disabled or no API key. Enable it in the PICC Settings page."}
    crew = PiccStrategistCrew()
    result = crew.crew().kickoff(inputs={"streams": req.streams, "audience": req.audience})
    return {"source": "crewai", "report": str(result)}
