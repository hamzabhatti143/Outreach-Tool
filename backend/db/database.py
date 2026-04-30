import asyncio
import logging
import os
from urllib.parse import urlparse, urlencode, parse_qs, urlunparse

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import NullPool
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

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
        "timeout": 30,
        "command_timeout": 60,
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

_TRANSIENT_MSGS = ("ssl", "tls", "eof", "connection", "getaddrinfo", "start_tls", "timeout")


def _is_transient(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(k in msg for k in _TRANSIENT_MSGS)


class _RetrySession:
    """Async context manager: opens an AsyncSession with up to 3 attempts on transient errors."""

    def __init__(self, max_attempts: int = 3):
        self._max = max_attempts
        self._session: AsyncSession | None = None

    async def __aenter__(self) -> AsyncSession:
        for attempt in range(self._max):
            try:
                self._session = AsyncSessionLocal()
                await self._session.connection()
                return self._session
            except Exception as exc:
                if self._session:
                    await self._session.close()
                    self._session = None
                if attempt < self._max - 1 and _is_transient(exc):
                    wait = 2 ** attempt
                    logger.warning(
                        "[db] Transient connection error (attempt %d/%d), retrying in %ds: %s",
                        attempt + 1, self._max, wait, exc,
                    )
                    await asyncio.sleep(wait)
                else:
                    raise

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session:
            try:
                if exc_type is None:
                    await self._session.commit()
                else:
                    await self._session.rollback()
            finally:
                await self._session.close()
        return False


def retry_session(max_attempts: int = 3) -> _RetrySession:
    """Use in background tasks instead of AsyncSessionLocal()."""
    return _RetrySession(max_attempts)


_GMAIL_MIGRATIONS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_client_id TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_client_secret TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_redirect_uri TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_access_token TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_refresh_token TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_token_expiry TIMESTAMP",
    "ALTER TABLE sent_log ADD COLUMN IF NOT EXISTS gmail_thread_id VARCHAR(255)",
]

_NEW_MIGRATIONS = [
    # Campaign pagination state
    "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS last_search_page INTEGER DEFAULT 0",
    "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS last_search_query_index INTEGER DEFAULT 0",
    "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_blogs_fetched INTEGER DEFAULT 0",
    # Search query page tracking
    "ALTER TABLE search_queries ADD COLUMN IF NOT EXISTS page_offset INTEGER DEFAULT 0",
    # Outreach email thread continuity
    "ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS message_id VARCHAR(500)",
    # AI response thread reference chain
    "ALTER TABLE ai_responses ADD COLUMN IF NOT EXISTS thread_references TEXT",
    # Unique indexes for deduplication
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_campaign_email ON leads (campaign_id, email)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_sources_campaign_url ON blog_sources (campaign_id, url)",
    # App-wide key/value settings table
    """CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
    )""",
]


async def init_db() -> None:
    for attempt in range(3):
        try:
            async with engine.begin() as conn:
                from db.models import Base
                await conn.run_sync(Base.metadata.create_all)
                from sqlalchemy import text
                for stmt in _GMAIL_MIGRATIONS + _NEW_MIGRATIONS:
                    await conn.execute(text(stmt))
            return
        except Exception as exc:
            if attempt < 2 and _is_transient(exc):
                logger.warning("[db] init_db transient error, retrying: %s", exc)
                await asyncio.sleep(2 ** attempt)
            else:
                raise


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
