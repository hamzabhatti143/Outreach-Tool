from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from datetime import datetime
from db.database import get_db
from db.models import OutreachEmail, OutreachStatus, Lead, BlogSource
from utils.auth import get_current_user_id

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


async def _enrich_emails(emails: list, db: AsyncSession) -> list[OutreachResponse]:
    """Batch-load leads and blogs in 2 queries instead of N*2 queries."""
    if not emails:
        return []

    # Batch load all leads
    lead_ids = [e.lead_id for e in emails]
    leads_result = await db.execute(select(Lead).where(Lead.id.in_(lead_ids)))
    leads_map: dict[int, Lead] = {l.id: l for l in leads_result.scalars().all()}

    # Batch load all blogs
    blog_ids = {l.source_blog_id for l in leads_map.values() if l.source_blog_id}
    blogs_map: dict[int, BlogSource] = {}
    if blog_ids:
        blogs_result = await db.execute(select(BlogSource).where(BlogSource.id.in_(blog_ids)))
        blogs_map = {b.id: b for b in blogs_result.scalars().all()}

    output = []
    for e in emails:
        lead = leads_map.get(e.lead_id)
        blog = blogs_map.get(lead.source_blog_id) if lead and lead.source_blog_id else None
        # status may be an enum instance or plain string — normalise to str
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


@router.get("/pending", response_model=list[OutreachResponse])
async def list_pending(
    campaign_id: int | None = None,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[OutreachResponse]:
    query = select(OutreachEmail).where(OutreachEmail.status == OutreachStatus.pending)
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
    query = select(OutreachEmail).where(OutreachEmail.status == OutreachStatus.approved)
    if campaign_id:
        query = query.where(OutreachEmail.campaign_id == campaign_id)
    result = await db.execute(query.order_by(OutreachEmail.approved_at.desc()))
    return await _enrich_emails(result.scalars().all(), db)


@router.patch("/{email_id}/approve")
async def approve_email(
    email_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(OutreachEmail).where(OutreachEmail.id == email_id)
    )
    email = result.scalar_one_or_none()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
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
    result = await db.execute(
        select(OutreachEmail).where(OutreachEmail.id == email_id)
    )
    email = result.scalar_one_or_none()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
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
    result = await db.execute(
        select(OutreachEmail).where(OutreachEmail.id == email_id)
    )
    email = result.scalar_one_or_none()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    if req.subject is not None:
        email.subject = req.subject
    if req.body is not None:
        email.body = req.body
    await db.commit()
    await db.refresh(email)
    enriched = await _enrich_emails([email], db)
    return enriched[0]
