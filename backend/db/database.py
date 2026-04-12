from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import NullPool
from db.models import Base
import os
from urllib.parse import urlparse, urlencode, parse_qs, urlunparse
from dotenv import load_dotenv

load_dotenv()

_raw_url = os.getenv("DATABASE_URL", "")

# Normalize scheme for asyncpg
if _raw_url.startswith("postgres://"):
    _raw_url = _raw_url.replace("postgres://", "postgresql+asyncpg://", 1)
elif _raw_url.startswith("postgresql://"):
    _raw_url = _raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)

# Strip query params asyncpg doesn't understand
parsed = urlparse(_raw_url)
qs = parse_qs(parsed.query)
qs.pop("sslmode", None)
qs.pop("channel_binding", None)
clean_query = urlencode({k: v[0] for k, v in qs.items()})
DATABASE_URL = urlunparse(parsed._replace(query=clean_query))

engine = create_async_engine(
    DATABASE_URL,
    poolclass=NullPool,
    echo=False,
    connect_args={
        "ssl": "require",
        "prepared_statement_cache_size": 0,
        "server_settings": {
            "plan_cache_mode": "force_generic_plan",
        },
    },
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncSession:  # type: ignore[return]
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
