"""PICC agents CLI.

Examples:
    python main.py research --topic "REIT investments in Southeast Asia 2026"
    python main.py content  --topic "REIT investing" --platform youtube --format "script"
    python main.py listing  --title "Example widget" --bullets "A;B;C" --asin B0EXAMPLE
    python main.py simulate --ticker VOO --capital 10000 --risk moderate --horizon 10
    python main.py trading  --asset EUR/USD --direction up --confidence 62 --horizon 5m
    python main.py invest   --topic "Crypto staking in 2026" --budget 500 --risk moderate

Requires OPENAI_API_KEY (and SERPER_API_KEY for web search) in .env or environment.
"""

import argparse
import os
import sys

from dotenv import load_dotenv

from crew import (
    PiccContentCrew,
    PiccInvestmentCrew,
    PiccListingCrew,
    PiccResearchCrew,
    PiccTradingCrew,
)

load_dotenv()


def cmd_research(args: argparse.Namespace) -> str:
    crew = PiccResearchCrew()
    result = crew.crew().kickoff(inputs={"topic": args.topic})
    return str(result)


def cmd_content(args: argparse.Namespace) -> str:
    crew = PiccContentCrew()
    result = crew.crew().kickoff(
        inputs={
            "topic": args.topic,
            "platform": args.platform,
            "format": args.format,
        }
    )
    return str(result)


def cmd_listing(args: argparse.Namespace) -> str:
    crew = PiccListingCrew()
    bullets = "\n".join(args.bullets.split(";")) if args.bullets else "N/A"
    result = crew.crew().kickoff(
        inputs={
            "title": args.title,
            "bullets": bullets,
            "asin": args.asin or "N/A",
        }
    )
    return str(result)


def cmd_simulate(args: argparse.Namespace) -> str:
    crew = PiccResearchCrew()
    result = crew.crew().kickoff(
        inputs={
            "topic": (
                f"Monte Carlo projection context for {args.ticker} over {args.horizon} years, "
                f"starting capital ${args.capital}, risk tolerance {args.risk}. "
                "Provide an analysis-style commentary: expected ranges, risks, and a suggested allocation. "
                "Do not give guaranteed returns."
            )
        }
    )
    return str(result)


def cmd_trading(args: argparse.Namespace) -> str:
    crew = PiccTradingCrew()
    result = crew.crew().kickoff(
        inputs={
            "asset": args.asset,
            "price": f"${args.price:,.4f}" if args.price else "N/A",
            "direction": args.direction,
            "confidence": f"{args.confidence:.0f}",
            "horizon": args.horizon,
            "context": args.context or "No additional context provided.",
        }
    )
    return str(result)


def cmd_investment(args: argparse.Namespace) -> str:
    crew = PiccInvestmentCrew()
    result = crew.crew().kickoff(
        inputs={
            "topic": args.topic,
            "budget": f"${args.budget:,.0f}",
            "risk": args.risk,
        }
    )
    return str(result)


def main() -> None:
    parser = argparse.ArgumentParser(prog="picc-agents", description="PICC CrewAI agent CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p_research = sub.add_parser("research", help="Research + analysis report on a topic")
    p_research.add_argument("--topic", required=True)
    p_research.set_defaults(fn=cmd_research)

    p_content = sub.add_parser("content", help="Generate platform-ready content")
    p_content.add_argument("--topic", required=True)
    p_content.add_argument("--platform", default="blog", help="blog | youtube | social")
    p_content.add_argument("--format", default="article", help="article | script | post")
    p_content.set_defaults(fn=cmd_content)

    p_listing = sub.add_parser("listing", help="Analyze an Amazon listing")
    p_listing.add_argument("--title", required=True)
    p_listing.add_argument("--bullets", default="", help="Semicolon-separated bullets")
    p_listing.add_argument("--asin", default="")
    p_listing.set_defaults(fn=cmd_listing)

    p_sim = sub.add_parser("simulate", help="Financial Twin commentary")
    p_sim.add_argument("--ticker", default="VOO")
    p_sim.add_argument("--capital", type=int, default=10000)
    p_sim.add_argument("--risk", default="moderate")
    p_sim.add_argument("--horizon", type=int, default=10)
    p_sim.set_defaults(fn=cmd_simulate)

    p_trading = sub.add_parser("trading", help="Trading Suite signal commentary")
    p_trading.add_argument("--asset", default="EUR/USD")
    p_trading.add_argument("--price", type=float, default=0)
    p_trading.add_argument("--direction", default="neutral")
    p_trading.add_argument("--confidence", type=float, default=50)
    p_trading.add_argument("--horizon", default="5m")
    p_trading.add_argument("--context", default="")
    p_trading.set_defaults(fn=cmd_trading)

    p_invest = sub.add_parser("invest", help="DeFi/staking/NFT strategy report")
    p_invest.add_argument("--topic", default="Best passive income from crypto in 2026")
    p_invest.add_argument("--budget", type=int, default=500)
    p_invest.add_argument("--risk", default="moderate")
    p_invest.set_defaults(fn=cmd_investment)

    args = parser.parse_args()
    if not os.getenv("OPENAI_API_KEY"):
        print("⚠️  OPENAI_API_KEY is not set. Add it to .env or the environment.", file=sys.stderr)
    output = args.fn(args)
    print(output)


if __name__ == "__main__":
    main()
