import os
import uuid
import base64
import asyncio
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.models import OutreachEmail, SentLog, Lead, Campaign, User, OutreachStatus, SentStatus
from routers.gmail import _get_valid_token

logger = logging.getLogger(__name__)

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")

MAX_RETRIES = 3
RETRY_DELAYS = [5, 15, 45]


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
    Walks outreach → campaign → user to resolve the sender's Gmail credentials.
    Generates and stores a Message-ID for email thread continuity.
    """
    result = await db.execute(
        select(OutreachEmail).where(OutreachEmail.id == outreach_email_id)
    )
    outreach = result.scalar_one_or_none()
    if not outreach:
        return {"status": "failed", "error": "Outreach email not found"}
    if outreach.status != OutreachStatus.approved:
        return {"status": "failed", "error": "Email not approved for sending"}

    lead_result = await db.execute(select(Lead).where(Lead.id == outreach.lead_id))
    lead = lead_result.scalar_one_or_none()
    if not lead:
        return {"status": "failed", "error": "Lead not found"}

    campaign = await db.get(Campaign, outreach.campaign_id)
    user = await db.get(User, campaign.user_id) if campaign else None

    if not user or not user.gmail_refresh_token:
        return {
            "status": "failed",
            "error": "Gmail not connected — connect your Gmail account in Settings.",
        }

    log_result = await db.execute(
        select(SentLog).where(SentLog.outreach_email_id == outreach_email_id)
    )
    sent_log = log_result.scalar_one_or_none()
    retry_count = sent_log.retry_count if sent_log else 0

    if retry_count >= MAX_RETRIES:
        return {"status": "failed", "error": f"Max retries ({MAX_RETRIES}) exceeded"}

    # Generate a stable Message-ID for this outreach email
    if not outreach.message_id:
        outreach.message_id = generate_message_id()

    html_body = _build_email_html(outreach.body, outreach_email_id)
    last_error: str | None = None

    for attempt in range(retry_count, MAX_RETRIES):
        try:
            thread_id = await _gmail_send(
                user, db,
                to=lead.email,
                subject=outreach.subject,
                plain=outreach.body,
                html=html_body,
                message_id=outreach.message_id,
            )

            outreach.status = OutreachStatus.sent
            if sent_log:
                sent_log.status = SentStatus.sent
                sent_log.retry_count = attempt
                if thread_id:
                    sent_log.gmail_thread_id = thread_id
            else:
                sent_log = SentLog(
                    outreach_email_id=outreach_email_id,
                    status=SentStatus.sent,
                    retry_count=attempt,
                    gmail_thread_id=thread_id or None,
                )
                db.add(sent_log)

            await db.commit()
            return {"status": "sent", "error": None}

        except Exception as e:
            last_error = str(e)
            logger.error("Gmail send attempt %d failed: %s", attempt + 1, e)
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(RETRY_DELAYS[attempt])

    outreach.status = OutreachStatus.failed
    if sent_log:
        sent_log.status = SentStatus.failed
        sent_log.retry_count = MAX_RETRIES
    else:
        sent_log = SentLog(
            outreach_email_id=outreach_email_id,
            status=SentStatus.failed,
            retry_count=MAX_RETRIES,
        )
        db.add(sent_log)

    await db.commit()
    return {"status": "failed", "error": last_error}
