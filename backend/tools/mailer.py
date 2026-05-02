import os
import uuid
import base64
import logging
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

import httpx
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import OutreachEmail, SentLog, Lead, Campaign, User, OutreachStatus, SentStatus, SentEmailRegistry
from routers.gmail import _get_valid_token

logger = logging.getLogger(__name__)

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")


def _build_email_html(body: str, tracking_id: int) -> str:
    pixel = f'<img src="{BASE_URL}/track/{tracking_id}.png" width="1" height="1" alt="" style="display:none;">'
    paragraphs = "".join(f"<p>{line}</p>" for line in body.split("\n") if line.strip())
    return f"""<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:600px;margin:0 auto;">
{paragraphs}
{pixel}
</body>
</html>"""


def generate_message_id() -> str:
    return f"<{uuid.uuid4()}@outreach.tool>"


async def _gmail_send(
    user: User,
    db: AsyncSession,
    to: str,
    subject: str,
    plain: str,
    html: str,
    message_id: str | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
) -> str:
    """Send via Gmail API. Returns threadId."""
    access_token = await _get_valid_token(user, db)

    msg = MIMEMultipart("alternative")
    msg["From"] = user.email
    msg["To"] = to
    msg["Subject"] = subject

    if message_id:
        msg["Message-ID"] = message_id
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references

    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(html, "html"))

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            headers={"Authorization": f"Bearer {access_token}"},
            json={"raw": raw},
        )

    if r.status_code >= 400:
        raise ValueError(f"Gmail API error {r.status_code}: {r.text}")

    return r.json().get("threadId", "")


async def send_email(outreach_email_id: int, db: AsyncSession) -> dict[str, Any]:
    """
    Send an approved outreach email via Gmail API.
    Uses an atomic DB claim (UPDATE WHERE status=approved) before calling Gmail
    to guarantee each email is sent at most once — even under concurrent requests.
    """
    # Load the outreach record
    result = await db.execute(
        select(OutreachEmail).where(OutreachEmail.id == outreach_email_id)
    )
    outreach = result.scalar_one_or_none()
    if not outreach:
        return {"status": "failed", "error": "Outreach email not found"}

    # Fast-path: already sent
    if outreach.status == OutreachStatus.sent:
        return {"status": "skipped", "error": "Already sent"}

    if outreach.status != OutreachStatus.approved:
        return {"status": "failed", "error": "Email not approved for sending"}

    # Load lead
    lead_result = await db.execute(select(Lead).where(Lead.id == outreach.lead_id))
    lead = lead_result.scalar_one_or_none()
    if not lead:
        return {"status": "failed", "error": "Lead not found"}

    # Check global sent registry — skip if already contacted
    reg_check = await db.execute(
        select(SentEmailRegistry.email).where(SentEmailRegistry.email == lead.email)
    )
    if reg_check.scalar_one_or_none():
        outreach.status = OutreachStatus.sent
        outreach.sent_at = datetime.utcnow()
        await db.commit()
        return {"status": "skipped", "error": "Already in sent registry"}

    # ATOMIC CLAIM: UPDATE ... WHERE status='approved'
    # If another request already claimed this email, rowcount will be 0 — we skip.
    claim = await db.execute(
        sa_update(OutreachEmail)
        .where(
            OutreachEmail.id == outreach_email_id,
            OutreachEmail.status == OutreachStatus.approved,
        )
        .values(status=OutreachStatus.sent, sent_at=datetime.utcnow())
    )
    await db.commit()

    if claim.rowcount == 0:
        return {"status": "skipped", "error": "Already claimed by concurrent request"}

    # Reload after claim
    await db.refresh(outreach)

    # Resolve sender credentials
    campaign = await db.get(Campaign, outreach.campaign_id)
    user = await db.get(User, campaign.user_id) if campaign else None

    if not user or not user.gmail_refresh_token:
        # Revert — can't send without Gmail
        outreach.status = OutreachStatus.approved
        outreach.sent_at = None
        await db.commit()
        return {"status": "failed", "error": "Gmail not connected — connect your Gmail account in Settings."}

    # Stable Message-ID for thread continuity
    if not outreach.message_id:
        outreach.message_id = generate_message_id()
        await db.commit()

    html_body = _build_email_html(outreach.body, outreach_email_id)

    try:
        thread_id = await _gmail_send(
            user, db,
            to=lead.email,
            subject=outreach.subject,
            plain=outreach.body,
            html=html_body,
            message_id=outreach.message_id,
        )

        # Log the send
        log_result = await db.execute(
            select(SentLog).where(SentLog.outreach_email_id == outreach_email_id)
        )
        sent_log = log_result.scalar_one_or_none()
        if sent_log:
            sent_log.status = SentStatus.sent
            if thread_id:
                sent_log.gmail_thread_id = thread_id
        else:
            db.add(SentLog(
                outreach_email_id=outreach_email_id,
                status=SentStatus.sent,
                retry_count=0,
                gmail_thread_id=thread_id or None,
            ))
        await db.commit()

        # Record in global dedup registry
        try:
            await db.execute(
                pg_insert(SentEmailRegistry).values(
                    email=lead.email,
                    campaign_id=outreach.campaign_id,
                    outreach_email_id=outreach_email_id,
                ).on_conflict_do_nothing(index_elements=["email"])
            )
            await db.commit()
        except Exception as reg_exc:
            logger.warning("Registry insert failed (non-fatal): %s", reg_exc)

        return {"status": "sent", "error": None}

    except Exception as e:
        logger.error("Gmail send failed for outreach %d: %s", outreach_email_id, e)
        # Revert status so the user can retry manually
        outreach.status = OutreachStatus.failed
        outreach.sent_at = None
        log_result = await db.execute(
            select(SentLog).where(SentLog.outreach_email_id == outreach_email_id)
        )
        sent_log = log_result.scalar_one_or_none()
        if sent_log:
            sent_log.status = SentStatus.failed
        else:
            db.add(SentLog(
                outreach_email_id=outreach_email_id,
                status=SentStatus.failed,
                retry_count=1,
            ))
        await db.commit()
        return {"status": "failed", "error": str(e)}
