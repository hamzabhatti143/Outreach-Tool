import os
import json
import asyncio
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from pydantic import BaseModel
from openai import AsyncOpenAI
from dotenv import load_dotenv
from db.database import get_db, AsyncSessionLocal
from db.models import EmailReply, AIResponse, OutreachEmail, Lead, BlogSource
from utils.auth import get_current_user_id

load_dotenv()

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/replies", tags=["replies"])

_openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Outreach Tool")

_REPLY_SYSTEM = (
    "You are an expert email response specialist. "
    "Generate a professional, warm reply to an email. "
    'Output ONLY valid JSON with exactly two keys: "subject" and "body". '
    "No preamble, no explanation."
)

_REPLY_USER = """Generate a professional reply to this incoming email.

Context — original outreach email we sent:
Subject: {original_subject}
Body: {original_body}

Incoming reply:
From: {from_name} <{from_email}>
Subject: {reply_subject}
Body: {reply_body}

Requirements:
- subject: begin with "Re: " followed by the original subject if not already a reply
- body: professional and warm, 2-3 short paragraphs, addresses their specific points
- Do NOT use generic openers like "I hope this email finds you well"
- Output only JSON: {{"subject": "...", "body": "..."}}"""


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class AIResponseSchema(BaseModel):
    id: int
    suggested_subject: str | None
    suggested_body: str | None
    user_edited_subject: str | None
    user_edited_body: str | None
    is_approved: bool
    is_sent: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ReplyResponse(BaseModel):
    id: int
    outreach_email_id: int
    from_email: str
    from_name: str | None
    subject: str | None
    body: str
    received_at: datetime
    message_id: str | None
    sentiment: str | None
    sentiment_score: float | None
    priority: str | None
    outreach_subject: str | None
    blog_name: str | None
    ai_response: AIResponseSchema | None

    class Config:
        from_attributes = True


class EditResponseRequest(BaseModel):
    user_edited_subject: str | None = None
    user_edited_body: str | None = None


class StatsResponse(BaseModel):
    total: int
    high_priority_pending: int


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _enrich_replies(replies: list, db: AsyncSession) -> list[ReplyResponse]:
    if not replies:
        return []

    oe_ids = list({r.outreach_email_id for r in replies})
    oe_res = await db.execute(select(OutreachEmail).where(OutreachEmail.id.in_(oe_ids)))
    oe_map: dict[int, OutreachEmail] = {oe.id: oe for oe in oe_res.scalars().all()}

    lead_ids = list({oe.lead_id for oe in oe_map.values()})
    lead_res = await db.execute(select(Lead).where(Lead.id.in_(lead_ids)))
    lead_map: dict[int, Lead] = {lead.id: lead for lead in lead_res.scalars().all()}

    blog_ids = {lead.source_blog_id for lead in lead_map.values() if lead.source_blog_id}
    blog_map: dict[int, BlogSource] = {}
    if blog_ids:
        blog_res = await db.execute(select(BlogSource).where(BlogSource.id.in_(blog_ids)))
        blog_map = {b.id: b for b in blog_res.scalars().all()}

    reply_ids = [r.id for r in replies]
    ai_res = await db.execute(select(AIResponse).where(AIResponse.reply_id.in_(reply_ids)))
    ai_map: dict[int, AIResponse] = {ar.reply_id: ar for ar in ai_res.scalars().all()}

    output: list[ReplyResponse] = []
    for r in replies:
        oe = oe_map.get(r.outreach_email_id)
        lead = lead_map.get(oe.lead_id) if oe else None
        blog = blog_map.get(lead.source_blog_id) if lead and lead.source_blog_id else None
        ar = ai_map.get(r.id)

        ai_schema: AIResponseSchema | None = None
        if ar:
            ai_schema = AIResponseSchema(
                id=ar.id,
                suggested_subject=ar.suggested_subject,
                suggested_body=ar.suggested_body,
                user_edited_subject=ar.user_edited_subject,
                user_edited_body=ar.user_edited_body,
                is_approved=ar.is_approved,
                is_sent=ar.is_sent,
                created_at=ar.created_at,
            )

        output.append(ReplyResponse(
            id=r.id,
            outreach_email_id=r.outreach_email_id,
            from_email=r.from_email,
            from_name=r.from_name,
            subject=r.subject,
            body=r.body,
            received_at=r.received_at,
            message_id=r.message_id,
            sentiment=r.sentiment,
            sentiment_score=r.sentiment_score,
            priority=r.priority,
            outreach_subject=oe.subject if oe else None,
            blog_name=blog.blog_name if blog else None,
            ai_response=ai_schema,
        ))

    return output


