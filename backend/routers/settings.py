import os
import smtplib
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, EmailStr
from db.database import get_db
from db.models import User
from utils.auth import get_current_user_id, hash_password

router = APIRouter(prefix="/settings", tags=["settings"])

# Env fallbacks — used when the user hasn't configured their own SMTP yet
_ENV_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
_ENV_PORT = int(os.getenv("SMTP_PORT", "587"))
_ENV_USER = os.getenv("SMTP_USER", "")
_ENV_PASS = os.getenv("SMTP_PASS", "")
_ENV_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Outreach Tool")


class SmtpConfig(BaseModel):
    host: str
    port: int
    username: str
    password: str | None = None   # None means keep existing password
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


def _user_smtp(user: User) -> dict:
    """Return the effective SMTP config for a user, falling back to .env."""
    return {
        "host": user.smtp_host or _ENV_HOST,
        "port": user.smtp_port or _ENV_PORT,
        "user": user.smtp_user or _ENV_USER,
        "pass": user.smtp_pass or _ENV_PASS,
        "from_name": user.smtp_from_name or _ENV_FROM_NAME,
    }


@router.get("/smtp", response_model=SmtpResponse)
async def get_smtp(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> SmtpResponse:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    cfg = _user_smtp(user)
    return SmtpResponse(
        host=cfg["host"],
        port=cfg["port"],
        username=cfg["user"],
        from_name=cfg["from_name"],
        password_set=bool(cfg["pass"]),
    )


@router.post("/smtp")
async def save_smtp(
    body: SmtpConfig,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.smtp_host = body.host
    user.smtp_port = body.port
    user.smtp_user = body.username
    user.smtp_from_name = body.from_name
    if body.password:            # only overwrite when a new password is provided
        user.smtp_pass = body.password

    await db.commit()
    return {"message": "SMTP settings saved"}


@router.post("/smtp/test")
async def test_smtp(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    cfg = _user_smtp(user)
    if not cfg["user"] or not cfg["pass"]:
        raise HTTPException(status_code=400, detail="SMTP not configured — add your Gmail address and app password first")

    try:
        with smtplib.SMTP(cfg["host"], cfg["port"], timeout=10) as server:
            server.starttls()
            server.login(cfg["user"], cfg["pass"])
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
