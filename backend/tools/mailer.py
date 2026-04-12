import os
import smtplib
import asyncio
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.models import OutreachEmail, SentLog, Lead, BlogSource, OutreachStatus, SentStatus
from dotenv import load_dotenv

load_dotenv()

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Outreach Tool")
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")

MAX_RETRIES = 3
RETRY_DELAYS = [5, 15, 45]  # seconds


def _build_email_html(body: str, tracking_id: int) -> str:
    pixel = f'<img src="{BASE_URL}/track/{tracking_id}.png" width="1" height="1" alt="" style="display:none;">'
    # Convert plain text body to HTML paragraphs
    paragraphs = "".join(f"<p>{line}</p>" for line in body.split("\n") if line.strip())
    return f"""<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:600px;margin:0 auto;">
{paragraphs}
{pixel}
</body>
</html>"""


async def send_email(outreach_email_id: int, db: AsyncSession) -> dict[str, Any]:
    """
    Send an approved outreach email via SMTP.
    Logs result to sent_log. Retries up to 3 times with backoff.
    Returns {"status": "sent"/"failed", "error": str | None}
    """
    # Load outreach email with lead and blog info
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

    recipient_email = lead.email

    # Check if sent_log exists (for retry tracking)
    log_result = await db.execute(
        select(SentLog).where(SentLog.outreach_email_id == outreach_email_id)
    )
    sent_log = log_result.scalar_one_or_none()

    retry_count = sent_log.retry_count if sent_log else 0

    if retry_count >= MAX_RETRIES:
        return {"status": "failed", "error": f"Max retries ({MAX_RETRIES}) exceeded"}

    # Build email
    msg = MIMEMultipart("alternative")
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    msg["To"] = recipient_email
    msg["Subject"] = outreach.subject

    # Use outreach_email_id as tracking ID
    html_body = _build_email_html(outreach.body, outreach_email_id)
    msg.attach(MIMEText(outreach.body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    # Attempt send with retry backoff
    last_error: str | None = None
    for attempt in range(retry_count, MAX_RETRIES):
        try:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
                server.starttls()
                server.login(SMTP_USER, SMTP_PASS)
                server.sendmail(SMTP_USER, recipient_email, msg.as_string())

            # Success — update DB
            outreach.status = OutreachStatus.sent

            if sent_log:
                sent_log.status = SentStatus.sent
                sent_log.retry_count = attempt
            else:
                sent_log = SentLog(
                    outreach_email_id=outreach_email_id,
                    status=SentStatus.sent,
                    retry_count=attempt,
                )
                db.add(sent_log)

            await db.commit()
            return {"status": "sent", "error": None}

        except Exception as e:
            last_error = str(e)
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_DELAYS[attempt]
                await asyncio.sleep(delay)

    # All attempts failed
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
