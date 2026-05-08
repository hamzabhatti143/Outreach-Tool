import asyncio
import logging
from datetime import datetime, timezone
from typing import Any
from functools import partial
from urllib.parse import urlparse

from ddgs import DDGS
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import SearchQuery, BlogSource, Campaign, AppSettings
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

SKIP_DOMAINS = [
    "facebook.com", "twitter.com", "linkedin.com", "youtube.com",
    "instagram.com", "reddit.com", "pinterest.com", "tiktok.com",
    "amazon.com", "wikipedia.org", "quora.com", "medium.com",
]

BLOGS_PER_ROUND = 30
_MAX_PER_DOMAIN = 2   # max URLs from the same root domain per round
_DDG_MAX_RESULTS = 40  # results requested from DDG per query

_QUERIES = [
    "{niche} blog write for us",
    "{niche} blog contact us",
    "{niche} blogs accepting guest posts",
    "{niche} blog submit article",
    "{niche} blogger outreach",
    "{niche} site:blog contact",
]


class QuotaExceededException(Exception):
    """Kept for interface compatibility — DDG has no quota."""


def _root_domain(url: str) -> str:
    try:
        host = urlparse(url).hostname or ""
        parts = host.split(".")
        return ".".join(parts[-2:]) if len(parts) >= 2 else host
    except Exception:
        return url


async def _upsert_setting(key: str, value: str, db: AsyncSession) -> None:
    stmt = pg_insert(AppSettings).values(
        key=key,
        value=value,
        updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
    ).on_conflict_do_update(
        index_elements=["key"],
        set_={"value": value, "updated_at": datetime.now(timezone.utc).replace(tzinfo=None)},
    )
    await db.execute(stmt)
    await db.commit()


def _ddg_search(query: str, max_results: int) -> list[dict]:
    """Synchronous DDGS text search — called via run_in_executor."""
    try:
        with DDGS() as ddgs:
            return list(ddgs.text(query, max_results=max_results))
    except Exception as exc:
        logger.warning("[search] DDGS error: %s", exc)
        return []


async def search_blogs(
    niche: str,
    campaign_id: int,
    db: AsyncSession,
    user_id: int | None = None,
) -> list[dict[str, Any]]:
    """
    Search DuckDuckGo for blogs in a niche.
    Rotates through _QUERIES, advancing to the next query each round.
    Resets query index when all queries are exhausted so the next call starts fresh.
    Returns up to BLOGS_PER_ROUND newly discovered blog sources.
    """
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        return []

    query_idx: int = campaign.last_search_query_index or 0
    total_fetched: int = campaign.total_blogs_fetched or 0

    # Load known URLs for this campaign for in-memory dedup
    existing_result = await db.execute(
        select(BlogSource.url).where(BlogSource.campaign_id == campaign_id)
    )
    seen_urls: set[str] = {row[0] for row in existing_result.all()}
    # Track per-domain counts within this round to avoid one site eating all slots
    domain_counts: dict[str, int] = {}

    queries = [q.format(niche=niche) for q in _QUERIES]
    all_sources: list[dict[str, Any]] = []
    slots_left = BLOGS_PER_ROUND

    while query_idx < len(queries) and slots_left > 0:
        query_string = queries[query_idx]

        query_record = SearchQuery(
            campaign_id=campaign_id,
            query_string=query_string,
            page_offset=0,
        )
        db.add(query_record)
        await db.flush()

        loop = asyncio.get_event_loop()
        raw_results: list[dict] = await loop.run_in_executor(
            None,
            partial(_ddg_search, query_string, _DDG_MAX_RESULTS),
        )

        for result in raw_results:
            if slots_left <= 0:
                break

            url: str = result.get("href", "")
            blog_name: str = result.get("title", url)

            if not url or url in seen_urls:
                continue
            if any(d in url for d in SKIP_DOMAINS):
                continue

            domain = _root_domain(url)
            if domain_counts.get(domain, 0) >= _MAX_PER_DOMAIN:
                continue

            seen_urls.add(url)
            domain_counts[domain] = domain_counts.get(domain, 0) + 1

            stmt = pg_insert(BlogSource).values(
                campaign_id=campaign_id,
                url=url,
                blog_name=blog_name,
                query_id=query_record.id,
            ).on_conflict_do_nothing(index_elements=["campaign_id", "url"])
            await db.execute(stmt)
            await db.flush()

            id_res = await db.execute(
                select(BlogSource.id).where(
                    BlogSource.campaign_id == campaign_id,
                    BlogSource.url == url,
                )
            )
            source_id = id_res.scalar_one_or_none()
            if source_id:
                all_sources.append({"id": source_id, "url": url, "blog_name": blog_name})
                slots_left -= 1
                total_fetched += 1

        # Advance to next query; DDG doesn't support page offsets
        query_idx += 1
        campaign.last_search_query_index = query_idx
        campaign.last_search_page = 0
        campaign.total_blogs_fetched = total_fetched
        await db.commit()

        # Small delay between queries to avoid DDG rate limiting
        if query_idx < len(queries) and slots_left > 0:
            await asyncio.sleep(2)

    # All queries exhausted → reset for next round
    if query_idx >= len(queries):
        campaign.last_search_query_index = 0
        campaign.last_search_page = 0
        campaign.total_blogs_fetched = total_fetched
        await db.commit()
        logger.info(
            "[search] Campaign %d: all %d queries exhausted — index reset for next round",
            campaign_id, len(queries),
        )

    logger.info("[search] Campaign %d: returning %d new sources", campaign_id, len(all_sources))
    return all_sources
