from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from pydantic import BaseModel
from db.database import get_db
from db.models import OutreachEmail
from utils.auth import get_current_user_id
from pipeline.sender_agent import run_sender_agent

router = APIRouter(prefix="/bulk", tags=["bulk"])


class BulkIdsRequest(BaseModel):
    ids: list[int]


@router.post("/send")
async def bulk_send(
    body: BulkIdsRequest,
    background_tasks: BackgroundTasks,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Send a list of approved outreach emails."""
    async def _send(ids: list[int]) -> None:
        from db.database import AsyncSessionLocal
        async with AsyncSessionLocal() as session:
            await run_sender_agent(ids, session)

    background_tasks.add_task(_send, body.ids)
    return {"message": f"Sending {len(body.ids)} emails in background", "ids": body.ids}


@router.post("/delete", status_code=204)
async def bulk_delete(
    body: BulkIdsRequest,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a list of outreach emails."""
    await db.execute(delete(OutreachEmail).where(OutreachEmail.id.in_(body.ids)))
    await db.commit()
