import os
from datetime import datetime, timedelta
from typing import Any
import serpapi
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from db.models import SearchQuery, BlogSource, Campaign
from dotenv import load_dotenv

load_dotenv()

SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")

SKIP_DOMAINS = ["facebook.com", "twitter.com", "linkedin.com", "youtube.com", "instagram.com"]

SEARCH_LIMIT = 20          # max blog results per user per window
SEARCH_WINDOW_HOURS = 12   # hours before the quota resets


async def _check_rate_limit(user_id: int, db: AsyncSession) -> None:
    """
    Raises HTTP 429 if the user has already received 30 search results in the last 12 hours.
    """
    window_start = datetime.utcnow() - timedelta(hours=SEARCH_WINDOW_HOURS)

    # All campaign IDs belonging to this user
    camp_res = await db.execute(
        select(Campaign.id).where(Campaign.user_id == user_id)
    )
    campaign_ids = [r[0] for r in camp_res.all()]

    if not campaign_ids:
        return  # no campaigns yet, nothing to count

    # Count BlogSources found in the last 12 hours across all user campaigns
    count_res = await db.execute(
        select(func.count(BlogSource.id))
        .where(
            BlogSource.campaign_id.in_(campaign_ids),
            BlogSource.found_at >= window_start,
        )
    )
    recent_count: int = count_res.scalar() or 0

    if recent_count >= SEARCH_LIMIT:
        # Find the oldest entry in the window so we can tell the user when it expires
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

    return recent_count  # type: ignore[return-value]


async def search_blogs(niche: str, campaign_id: int, db: AsyncSession, user_id: int | None = None) -> list[dict[str, Any]]:
    """
    Search for blogs in a niche using SerpAPI.
    Enforces a per-user limit of 30 results per 12-hour window.
    Skips URLs already saved for this campaign (no duplicates).
    """
    # ── Rate-limit check ────────────────────────────────────────────────────
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
            await _check_rate_limit(user_id, db)  # will raise 429
        slots_left = SEARCH_LIMIT - recent_count
    else:
        slots_left = SEARCH_LIMIT

    queries = [
        f"{niche} blog write for us",
        f"{niche} blog contact",
        f"{niche} blogs accepting guest posts",
    ]

    # Load existing URLs for this campaign upfront
    existing_result = await db.execute(
        select(BlogSource.url).where(BlogSource.campaign_id == campaign_id)
    )
    seen_urls: set[str] = {row[0] for row in existing_result.all()}

    all_sources: list[dict[str, Any]] = []

    for query_string in queries:
        if slots_left <= 0:
            break

        query_record = SearchQuery(campaign_id=campaign_id, query_string=query_string)
        db.add(query_record)
        await db.flush()

        try:
            client = serpapi.Client(api_key=SERPAPI_KEY)
            results = client.search(q=query_string, engine="google", num=10)
            organic = results.get("organic_results", [])
        except Exception as e:
            print(f"[search_blogs] SerpAPI error for '{query_string}': {e}")
            organic = []

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

            source = BlogSource(
                campaign_id=campaign_id,
                url=url,
                blog_name=blog_name,
                query_id=query_record.id,
            )
            db.add(source)
            await db.flush()

            all_sources.append({"id": source.id, "url": url, "blog_name": blog_name})
            slots_left -= 1

    await db.commit()
    return all_sources
