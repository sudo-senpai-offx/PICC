"""PICC CrewAI crew definitions.

Five crews power the PICC features:
- PiccResearchCrew  : researcher -> analyst            (general topic reports / financial research)
- PiccContentCrew   : researcher -> analyst -> content_creator (Content Studio)
- PiccListingCrew   : listing_analyst                  (Listing Optimizer)
- PiccTradingCrew   : trading_strategist               (Trading Suite signal commentary)
- PiccInvestmentCrew: nft_royalty_analyst -> defi_analyst (DeFi / staking / NFT strategy)

Every agent is decision-support only: crews return text/JSON, never execute actions.
"""

from crewai import Agent, Crew, LLM, Process, Task
from crewai.project import CrewBase, agent, crew, task
from crewai_tools import SerperDevTool
import os

SEARCH_TOOL = SerperDevTool() if os.getenv("SERPER_API_KEY") else None

# Free LLM provider via Groq's OpenAI-compatible endpoint. No OpenAI account needed.
# Configured at runtime through GET/POST /settings (model, base_url, api_key) or
# with the AGENTS_LLM_* env vars / .env. get_llm() reads the environment each time
# a crew is built, so changing /settings takes effect on the next kickoff.
def get_llm() -> LLM:
    return LLM(
        model=os.getenv("AGENTS_LLM_MODEL", "openai/llama-3.3-70b-versatile"),
        base_url=os.getenv("AGENTS_LLM_BASE_URL", "https://api.groq.com/openai/v1"),
    )


@CrewBase
class PiccResearchCrew:
    """Researcher -> Analyst. Produces a markdown research + analysis report."""

    agents_config = "config/research_agents.yaml"
    tasks_config = "config/research_tasks.yaml"

    @agent
    def researcher(self) -> Agent:
        return Agent(
            config=self.agents_config["researcher"],
            llm=get_llm(),
            tools=[SEARCH_TOOL] if SEARCH_TOOL else [],
            verbose=True,
        )

    @agent
    def analyst(self) -> Agent:
        return Agent(config=self.agents_config["analyst"], llm=get_llm(), verbose=True)

    @task
    def research_task(self) -> Task:
        return Task(config=self.tasks_config["research_task"])

    @task
    def analysis_task(self) -> Task:
        return Task(config=self.tasks_config["analysis_task"])

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
        )


@CrewBase
class PiccContentCrew:
    """Researcher -> Analyst -> Content Creator. Produces platform-ready content."""

    agents_config = "config/content_agents.yaml"
    tasks_config = "config/content_tasks.yaml"

    @agent
    def researcher(self) -> Agent:
        return Agent(
            config=self.agents_config["researcher"],
            llm=get_llm(),
            tools=[SEARCH_TOOL] if SEARCH_TOOL else [],
            verbose=True,
        )

    @agent
    def analyst(self) -> Agent:
        return Agent(config=self.agents_config["analyst"], llm=get_llm(), verbose=True)

    @agent
    def content_creator(self) -> Agent:
        return Agent(config=self.agents_config["content_creator"], llm=get_llm(), verbose=True)

    @task
    def research_task(self) -> Task:
        return Task(config=self.tasks_config["research_task"])

    @task
    def analysis_task(self) -> Task:
        return Task(config=self.tasks_config["analysis_task"])

    @task
    def content_task(self) -> Task:
        return Task(config=self.tasks_config["content_task"])

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
        )


@CrewBase
class PiccListingCrew:
    """Listing analyst only. Produces JSON listing suggestions."""

    agents_config = "config/listing_agents.yaml"
    tasks_config = "config/listing_tasks.yaml"

    @agent
    def listing_analyst(self) -> Agent:
        return Agent(config=self.agents_config["listing_analyst"], llm=get_llm(), verbose=True)

    @task
    def listing_task(self) -> Task:
        return Task(config=self.tasks_config["listing_task"])

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
        )


