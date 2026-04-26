"""
reply_tracker.py — Gmail thread-based reply detection + sentiment analysis.
"""
import base64
import logging
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)


def analyze_sentiment(text: str) -> dict:
    """
    Analyse the sentiment of text using TextBlob's pattern analyser.
    Returns {"sentiment", "sentiment_score", "priority"}.
    """
    from textblob import TextBlob

    blob = TextBlob(text[:2000])
    polarity: float = blob.sentiment.polarity

    if polarity > 0.1:
        label, priority = "positive", "high"
    elif polarity < -0.1:
        label, priority = "negative", "low"
    else:
        label, priority = "neutral", "medium"

    confidence = round(min(abs(polarity) + 0.05, 1.0), 3)
    return {"sentiment": label, "sentiment_score": confidence, "priority": priority}


def _extract_gmail_body(payload: dict) -> str:
    """Recursively extract plain-text body from a Gmail message payload."""
    mime_type = payload.get("mimeType", "")

    if mime_type == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")

    for part in payload.get("parts", []):
        result = _extract_gmail_body(part)
        if result:
            return result

    return ""


async def poll_inbox(user_id: int) -> dict:
    """
    Poll Gmail threads for replies to sent outreach emails.

    Strategy:
      - Find all SentLog rows (for this user) that have a gmail_thread_id
        but no EmailReply yet.
      - Call Gmail Threads API for each thread.
      - If messages > 1, the thread has replies — save them as EmailReply rows
        and run sentiment analysis.

    Returns {"new": int, "errors": list[str]}
    """
    from sqlalchemy import select
    from db.database import retry_session
    from db.models import (
        EmailReply, OutreachEmail, Lead, SentLog, SentStatus,
        Campaign, User,
    )
    from routers.gmail import _get_valid_token

    new_count = 0
    errors: list[str] = []

    async with retry_session() as db:
        # Load the user
        user = await db.get(User, user_id)
        if not user or not user.gmail_refresh_token:
            return {"new": 0, "errors": ["Gmail not connected"]}

        # Get a valid access token
        try:
            access_token = await _get_valid_token(user, db)
        except Exception as exc:
            return {"new": 0, "errors": [f"Token error: {exc}"]}

        # Find SentLog rows for this user's campaigns that have a thread ID
        rows = await db.execute(
            select(SentLog, OutreachEmail, Lead)
            .join(OutreachEmail, SentLog.outreach_email_id == OutreachEmail.id)
            .join(Lead, OutreachEmail.lead_id == Lead.id)
            .join(Campaign, OutreachEmail.campaign_id == Campaign.id)
            .where(
                Campaign.user_id == user_id,
                SentLog.status == SentStatus.sent,
                SentLog.gmail_thread_id.isnot(None),
            )
        )

        sent_rows = rows.all()
        if not sent_rows:
            return {"new": 0, "errors": []}

        async with httpx.AsyncClient(timeout=15) as client:
            for log, oe, lead in sent_rows:
                try:
                    r = await client.get(
                        f"https://gmail.googleapis.com/gmail/v1/users/me/threads/{log.gmail_thread_id}",
                        headers={"Authorization": f"Bearer {access_token}"},
                        params={"format": "full"},
                    )

                    if r.status_code == 401:
                        # Token expired mid-batch — refresh and retry once
                        access_token = await _get_valid_token(user, db)
                        r = await client.get(
                            f"https://gmail.googleapis.com/gmail/v1/users/me/threads/{log.gmail_thread_id}",
                            headers={"Authorization": f"Bearer {access_token}"},
                            params={"format": "full"},
                        )

                    if r.status_code >= 400:
                        errors.append(f"Thread {log.gmail_thread_id}: HTTP {r.status_code}")
                        continue

                    messages = r.json().get("messages", [])
                    if len(messages) <= 1:
                        continue  # no replies yet

                    # messages[0] is our outreach; messages[1:] are replies
                    for reply_msg in messages[1:]:
                        msg_id = reply_msg.get("id", "")

                        # Deduplicate
                        existing = await db.execute(
                            select(EmailReply).where(EmailReply.message_id == msg_id)
                        )
                        if existing.scalar_one_or_none():
                            continue

                        headers = {
                            h["name"].lower(): h["value"]
                            for h in reply_msg.get("payload", {}).get("headers", [])
                        }
                        from_raw = headers.get("from", lead.email)
                        subject = headers.get("subject", "")

                        if "<" in from_raw and ">" in from_raw:
                            from_name = from_raw[:from_raw.index("<")].strip().strip('"\'')
                            from_email = from_raw[from_raw.index("<") + 1:from_raw.index(">")].strip().lower()
                        else:
                            from_name = ""
                            from_email = from_raw.strip().lower()

                        body_text = _extract_gmail_body(reply_msg.get("payload", {})).strip()

                        internal_date_ms = int(reply_msg.get("internalDate", "0"))
                        received_at = datetime.fromtimestamp(
                            internal_date_ms / 1000, tz=timezone.utc
                        ).replace(tzinfo=None)

                        reply = EmailReply(
                            outreach_email_id=oe.id,
                            from_email=from_email,
                            from_name=from_name or None,
                            subject=subject or None,
                            body=body_text or "(empty)",
                            message_id=msg_id,
                            received_at=received_at,
                        )
                        db.add(reply)
                        await db.flush()

                        sentiment_data = analyze_sentiment(body_text)
                        reply.sentiment = sentiment_data["sentiment"]
                        reply.sentiment_score = sentiment_data["sentiment_score"]
                        reply.priority = sentiment_data["priority"]

                        await db.commit()
                        new_count += 1

                except Exception as exc:
                    logger.error("Error checking thread %s: %s", log.gmail_thread_id, exc)
                    errors.append(str(exc))
                    await db.rollback()

    return {"new": new_count, "errors": errors}