async def _generate_ai_reply(reply: EmailReply, outreach: OutreachEmail | None) -> dict:
    prompt = _REPLY_USER.format(
        original_subject=outreach.subject if outreach else "",
        original_body=outreach.body[:500] if outreach else "",
        from_name=reply.from_name or reply.from_email,
        from_email=reply.from_email,
        reply_subject=reply.subject or "",
        reply_body=reply.body[:1000],
    )
    resp = await _openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": _REPLY_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        max_tokens=600,
        temperature=0.7,
        response_format={"type": "json_object"},
    )
    raw = resp.choices[0].message.content or "{}"
    data = json.loads(raw)
    fallback = f"Re: {outreach.subject}" if outreach else "Re: Your reply"
    return {"subject": data.get("subject", fallback), "body": data.get("body", "")}


def _smtp_send_sync(to: str, subject: str, body: str) -> None:
    """Synchronous SMTP send — run in executor."""
    msg = MIMEMultipart("alternative")
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(SMTP_USER, to, msg.as_string())


async def _send_and_mark(reply_id: int, to: str, subject: str, body: str) -> None:
    """Background coroutine: send email then mark ai_response.is_sent = True."""
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _smtp_send_sync, to, subject, body)
    except Exception as exc:
        logger.error("Reply send failed for reply_id=%s: %s", reply_id, exc)
        return

    async with AsyncSessionLocal() as session:
        ar_res = await session.execute(select(AIResponse).where(AIResponse.reply_id == reply_id))
        ar_obj = ar_res.scalar_one_or_none()
        if ar_obj:
            ar_obj.is_sent = True
            await session.commit()


# ── Routes ────────────────────────────────────────────────────────────────────
# IMPORTANT: /stats and /poll must appear before /{reply_id} so FastAPI doesn't
# try to cast the literal strings "stats" / "poll" to an integer.

@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> StatsResponse:
    """Stats for the sidebar badge."""
    total_res = await db.execute(select(func.count(EmailReply.id)))
    total = total_res.scalar() or 0

    hp_res = await db.execute(
        select(func.count(EmailReply.id))
        .outerjoin(AIResponse, AIResponse.reply_id == EmailReply.id)
        .where(EmailReply.priority == "high")
        .where(or_(AIResponse.id.is_(None), AIResponse.is_sent.is_(False)))
    )
    high_priority_pending = hp_res.scalar() or 0

    return StatsResponse(total=total, high_priority_pending=high_priority_pending)


