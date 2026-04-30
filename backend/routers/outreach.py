import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from pydantic import BaseModel
from db.database import get_db
from db.models import OutreachEmail, OutreachStatus, Lead, BlogSource, Campaign, AppSettings
from utils.auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/outreach", tags=["outreach"])


class OutreachResponse(BaseModel):
    id: int
    lead_id: int
    campaign_id: int
    recipient_email: str
    blog_name: str | None
    subject: str
    body: str
    status: str
    created_at: datetime
    approved_at: datetime | None

    class Config:
        from_attributes = True


class EditRequest(BaseModel):
    subject: str | None = None
    body: str | None = None


class ApproveAllRequest(BaseModel):
    campaign_id: int | None = None


class SendAllRequest(BaseModel):
    campaign_id: int | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _enrich_emails(emails: list, db: AsyncSession) -> list[OutreachResponse]:
    if not emails:
        return []

    lead_ids = [e.lead_id for e in emails]
    leads_result = await db.execute(select(Lead).where(Lead.id.in_(lead_ids)))
    leads_map: dict[int, Lead] = {l.id: l for l in leads_result.scalars().all()}

    blog_ids = {l.source_blog_id for l in leads_map.values() if l.source_blog_id}
    blogs_map: dict[int, BlogSource] = {}
    if blog_ids:
        blogs_result = await db.execute(select(BlogSource).where(BlogSource.id.in_(blog_ids)))
        blogs_map = {b.id: b for b in blogs_result.scalars().all()}

    output = []
    for e in emails:
        lead = leads_map.get(e.lead_id)
        blog = blogs_map.get(lead.source_blog_id) if lead and lead.source_blog_id else None
        status_val = e.status.value if hasattr(e.status, "value") else str(e.status)
        output.append(OutreachResponse(
            id=e.id,
            lead_id=e.lead_id,
            campaign_id=e.campaign_id,
            recipient_email=lead.email if lead else "",
            blog_name=blog.blog_name if blog else None,
            subject=e.subject,
            body=e.body,
            status=status_val,
            created_at=e.created_at,
            approved_at=e.approved_at,
        ))
    return output


async def _upsert_app_setting(key: str, value: str, db: AsyncSession) -> None:
    stmt = pg_insert(AppSettings).values(
        key=key,
        value=value,
        updated_at=datetime.utcnow(),
    ).on_conflict_do_update(
        index_elements=["key"],
        set_={"value": value, "updated_at": datetime.utcnow()},
    )
    await db.execute(stmt)
    await db.commit()


async def _background_send_all(email_ids: list[int]) -> None:
    """Send approved emails one-by-one with a 2s delay, tracking progress in app_settings."""
    from db.database import retry_session
    from tools.mailer import send_email

    sent = 0
    failed = 0
    failed_ids: list[int] = []
    total = len(email_ids)

    for i, email_id in enumerate(email_ids):
        async with retry_session() as db:
            try:
                result = await send_email(email_id, db)
                if result["status"] == "sent":
                    sent += 1
                else:
                    failed += 1
                    failed_ids.append(email_id)
            except Exception as exc:
                logger.error("[send_all] email_id=%d failed: %s", email_id, exc)
                failed += 1
                failed_ids.append(email_id)

            progress = {
                "total": total,
                "sent": sent,
                "failed": failed,
                "failed_ids": failed_ids,
                "in_progress": (i + 1) < total,
            }
            await _upsert_app_setting("send_progress", json.dumps(progress), db)

        if (i + 1) < total:
            await asyncio.sleep(2)


