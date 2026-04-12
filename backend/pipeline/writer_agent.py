import asyncio
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.models import Lead, OutreachEmail, BlogSource, ValidityStatus, OutreachStatus
from tools.email_writer import generate_outreach

# Limit concurrent OpenAI calls to avoid rate limits
_WRITE_CONCURRENCY = 5


async def run_writer_agent(
    campaign_id: int,
    niche: str,
    db: AsyncSession,
) -> int:
    """
    For each valid/unverified lead, generate an outreach email concurrently.
    Saves results to outreach_emails with status=pending.
    Returns count of emails generated.
    """
    result = await db.execute(
        select(Lead).where(
            Lead.campaign_id == campaign_id,
            Lead.validity_status.in_([ValidityStatus.valid, ValidityStatus.unverified]),
            Lead.is_duplicate == False,
        )
    )
    leads = result.scalars().all()

    # Filter leads that already have a pending/approved/sent email
    filtered: list[Lead] = []
    for lead in leads:
        existing = await db.execute(
            select(OutreachEmail).where(
                OutreachEmail.lead_id == lead.id,
                OutreachEmail.status.in_([
                    OutreachStatus.pending,
                    OutreachStatus.approved,
                    OutreachStatus.sent,
                ])
            )
        )
        if not existing.scalar_one_or_none():
            filtered.append(lead)

    if not filtered:
        return 0

    # Pre-load blog info for all leads in one query
    blog_ids = {lead.source_blog_id for lead in filtered if lead.source_blog_id}
    blogs: dict[int, BlogSource] = {}
    if blog_ids:
        blog_result = await db.execute(
            select(BlogSource).where(BlogSource.id.in_(blog_ids))
        )
        for blog in blog_result.scalars().all():
            blogs[blog.id] = blog

    sem = asyncio.Semaphore(_WRITE_CONCURRENCY)

    async def generate_for_lead(lead: Lead) -> dict[str, Any] | None:
        blog_name = "the blog"
        blog_url = ""
        if lead.source_blog_id and lead.source_blog_id in blogs:
            blog = blogs[lead.source_blog_id]
            blog_name = blog.blog_name or "the blog"
            blog_url = blog.url

        async with sem:
            try:
                return await generate_outreach(
                    blog_name=blog_name,
                    niche=niche,
                    url=blog_url,
                    campaign_id=campaign_id,
                )
            except Exception as e:
                print(f"[writer_agent] Error for lead {lead.id}: {e}")
                return None

    results = await asyncio.gather(*[generate_for_lead(lead) for lead in filtered])

    generated = 0
    for lead, email_data in zip(filtered, results):
        if email_data is None:
            continue
        outreach = OutreachEmail(
            lead_id=lead.id,
            campaign_id=campaign_id,
            subject=email_data["subject"],
            body=email_data["body"],
            status=OutreachStatus.pending,
        )
        db.add(outreach)
        generated += 1

    await db.commit()
    return generated
