import asyncio
import json
import os
import secrets
import smtplib
import logging
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from functools import partial

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from pydantic import BaseModel, EmailStr
from db.database import get_db
from db.models import User, AppSettings
from utils.auth import (
    hash_password, verify_password,
    create_access_token, create_refresh_token, decode_token,
)

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

_RESET_TOKEN_TTL_MINUTES = 60

router = APIRouter(prefix="/auth", tags=["auth"])


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    name: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def signup(body: SignupRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        name=body.name,
    )
    db.add(user)
    await db.flush()
    await db.commit()

    token_data = {"sub": str(user.id)}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token_data = {"sub": str(user.id)}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest) -> TokenResponse:
    payload = decode_token(body.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    token_data = {"sub": user_id}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


# ── Password reset ────────────────────────────────────────────────────────────

def _send_reset_email_sync(to_email: str, reset_link: str) -> None:
    """Blocking SMTP send — called via run_in_executor to avoid blocking the event loop."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Reset your OutreachAI password"
    msg["From"] = SMTP_USER
    msg["To"] = to_email

    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <h2 style="margin:0 0 8px;color:#1a1a2e">Reset your password</h2>
      <p style="color:#555;margin:0 0 24px">
        Click the button below to set a new password. This link expires in 1 hour.
      </p>
      <a href="{reset_link}"
         style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;
                padding:12px 28px;border-radius:8px;font-weight:600">
        Reset Password
      </a>
      <p style="color:#888;font-size:13px;margin-top:24px">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
    """
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(SMTP_USER, to_email, msg.as_string())


@router.post("/forgot-password")
async def forgot_password(
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Generate a password reset token and email it.
    Always returns the same response to prevent user enumeration.
    """
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user:
        token = secrets.token_urlsafe(32)
        expires_at = (datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=_RESET_TOKEN_TTL_MINUTES)).isoformat()

        stmt = pg_insert(AppSettings).values(
            key=f"reset_{token}",
            value=json.dumps({"user_id": user.id, "expires_at": expires_at}),
        ).on_conflict_do_update(
            index_elements=["key"],
            set_={"value": json.dumps({"user_id": user.id, "expires_at": expires_at})},
        )
        await db.execute(stmt)
        await db.commit()

        reset_link = f"{FRONTEND_URL}/reset-password?token={token}"
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, partial(_send_reset_email_sync, user.email, reset_link)
            )
        except Exception as exc:
            logger.error("Failed to send password reset email to %s: %s", user.email, exc)

    return {"message": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Validate reset token, update password, and invalidate the token."""
    setting_result = await db.execute(
        select(AppSettings).where(AppSettings.key == f"reset_{body.token}")
    )
    setting = setting_result.scalar_one_or_none()

    if not setting or not setting.value:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")

    try:
        data = json.loads(setting.value)
        expires_at = datetime.fromisoformat(data["expires_at"])
        user_id = int(data["user_id"])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")

    if datetime.now(timezone.utc).replace(tzinfo=None) > expires_at:
        await db.execute(sa_delete(AppSettings).where(AppSettings.key == f"reset_{body.token}"))
        await db.commit()
        raise HTTPException(status_code=400, detail="Reset link has expired. Please request a new one.")

    if len(body.new_password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters.")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")

    user.password_hash = hash_password(body.new_password)
    await db.execute(sa_delete(AppSettings).where(AppSettings.key == f"reset_{body.token}"))
    await db.commit()

    return {"message": "Password updated successfully. You can now log in."}