async def _get_owned_email(email_id: int, user_id: int, db: AsyncSession) -> OutreachEmail:
    result = await db.execute(
        select(OutreachEmail)
        .join(Campaign, Campaign.id == OutreachEmail.campaign_id)
        .where(OutreachEmail.id == email_id, Campaign.user_id == user_id)
    )
    email = result.scalar_one_or_none()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    return email


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_outreach_drafts(
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

    leads_res = await db.execute(select(Lead).where(Lead.campaign_id == campaign_id))
    leads = leads_res.scalars().all()
    if not leads:
        raise HTTPException(
            status_code=400,
            detail="No leads found for this campaign. Run the full pipeline first."
        )

    from pipeline.writer_agent import run_writer_agent
    try:
        generated = await run_writer_agent(campaign_id, campaign.niche, db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Writer agent failed: {exc}")

    return {"generated": generated, "total_leads": len(leads)}


@router.get("/all", response_model=list[OutreachResponse])
async def list_all(
    campaign_id: int | None = None,
    status: str | None = None,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[OutreachResponse]:
    query = (
        select(OutreachEmail)
        .join(Campaign, Campaign.id == OutreachEmail.campaign_id)
        .where(Campaign.user_id == user_id)
    )
    if campaign_id:
        query = query.where(OutreachEmail.campaign_id == campaign_id)
    if status:
        query = query.where(OutreachEmail.status == status)
    result = await db.execute(query.order_by(OutreachEmail.created_at.desc()))
    return await _enrich_emails(result.scalars().all(), db)


@router.get("/pending", response_model=list[OutreachResponse])
async def list_pending(
    campaign_id: int | None = None,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[OutreachResponse]:
    query = (
        select(OutreachEmail)
        .join(Campaign, Campaign.id == OutreachEmail.campaign_id)
        .where(Campaign.user_id == user_id, OutreachEmail.status == "pending")
    )
    if campaign_id:
        query = query.where(OutreachEmail.campaign_id == campaign_id)
    result = await db.execute(query.order_by(OutreachEmail.created_at.desc()))
    return await _enrich_emails(result.scalars().all(), db)


@router.get("/approved", response_model=list[OutreachResponse])
async def list_approved(
    campaign_id: int | None = None,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[OutreachResponse]:
    query = (
        select(OutreachEmail)
        .join(Campaign, Campaign.id == OutreachEmail.campaign_id)
        .where(Campaign.user_id == user_id, OutreachEmail.status == "approved")
    )
    if campaign_id:
        query = query.where(OutreachEmail.campaign_id == campaign_id)
    result = await db.execute(query.order_by(OutreachEmail.approved_at.desc()))
    return await _enrich_emails(result.scalars().all(), db)


@router.get("/send-progress")
async def get_send_progress(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(AppSettings).where(AppSettings.key == "send_progress")
    )
    setting = result.scalar_one_or_none()
    if not setting or not setting.value:
        return {"total": 0, "sent": 0, "failed": 0, "failed_ids": [], "in_progress": False}
    try:
        return json.loads(setting.value)
    except Exception:
        return {"total": 0, "sent": 0, "failed": 0, "failed_ids": [], "in_progress": False}


@router.post("/approve-all")
async def approve_all(
    body: ApproveAllRequest,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Approve all pending emails for a campaign (or all campaigns if campaign_id is None)."""
    query = (
        select(OutreachEmail)
        .join(Campaign, Campaign.id == OutreachEmail.campaign_id)
        .where(Campaign.user_id == user_id, OutreachEmail.status == OutreachStatus.pending)
    )
    if body.campaign_id:
        query = query.where(OutreachEmail.campaign_id == body.campaign_id)

    result = await db.execute(query)
    emails = result.scalars().all()

    now = datetime.utcnow()
    for email in emails:
        email.status = OutreachStatus.approved
        email.approved_at = now

    await db.commit()
    return {"approved_count": len(emails)}


@router.post("/send-all-approved")
async def send_all_approved(
    body: SendAllRequest,
    background_tasks: BackgroundTasks,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Queue all approved emails for sending with 2s delay between each."""
    query = (
        select(OutreachEmail)
        .join(Campaign, Campaign.id == OutreachEmail.campaign_id)
        .where(Campaign.user_id == user_id, OutreachEmail.status == OutreachStatus.approved)
    )
    if body.campaign_id:
        query = query.where(OutreachEmail.campaign_id == body.campaign_id)

    result = await db.execute(query)
    emails = result.scalars().all()

    if not emails:
        return {"message": "No approved emails to send", "total": 0}

    email_ids = [e.id for e in emails]

    # Initialise progress tracking
    progress = {"total": len(email_ids), "sent": 0, "failed": 0, "failed_ids": [], "in_progress": True}
    await _upsert_app_setting("send_progress", json.dumps(progress), db)

    background_tasks.add_task(_background_send_all, email_ids)

    return {"message": f"Sending {len(email_ids)} emails", "total": len(email_ids)}


@router.patch("/{email_id}/approve")
async def approve_email(
    email_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    email = await _get_owned_email(email_id, user_id, db)
    email.status = OutreachStatus.approved
    email.approved_at = datetime.utcnow()
    await db.commit()
    return {"id": email_id, "status": "approved"}


@router.patch("/{email_id}/reject")
async def reject_email(
    email_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    email = await _get_owned_email(email_id, user_id, db)
    email.status = OutreachStatus.rejected
    await db.commit()
    return {"id": email_id, "status": "rejected"}


@router.patch("/{email_id}/edit", response_model=OutreachResponse)
async def edit_email(
    email_id: int,
    req: EditRequest,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> OutreachResponse:
    email = await _get_owned_email(email_id, user_id, db)
    if req.subject is not None:
        email.subject = req.subject
    if req.body is not None:
        email.body = req.body
    await db.commit()
    await db.refresh(email)
    enriched = await _enrich_emails([email], db)
    return enriched[0]
