import asyncio
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from db.models import Lead, OutreachEmail, BlogSource, ValidityStatus, OutreachStatus
from tools.email_writer import generate_outreach

_BATCH_SIZE = 10
_SUB_BATCH_SIZE = 5   # generate this many, pause, then generate the next group
_REQUEST_INTERVAL = 3  # seconds between individual calls
_SUB_BATCH_GAP = 15   # seconds to wait between the two groups of 5


async def run_writer_agent(
    campaign_id: int,
    niche: str,
    db: AsyncSession,
) -> int:
    """
    Generates outreach emails one at a time with a 7-second gap between each
    Gemini call to stay safely under the 10 RPM free-tier limit.
    Skips generation if unsent drafts still exist — current batch must be sent first.
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
    remaining = len(filtered) - len(batch)
    print(
        f"[writer_agent] Generating {len(batch)} emails one by one "
        f"({_REQUEST_INTERVAL}s between calls, {remaining} leads queued for next batch)"
    )

    # Pre-load blog info in one query
    blog_ids = {l.source_blog_id for l in batch if l.source_blog_id}
    blogs: dict[int, BlogSource] = {}
    if blog_ids:
        blog_res = await db.execute(select(BlogSource).where(BlogSource.id.in_(blog_ids)))
        blogs = {b.id: b for b in blog_res.scalars().all()}

    generated = 0

    # Split batch into sub-batches of 5 with a longer gap between groups
    sub_batches = [batch[i:i + _SUB_BATCH_SIZE] for i in range(0, len(batch), _SUB_BATCH_SIZE)]

    for sub_idx, sub_batch in enumerate(sub_batches):
        if sub_idx > 0:
            print(f"[writer_agent] Sub-batch {sub_idx} done — waiting {_SUB_BATCH_GAP}s before next group")
            await asyncio.sleep(_SUB_BATCH_GAP)

        for i, lead in enumerate(sub_batch):
            if i > 0:
                await asyncio.sleep(_REQUEST_INTERVAL)

            global_idx = sub_idx * _SUB_BATCH_SIZE + i + 1
            blog = blogs.get(lead.source_blog_id) if lead.source_blog_id else None
            blog_name = blog.blog_name or "the blog" if blog else "the blog"
            blog_url = blog.url if blog else ""

            try:
                email_data: dict[str, Any] = await generate_outreach(
                    blog_name=blog_name,
                    niche=niche,
                    url=blog_url,
                    campaign_id=campaign_id,
                )
                db.add(OutreachEmail(
                    lead_id=lead.id,
                    campaign_id=campaign_id,
                    subject=email_data["subject"],
                    body=email_data["body"],
                    status=OutreachStatus.pending,
                ))
                await db.commit()
                generated += 1
                print(f"[writer_agent] {global_idx}/{len(batch)} OK — lead={lead.id} ({lead.email})")
            except Exception as exc:
                print(f"[writer_agent] {global_idx}/{len(batch)} FAIL — lead={lead.id} ({lead.email}): {type(exc).__name__}: {exc}")

    print(f"[writer_agent] Done: {generated}/{len(batch)} emails generated this batch")
    return generated
