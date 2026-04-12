import os
import smtplib
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr
from db.database import get_db
from db.models import User
from utils.auth import get_current_user_id, hash_password
from dotenv import load_dotenv, set_key
from pathlib import Path

router = APIRouter(prefix="/settings", tags=["settings"])

ENV_PATH = Path(__file__).parent.parent / ".env"


class SmtpConfig(BaseModel):
    host: str
    port: int
    username: str
    password: str | None = None  # None means keep existing
    from_name: str


class SmtpResponse(BaseModel):
    host: str
    port: int
    username: str
    from_name: str
    password_set: bool


class ProfileUpdate(BaseModel):
    name: str | None = None
    email: EmailStr | None = None
    new_password: str | None = None


@router.get("/smtp", response_model=SmtpResponse)
async def get_smtp(user_id: int = Depends(get_current_user_id)) -> SmtpResponse:
    return SmtpResponse(
        host=os.getenv("SMTP_HOST", ""),
        port=int(os.getenv("SMTP_PORT", "587")),
        username=os.getenv("SMTP_USER", ""),
        from_name=os.getenv("SMTP_FROM_NAME", "Outreach Tool"),
        password_set=bool(os.getenv("SMTP_PASS", "")),
    )


@router.post("/smtp")
async def save_smtp(
    body: SmtpConfig,
    user_id: int = Depends(get_current_user_id),
) -> dict:
    if ENV_PATH.exists():
        set_key(str(ENV_PATH), "SMTP_HOST", body.host)
        set_key(str(ENV_PATH), "SMTP_PORT", str(body.port))
        set_key(str(ENV_PATH), "SMTP_USER", body.username)
        set_key(str(ENV_PATH), "SMTP_FROM_NAME", body.from_name)
        if body.password:
            set_key(str(ENV_PATH), "SMTP_PASS", body.password)

        # Reload env
        load_dotenv(str(ENV_PATH), override=True)

    return {"message": "SMTP settings saved"}


@router.post("/smtp/test")
async def test_smtp(user_id: int = Depends(get_current_user_id)) -> dict:
    host = os.getenv("SMTP_HOST", "")
    port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")

    if not host or not smtp_user or not smtp_pass:
        raise HTTPException(status_code=400, detail="SMTP not configured")

    try:
        with smtplib.SMTP(host, port, timeout=10) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
        return {"ok": True, "message": "SMTP connection successful"}
    except Exception as e:
        return {"ok": False, "message": str(e)}


@router.get("/profile")
async def get_profile(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user.id, "email": user.email, "name": user.name, "created_at": user.created_at}


@router.patch("/profile")
async def update_profile(
    body: ProfileUpdate,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.name is not None:
        user.name = body.name
    if body.email is not None:
        user.email = body.email
    if body.new_password is not None:
        user.password_hash = hash_password(body.new_password)

    await db.commit()
    return {"message": "Profile updated"}


@router.delete("/account", status_code=204)
async def delete_account(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> None:
    user = await db.get(User, user_id)
    if user:
        await db.delete(user)
        await db.commit()
