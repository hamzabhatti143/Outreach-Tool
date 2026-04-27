from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from datetime import datetime
from db.database import get_db
from db.models import SentLog, OutreachEmail, Lead, BlogSource, OutreachStatus, EmailReply, Campaign
from utils.auth import get_current_user_id
from tools.mailer import send_email

router = APIRouter(prefix="/sent", tags=["sent"])


class SentLogResponse(BaseModel):
    id: int
    outreach_email_id: int
    recipient_email: str
    blog_name: str | None
    subject: str
    sent_at: datetime
    status: str
    open_count: int
    last_opened_at: datetime | None
    retry_count: int
    reply_sentiment: str | None  # sentiment of the most recent reply, if any

    class Config:
        from_attributes = True


@router.get("", response_model=list[SentLogResponse])
async def list_sent(
    status_filter: str | None = None,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[SentLogResponse]:
    # Only return sent logs for emails that belong to the current user's campaigns
    user_campaign_ids_q = select(Campaign.id).where(Campaign.user_id == user_id).scalar_subquery()
    query = (
        select(SentLog)
        .join(OutreachEmail, OutreachEmail.id == SentLog.outreach_email_id)
        .where(OutreachEmail.campaign_id.in_(user_campaign_ids_q))
        .order_by(SentLog.sent_at.desc())
    )
    if status_filter:
        query = query.where(SentLog.status == status_filter)

    result = await db.execute(query)
    logs = result.scalars().all()

    if not logs:
        return []

    # Batch-load outreach emails
    oe_ids = [log.outreach_email_id for log in logs]
    oe_res = await db.execute(select(OutreachEmail).where(OutreachEmail.id.in_(oe_ids)))
    oe_map: dict[int, OutreachEmail] = {oe.id: oe for oe in oe_res.scalars().all()}

    # Batch-load leads
    lead_ids = list({oe.lead_id for oe in oe_map.values()})
    lead_res = await db.execute(select(Lead).where(Lead.id.in_(lead_ids)))
    lead_map: dict[int, Lead] = {lead.id: lead for lead in lead_res.scalars().all()}

    # Batch-load blogs
    blog_ids = {lead.source_blog_id for lead in lead_map.values() if lead.source_blog_id}
    blog_map: dict[int, BlogSource] = {}
    if blog_ids:
        blog_res = await db.execute(select(BlogSource).where(BlogSource.id.in_(blog_ids)))
        blog_map = {b.id: b for b in blog_res.scalars().all()}

    # Batch-load most recent reply per outreach_email_id
    replies_res = await db.execute(
        select(EmailReply)
        .where(EmailReply.outreach_email_id.in_(oe_ids))
        .order_by(EmailReply.received_at.desc())
    )
    all_replies = replies_res.scalars().all()
    # Keep only the most-recent reply per outreach_email_id
    reply_sentiment_map: dict[int, str | None] = {}
    for r in all_replies:
        if r.outreach_email_id not in reply_sentiment_map:
            reply_sentiment_map[r.outreach_email_id] = r.sentiment

    output: list[SentLogResponse] = []
    for log in logs:
        oe = oe_map.get(log.outreach_email_id)
        if not oe:
            continue
        lead = lead_map.get(oe.lead_id)
        blog = blog_map.get(lead.source_blog_id) if lead and lead.source_blog_id else None

        status_val = log.status.value if hasattr(log.status, "value") else str(log.status)

        output.append(SentLogResponse(
            id=log.id,
            outreach_email_id=log.outreach_email_id,
            recipient_email=lead.email if lead else "",
            blog_name=blog.blog_name if blog else None,
            subject=oe.subject,
            sent_at=log.sent_at,
            status=status_val,
            open_count=log.open_count,
            last_opened_at=log.last_opened_at,
            retry_count=log.retry_count,
            reply_sentiment=reply_sentiment_map.get(log.outreach_email_id),
        ))

    return output


@router.post("/{log_id}/retry")
async def retry_send(
    log_id: int,
    background_tasks: BackgroundTasks,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    log = await db.get(SentLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log entry not found")

    email_obj = await db.get(OutreachEmail, log.outreach_email_id)
    if not email_obj:
        raise HTTPException(status_code=404, detail="Outreach email not found")

    # Verify ownership
    camp_res = await db.execute(
        select(Campaign).where(Campaign.id == email_obj.campaign_id, Campaign.user_id == user_id)
    )
    if not camp_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Log entry not found")

    email_obj.status = OutreachStatus.approved
    log.retry_count = max(0, log.retry_count - 1)
    await db.commit()

    async def _retry(outreach_id: int) -> None:
        from db.database import AsyncSessionLocal
        async with AsyncSessionLocal() as session:
            await send_email(outreach_id, session)

    background_tasks.add_task(_retry, log.outreach_email_id)
    return {"message": "Retry queued", "log_id": log_id}
