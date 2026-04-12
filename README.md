# OutreachAI — Automated Blog Outreach System

End-to-end outreach automation: find blogs, scrape contacts, validate emails, write personalized outreach with GPT-4o-mini, and track opens — all in one tool.

## Architecture

```
outreach-system/
├── backend/     FastAPI + SQLAlchemy + asyncpg (PostgreSQL)
└── frontend/    Next.js 16 + Tailwind CSS + Framer Motion
```

## Prerequisites

- Python 3.12+, [uv](https://docs.astral.sh/uv/) package manager
- Node.js 18+
- PostgreSQL database (Neon recommended — free tier works)
- OpenAI API key
- SerpAPI key (for blog discovery)
- Gmail account with App Password (or any SMTP provider)

---

## Backend Setup

```bash
cd backend

# Copy and fill in environment variables
cp .env.example .env
# Edit .env — set DATABASE_URL, OPENAI_API_KEY, SERPAPI_KEY, SMTP_*, SECRET_KEY

# Install dependencies and run
uv sync
uv run uvicorn main:app --reload --port 8000
```

The server starts at `http://localhost:8000`. On startup it:
- Creates all database tables automatically
- Runs an SMTP health check (logs a warning if SMTP is not configured)

API docs available at `http://localhost:8000/docs`.

---

## Frontend Setup

```bash
cd frontend

# Copy and fill in environment variables
cp .env.example .env.local
# NEXT_PUBLIC_API_URL should point to your running backend

npm install
npm run dev
```

The app starts at `http://localhost:3000`.

---

## Environment Variables

### `backend/.env`

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (e.g. Neon) |
| `SECRET_KEY` | JWT signing secret (min 32 chars) |
| `ALGORITHM` | JWT algorithm — `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access token TTL — `15` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Refresh token TTL — `7` |
| `OPENAI_API_KEY` | OpenAI API key for email generation |
| `SERPAPI_KEY` | SerpAPI key for blog discovery |
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port — `587` for TLS |
| `SMTP_USER` | SMTP username / email address |
| `SMTP_PASS` | SMTP password or App Password |
| `SMTP_FROM_NAME` | Display name for outgoing emails |
| `BASE_URL` | Public URL of the backend (for tracking pixel) |

### `frontend/.env.local`

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API URL — `http://localhost:8000` |

---

## User Flow

1. **Sign up** at `/signup` and log in
2. **Create a campaign** — enter a name and niche (e.g. "SaaS", "fitness")
3. **Run the pipeline** — the system:
   - Searches for blogs via SerpAPI (3 query variants)
   - Scrapes contact emails from each blog's homepage, `/contact`, `/about`
   - Validates emails (syntax → MX → SMTP soft check)
   - Generates personalized outreach with GPT-4o-mini (1 LLM call per lead)
4. **Review outreach emails** — edit inline, approve or reject each one
5. **Bulk send** approved emails with open tracking
6. **Monitor** opens and retry failed sends from the Sent log

---

## Key Features

- **Duplicate detection** — emails already scraped for a campaign are flagged, not re-inserted
- **Rate limiting** — 1–3s random delay between scraper requests
- **Email validation** — syntax + MX record + optional SMTP RCPT TO handshake
- **Open tracking** — 1×1 transparent GIF served from `/track/{id}.png`
- **Retry logic** — up to 3 retries with 5s / 15s / 45s exponential backoff
- **JWT auth** — 15-min access tokens, 7-day refresh tokens, auto-refresh in frontend
- **CSV export** — leads and blog sources exportable from the UI

---

## API Reference

Full interactive docs at `http://localhost:8000/docs` once the server is running.

| Method | Path | Description |
|---|---|---|
| POST | `/auth/signup` | Create account |
| POST | `/auth/login` | Login |
| POST | `/auth/refresh` | Refresh access token |
| GET | `/campaigns` | List campaigns |
| POST | `/campaigns` | Create campaign |
| POST | `/campaigns/{id}/run` | Trigger pipeline |
| GET | `/campaigns/{id}/sources` | Blog sources |
| GET | `/campaigns/{id}/leads` | Leads with validity |
| POST | `/leads/validate` | Re-validate selected leads |
| POST | `/leads/bulk-delete` | Delete selected leads |
| GET | `/leads/export/{campaign_id}` | Download leads CSV |
| GET | `/outreach/pending` | Pending emails to review |
| GET | `/outreach/approved` | Approved emails for bulk send |
| PATCH | `/outreach/{id}/approve` | Approve email |
| PATCH | `/outreach/{id}/reject` | Reject email |
| PATCH | `/outreach/{id}/edit` | Edit subject/body |
| POST | `/bulk/send` | Send approved emails |
| POST | `/bulk/delete` | Delete outreach emails |
| GET | `/sent` | Sent log |
| POST | `/sent/{id}/retry` | Retry failed send |
| GET | `/track/{id}.png` | Open tracking pixel |
| GET | `/settings/smtp` | Get SMTP config |
| POST | `/settings/smtp` | Save SMTP config |
| POST | `/settings/smtp/test` | Test SMTP connection |
| GET | `/settings/profile` | Get profile |
| PATCH | `/settings/profile` | Update profile |
| DELETE | `/settings/account` | Delete account |
