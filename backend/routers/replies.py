import os
import json
import uuid
import base64
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from pydantic import BaseModel
from openai import AsyncOpenAI
from dotenv import load_dotenv

from db.database import get_db, retry_session
from db.models import EmailReply, AIResponse, OutreachEmail, Lead, BlogSource, Campaign, User
from utils.auth import get_current_user_id
from utils.gmail_service import get_valid_token as _get_valid_token

load_dotenv()

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/replies", tags=["replies"])

_openai = AsyncOpenAI(
    api_key=os.getenv("GEMINI_API_KEY", ""),
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
)

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
    outreach_body: str | None
    lead_email: str | None
    blog_name: str | None
    blog_url: str | None
    ai_response: AIResponseSchema | None

    class Config:
        from_attributes = True


class EditResponseRequest(BaseModel):
    user_edited_subject: str | None = None
    user_edited_body: str | None = None


class StatsResponse(BaseModel):
    total: int
    high_priority_pending: int


# ── Ownership helpers ─────────────────────────────────────────────────────────

def _user_outreach_ids_sq(user_id: int):
    """Scalar subquery: outreach email IDs belonging to user_id."""
    user_camp_ids = (
        select(Campaign.id)
        .where(Campaign.user_id == user_id)
        .scalar_subquery()
    )
    return (
        select(OutreachEmail.id)
        .where(OutreachEmail.campaign_id.in_(user_camp_ids))
        .scalar_subquery()
    )


async def _get_owned_reply(reply_id: int, user_id: int, db: AsyncSession) -> EmailReply:
    """Fetch a reply that belongs to the current user, or raise 404."""
    result = await db.execute(
        select(EmailReply).where(
            EmailReply.id == reply_id,
            EmailReply.outreach_email_id.in_(_user_outreach_ids_sq(user_id)),
        )
    )
    reply = result.scalar_one_or_none()
    if not reply:
        raise HTTPException(status_code=404, detail="Reply not found")
    return reply


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
            outreach_body=oe.body if oe else None,
            lead_email=lead.email if lead else None,
            blog_name=blog.blog_name if blog else None,
            blog_url=blog.url if blog else None,
            ai_response=ai_schema,
        ))

    return output


