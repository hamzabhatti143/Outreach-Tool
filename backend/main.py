import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db.database import init_db
from routers import auth, campaigns, sources, leads, outreach, bulk, sent, tracking, settings, replies, template
from routers import gmail

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://outreach-tool-drab.vercel.app")


# ── Background tasks ──────────────────────────────────────────────────────────

async def _check_and_reset_quota() -> None:
    """
    Check if the search quota flag was set and 12 hours have passed.
    If yes: clear the flag and re-trigger research for all quota_paused campaigns.
    """
    from db.database import retry_session
    from db.models import AppSettings, Campaign, CampaignStatus
    from sqlalchemy import select

    async with retry_session() as db:
        result = await db.execute(
            select(AppSettings).where(AppSettings.key == "quota_exceeded_at")
        )
        setting = result.scalar_one_or_none()
        if not setting or not setting.value:
            return

        try:
            exceeded_at = datetime.fromisoformat(setting.value)
        except Exception:
            return

        if datetime.now(timezone.utc).replace(tzinfo=None) - exceeded_at < timedelta(hours=12):
            return

        await db.delete(setting)

        paused_result = await db.execute(
            select(Campaign).where(Campaign.status == CampaignStatus.quota_paused)
        )
        paused = paused_result.scalars().all()

        logger.info("[quota_reset] resuming %d paused campaigns", len(paused))

        campaign_data = [(c.id, c.niche, c.user_id) for c in paused]
        for c in paused:
            c.status = CampaignStatus.running

        await db.commit()

    for campaign_id, niche, user_id in campaign_data:
        asyncio.create_task(_resume_research_for_campaign(campaign_id, niche, user_id))


async def _resume_research_for_campaign(campaign_id: int, niche: str, user_id: int) -> None:
    from routers.campaigns import _run_pipeline
    await _run_pipeline(campaign_id, niche, user_id)


async def _quota_reset_loop() -> None:
    """Every 30 minutes check if quota_paused campaigns can resume."""
    while True:
        await asyncio.sleep(1800)
        try:
            await _check_and_reset_quota()
        except Exception as exc:
            logger.error("[quota_reset_loop] %s", exc)


async def _poll_replies_for_all_users() -> None:
    """Poll Gmail for new replies from every user who has Gmail connected."""
    from db.database import retry_session
    from db.models import User
    from sqlalchemy import select
    from tools.reply_tracker import poll_inbox

    async with retry_session() as db:
        result = await db.execute(
            select(User.id).where(User.gmail_refresh_token.isnot(None))
        )
        user_ids = [row[0] for row in result.all()]

    for user_id in user_ids:
        try:
            outcome = await poll_inbox(user_id)
            if outcome.get("new"):
                logger.info("[reply_poll] user_id=%d: %d new replies", user_id, outcome["new"])
            if outcome.get("errors"):
                logger.warning("[reply_poll] user_id=%d errors: %s", user_id, outcome["errors"])
        except Exception as exc:
            logger.error("[reply_poll] user_id=%d: %s", user_id, exc)


async def _reply_poll_loop() -> None:
    """Poll Gmail replies every 10 minutes for all connected users."""
    while True:
        await asyncio.sleep(int(os.getenv("REPLY_POLL_INTERVAL_MINUTES", "10")) * 60)
        try:
            await _poll_replies_for_all_users()
        except Exception as exc:
            logger.error("[reply_poll_loop] %s", exc)


# ── App setup ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database...")
    await init_db()
    logger.info("Database initialized.")

    quota_task = asyncio.create_task(_quota_reset_loop())
    poll_task = asyncio.create_task(_reply_poll_loop())
    logger.info("Background tasks started. Frontend: %s", FRONTEND_URL)

    yield

    quota_task.cancel()
    poll_task.cancel()
    for task in (quota_task, poll_task):
        try:
            await task
        except asyncio.CancelledError:
            pass
    logger.info("Shutting down.")


app = FastAPI(
    title="Outreach Tool API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(gmail.router)
app.include_router(campaigns.router)
app.include_router(sources.router)
app.include_router(leads.router)
app.include_router(outreach.router)
app.include_router(bulk.router)
app.include_router(sent.router)
app.include_router(tracking.router)
app.include_router(settings.router)
app.include_router(replies.router)
app.include_router(template.router)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "frontend": FRONTEND_URL,
        "backend": os.getenv("BASE_URL", ""),
    }
