import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db.database import init_db
from routers import auth, campaigns, sources, leads, outreach, bulk, sent, tracking, settings, replies
from routers import gmail

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _check_and_reset_quota() -> None:
    """
    Check if SerpAPI quota was exceeded and 12 hours have passed.
    If yes: clear the quota flag and re-trigger research for all quota_paused campaigns.
    """
    from db.database import AsyncSessionLocal
    from db.models import AppSettings, Campaign, CampaignStatus
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
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

        if datetime.utcnow() - exceeded_at < timedelta(hours=12):
            return

        # 12 hours have passed — clear the flag
        await db.delete(setting)

        # Find all campaigns waiting for quota reset
        paused_result = await db.execute(
            select(Campaign).where(Campaign.status == CampaignStatus.quota_paused)
        )
        paused = paused_result.scalars().all()

        logger.info("SerpAPI quota reset detected, resuming %d campaigns", len(paused))

        campaign_data = [(c.id, c.niche, c.user_id) for c in paused]
        for c in paused:
            c.status = CampaignStatus.running

        await db.commit()

    # Kick off resume tasks outside the DB session
    for campaign_id, niche, user_id in campaign_data:
        asyncio.create_task(_resume_research_for_campaign(campaign_id, niche, user_id))


async def _resume_research_for_campaign(campaign_id: int, niche: str, user_id: int) -> None:
    """
    Resume a quota-paused campaign by restarting the continuous pipeline loop.
    Pagination state is preserved on the Campaign row so the loop picks up where it left off.
    """
    from routers.campaigns import _run_pipeline
    await _run_pipeline(campaign_id, niche, user_id)


async def _quota_reset_loop() -> None:
    """Background loop: every 30 minutes, check if SerpAPI quota has reset."""
    while True:
        await asyncio.sleep(1800)  # 30 minutes
        try:
            await _check_and_reset_quota()
        except Exception as exc:
            logger.error("[quota_reset_loop] Unhandled error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database...")
    await init_db()
    logger.info("Database initialized.")

    task = asyncio.create_task(_quota_reset_loop())
    logger.info("Quota reset scheduler started.")

    yield

    task.cancel()
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
        "http://localhost:3000",
        "https://hamzabhatti-outreach-tool-82fb335.hf.space",
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


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
