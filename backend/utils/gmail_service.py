"""
gmail_service.py — Central Gmail token management.

Supports two modes:
  1. Shared OAuth app  — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in env vars.
     Users click Connect Gmail and grant access; no credential entry needed.
  2. Per-user OAuth app — User saves their own client_id/secret in Settings.
     User's saved credentials take priority over env vars.
"""
import logging
import os
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import User

logger = logging.getLogger(__name__)

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def _client_id(user: User) -> str | None:
    return user.google_client_id or os.getenv("GOOGLE_CLIENT_ID")


def _client_secret(user: User) -> str | None:
    return user.google_client_secret or os.getenv("GOOGLE_CLIENT_SECRET")


def _redirect_uri(user: User) -> str | None:
    return user.google_redirect_uri or os.getenv("GMAIL_REDIRECT_URI")


def has_oauth_credentials(user: User) -> bool:
    """True if we have enough credentials (user-saved or env) to run OAuth."""
    return bool(_client_id(user) and _client_secret(user) and _redirect_uri(user))


async def get_valid_token(user: User, db: AsyncSession) -> str:
    """
    Return a valid Gmail access token for this user.
    Auto-refreshes if the token is expired or within 2 minutes of expiry.
    Uses user's own stored credentials if available, falls back to env vars.
    """
    if not user.gmail_refresh_token:
        raise HTTPException(
            status_code=403,
            detail="Gmail not connected. Go to Settings → Connect Gmail.",
        )

    now = datetime.now(timezone.utc)
    expiry = user.gmail_token_expiry
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    needs_refresh = (
        not user.gmail_access_token
        or expiry is None
        or expiry <= now + timedelta(minutes=2)
    )

    if needs_refresh:
        cid = _client_id(user)
        csecret = _client_secret(user)
        if not cid or not csecret:
            raise HTTPException(
                status_code=502,
                detail="Gmail OAuth credentials not configured.",
            )

        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(GOOGLE_TOKEN_URL, data={
                "client_id": cid,
                "client_secret": csecret,
                "refresh_token": user.gmail_refresh_token,
                "grant_type": "refresh_token",
            })

        if r.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Token refresh failed: {r.text}")

        tokens = r.json()
        if "access_token" not in tokens:
            raise HTTPException(status_code=502, detail="Token refresh returned no access_token")

        user.gmail_access_token = tokens["access_token"]
        user.gmail_token_expiry = (
            now + timedelta(seconds=tokens.get("expires_in", 3600))
        ).replace(tzinfo=None)
        await db.commit()

    return user.gmail_access_token  # type: ignore[return-value]