@CrewBase
class PiccTradingCrew:
    """Trading strategist only. Produces markdown trading commentary for Trading Suite signals."""

    agents_config = "config/trading_agents.yaml"
    tasks_config = "config/trading_tasks.yaml"

    @agent
    def trading_strategist(self) -> Agent:
        return Agent(config=self.agents_config["trading_strategist"], llm=get_llm(), verbose=True)

    @task
    def trading_task(self) -> Task:
        return Task(config=self.tasks_config["trading_task"])

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
        )


@CrewBase
class PiccInvestmentCrew:
    """DeFi/Staking/NFT strategists. Produces a passive-income strategy report."""

    agents_config = "config/investment_agents.yaml"
    tasks_config = "config/investment_tasks.yaml"

    @agent
    def defi_analyst(self) -> Agent:
        return Agent(config=self.agents_config["defi_analyst"], llm=get_llm(), verbose=True)

    @agent
    def nft_royalty_analyst(self) -> Agent:
        return Agent(config=self.agents_config["nft_royalty_analyst"], llm=get_llm(), verbose=True)

    @task
    def nft_task(self) -> Task:
        return Task(config=self.tasks_config["nft_task"])

    @task
    def strategy_task(self) -> Task:
        return Task(config=self.tasks_config["strategy_task"])

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
        )


@CrewBase
class PiccBountyCrew:
    """Bounty hunter only. Produces a ranked AIGEN bounty shortlist with first steps."""

    agents_config = "config/bounty_agents.yaml"
    tasks_config = "config/bounty_tasks.yaml"

    @agent
    def bounty_hunter(self) -> Agent:
        return Agent(
            config=self.agents_config["bounty_hunter"],
            llm=get_llm(),
            tools=[SEARCH_TOOL] if SEARCH_TOOL else [],
            verbose=True,
        )

    @task
    def bounty_task(self) -> Task:
        return Task(config=self.tasks_config["bounty_task"])

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
        )


@CrewBase
class PiccCashClawCrew:
    """CashClaw hunter only. Produces a crypto rewards recovery audit (claims, expiry, clawbacks)."""

    agents_config = "config/cashclaw_agents.yaml"
    tasks_config = "config/cashclaw_tasks.yaml"

    @agent
    def cashclaw_hunter(self) -> Agent:
        return Agent(config=self.agents_config["cashclaw_hunter"], llm=get_llm(), verbose=True)

    @task
    def cashclaw_task(self) -> Task:
        return Task(config=self.tasks_config["cashclaw_task"])

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
        )


@CrewBase
class PiccDepinCrew:
    """DePIN optimizer only. Produces a network/uptime optimization report."""

    agents_config = "config/depin_agents.yaml"
    tasks_config = "config/depin_tasks.yaml"

    @agent
    def depin_optimizer(self) -> Agent:
        return Agent(
            config=self.agents_config["depin_optimizer"],
            llm=get_llm(),
            tools=[SEARCH_TOOL] if SEARCH_TOOL else [],
            verbose=True,
        )

    @task
    def depin_task(self) -> Task:
        return Task(config=self.tasks_config["depin_task"])

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
        )


@CrewBase
class PiccStrategistCrew:
    """Content strategist only. Produces a content strategy tied to real income streams."""

    agents_config = "config/strategist_agents.yaml"
    tasks_config = "config/strategist_tasks.yaml"

    @agent
    def content_strategist(self) -> Agent:
        return Agent(config=self.agents_config["content_strategist"], llm=get_llm(), verbose=True)

    @task
    def strategist_task(self) -> Task:
        return Task(config=self.tasks_config["strategist_task"])

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
        )


__all__ = [
    "PiccResearchCrew",
    "PiccContentCrew",
    "PiccListingCrew",
    "PiccTradingCrew",
    "PiccInvestmentCrew",
    "PiccBountyCrew",
    "PiccCashClawCrew",
    "PiccDepinCrew",
    "PiccStrategistCrew",
]
