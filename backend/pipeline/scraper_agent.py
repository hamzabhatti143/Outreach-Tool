import asyncio
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from db.models import Lead, ValidityStatus, SentEmailRegistry, CampaignEvent

_SCRAPE_CONCURRENCY = 10
_MAX_LEADS_PER_CAMPAIGN = 500  # High cap; dedup logic prevents true duplicates


async def run_scraper_agent(
    blog_sources: list[dict[str, Any]],
    campaign_id: int,
    db: AsyncSession,
) -> int:
    """
    Scrapes all blog sources concurrently.
    Skips emails already in the global sent registry.
    Uses INSERT ... ON CONFLICT DO NOTHING for race-safe inserts.
    Returns count of new emails saved.
    """
    # Remove duplicate leads from previous runs
    await db.execute(
        delete(Lead).where(Lead.campaign_id == campaign_id, Lead.is_duplicate == True)
    )
    await db.commit()

    sem = asyncio.Semaphore(_SCRAPE_CONCURRENCY)

    async def scrape_source(source: dict[str, Any]) -> list[tuple[str, int]]:
        url: str = source.get("url", "")
        source_id: int = source.get("id", 0)
        if not url:
            return []
        async with sem:
            try:
                from tools.scraper import scrape_emails
                emails = await scrape_emails(url)
                return [(email.lower(), source_id) for email in emails]
            except Exception as e:
                print(f"[scraper_agent] Error scraping {url}: {e}")
                return []

    nested = await asyncio.gather(*[scrape_source(s) for s in blog_sources])
    all_results: list[tuple[str, int]] = [pair for batch in nested for pair in batch]

    if not all_results:
        return 0

    # Load global sent registry to skip already-contacted addresses
    all_emails = list({email for email, _ in all_results})
    if all_emails:
        registry_result = await db.execute(
            select(SentEmailRegistry.email).where(SentEmailRegistry.email.in_(all_emails))
        )
        already_sent_globally: set[str] = {row[0] for row in registry_result.all()}
    else:
        already_sent_globally = set()

    # Count existing leads for the cap check
    existing_result = await db.execute(
        select(Lead.email).where(Lead.campaign_id == campaign_id)
    )
    existing_emails: set[str] = {row[0] for row in existing_result.all()}

    new_count = 0
    skipped_registry = 0
    seen_in_batch: set[str] = set()
    slots_left = _MAX_LEADS_PER_CAMPAIGN - len(existing_emails)

    for email, source_id in all_results:
        if slots_left <= 0:
            print(f"[scraper_agent] Lead cap ({_MAX_LEADS_PER_CAMPAIGN}) reached — stopping")
            break
        if email in already_sent_globally:
            skipped_registry += 1
            continue
        if email in existing_emails or email in seen_in_batch:
            continue

        seen_in_batch.add(email)
        existing_emails.add(email)

        # INSERT ... ON CONFLICT DO NOTHING handles race conditions and retries gracefully
        stmt = pg_insert(Lead).values(
            campaign_id=campaign_id,
            email=email,
            source_blog_id=source_id or None,
            validity_status=ValidityStatus.unverified.value,
            is_duplicate=False,
        ).on_conflict_do_nothing(
            index_elements=["campaign_id", "email"],
        )
        result = await db.execute(stmt)

        # Only count if the row was actually inserted (not a conflict skip)
        if result.rowcount > 0:
            new_count += 1
            slots_left -= 1

    await db.commit()

    # Log scrape results as a campaign event
    if new_count > 0 or skipped_registry > 0:
        parts = [f"Scraped {new_count} new lead{'' if new_count == 1 else 's'}"]
        if skipped_registry > 0:
            parts.append(f"skipped {skipped_registry} already-contacted")
        db.add(CampaignEvent(
            campaign_id=campaign_id,
            event_type="scrape",
            message=", ".join(parts),
        ))
        await db.commit()

    return new_count
