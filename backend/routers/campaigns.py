import asyncio
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from db.database import get_db
from db.models import Campaign, CampaignStatus, Lead, ValidityStatus, BlogSource, OutreachEmail, OutreachStatus
from utils.auth import get_current_user_id
from pipeline.research_agent import run_research_agent
from pipeline.scraper_agent import run_scraper_agent
from pipeline.writer_agent import run_writer_agent
from tools.validator import validate_email
from datetime import datetime

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


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


@router.get("", response_model=list[CampaignResponse])
async def list_campaigns(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[CampaignResponse]:
    result = await db.execute(
        select(Campaign).where(Campaign.user_id == user_id).order_by(Campaign.created_at.desc())
    )
    return [CampaignResponse.model_validate(c) for c in result.scalars().all()]


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
    return CampaignResponse.model_validate(campaign)


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


async def _run_pipeline(campaign_id: int, niche: str) -> None:
    """
    Resumable pipeline: each step checks existing data and skips if already done.
    Order: research → scrape (new sources only) → write (new leads only) → validate (unverified only)
    """
    from db.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
        campaign = result.scalar_one_or_none()
        if not campaign:
            return

        campaign.status = CampaignStatus.running
        await db.commit()

        try:
            # ── Step 1: Research ──────────────────────────────────────────
            # Skip if sources already exist; otherwise fetch new ones via SerpAPI.
            existing_sources_result = await db.execute(
                select(BlogSource).where(BlogSource.campaign_id == campaign_id)
            )
            existing_sources = existing_sources_result.scalars().all()

            if existing_sources:
                print(f"[pipeline] Skipping research — {len(existing_sources)} sources already exist")
                sources = [{"id": s.id, "url": s.url, "blog_name": s.blog_name} for s in existing_sources]
            else:
                sources = await run_research_agent(niche, campaign_id, db)
                print(f"[pipeline] Research found {len(sources)} sources")

            # ── Step 2: Scrape ────────────────────────────────────────────
            # Only scrape sources that have no leads associated yet.
            scraped_ids_result = await db.execute(
                select(Lead.source_blog_id).where(
                    Lead.campaign_id == campaign_id,
                    Lead.source_blog_id.isnot(None),
                )
            )
            already_scraped: set[int] = {row[0] for row in scraped_ids_result.all()}
            new_sources = [s for s in sources if s.get("id") not in already_scraped]

            if new_sources:
                count = await run_scraper_agent(new_sources, campaign_id, db)
                print(f"[pipeline] Scraped {count} new leads from {len(new_sources)} sources")
            else:
                print(f"[pipeline] Skipping scrape — all sources already scraped")

            # ── Step 3: Write ─────────────────────────────────────────────
            # Writer agent skips leads that already have a pending/approved/sent email.
            generated = await run_writer_agent(campaign_id, niche, db)
            print(f"[pipeline] Generated {generated} new outreach emails")

            # ── Step 4: Validate ──────────────────────────────────────────
            # Only validate leads still marked unverified.
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
                        lead.validated_at = datetime.utcnow()
                    except Exception:
                        pass

                await asyncio.gather(*[_validate(lead) for lead in unverified])
                await db.commit()
                print(f"[pipeline] Validated {len(unverified)} leads")
            else:
                print(f"[pipeline] Skipping validation — no unverified leads")

            # Mark complete
            result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
            campaign = result.scalar_one_or_none()
            if campaign:
                campaign.status = CampaignStatus.completed
            await db.commit()

        except Exception as e:
            result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
            campaign = result.scalar_one_or_none()
            if campaign:
                campaign.status = CampaignStatus.error
            await db.commit()
            print(f"[pipeline] Error for campaign {campaign_id}: {e}")


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

    background_tasks.add_task(_run_pipeline, campaign_id, campaign.niche)
    return {"message": "Pipeline started", "campaign_id": campaign_id}
