from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from db.models import Lead, OutreachEmail, ValidityStatus, OutreachStatus, SentEmailRegistry, Campaign, AppSettings


async def _get_template(campaign_id: int, db: AsyncSession) -> tuple[str, str]:
    """Return (subject, body) — user's saved template if set, otherwise the default."""
    from routers.template import DEFAULT_SUBJECT, DEFAULT_BODY
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        return DEFAULT_SUBJECT, DEFAULT_BODY
    user_id = campaign.user_id
    sub_res = await db.execute(
        select(AppSettings).where(AppSettings.key == f"template_subject_{user_id}")
    )
    bod_res = await db.execute(
        select(AppSettings).where(AppSettings.key == f"template_body_{user_id}")
    )
    sub = sub_res.scalar_one_or_none()
    bod = bod_res.scalar_one_or_none()
    if sub and bod and sub.value and bod.value:
        return sub.value, bod.value
    return DEFAULT_SUBJECT, DEFAULT_BODY


async def run_writer_agent(
    campaign_id: int,
    niche: str,
    db: AsyncSession,
) -> int:
    """
    Creates outreach emails for every eligible lead using the user's saved template
    (or the default template if none is saved).
    Skips leads already in the global sent registry or with existing drafts.
    Returns count of emails created.
    """
    # Hold off if pending/approved drafts still exist
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
            "skipping until current batch is sent"
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

    # Exclude leads that already have a pending/approved/sent email
    lead_ids = [l.id for l in leads]
    existing_res = await db.execute(
        select(OutreachEmail.lead_id).where(
            OutreachEmail.campaign_id == campaign_id,
            OutreachEmail.lead_id.in_(lead_ids),
            OutreachEmail.status.in_(["pending", "approved", "sent"]),
        )
    )
    already_have_email: set[int] = {row[0] for row in existing_res.all()}
    targets = [l for l in leads if l.id not in already_have_email]

    if not targets:
        print(f"[writer_agent] All {len(leads)} leads already have outreach emails")
        return 0

    # Exclude leads already in the global sent registry
    target_emails = [l.email for l in targets]
    registry_res = await db.execute(
        select(SentEmailRegistry.email).where(SentEmailRegistry.email.in_(target_emails))
    )
    already_sent: set[str] = {row[0] for row in registry_res.all()}
    if already_sent:
        print(f"[writer_agent] Skipping {len(already_sent)} leads already in global sent registry")
    targets = [l for l in targets if l.email not in already_sent]

    if not targets:
        print(f"[writer_agent] All remaining leads already contacted globally")
        return 0

    subject, body = await _get_template(campaign_id, db)
    print(f"[writer_agent] Creating {len(targets)} emails")

    generated = 0
    for lead in targets:
        db.add(OutreachEmail(
            lead_id=lead.id,
            campaign_id=campaign_id,
            subject=subject,
            body=body,
            status=OutreachStatus.pending,
        ))
        await db.commit()
        generated += 1
        print(f"[writer_agent] {generated}/{len(targets)} — lead={lead.id} ({lead.email})")

    print(f"[writer_agent] Done: {generated} emails created")
    return generated
