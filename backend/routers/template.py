from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from pydantic import BaseModel

from db.database import get_db
from db.models import AppSettings
from utils.auth import get_current_user_id

router = APIRouter(prefix="/template", tags=["template"])

DEFAULT_SUBJECT = "Fill Content Gaps and Outperform Your Competitors"
DEFAULT_BODY = (
    "Hi,\n"
    "I've been exploring your blog and noticed some key content gaps that your competitors "
    "are taking advantage of, driving traffic away from your site. The good news is, your "
    "site has significant potential to not only fill these gaps but also outperform them.\n"
    "I specialize in creating strategic content designed to close these gaps, attract more "
    "visitors, and ultimately boost your traffic. With the right approach, we can enhance "
    "your site's value and reclaim that competitive edge.\n"
    "Let me know if you'd like to discuss this further—I'd love to help you take your blog "
    "to the next level.\n"
    "Best regards,\n"
    "Howard"
)


class TemplateSaveRequest(BaseModel):
    subject: str
    body: str


def _subject_key(user_id: int) -> str:
    return f"template_subject_{user_id}"


def _body_key(user_id: int) -> str:
    return f"template_body_{user_id}"


async def _upsert(key: str, value: str, db: AsyncSession) -> None:
    stmt = pg_insert(AppSettings).values(
        key=key,
        value=value,
        updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
    ).on_conflict_do_update(
        index_elements=["key"],
        set_={"value": value, "updated_at": datetime.now(timezone.utc).replace(tzinfo=None)},
    )
    await db.execute(stmt)


@router.get("")
async def get_template(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    sub_res = await db.execute(
        select(AppSettings).where(AppSettings.key == _subject_key(user_id))
    )
    bod_res = await db.execute(
        select(AppSettings).where(AppSettings.key == _body_key(user_id))
    )
    sub = sub_res.scalar_one_or_none()
    bod = bod_res.scalar_one_or_none()

    if sub and bod and sub.value and bod.value:
        return {
            "type": "custom",
            "subject": sub.value,
            "body": bod.value,
            "default_subject": DEFAULT_SUBJECT,
            "default_body": DEFAULT_BODY,
        }
    return {
        "type": "default",
        "subject": DEFAULT_SUBJECT,
        "body": DEFAULT_BODY,
        "default_subject": DEFAULT_SUBJECT,
        "default_body": DEFAULT_BODY,
    }


@router.post("")
async def save_template(
    req: TemplateSaveRequest,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not req.subject.strip():
        raise HTTPException(status_code=422, detail="Subject cannot be empty.")
    if not req.body.strip():
        raise HTTPException(status_code=422, detail="Body cannot be empty.")

    await _upsert(_subject_key(user_id), req.subject.strip(), db)
    await _upsert(_body_key(user_id), req.body.strip(), db)
    await db.commit()
    return {"saved": True}


@router.delete("")
async def reset_template(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await db.execute(
        sa_delete(AppSettings).where(
            AppSettings.key.in_([_subject_key(user_id), _body_key(user_id)])
        )
    )
    await db.commit()
    return {"reset": True}
