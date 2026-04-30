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
    Re-run the research → scrape → write pipeline for a quota-paused campaign.
    search_blogs continues from the saved pagination offset automatically.
    """
    from db.database import retry_session
    from tools.search import search_blogs, QuotaExceededException
    from pipeline.scraper_agent import run_scraper_agent
    from pipeline.writer_agent import run_writer_agent
    from db.models import Campaign, CampaignStatus

    async with retry_session() as db:
        try:
            new_sources = await search_blogs(niche, campaign_id, db, user_id=user_id)
            logger.info("[resume] Campaign %d found %d new sources", campaign_id, len(new_sources))

            if new_sources:
                count = await run_scraper_agent(new_sources, campaign_id, db)
                logger.info("[resume] Campaign %d scraped %d new leads", campaign_id, count)
                await run_writer_agent(campaign_id, niche, db)

            campaign = await db.get(Campaign, campaign_id)
            if campaign and campaign.status == CampaignStatus.running:
                campaign.status = CampaignStatus.completed
            await db.commit()

        except QuotaExceededException:
            logger.warning("[resume] Campaign %d hit quota again — staying paused", campaign_id)

        except Exception as exc:
            logger.error("[resume] Campaign %d failed: %s", campaign_id, exc)
            campaign = await db.get(Campaign, campaign_id)
            if campaign:
                campaign.status = CampaignStatus.error
            await db.commit()


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
