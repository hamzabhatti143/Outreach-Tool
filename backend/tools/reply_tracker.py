"""
reply_tracker.py — IMAP inbox polling + sentiment analysis for incoming replies.
"""
import os
import imaplib
import email
import email.header
import email.message
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

IMAP_HOST = os.getenv("IMAP_HOST", "imap.gmail.com")
IMAP_PORT = int(os.getenv("IMAP_PORT", "993"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")

_executor = ThreadPoolExecutor(max_workers=2)


def analyze_sentiment(text: str) -> dict:
    """
    Analyse the sentiment of text using TextBlob's pattern analyser.

    Returns:
        {
          "sentiment": "positive" | "neutral" | "negative",
          "sentiment_score": float 0–1,
          "priority": "high" | "medium" | "low",
        }
    """
    from textblob import TextBlob

    # Cap input to keep latency low
    blob = TextBlob(text[:2000])
    polarity: float = blob.sentiment.polarity  # −1.0 … +1.0

    if polarity > 0.1:
        label = "positive"
        priority = "high"
    elif polarity < -0.1:
        label = "negative"
        priority = "low"
    else:
        label = "neutral"
        priority = "medium"

    # Map absolute polarity → confidence (small base so neutral never reads 0)
    confidence = round(min(abs(polarity) + 0.05, 1.0), 3)

    return {"sentiment": label, "sentiment_score": confidence, "priority": priority}


# ── helpers ──────────────────────────────────────────────────────────────────

def _decode_header_str(raw: str) -> str:
    parts = email.header.decode_header(raw or "")
    result = ""
    for fragment, charset in parts:
        if isinstance(fragment, bytes):
            result += fragment.decode(charset or "utf-8", errors="replace")
        else:
            result += fragment
    return result


def _extract_body(msg: email.message.Message) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                try:
                    return part.get_payload(decode=True).decode(
                        part.get_content_charset() or "utf-8", errors="replace"
                    )
                except Exception:
                    pass
    else:
        try:
            return msg.get_payload(decode=True).decode(
                msg.get_content_charset() or "utf-8", errors="replace"
            )
        except Exception:
            pass
    return ""


def _fetch_emails_sync() -> list[dict]:
    """
    Connect to IMAP, retrieve emails from the past 30 days, and return
    parsed message dicts.  Runs in a ThreadPoolExecutor (blocking I/O).
    """
    messages: list[dict] = []
    if not SMTP_USER or not SMTP_PASS:
        logger.warning("IMAP credentials not configured — skipping inbox poll")
        return messages

    try:
        mail = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
        mail.login(SMTP_USER, SMTP_PASS)
        mail.select("INBOX")

        cutoff = (datetime.now() - timedelta(days=30)).strftime("%d-%b-%Y")
        _, data = mail.search(None, f"SINCE {cutoff}")
        if not data or not data[0]:
            mail.logout()
            return messages

        for uid in data[0].split():
            try:
                _, msg_data = mail.fetch(uid, "(RFC822)")
                if not msg_data or not msg_data[0]:
                    continue
                raw = msg_data[0][1]
                msg = email.message_from_bytes(raw)

                subject = _decode_header_str(msg.get("Subject", ""))
                from_raw = _decode_header_str(msg.get("From", ""))

                # Parse "Name <addr>" or plain address
                if "<" in from_raw and ">" in from_raw:
                    from_name = from_raw[:from_raw.index("<")].strip().strip('"\'')
                    from_email = from_raw[from_raw.index("<") + 1:from_raw.index(">")].strip()
                else:
                    from_name = ""
                    from_email = from_raw.strip()

                message_id = (msg.get("Message-ID") or "").strip()
                body = _extract_body(msg).strip()

                messages.append({
                    "from_email": from_email.lower(),
                    "from_name": from_name,
                    "subject": subject,
                    "body": body,
                    "message_id": message_id or None,
                })
            except Exception as exc:
                logger.debug("Skipping malformed IMAP message: %s", exc)

        mail.logout()
    except Exception as exc:
        logger.error("IMAP fetch error: %s", exc)

    return messages


# ── public API ────────────────────────────────────────────────────────────────

async def poll_inbox() -> dict:
    """
    Poll the IMAP inbox for replies to sent outreach emails.

    Match strategy: if the sender's address appears in our leads table AND
    there is a SentLog row for the corresponding outreach email, it is a reply.

    For each new reply:
      1. Save to email_replies.
      2. Immediately call analyze_sentiment() on the body.
      3. Persist sentiment / sentiment_score / priority on the same row.

    Returns {"new": int, "errors": list[str]}
    """
    loop = asyncio.get_event_loop()
    messages = await loop.run_in_executor(_executor, _fetch_emails_sync)

    new_count = 0
    errors: list[str] = []

    from sqlalchemy import select
    from db.database import AsyncSessionLocal
    from db.models import EmailReply, OutreachEmail, Lead, SentLog, SentStatus

    async with AsyncSessionLocal() as db:
        # Build map: lead_email → outreach_email_id  (only for emails we actually sent)
        rows = await db.execute(
            select(SentLog, OutreachEmail, Lead)
            .join(OutreachEmail, SentLog.outreach_email_id == OutreachEmail.id)
            .join(Lead, OutreachEmail.lead_id == Lead.id)
            .where(SentLog.status == SentStatus.sent)
        )
        lead_email_map: dict[str, int] = {}
        for log, oe, lead in rows.all():
            lead_email_map[lead.email.lower()] = oe.id

        for msg in messages:
            try:
                from_email = msg["from_email"]
                if not from_email or from_email not in lead_email_map:
                    continue

                outreach_email_id = lead_email_map[from_email]

                # Deduplicate by message_id
                if msg["message_id"]:
                    existing = await db.execute(
                        select(EmailReply).where(EmailReply.message_id == msg["message_id"])
                    )
                    if existing.scalar_one_or_none():
                        continue

                # 1. Save reply
                reply = EmailReply(
                    outreach_email_id=outreach_email_id,
                    from_email=from_email,
                    from_name=msg["from_name"] or None,
                    subject=msg["subject"] or None,
                    body=msg["body"] or "(empty)",
                    message_id=msg["message_id"],
                )
                db.add(reply)
                await db.flush()  # get reply.id without committing

                # 2. Analyse sentiment immediately after saving
                sentiment_data = analyze_sentiment(msg["body"])

                # 3. Store sentiment on the row
                reply.sentiment = sentiment_data["sentiment"]
                reply.sentiment_score = sentiment_data["sentiment_score"]
                reply.priority = sentiment_data["priority"]

                await db.commit()
                new_count += 1

            except Exception as exc:
                logger.error("Error saving reply: %s", exc)
                errors.append(str(exc))
                await db.rollback()

    return {"new": new_count, "errors": errors}