@router.get("", response_model=list[ReplyResponse])
async def list_replies(
    sentiment: str | None = None,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[ReplyResponse]:
    query = select(EmailReply).order_by(EmailReply.received_at.desc())
    if sentiment:
        query = query.where(EmailReply.sentiment == sentiment)
    result = await db.execute(query)
    return await _enrich_replies(result.scalars().all(), db)


@router.post("/poll")
async def poll_inbox_endpoint(
    background_tasks: BackgroundTasks,
    user_id: int = Depends(get_current_user_id),
) -> dict:
    """Trigger an IMAP inbox poll in the background."""
    from tools.reply_tracker import poll_inbox
    background_tasks.add_task(poll_inbox)
    return {"message": "Inbox poll queued"}


@router.get("/{reply_id}", response_model=ReplyResponse)
async def get_reply(
    reply_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> ReplyResponse:
    result = await db.execute(select(EmailReply).where(EmailReply.id == reply_id))
    reply = result.scalar_one_or_none()
    if not reply:
        raise HTTPException(status_code=404, detail="Reply not found")
    enriched = await _enrich_replies([reply], db)
    return enriched[0]


@router.post("/{reply_id}/generate-response")
async def generate_response(
    reply_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Generate (or regenerate) an AI suggested reply. Resets any user edits."""
    result = await db.execute(select(EmailReply).where(EmailReply.id == reply_id))
    reply = result.scalar_one_or_none()
    if not reply:
        raise HTTPException(status_code=404, detail="Reply not found")

    outreach = await db.get(OutreachEmail, reply.outreach_email_id)
    suggested = await _generate_ai_reply(reply, outreach)

    ar_res = await db.execute(select(AIResponse).where(AIResponse.reply_id == reply_id))
    ar = ar_res.scalar_one_or_none()

    if ar:
        ar.suggested_subject = suggested["subject"]
        ar.suggested_body = suggested["body"]
        ar.user_edited_subject = None
        ar.user_edited_body = None
        ar.is_approved = False
    else:
        ar = AIResponse(
            reply_id=reply_id,
            suggested_subject=suggested["subject"],
            suggested_body=suggested["body"],
        )
        db.add(ar)

    await db.commit()
    await db.refresh(ar)

    return {
        "id": ar.id,
        "suggested_subject": ar.suggested_subject,
        "suggested_body": ar.suggested_body,
        "user_edited_subject": ar.user_edited_subject,
        "user_edited_body": ar.user_edited_body,
        "is_approved": ar.is_approved,
        "is_sent": ar.is_sent,
    }


@router.patch("/{reply_id}/response")
async def edit_response(
    reply_id: int,
    req: EditResponseRequest,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Auto-save user edits.
    Writes into user_edited_* columns; suggested_* columns are never touched.
    """
    ar_res = await db.execute(select(AIResponse).where(AIResponse.reply_id == reply_id))
    ar = ar_res.scalar_one_or_none()
    if not ar:
        raise HTTPException(
            status_code=404,
            detail="No AI response for this reply. Generate one first.",
        )

    ar.user_edited_subject = req.user_edited_subject
    ar.user_edited_body = req.user_edited_body
    await db.commit()
    return {"reply_id": reply_id, "saved": True}


@router.post("/{reply_id}/response/approve")
async def approve_response(
    reply_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    ar_res = await db.execute(select(AIResponse).where(AIResponse.reply_id == reply_id))
    ar = ar_res.scalar_one_or_none()
    if not ar:
        raise HTTPException(status_code=404, detail="AI response not found")

    ar.is_approved = True
    await db.commit()
    return {"reply_id": reply_id, "approved": True}


@router.post("/{reply_id}/response/send")
async def send_response(
    reply_id: int,
    background_tasks: BackgroundTasks,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Send the reply via SMTP.
    Uses user_edited_* if present, falls back to suggested_*.
    Requires is_approved == True.
    """
    result = await db.execute(select(EmailReply).where(EmailReply.id == reply_id))
    reply = result.scalar_one_or_none()
    if not reply:
        raise HTTPException(status_code=404, detail="Reply not found")

    ar_res = await db.execute(select(AIResponse).where(AIResponse.reply_id == reply_id))
    ar = ar_res.scalar_one_or_none()
    if not ar:
        raise HTTPException(status_code=400, detail="Generate and approve a response first")
    if not ar.is_approved:
        raise HTTPException(status_code=400, detail="Response must be approved before sending")

    subject = ar.user_edited_subject or ar.suggested_subject or ""
    body = ar.user_edited_body or ar.suggested_body or ""

    background_tasks.add_task(_send_and_mark, reply_id, reply.from_email, subject, body)
    return {"message": "Reply queued for sending", "reply_id": reply_id}
