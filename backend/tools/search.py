import os
from typing import Any
import serpapi
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.models import SearchQuery, BlogSource
from dotenv import load_dotenv

load_dotenv()

SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")

SKIP_DOMAINS = ["facebook.com", "twitter.com", "linkedin.com", "youtube.com", "instagram.com"]


async def search_blogs(niche: str, campaign_id: int, db: AsyncSession) -> list[dict[str, Any]]:
    """
    Search for blogs in a niche using SerpAPI.
    Skips URLs already saved for this campaign (no duplicates).
    """
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

    await db.commit()
    return all_sources
