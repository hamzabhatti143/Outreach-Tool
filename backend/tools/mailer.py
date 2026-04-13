import os
import smtplib
import asyncio
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.models import OutreachEmail, SentLog, Lead, BlogSource, Campaign, User, OutreachStatus, SentStatus
from dotenv import load_dotenv

load_dotenv()

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")

MAX_RETRIES = 3
RETRY_DELAYS = [5, 15, 45]  # seconds

# Global .env fallbacks — used only when the user hasn't saved their own SMTP
_ENV_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
_ENV_PORT = int(os.getenv("SMTP_PORT", "587"))
_ENV_USER = os.getenv("SMTP_USER", "")
_ENV_PASS = os.getenv("SMTP_PASS", "")
_ENV_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Outreach Tool")


async def _load_smtp_for_outreach(outreach: OutreachEmail, db: AsyncSession) -> dict:
    """
    Walk outreach → campaign → user to get per-user SMTP credentials.
    Falls back to global .env values if the user hasn't set their own.
    """
    campaign = await db.get(Campaign, outreach.campaign_id)
    user = await db.get(User, campaign.user_id) if campaign else None

    return {
        "host": (user and user.smtp_host) or _ENV_HOST,
        "port": (user and user.smtp_port) or _ENV_PORT,
        "user": (user and user.smtp_user) or _ENV_USER,
        "pass": (user and user.smtp_pass) or _ENV_PASS,
        "from_name": (user and user.smtp_from_name) or _ENV_FROM_NAME,
    }


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


async def send_email(outreach_email_id: int, db: AsyncSession) -> dict[str, Any]:
    """
    Send an approved outreach email via SMTP using the sending user's credentials.
    Logs result to sent_log. Retries up to 3 times with exponential backoff.
    Returns {"status": "sent"/"failed", "error": str | None}
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

    recipient_email = lead.email

    # Check for existing sent_log (retry tracking)
    log_result = await db.execute(
        select(SentLog).where(SentLog.outreach_email_id == outreach_email_id)
    )
    sent_log = log_result.scalar_one_or_none()
    retry_count = sent_log.retry_count if sent_log else 0

    if retry_count >= MAX_RETRIES:
        return {"status": "failed", "error": f"Max retries ({MAX_RETRIES}) exceeded"}

    # Load per-user SMTP credentials
    smtp = await _load_smtp_for_outreach(outreach, db)

    if not smtp["user"] or not smtp["pass"]:
        return {"status": "failed", "error": "SMTP not configured — add your Gmail address and app password in Settings"}

    # Build MIME message
    msg = MIMEMultipart("alternative")
    msg["From"] = f"{smtp['from_name']} <{smtp['user']}>"
    msg["To"] = recipient_email
    msg["Subject"] = outreach.subject

    html_body = _build_email_html(outreach.body, outreach_email_id)
    msg.attach(MIMEText(outreach.body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    # Attempt send with retry backoff
    last_error: str | None = None
    for attempt in range(retry_count, MAX_RETRIES):
        try:
            with smtplib.SMTP(smtp["host"], smtp["port"], timeout=10) as server:
                server.starttls()
                server.login(smtp["user"], smtp["pass"])
                server.sendmail(smtp["user"], recipient_email, msg.as_string())

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
                await asyncio.sleep(RETRY_DELAYS[attempt])

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
