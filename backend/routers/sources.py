from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from datetime import datetime
from db.database import get_db
from db.models import BlogSource, SearchQuery, Lead, Campaign, OutreachEmail
from utils.auth import get_current_user_id
from utils.export import sources_to_csv
import io

router = APIRouter(prefix="/campaigns", tags=["sources"])


class SourceResponse(BaseModel):
    id: int
    blog_name: str | None
    url: str
    query_string: str | None
    email_count: int
    found_at: datetime
    already_emailed: bool = False

    class Config:
        from_attributes = True


async def _build_sources(
    campaign_id: int,
    db: AsyncSession,
    show_all: bool = False,
) -> list[SourceResponse]:
    """
    Return blog sources for a campaign.
    When show_all=False (default): only uncontacted blogs (no approved/sent lead).
    When show_all=True: all blogs, with already_emailed flag set on contacted ones.
    """
    # Sub-query: lead IDs that already have an approved or sent outreach email
    emailed_lead_ids_q = (
        select(OutreachEmail.lead_id)
        .where(
            OutreachEmail.campaign_id == campaign_id,
            OutreachEmail.status.in_(["approved", "sent"]),
        )
        .scalar_subquery()
    )

    # Sub-query: blog source IDs that have at least one such lead
    emailed_blog_ids_q = (
        select(Lead.source_blog_id)
        .where(
            Lead.source_blog_id.isnot(None),
            Lead.id.in_(emailed_lead_ids_q),
        )
        .scalar_subquery()
    )

    base_query = (
        select(BlogSource)
        .where(BlogSource.campaign_id == campaign_id)
        .order_by(BlogSource.found_at.desc())
    )

    if not show_all:
        base_query = base_query.where(BlogSource.id.notin_(emailed_blog_ids_q))

    result = await db.execute(base_query)
    sources = result.scalars().all()

    # Build emailed set for badge rendering when show_all=True
    emailed_ids: set[int] = set()
    if show_all and sources:
        emailed_res = await db.execute(
            select(Lead.source_blog_id)
            .where(
                Lead.source_blog_id.isnot(None),
                Lead.source_blog_id.in_([s.id for s in sources]),
                Lead.id.in_(emailed_lead_ids_q),
            )
        )
        emailed_ids = {row[0] for row in emailed_res.all()}

    output: list[SourceResponse] = []
    for source in sources:
        count_result = await db.execute(
            select(func.count(Lead.id)).where(Lead.source_blog_id == source.id)
        )
        email_count = count_result.scalar() or 0

        query_string = None
        if source.query_id:
            q_result = await db.execute(
                select(SearchQuery).where(SearchQuery.id == source.query_id)
            )
            q = q_result.scalar_one_or_none()
            if q:
                query_string = q.query_string

        output.append(SourceResponse(
            id=source.id,
            blog_name=source.blog_name,
            url=source.url,
            query_string=query_string,
            email_count=email_count,
            found_at=source.found_at,
            already_emailed=source.id in emailed_ids,
        ))

    return output


@router.get("/{campaign_id}/sources", response_model=list[SourceResponse])
async def list_sources(
    campaign_id: int,
    show_all: bool = False,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[SourceResponse]:
    camp_result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.user_id == user_id)
    )
    if not camp_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Campaign not found")

    return await _build_sources(campaign_id, db, show_all=show_all)


@router.get("/{campaign_id}/sources/export")
async def export_sources(
    campaign_id: int,
    show_all: bool = False,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    camp_result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.user_id == user_id)
    )
    if not camp_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Campaign not found")

    sources = await _build_sources(campaign_id, db, show_all=show_all)
    csv_data = sources_to_csv([s.model_dump() for s in sources])

    return StreamingResponse(
        io.StringIO(csv_data),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=sources_{campaign_id}.csv"},
    )
