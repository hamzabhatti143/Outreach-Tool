from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from datetime import datetime
from db.database import get_db
from db.models import SentLog, OutreachEmail, Lead, OutreachStatus
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

    class Config:
        from_attributes = True


@router.get("", response_model=list[SentLogResponse])
async def list_sent(
    status_filter: str | None = None,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[SentLogResponse]:
    query = select(SentLog).order_by(SentLog.sent_at.desc())
    if status_filter:
        query = query.where(SentLog.status == status_filter)

    result = await db.execute(query)
    logs = result.scalars().all()

    output = []
    for log in logs:
        email = await db.get(OutreachEmail, log.outreach_email_id)
        if not email:
            continue

        lead = await db.get(Lead, email.lead_id) if email else None
        recipient = lead.email if lead else ""

        blog_name = None
        if lead and lead.source_blog_id:
            from db.models import BlogSource
            blog = await db.get(BlogSource, lead.source_blog_id)
            if blog:
                blog_name = blog.blog_name

        output.append(SentLogResponse(
            id=log.id,
            outreach_email_id=log.outreach_email_id,
            recipient_email=recipient,
            blog_name=blog_name,
            subject=email.subject if email else "",
            sent_at=log.sent_at,
            status=log.status.value,
            open_count=log.open_count,
            last_opened_at=log.last_opened_at,
            retry_count=log.retry_count,
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

    email = await db.get(OutreachEmail, log.outreach_email_id)
    if not email:
        raise HTTPException(status_code=404, detail="Outreach email not found")

    # Reset to approved for retry
    email.status = OutreachStatus.approved
    log.retry_count = max(0, log.retry_count - 1)
    await db.commit()

    async def _retry(outreach_id: int) -> None:
        from db.database import AsyncSessionLocal
        async with AsyncSessionLocal() as session:
            await send_email(outreach_id, session)

    background_tasks.add_task(_retry, log.outreach_email_id)
    return {"message": "Retry queued", "log_id": log_id}