async def _generate_ai_reply(reply: EmailReply, outreach: OutreachEmail | None) -> dict:
    prompt = _REPLY_USER.format(
        original_subject=outreach.subject if outreach else "",
        original_body=outreach.body[:2000] if outreach else "",
        from_name=reply.from_name or reply.from_email,
        from_email=reply.from_email,
        reply_subject=reply.subject or "",
        reply_body=reply.body[:1000],
    )
    resp = await _openai.chat.completions.create(
        model="gemini-2.0-flash",
        messages=[
            {"role": "system", "content": _REPLY_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        max_tokens=600,
        temperature=0.7,
    )
    raw = resp.choices[0].message.content or "{}"
    import re as _re
    fenced = _re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", raw)
    if fenced:
        raw = fenced.group(1)
    data = json.loads(raw)
    fallback = f"Re: {outreach.subject}" if outreach else "Re: Your reply"
    return {"subject": data.get("subject", fallback), "body": data.get("body", "")}


async def _send_reply_via_gmail(reply_id: int, to: str, subject: str, body: str) -> None:
    """Background task: load user Gmail token, send reply via Gmail API with threading headers."""
    async with retry_session() as db:
        reply = await db.get(EmailReply, reply_id)
        if not reply:
            return

        oe = await db.get(OutreachEmail, reply.outreach_email_id)
        camp = await db.get(Campaign, oe.campaign_id) if oe else None
        user = await db.get(User, camp.user_id) if camp else None

        if not user or not user.gmail_refresh_token:
            logger.error("Cannot send reply %s — Gmail not connected", reply_id)
            return

        ar_res = await db.execute(select(AIResponse).where(AIResponse.reply_id == reply_id))
        ar_obj = ar_res.scalar_one_or_none()

        their_message_id = reply.message_id
        original_message_id = oe.message_id if oe else None

        existing_refs = ar_obj.thread_references if ar_obj else None
        ref_parts: list[str] = []
        if original_message_id:
            ref_parts.append(original_message_id)
        if existing_refs:
            for mid in existing_refs.split():
                if mid not in ref_parts:
                    ref_parts.append(mid)
        if their_message_id and their_message_id not in ref_parts:
            ref_parts.append(their_message_id)
        references_header = " ".join(ref_parts) if ref_parts else None

        final_subject = reply.subject or subject
        if final_subject and not final_subject.lower().startswith("re:"):
            final_subject = f"Re: {final_subject}"

        our_message_id = f"<{uuid.uuid4()}@outreach.tool>"

        try:
            access_token = await _get_valid_token(user, db)

            msg = MIMEMultipart("alternative")
            msg["From"] = user.email
            msg["To"] = to
            msg["Subject"] = final_subject
            msg["Message-ID"] = our_message_id
            if their_message_id:
                msg["In-Reply-To"] = their_message_id
            if references_header:
                msg["References"] = references_header

            msg.attach(MIMEText(body, "plain"))

            raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(
                    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                    headers={"Authorization": f"Bearer {access_token}"},
                    json={"raw": raw},
                )

            if r.status_code >= 400:
                raise ValueError(f"Gmail API error {r.status_code}: {r.text}")

        except Exception as exc:
            logger.error("Reply send failed for reply_id=%s: %s", reply_id, exc)
            return

        if ar_obj:
            ar_obj.is_sent = True
            new_refs = (references_header + " " + our_message_id).strip() if references_header else our_message_id
            ar_obj.thread_references = new_refs
            await db.commit()


# ── Routes ────────────────────────────────────────────────────────────────────
# IMPORTANT: /stats and /poll must appear before /{reply_id} so FastAPI doesn't
# try to cast the literal strings "stats" / "poll" to an integer.

@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> StatsResponse:
    user_oe_ids = _user_outreach_ids_sq(user_id)

    total_res = await db.execute(
        select(func.count(EmailReply.id))
        .where(EmailReply.outreach_email_id.in_(user_oe_ids))
    )
    total = total_res.scalar() or 0

    hp_res = await db.execute(
        select(func.count(EmailReply.id))
        .outerjoin(AIResponse, AIResponse.reply_id == EmailReply.id)
        .where(
            EmailReply.outreach_email_id.in_(user_oe_ids),
            EmailReply.priority == "high",
            or_(AIResponse.id.is_(None), AIResponse.is_sent.is_(False)),
        )
    )
    high_priority_pending = hp_res.scalar() or 0

    return StatsResponse(total=total, high_priority_pending=high_priority_pending)


@router.get("", response_model=list[ReplyResponse])
async def list_replies(
    sentiment: str | None = None,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[ReplyResponse]:
    user_oe_ids = _user_outreach_ids_sq(user_id)
    query = (
        select(EmailReply)
        .where(EmailReply.outreach_email_id.in_(user_oe_ids))
        .order_by(EmailReply.received_at.desc())
    )
    if sentiment:
        query = query.where(EmailReply.sentiment == sentiment)
    result = await db.execute(query)
    return await _enrich_replies(result.scalars().all(), db)


@router.post("/poll")
async def poll_inbox_endpoint(
    user_id: int = Depends(get_current_user_id),
) -> dict:
    """Poll Gmail threads synchronously and return results."""
    from tools.reply_tracker import poll_inbox
    result = await poll_inbox(user_id)
    return result


@router.get("/{reply_id}", response_model=ReplyResponse)
async def get_reply(
    reply_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> ReplyResponse:
    reply = await _get_owned_reply(reply_id, user_id, db)
    enriched = await _enrich_replies([reply], db)
    return enriched[0]


@router.post("/{reply_id}/generate-response")
async def generate_response(
    reply_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    reply = await _get_owned_reply(reply_id, user_id, db)
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
    await _get_owned_reply(reply_id, user_id, db)

    ar_res = await db.execute(select(AIResponse).where(AIResponse.reply_id == reply_id))
    ar = ar_res.scalar_one_or_none()
    if ar:
        ar.user_edited_subject = req.user_edited_subject
        ar.user_edited_body = req.user_edited_body
    else:
        ar = AIResponse(
            reply_id=reply_id,
            user_edited_subject=req.user_edited_subject,
            user_edited_body=req.user_edited_body,
        )
        db.add(ar)
    await db.commit()
    return {"reply_id": reply_id, "saved": True}


@router.post("/{reply_id}/response/approve")
async def approve_response(
    reply_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _get_owned_reply(reply_id, user_id, db)

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
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    reply = await _get_owned_reply(reply_id, user_id, db)

    ar_res = await db.execute(select(AIResponse).where(AIResponse.reply_id == reply_id))
    ar = ar_res.scalar_one_or_none()
    if not ar:
        raise HTTPException(status_code=400, detail="Generate and approve a response first")
    if not ar.is_approved:
        raise HTTPException(status_code=400, detail="Response must be approved before sending")

    subject = ar.user_edited_subject or ar.suggested_subject or ""
    body = ar.user_edited_body or ar.suggested_body or ""

    await _send_reply_via_gmail(reply_id, reply.from_email, subject, body)
    return {"message": "Reply sent", "reply_id": reply_id}
