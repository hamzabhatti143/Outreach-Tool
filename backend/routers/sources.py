from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from datetime import datetime
from db.database import get_db
from db.models import BlogSource, SearchQuery, Lead, Campaign
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

    class Config:
        from_attributes = True


@router.get("/{campaign_id}/sources", response_model=list[SourceResponse])
async def list_sources(
    campaign_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[SourceResponse]:
    # Verify campaign belongs to user
    camp_result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.user_id == user_id)
    )
    if not camp_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Campaign not found")

    result = await db.execute(
        select(BlogSource).where(BlogSource.campaign_id == campaign_id)
        .order_by(BlogSource.found_at.desc())
    )
    sources = result.scalars().all()

    output = []
    for source in sources:
        # Count leads from this source
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
        ))

    return output


@router.get("/{campaign_id}/sources/export")
async def export_sources(
    campaign_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    camp_result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.user_id == user_id)
    )
    if not camp_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Campaign not found")

    sources = await list_sources(campaign_id, user_id, db)
    csv_data = sources_to_csv([s.model_dump() for s in sources])

    return StreamingResponse(
        io.StringIO(csv_data),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=sources_{campaign_id}.csv"},
    )
