from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from pydantic import BaseModel
from datetime import datetime, timezone
from db.database import get_db
from db.models import Lead, BlogSource, Campaign, ValidityStatus, OutreachEmail, OutreachStatus
from utils.auth import get_current_user_id
from utils.export import leads_to_csv
from tools.validator import validate_email
import io

router = APIRouter(tags=["leads"])


class LeadResponse(BaseModel):
    id: int
    email: str
    source_blog: str | None
    validity_status: str
    validated_at: datetime | None
    is_duplicate: bool

    class Config:
        from_attributes = True


class BulkIdsRequest(BaseModel):
    ids: list[int]


async def _get_campaign_or_404(campaign_id: int, user_id: int, db: AsyncSession) -> None:
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.user_id == user_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Campaign not found")


@router.get("/campaigns/{campaign_id}/leads/counts")
async def get_lead_counts(
    campaign_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _get_campaign_or_404(campaign_id, user_id, db)

    # Subquery: lead_ids with at least one sent outreach email
    sent_lead_ids_sq = (
        select(OutreachEmail.lead_id)
        .where(
            OutreachEmail.campaign_id == campaign_id,
            OutreachEmail.status == OutreachStatus.sent,
        )
        .scalar_subquery()
    )

    base = select(func.count(Lead.id)).where(
        Lead.campaign_id == campaign_id,
        Lead.is_duplicate.is_(False),
    )

    all_res = await db.execute(base)
    new_res = await db.execute(
        base.where(
            ~Lead.id.in_(sent_lead_ids_sq),
            Lead.validity_status.in_([ValidityStatus.valid, ValidityStatus.unverified]),
        )
    )
    contacted_res = await db.execute(base.where(Lead.id.in_(sent_lead_ids_sq)))
    invalid_res = await db.execute(
        base.where(Lead.validity_status == ValidityStatus.invalid)
    )

    return {
        "all": all_res.scalar() or 0,
        "new": new_res.scalar() or 0,
        "contacted": contacted_res.scalar() or 0,
        "invalid": invalid_res.scalar() or 0,
    }


@router.get("/campaigns/{campaign_id}/leads", response_model=list[LeadResponse])
async def list_leads(
    campaign_id: int,
    tab: str = Query(default="all"),
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[LeadResponse]:
    await _get_campaign_or_404(campaign_id, user_id, db)

    # Delete duplicates from DB on every fetch — keeps DB clean automatically
    await db.execute(
        delete(Lead).where(Lead.campaign_id == campaign_id, Lead.is_duplicate == True)
    )
    await db.commit()

    # Subquery: lead_ids with at least one sent outreach email
    sent_lead_ids_sq = (
        select(OutreachEmail.lead_id)
        .where(
            OutreachEmail.campaign_id == campaign_id,
            OutreachEmail.status == OutreachStatus.sent,
        )
        .scalar_subquery()
    )

    query = select(Lead).where(
        Lead.campaign_id == campaign_id,
        Lead.is_duplicate.is_(False),
    )

    if tab == "new":
        query = query.where(
            ~Lead.id.in_(sent_lead_ids_sq),
            Lead.validity_status.in_([ValidityStatus.valid, ValidityStatus.unverified]),
        )
    elif tab == "contacted":
        query = query.where(Lead.id.in_(sent_lead_ids_sq))
    elif tab == "invalid":
        query = query.where(Lead.validity_status == ValidityStatus.invalid)

    result = await db.execute(query.order_by(Lead.id.desc()))
    leads = result.scalars().all()

    # Batch-load blog names in one query
    blog_ids = {l.source_blog_id for l in leads if l.source_blog_id}
    blogs_map: dict[int, str] = {}
    if blog_ids:
        blogs_result = await db.execute(
            select(BlogSource.id, BlogSource.blog_name).where(BlogSource.id.in_(blog_ids))
        )
        blogs_map = {row.id: row.blog_name for row in blogs_result.all()}

    return [
        LeadResponse(
            id=lead.id,
            email=lead.email,
            source_blog=blogs_map.get(lead.source_blog_id) if lead.source_blog_id else None,
            validity_status=lead.validity_status.value if hasattr(lead.validity_status, "value") else str(lead.validity_status),
            validated_at=lead.validated_at,
            is_duplicate=lead.is_duplicate,
        )
        for lead in leads
    ]


@router.post("/leads/validate")
async def validate_leads(
    body: BulkIdsRequest,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    import asyncio

    user_camp_ids = select(Campaign.id).where(Campaign.user_id == user_id).scalar_subquery()
    result = await db.execute(
        select(Lead).where(Lead.id.in_(body.ids), Lead.campaign_id.in_(user_camp_ids))
    )
    leads = result.scalars().all()

    async def _v(lead: Lead) -> None:
        try:
            v = await validate_email(lead.email)
            lead.validity_status = ValidityStatus(v["status"])
            lead.validated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        except Exception as e:
            print(f"[validate] Error for {lead.email}: {e}")

    await asyncio.gather(*[_v(lead) for lead in leads])
    await db.commit()
    return {"updated": len(leads)}


@router.post("/leads/bulk-delete", status_code=204)
async def bulk_delete_leads(
    body: BulkIdsRequest,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> None:
    user_camp_ids = select(Campaign.id).where(Campaign.user_id == user_id).scalar_subquery()
    await db.execute(
        delete(Lead).where(Lead.id.in_(body.ids), Lead.campaign_id.in_(user_camp_ids))
    )
    await db.commit()


@router.get("/leads/export/{campaign_id}")
async def export_leads(
    campaign_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    await _get_campaign_or_404(campaign_id, user_id, db)
    leads = await list_leads(campaign_id, "all", user_id, db)
    csv_data = leads_to_csv([l.model_dump() for l in leads])
    return StreamingResponse(
        io.StringIO(csv_data),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=leads_{campaign_id}.csv"},
    )
