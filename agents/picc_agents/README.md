# PICC Agents (CrewAI)

Multi-agent research / analysis / content crew powering the PICC features. All agents are
**decision-support only** — they return text or JSON, never execute actions.

## Setup

```bash
python -m venv .venv
.\.venv\Scripts\activate          # Windows
pip install -r requirements.txt
cp .env.example .env              # add OPENAI_API_KEY, SERPER_API_KEY
```

## CLI

```bash
python main.py research --topic "REIT investments in Southeast Asia 2026"
python main.py content  --topic "REIT investing" --platform youtube --format script
python main.py listing  --title "Example widget" --bullets "Benefit A;Benefit B" --asin B0EXAMPLE
python main.py simulate --ticker VOO --capital 10000 --risk moderate --horizon 10
```

## Microservice

```bash
uvicorn server:app --port 8000
```

Then point the dashboard at it via `PICC_AGENTS_URL=http://localhost:8000` in
`apps/dashboard/.env`. The dashboard's Agents page uses it for live crew runs.

| Endpoint | Body | Returns |
| :-- | :-- | :-- |
| `GET /health` | — | `{status, agents[]}` |
| `POST /run/research` | `{topic}` | live Researcher → Analyst report |
| `POST /simulate` | `{ticker, capital, risk, horizon}` | commentary report |
| `POST /analyze-listing` | `{title, bullets[], asin}` | suggestions JSON |
| `POST /generate-content` | `{topic, kind}` | draft JSON |

## Crews

- `PiccResearchCrew` — researcher → analyst (reports)
- `PiccContentCrew` — researcher → analyst → content_creator (Content Studio)
- `PiccListingCrew` — listing_analyst (Listing Optimizer)

Config lives in `config/*.yaml` (one `*_agents.yaml` + `*_tasks.yaml` pair per crew). Add a new
income stream by adding a config pair and a new `@CrewBase` class in `crew.py`.
