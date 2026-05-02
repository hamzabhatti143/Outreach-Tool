import asyncio
import os
import logging
from datetime import datetime
from typing import Any
from functools import partial

import serpapi
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import SearchQuery, BlogSource, Campaign, CampaignStatus, AppSettings
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")

SKIP_DOMAINS = [
    "facebook.com", "twitter.com", "linkedin.com", "youtube.com",
    "instagram.com", "reddit.com", "pinterest.com", "tiktok.com",
]

# How many NEW blogs to find per call; SerpAPI returns 10 per page
BLOGS_PER_ROUND = 30

_QUERIES = [
    "{niche} blog write for us",
    "{niche} blog contact us",
    "{niche} blogs accepting guest posts",
    "{niche} blog submit article",
    "{niche} blogger outreach",
    "{niche} site:blog contact",
]


class QuotaExceededException(Exception):
    """Raised when SerpAPI reports the account has run out of searches."""


async def _upsert_setting(key: str, value: str, db: AsyncSession) -> None:
    stmt = pg_insert(AppSettings).values(
        key=key,
        value=value,
        updated_at=datetime.utcnow(),
    ).on_conflict_do_update(
        index_elements=["key"],
        set_={"value": value, "updated_at": datetime.utcnow()},
    )
    await db.execute(stmt)
    await db.commit()


async def _handle_quota_exceeded(campaign_id: int, db: AsyncSession) -> None:
    logger.warning("[search] SerpAPI quota exceeded for campaign %d", campaign_id)
    await _upsert_setting("quota_exceeded_at", datetime.utcnow().isoformat(), db)
    campaign = await db.get(Campaign, campaign_id)
    if campaign:
        campaign.status = CampaignStatus.quota_paused
        await db.commit()


async def search_blogs(
    niche: str,
    campaign_id: int,
    db: AsyncSession,
    user_id: int | None = None,
) -> list[dict[str, Any]]:
    """
    Search SerpAPI for blogs in a niche.
    Resumes from the campaign's saved pagination state.
    Returns up to BLOGS_PER_ROUND newly discovered blog sources.
    Resets pagination when all queries are exhausted so the next call starts fresh.
    """
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        return []

    query_idx: int = campaign.last_search_query_index or 0
    page_num: int = campaign.last_search_page or 0
    total_fetched: int = campaign.total_blogs_fetched or 0

    # Load all known URLs for this campaign for in-memory dedup
    existing_result = await db.execute(
        select(BlogSource.url).where(BlogSource.campaign_id == campaign_id)
    )
    seen_urls: set[str] = {row[0] for row in existing_result.all()}

    queries = [q.format(niche=niche) for q in _QUERIES]
    all_sources: list[dict[str, Any]] = []
    slots_left = BLOGS_PER_ROUND

    while query_idx < len(queries) and slots_left > 0:
        query_string = queries[query_idx]
        start_offset = page_num * 10

        query_record = SearchQuery(
            campaign_id=campaign_id,
            query_string=query_string,
            page_offset=start_offset,
        )
        db.add(query_record)
        await db.flush()

        try:
            client = serpapi.Client(api_key=SERPAPI_KEY)
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None,
                partial(client.search, q=query_string, engine="google", num=10, start=start_offset),
            )
            organic = results.get("organic_results", [])
        except Exception as e:
            error_str = str(e).lower()
            if "run out of searches" in error_str or "quota" in error_str or "credits" in error_str:
                await _handle_quota_exceeded(campaign_id, db)
                raise QuotaExceededException(str(e))
            logger.error("[search] SerpAPI error for '%s' page %d: %s", query_string, page_num, e)
            # Treat as empty page and advance
            organic = []

        if not organic:
            # This query has no more results — move to the next query
            query_idx += 1
            page_num = 0
            campaign.last_search_query_index = query_idx
            campaign.last_search_page = page_num
            await db.commit()
            continue

        for result in organic:
            if slots_left <= 0:
                break

            url: str = result.get("link", "")
            blog_name: str = result.get("title", url)

            if not url or url in seen_urls:
                continue
            if any(d in url for d in SKIP_DOMAINS):
                continue

            seen_urls.add(url)

            stmt = pg_insert(BlogSource).values(
                campaign_id=campaign_id,
                url=url,
                blog_name=blog_name,
                query_id=query_record.id,
            ).on_conflict_do_nothing(index_elements=["campaign_id", "url"])
            await db.execute(stmt)
            await db.flush()

            # Fetch the row ID (may have been inserted just now, or already existed)
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

        # Advance to next page of this query
        page_num += 1
        campaign.last_search_page = page_num
        campaign.last_search_query_index = query_idx
        campaign.total_blogs_fetched = total_fetched
        await db.commit()

    # All queries exhausted → reset pagination so next call starts fresh
    if query_idx >= len(queries):
        campaign.last_search_query_index = 0
        campaign.last_search_page = 0
        campaign.total_blogs_fetched = total_fetched
        await db.commit()
        logger.info(
            "[search] Campaign %d: all %d queries exhausted — pagination reset for next round",
            campaign_id, len(queries),
        )

    logger.info("[search] Campaign %d: returning %d new sources", campaign_id, len(all_sources))
    return all_sources
