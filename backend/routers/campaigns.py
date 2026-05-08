import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from db.database import get_db
from db.models import Campaign, CampaignStatus, Lead, ValidityStatus, BlogSource, OutreachEmail, OutreachStatus, CampaignEvent
from utils.auth import get_current_user_id
from pipeline.research_agent import run_research_agent
from pipeline.scraper_agent import run_scraper_agent
from pipeline.writer_agent import run_writer_agent
from tools.validator import validate_email
from tools.search import QuotaExceededException
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/campaigns", tags=["campaigns"])

# Campaigns whose pipeline should abort at the next checkpoint
_stop_requested: set[int] = set()


class CampaignCreate(BaseModel):
    niche: str
    name: str


class CampaignResponse(BaseModel):
    id: int
    niche: str
    name: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True

    @classmethod
    def from_campaign(cls, c: "Campaign") -> "CampaignResponse":
        status_val = c.status.value if hasattr(c.status, "value") else str(c.status)
        return cls(id=c.id, niche=c.niche, name=c.name, status=status_val, created_at=c.created_at)


@router.get("", response_model=list[CampaignResponse])
async def list_campaigns(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[CampaignResponse]:
    result = await db.execute(
        select(Campaign).where(Campaign.user_id == user_id).order_by(Campaign.created_at.desc())
    )
    return [CampaignResponse.from_campaign(c) for c in result.scalars().all()]


@router.post("", response_model=CampaignResponse, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    body: CampaignCreate,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> CampaignResponse:
    campaign = Campaign(user_id=user_id, niche=body.niche, name=body.name)
    db.add(campaign)
    await db.flush()
    await db.commit()
    return CampaignResponse.from_campaign(campaign)


@router.get("/events")
async def list_campaign_events(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
    limit: int = 20,
) -> list[dict]:
    user_camp_ids = select(Campaign.id).where(Campaign.user_id == user_id).scalar_subquery()
    result = await db.execute(
        select(CampaignEvent)
        .where(CampaignEvent.campaign_id.in_(user_camp_ids))
        .order_by(CampaignEvent.created_at.desc())
        .limit(limit)
    )
    events = result.scalars().all()
    return [
        {
            "id": e.id,
            "campaign_id": e.campaign_id,
            "event_type": e.event_type,
            "message": e.message,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in events
    ]


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_campaign(
    campaign_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.user_id == user_id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    await db.delete(campaign)
    await db.commit()


async def _run_pipeline(campaign_id: int, niche: str, user_id: int | None = None) -> None:
    """
    Continuous pipeline loop — keeps running until the user stops it.
    Each iteration: research (≥30 new blogs) → scrape emails → write drafts → validate.
    Uses a separate DB session per step to avoid long-lived connections.
    Backs off exponentially when no new blogs are found.
    """
    from db.database import retry_session

    logger.info("[pipeline] Campaign %d starting continuous loop", campaign_id)

    # ── Mark running ─────────────────────────────────────────────────────────
    async with retry_session() as db:
        result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
        campaign = result.scalar_one_or_none()
        if not campaign:
            return
        campaign.status = CampaignStatus.running
        db.add(CampaignEvent(campaign_id=campaign_id, event_type="pipeline",
                             message="Pipeline started"))
        await db.commit()

    consecutive_empty = 0  # Rounds with zero new blogs found

    while campaign_id not in _stop_requested:

        # ── Step 1: Research — always search for more blogs ──────────────────
        new_sources: list[dict] = []
        try:
            async with retry_session() as db:
                new_sources = await run_research_agent(niche, campaign_id, db,
                                                       user_id=user_id)
            logger.info("[pipeline] Campaign %d: found %d new blogs this round",
                        campaign_id, len(new_sources))
        except QuotaExceededException:
            logger.warning("[pipeline] Campaign %d: SerpAPI quota exceeded — pausing",
                           campaign_id)
            # _handle_quota_exceeded already set status = quota_paused
            _stop_requested.discard(campaign_id)
            return
        except Exception as exc:
            logger.error("[pipeline] Campaign %d research error: %s", campaign_id, exc)

        if campaign_id in _stop_requested:
            break

        # ── Step 2: Scrape new blogs for emails ──────────────────────────────
        if new_sources:
            try:
                async with retry_session() as db:
                    count = await run_scraper_agent(new_sources, campaign_id, db)
                logger.info("[pipeline] Campaign %d: scraped %d new emails from %d blogs",
                            campaign_id, count, len(new_sources))
            except Exception as exc:
                logger.error("[pipeline] Campaign %d scrape error: %s", campaign_id, exc)

        if campaign_id in _stop_requested:
            break

        # ── Step 3: Write outreach drafts ────────────────────────────────────
        try:
            async with retry_session() as db:
                generated = await run_writer_agent(campaign_id, niche, db)
            if generated:
                logger.info("[pipeline] Campaign %d: created %d new outreach drafts",
                            campaign_id, generated)
        except Exception as exc:
            logger.error("[pipeline] Campaign %d writer error: %s", campaign_id, exc)

        if campaign_id in _stop_requested:
            break

        # ── Step 4: Validate unverified leads ────────────────────────────────
        try:
            async with retry_session() as db:
                unverified_result = await db.execute(
                    select(Lead).where(
                        Lead.campaign_id == campaign_id,
                        Lead.validity_status == ValidityStatus.unverified,
                    )
                )
                unverified = unverified_result.scalars().all()
                if unverified:
                    async def _validate(lead: Lead) -> None:
                        try:
                            v = await validate_email(lead.email)
                            lead.validity_status = ValidityStatus(v["status"])
                            lead.validated_at = datetime.now(timezone.utc).replace(tzinfo=None)
                        except Exception:
                            pass
                    await asyncio.gather(*[_validate(lead) for lead in unverified])
                    await db.commit()
                    logger.info("[pipeline] Campaign %d: validated %d leads",
                                campaign_id, len(unverified))
        except Exception as exc:
            logger.error("[pipeline] Campaign %d validate error: %s", campaign_id, exc)

        if campaign_id in _stop_requested:
            break

        # ── Throttle ─────────────────────────────────────────────────────────
        if not new_sources:
            consecutive_empty += 1
            # Back off: 60s → 120s → 180s … capped at 10 minutes
            wait_secs = min(60 * consecutive_empty, 600)
            logger.info(
                "[pipeline] Campaign %d: no new blogs — waiting %ds before next round "
                "(empty round #%d)",
                campaign_id, wait_secs, consecutive_empty,
            )
            elapsed = 0
            while elapsed < wait_secs and campaign_id not in _stop_requested:
                await asyncio.sleep(1)
                elapsed += 1
        else:
            consecutive_empty = 0
            await asyncio.sleep(2)  # Brief pause between active rounds

    # ── Cleanup ──────────────────────────────────────────────────────────────
    _stop_requested.discard(campaign_id)
    async with retry_session() as db:
        result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
        campaign = result.scalar_one_or_none()
        if campaign:
            status_val = (campaign.status.value
                          if hasattr(campaign.status, "value") else str(campaign.status))
            if status_val != "quota_paused":
                campaign.status = CampaignStatus.idle
            db.add(CampaignEvent(campaign_id=campaign_id, event_type="pipeline",
                                 message="Pipeline stopped"))
        await db.commit()
    logger.info("[pipeline] Campaign %d stopped", campaign_id)


@router.get("/{campaign_id}/stats")
async def campaign_stats(
    campaign_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.user_id == user_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Campaign not found")

    sources_res = await db.execute(
        select(func.count(BlogSource.id)).where(BlogSource.campaign_id == campaign_id)
    )
    leads_res = await db.execute(
        select(func.count(Lead.id)).where(Lead.campaign_id == campaign_id)
    )
    pending_res = await db.execute(
        select(func.count(OutreachEmail.id)).where(
            OutreachEmail.campaign_id == campaign_id,
            OutreachEmail.status == OutreachStatus.pending,
        )
    )
    approved_res = await db.execute(
        select(func.count(OutreachEmail.id)).where(
            OutreachEmail.campaign_id == campaign_id,
            OutreachEmail.status == OutreachStatus.approved,
        )
    )
    sent_res = await db.execute(
        select(func.count(OutreachEmail.id)).where(
            OutreachEmail.campaign_id == campaign_id,
            OutreachEmail.status == OutreachStatus.sent,
        )
    )

    # Reload campaign for pagination stats
    camp_res2 = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id)
    )
    camp = camp_res2.scalar_one_or_none()

    return {
        "sources": sources_res.scalar() or 0,
        "leads": leads_res.scalar() or 0,
        "pending_outreach": pending_res.scalar() or 0,
        "approved_outreach": approved_res.scalar() or 0,
        "sent_outreach": sent_res.scalar() or 0,
        "total_blogs_fetched": (camp.total_blogs_fetched or 0) if camp else 0,
        "last_search_page": (camp.last_search_page or 0) if camp else 0,
    }


@router.post("/{campaign_id}/run", status_code=status.HTTP_202_ACCEPTED)
async def run_campaign(
    campaign_id: int,
    background_tasks: BackgroundTasks,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.user_id == user_id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.status == CampaignStatus.running:
        raise HTTPException(status_code=409, detail="Campaign is already running")

    background_tasks.add_task(_run_pipeline, campaign_id, campaign.niche, user_id)
    return {"message": "Pipeline started", "campaign_id": campaign_id}


@router.post("/{campaign_id}/stop")
async def stop_campaign(
    campaign_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.user_id == user_id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    status_val = campaign.status.value if hasattr(campaign.status, "value") else str(campaign.status)
    _stop_requested.add(campaign_id)

    if status_val == "running":
        # Pipeline is still active — let it detect the flag at the next checkpoint
        return {"message": "Stop requested", "campaign_id": campaign_id}
    else:
        # Pipeline already finished — force status back to idle so user can re-run
        campaign.status = CampaignStatus.idle
        await db.commit()
        return {"message": "Campaign reset to idle", "campaign_id": campaign_id}


@router.post("/stop-all")
async def stop_all_campaigns(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(Campaign).where(Campaign.user_id == user_id)
    )
    all_campaigns = result.scalars().all()

    for c in all_campaigns:
        _stop_requested.add(c.id)
        status_val = c.status.value if hasattr(c.status, "value") else str(c.status)
        if status_val != "running":
            c.status = CampaignStatus.idle

    await db.commit()
    return {"message": "Stop requested for all campaigns", "count": len(all_campaigns)}
