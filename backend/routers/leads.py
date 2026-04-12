from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from datetime import datetime
from db.database import get_db
from db.models import Lead, BlogSource, Campaign, ValidityStatus
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


@router.get("/campaigns/{campaign_id}/leads", response_model=list[LeadResponse])
async def list_leads(
    campaign_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[LeadResponse]:
    await _get_campaign_or_404(campaign_id, user_id, db)

    # Delete duplicates from DB on every fetch — keeps DB clean automatically
    await db.execute(
        delete(Lead).where(Lead.campaign_id == campaign_id, Lead.is_duplicate == True)
    )
    await db.commit()

    # Fetch only non-duplicate leads
    result = await db.execute(
        select(Lead).where(
            Lead.campaign_id == campaign_id,
            Lead.is_duplicate == False,
        ).order_by(Lead.id.desc())
    )
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

    result = await db.execute(select(Lead).where(Lead.id.in_(body.ids)))
    leads = result.scalars().all()

    async def _v(lead: Lead) -> None:
        try:
            v = await validate_email(lead.email)
            lead.validity_status = ValidityStatus(v["status"])
            lead.validated_at = datetime.utcnow()  # naive UTC — matches TIMESTAMP WITHOUT TIME ZONE column
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
    await db.execute(delete(Lead).where(Lead.id.in_(body.ids)))
    await db.commit()


@router.get("/leads/export/{campaign_id}")
async def export_leads(
    campaign_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    await _get_campaign_or_404(campaign_id, user_id, db)
    leads = await list_leads(campaign_id, user_id, db)
    csv_data = leads_to_csv([l.model_dump() for l in leads])
    return StreamingResponse(
        io.StringIO(csv_data),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=leads_{campaign_id}.csv"},
    )
