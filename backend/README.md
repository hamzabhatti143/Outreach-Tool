# OutreachAI Backend

FastAPI backend for the OutreachAI outreach automation system.

## Quick Start

```bash
# From this directory
cp .env.example .env
# Fill in .env values

uv sync
uv run uvicorn main:app --reload --port 8000
```

See the [root README](../README.md) for full setup instructions and environment variable reference.

## Structure

```
backend/
├── db/
│   ├── database.py      async SQLAlchemy engine + session factory
│   └── models.py        ORM models: User, Campaign, Lead, OutreachEmail, SentLog, ...
├── pipeline/
│   ├── research_agent.py  blog discovery via SerpAPI
│   ├── scraper_agent.py   email scraping + duplicate detection
│   ├── writer_agent.py    outreach email generation (GPT-4o-mini)
│   └── sender_agent.py    bulk email sending
├── routers/
│   ├── auth.py            JWT signup/login/refresh
│   ├── campaigns.py       campaign CRUD + pipeline trigger
│   ├── sources.py         blog sources + CSV export
│   ├── leads.py           leads + validation + CSV export
│   ├── outreach.py        email review (pending/approved/edit)
│   ├── bulk.py            bulk send + bulk delete
│   ├── sent.py            sent log + retry
│   ├── tracking.py        1x1 open tracking pixel
│   └── settings.py        SMTP config + profile
├── tools/
│   ├── search.py          SerpAPI blog search
│   ├── scraper.py         httpx email scraper
│   ├── validator.py       syntax + MX + SMTP validation
│   ├── email_writer.py    GPT-4o-mini outreach writer
│   └── mailer.py          SMTP sender with retry backoff
├── utils/
│   ├── auth.py            JWT helpers + bcrypt
│   ├── smtp_check.py      startup SMTP health check
│   └── export.py          CSV serializers
└── main.py                FastAPI app + CORS + lifespan
```
