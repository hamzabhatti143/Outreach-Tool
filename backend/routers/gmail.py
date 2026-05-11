import os
import secrets
import time
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import User
from utils.auth import get_current_user_id
from utils.gmail_service import get_valid_token, has_oauth_credentials, _client_id, _client_secret, _redirect_uri

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/gmail", tags=["gmail"])

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://outreach-tool-drab.vercel.app")
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SCOPES = (
    "https://www.googleapis.com/auth/gmail.send "
    "https://www.googleapis.com/auth/gmail.readonly "
    "https://www.googleapis.com/auth/gmail.modify"
)

# Short-lived in-memory state store (10-minute TTL)
_pending_oauth: dict[str, tuple] = {}


class CredentialsRequest(BaseModel):
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/credentials")
async def save_credentials(
    req: CredentialsRequest,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Save per-user Google OAuth credentials (optional when env vars are set)."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.google_client_id = req.google_client_id.strip()
    user.google_client_secret = req.google_client_secret.strip()
    user.google_redirect_uri = req.google_redirect_uri.strip()
    await db.commit()
    return {"success": True}


@router.get("/connect")
async def start_oauth(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return the Google OAuth consent URL. Frontend redirects the user there."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not has_oauth_credentials(user):
        raise HTTPException(
            status_code=400,
            detail="Gmail OAuth is not configured. Contact the administrator or save your credentials in Settings.",
        )

    cid = _client_id(user)
    csecret = _client_secret(user)
    redir = _redirect_uri(user)

    # Purge expired state entries
    now = time.monotonic()
    for s in [s for s, v in _pending_oauth.items() if v[1] < now]:
        _pending_oauth.pop(s, None)

    state = secrets.token_urlsafe(16)
    _pending_oauth[state] = (user_id, now + 600, cid, csecret, redir)

    url = GOOGLE_AUTH_URL + "?" + urlencode({
        "client_id": cid,
        "redirect_uri": redir,
        "response_type": "code",
        "scope": GMAIL_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    })
    return {"url": url}


@router.get("/callback")
async def oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Google redirects here after user grants permission."""
    redirect_base = f"{FRONTEND_URL}/dashboard/settings"

    if error or not code or not state:
        return RedirectResponse(f"{redirect_base}?gmail=error")

    entry = _pending_oauth.pop(state, None)
    if not entry or entry[1] < time.monotonic():
        return RedirectResponse(f"{redirect_base}?gmail=expired")

    user_id, _, client_id, client_secret, redirect_uri = entry

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })

    if r.status_code >= 400:
        logger.error("Gmail token exchange failed: %s", r.text)
        return RedirectResponse(f"{redirect_base}?gmail=error")

    tokens = r.json()
    if "access_token" not in tokens:
        return RedirectResponse(f"{redirect_base}?gmail=error")

    # Fetch the actual Gmail address connected
    gmail_email: str | None = None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            profile_r = await client.get(
                "https://gmail.googleapis.com/gmail/v1/users/me/profile",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
            if profile_r.status_code == 200:
                gmail_email = profile_r.json().get("emailAddress")
    except Exception as exc:
        logger.warning("Could not fetch Gmail profile: %s", exc)

    from db.database import retry_session
    async with retry_session() as db:
        user = await db.get(User, user_id)
        if not user:
            return RedirectResponse(f"{redirect_base}?gmail=error")

        user.gmail_access_token = tokens["access_token"]
        if "refresh_token" in tokens:
            user.gmail_refresh_token = tokens["refresh_token"]
        user.gmail_token_expiry = (
            datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 3600))
        ).replace(tzinfo=None)
        user.gmail_email = gmail_email
        await db.commit()

    return RedirectResponse(f"{redirect_base}?gmail=connected")


@router.get("/status")
async def gmail_status(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    connected = bool(user.gmail_access_token and user.gmail_refresh_token)
    return {
        "connected": connected,
        "email": user.gmail_email if connected else None,
        "credentials_saved": bool(user.google_client_id),
        "server_credentials": bool(
            os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET")
        ),
    }


@router.delete("/disconnect")
async def disconnect_gmail(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.gmail_access_token = None
    user.gmail_refresh_token = None
    user.gmail_token_expiry = None
    user.gmail_email = None
    await db.commit()
    return {"success": True}
