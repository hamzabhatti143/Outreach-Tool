import asyncio
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from db.models import Lead, OutreachEmail, BlogSource, ValidityStatus, OutreachStatus
from tools.email_writer import generate_outreach

_WRITE_CONCURRENCY = 3
_BATCH_SIZE = 10


async def run_writer_agent(
    campaign_id: int,
    niche: str,
    db: AsyncSession,
) -> int:
    """
    Generates outreach emails in batches of 10.
    If any emails are still pending or approved (not yet sent), generation is skipped —
    the existing batch must be sent first before the next one is created.
    Returns count of emails generated.
    """
    # If unsent drafts exist, hold off until they are sent
    unsent_res = await db.execute(
        select(func.count(OutreachEmail.id)).where(
            OutreachEmail.campaign_id == campaign_id,
            OutreachEmail.status.in_(["pending", "approved"]),
        )
    )
    unsent_count: int = unsent_res.scalar() or 0
    if unsent_count > 0:
        print(
            f"[writer_agent] {unsent_count} unsent draft(s) still pending/approved — "
            "skipping generation until current batch is sent"
        )
        return 0

    # Load all eligible leads
    leads_res = await db.execute(
        select(Lead).where(
            Lead.campaign_id == campaign_id,
            Lead.validity_status.in_([ValidityStatus.valid, ValidityStatus.unverified]),
            Lead.is_duplicate.is_(False),
        )
    )
    leads = leads_res.scalars().all()

    if not leads:
        print(f"[writer_agent] No eligible leads for campaign {campaign_id}")
        return 0

    # Exclude leads that already have any email (pending/approved/sent)
    lead_ids = [l.id for l in leads]
    existing_res = await db.execute(
        select(OutreachEmail.lead_id).where(
            OutreachEmail.campaign_id == campaign_id,
            OutreachEmail.lead_id.in_(lead_ids),
            OutreachEmail.status.in_(["pending", "approved", "sent"]),
        )
    )
    already_have_email: set[int] = {row[0] for row in existing_res.all()}
    filtered = [l for l in leads if l.id not in already_have_email]

    if not filtered:
        print(f"[writer_agent] All {len(leads)} leads already have outreach emails")
        return 0

    # Take only the next batch
    batch = filtered[:_BATCH_SIZE]
    print(
        f"[writer_agent] Generating batch of {len(batch)} emails "
        f"({len(filtered) - len(batch)} leads remain for future batches)"
    )

    # Pre-load blog info in one query
    blog_ids = {l.source_blog_id for l in batch if l.source_blog_id}
    blogs: dict[int, BlogSource] = {}
    if blog_ids:
        blog_res = await db.execute(select(BlogSource).where(BlogSource.id.in_(blog_ids)))
        blogs = {b.id: b for b in blog_res.scalars().all()}

    sem = asyncio.Semaphore(_WRITE_CONCURRENCY)

    async def generate_for_lead(lead: Lead) -> dict[str, Any] | None:
        blog = blogs.get(lead.source_blog_id) if lead.source_blog_id else None
        blog_name = blog.blog_name or "the blog" if blog else "the blog"
        blog_url = blog.url if blog else ""

        async with sem:
            try:
                result = await generate_outreach(
                    blog_name=blog_name,
                    niche=niche,
                    url=blog_url,
                    campaign_id=campaign_id,
                )
                print(f"[writer_agent] OK lead={lead.id} ({lead.email})")
                return result
            except Exception as exc:
                print(f"[writer_agent] FAIL lead={lead.id} ({lead.email}): {type(exc).__name__}: {exc}")
                return None

    results = await asyncio.gather(*[generate_for_lead(l) for l in batch])

    generated = 0
    for lead, email_data in zip(batch, results):
        if not email_data:
            continue
        db.add(OutreachEmail(
            lead_id=lead.id,
            campaign_id=campaign_id,
            subject=email_data["subject"],
            body=email_data["body"],
            status=OutreachStatus.pending,
        ))
        generated += 1

    if generated:
        await db.commit()

    print(f"[writer_agent] Done: {generated}/{len(batch)} emails generated this batch")
    return generated
