from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from db.database import get_db
from db.models import OutreachEmail, Campaign
from utils.auth import get_current_user_id
from pipeline.sender_agent import run_sender_agent

router = APIRouter(prefix="/bulk", tags=["bulk"])


class BulkIdsRequest(BaseModel):
    ids: list[int]


async def _owned_email_ids(ids: list[int], user_id: int, db: AsyncSession) -> list[int]:
    """Return only the email IDs from `ids` that belong to the current user."""
    user_camp_ids = select(Campaign.id).where(Campaign.user_id == user_id).scalar_subquery()
    result = await db.execute(
        select(OutreachEmail.id).where(
            OutreachEmail.id.in_(ids),
            OutreachEmail.campaign_id.in_(user_camp_ids),
        )
    )
    return [r[0] for r in result.all()]


@router.post("/send")
async def bulk_send(
    body: BulkIdsRequest,
    background_tasks: BackgroundTasks,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Send a list of approved outreach emails."""
    verified_ids = await _owned_email_ids(body.ids, user_id, db)

    async def _send(ids: list[int]) -> None:
        from db.database import AsyncSessionLocal
        async with AsyncSessionLocal() as session:
            await run_sender_agent(ids, session)

    background_tasks.add_task(_send, verified_ids)
    return {"message": f"Sending {len(verified_ids)} emails in background", "ids": verified_ids}


@router.post("/delete", status_code=204)
async def bulk_delete(
    body: BulkIdsRequest,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a list of outreach emails."""
    user_camp_ids = select(Campaign.id).where(Campaign.user_id == user_id).scalar_subquery()
    await db.execute(
        delete(OutreachEmail).where(
            OutreachEmail.id.in_(body.ids),
            OutreachEmail.campaign_id.in_(user_camp_ids),
        )
    )
    await db.commit()
