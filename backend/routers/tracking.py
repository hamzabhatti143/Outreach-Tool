from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from db.database import get_db
from db.models import SentLog

router = APIRouter(tags=["tracking"])

# 1x1 transparent GIF bytes
TRACKING_PIXEL = (
    b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00"
    b"!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01"
    b"\x00\x00\x02\x02D\x01\x00;"
)


@router.get("/track/{outreach_email_id}.png")
async def track_open(
    outreach_email_id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Serve a 1x1 tracking pixel and increment open_count."""
    result = await db.execute(
        select(SentLog).where(SentLog.outreach_email_id == outreach_email_id)
    )
    log = result.scalar_one_or_none()

    if log:
        log.open_count = (log.open_count or 0) + 1
        log.last_opened_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.commit()

    return Response(
        content=TRACKING_PIXEL,
        media_type="image/gif",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )
