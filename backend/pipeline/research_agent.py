from sqlalchemy.ext.asyncio import AsyncSession
from tools.search import search_blogs


async def run_research_agent(niche: str, campaign_id: int, db: AsyncSession) -> list[dict]:
    """Find blogs in a niche and save them to DB. Returns discovered blog sources."""
    return await search_blogs(niche, campaign_id, db)
