import os
import logging
from datetime import datetime, timedelta
from typing import Any

import serpapi
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import SearchQuery, BlogSource, Campaign, CampaignStatus, AppSettings
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")

SKIP_DOMAINS = ["facebook.com", "twitter.com", "linkedin.com", "youtube.com", "instagram.com"]

SEARCH_LIMIT = 20
SEARCH_WINDOW_HOURS = 12

_QUERIES = [
    "{niche} blog write for us",
    "{niche} blog contact us",
    "{niche} blogs accepting guest posts",
    "{niche} blog submit article",
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
    """Save quota timestamp and mark campaign as quota_paused."""
    logger.warning("[search] SerpAPI quota exceeded for campaign %d", campaign_id)
    await _upsert_setting("quota_exceeded_at", datetime.utcnow().isoformat(), db)
    campaign = await db.get(Campaign, campaign_id)
    if campaign:
        campaign.status = CampaignStatus.quota_paused
        await db.commit()


async def _check_rate_limit(user_id: int, db: AsyncSession) -> None:
    """Raises HTTP 429 if the user already received SEARCH_LIMIT results in the last 12 hours."""
    window_start = datetime.utcnow() - timedelta(hours=SEARCH_WINDOW_HOURS)

    camp_res = await db.execute(
        select(Campaign.id).where(Campaign.user_id == user_id)
    )
    campaign_ids = [r[0] for r in camp_res.all()]
    if not campaign_ids:
        return

    count_res = await db.execute(
        select(func.count(BlogSource.id))
        .where(
            BlogSource.campaign_id.in_(campaign_ids),
            BlogSource.found_at >= window_start,
        )
    )
    recent_count: int = count_res.scalar() or 0

    if recent_count >= SEARCH_LIMIT:
        oldest_res = await db.execute(
            select(func.min(BlogSource.found_at))
            .where(
                BlogSource.campaign_id.in_(campaign_ids),
                BlogSource.found_at >= window_start,
            )
        )
        oldest: datetime | None = oldest_res.scalar()
        reset_at = (oldest + timedelta(hours=SEARCH_WINDOW_HOURS)) if oldest else None
        reset_str = reset_at.strftime("%H:%M UTC") if reset_at else "in ~12 hours"

        raise HTTPException(
            status_code=429,
            detail=(
                f"Search limit reached: you can discover up to {SEARCH_LIMIT} blogs every "
                f"{SEARCH_WINDOW_HOURS} hours. Quota resets at {reset_str}."
            ),
        )


async def search_blogs(
    niche: str,
    campaign_id: int,
    db: AsyncSession,
    user_id: int | None = None,
) -> list[dict[str, Any]]:
    """
    Search for blogs in a niche using SerpAPI.
    Continues from the last saved pagination offset stored on the Campaign row.
    Enforces a per-user limit of SEARCH_LIMIT results per SEARCH_WINDOW_HOURS window.
    Uses INSERT ... ON CONFLICT DO NOTHING for duplicate-safe blog source saves.
    """
    # ── Per-user rate-limit check ────────────────────────────────────────────
    if user_id is not None:
        remaining_res = await db.execute(
            select(func.count(BlogSource.id))
            .where(
                BlogSource.campaign_id.in_(
                    select(Campaign.id).where(Campaign.user_id == user_id).scalar_subquery()
                ),
                BlogSource.found_at >= datetime.utcnow() - timedelta(hours=SEARCH_WINDOW_HOURS),
            )
        )
        recent_count: int = remaining_res.scalar() or 0
        if recent_count >= SEARCH_LIMIT:
            await _check_rate_limit(user_id, db)
        slots_left = SEARCH_LIMIT - recent_count
    else:
        slots_left = SEARCH_LIMIT

    # ── Load campaign pagination state ───────────────────────────────────────
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        return []

    query_idx: int = campaign.last_search_query_index or 0
    page_num: int = campaign.last_search_page or 0
    total_fetched: int = campaign.total_blogs_fetched or 0

    # ── Load existing URLs for this campaign (dedup) ─────────────────────────
    existing_result = await db.execute(
        select(BlogSource.url).where(BlogSource.campaign_id == campaign_id)
    )
    seen_urls: set[str] = {row[0] for row in existing_result.all()}

    queries = [q.format(niche=niche) for q in _QUERIES]
    all_sources: list[dict[str, Any]] = []

    while query_idx < len(queries) and slots_left > 0:
        query_string = queries[query_idx]
        start_offset = page_num * 10

        # Log this query + page to search_queries
        query_record = SearchQuery(
            campaign_id=campaign_id,
            query_string=query_string,
            page_offset=start_offset,
        )
        db.add(query_record)
        await db.flush()

        try:
            client = serpapi.Client(api_key=SERPAPI_KEY)
            results = client.search(q=query_string, engine="google", num=10, start=start_offset)
            organic = results.get("organic_results", [])
        except Exception as e:
            error_str = str(e).lower()
            if "run out of searches" in error_str or "quota" in error_str or "credits" in error_str:
                await _handle_quota_exceeded(campaign_id, db)
                raise QuotaExceededException(str(e))
            logger.error("[search_blogs] SerpAPI error for '%s' page %d: %s", query_string, page_num, e)
            organic = []

        if not organic:
            # This query has no more results — advance to the next query
            query_idx += 1
            page_num = 0
            campaign.last_search_query_index = query_idx
            campaign.last_search_page = page_num
            await db.commit()
            continue

        # Process results and save with ON CONFLICT DO NOTHING
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

            # Use upsert-style insert; if campaign+url already exists, skip silently
            stmt = pg_insert(BlogSource).values(
                campaign_id=campaign_id,
                url=url,
                blog_name=blog_name,
                query_id=query_record.id,
            ).on_conflict_do_nothing(
                index_elements=["campaign_id", "url"],
            )
            await db.execute(stmt)
            await db.flush()

            # Fetch the ID (inserted or pre-existing)
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

        # Advance pagination after processing this page
        page_num += 1
        campaign.last_search_page = page_num
        campaign.last_search_query_index = query_idx
        campaign.total_blogs_fetched = total_fetched
        await db.commit()

    return all_sources
