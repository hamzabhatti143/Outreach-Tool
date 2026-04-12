import asyncio
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from db.models import Lead, ValidityStatus
from tools.scraper import scrape_emails

_SCRAPE_CONCURRENCY = 10


async def run_scraper_agent(
    blog_sources: list[dict[str, Any]],
    campaign_id: int,
    db: AsyncSession,
) -> int:
    """
    Scrapes all blog sources concurrently.
    Deletes any duplicate leads already in DB, then saves only unique new ones.
    Returns count of new emails saved.
    """
    # First: delete any duplicate leads left over from previous runs
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
                emails = await scrape_emails(url)
                return [(email.lower(), source_id) for email in emails]
            except Exception as e:
                print(f"[scraper_agent] Error scraping {url}: {e}")
                return []

    # Scrape all sources concurrently
    nested = await asyncio.gather(*[scrape_source(s) for s in blog_sources])
    all_results: list[tuple[str, int]] = [pair for batch in nested for pair in batch]

    if not all_results:
        return 0

    # Load existing emails for duplicate check in memory
    existing_result = await db.execute(
        select(Lead.email).where(Lead.campaign_id == campaign_id)
    )
    existing_emails: set[str] = {row[0] for row in existing_result.all()}

    new_count = 0
    seen_in_batch: set[str] = set()

    for email, source_id in all_results:
        if email in existing_emails or email in seen_in_batch:
            continue  # skip — don't store duplicates at all

        seen_in_batch.add(email)
        existing_emails.add(email)

        db.add(Lead(
            campaign_id=campaign_id,
            email=email,
            source_blog_id=source_id or None,
            validity_status=ValidityStatus.unverified,
            is_duplicate=False,
        ))
        new_count += 1

    await db.commit()
    return new_count
