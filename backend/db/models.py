from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Boolean,
    ForeignKey, Enum, Float, func, UniqueConstraint
)
from sqlalchemy.orm import declarative_base, relationship
import enum

Base = declarative_base()


class CampaignStatus(str, enum.Enum):
    idle = "idle"
    running = "running"
    completed = "completed"
    error = "error"
    quota_paused = "quota_paused"


class ValidityStatus(str, enum.Enum):
    valid = "valid"
    invalid = "invalid"
    unverified = "unverified"


class OutreachStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    sent = "sent"
    failed = "failed"


class SentStatus(str, enum.Enum):
    sent = "sent"
    failed = "failed"


# native_enum=False stores as VARCHAR — avoids asyncpg native enum type conflicts
def _enum(enum_cls):
    return Enum(enum_cls, native_enum=False)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    # Per-user Gmail OAuth credentials (user brings their own Google Cloud project)
    google_client_id = Column(String(500), nullable=True)
    google_client_secret = Column(String(500), nullable=True)
    google_redirect_uri = Column(String(500), nullable=True)
    gmail_access_token = Column(Text, nullable=True)
    gmail_refresh_token = Column(Text, nullable=True)
    gmail_token_expiry = Column(DateTime, nullable=True)

    campaigns = relationship("Campaign", back_populates="user", cascade="all, delete-orphan")


class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    niche = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False)
    status = Column(_enum(CampaignStatus), default=CampaignStatus.idle, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    # Pagination state for SerpAPI — persisted so we resume where we left off
    last_search_page = Column(Integer, default=0, nullable=False)
    last_search_query_index = Column(Integer, default=0, nullable=False)
    total_blogs_fetched = Column(Integer, default=0, nullable=False)

    user = relationship("User", back_populates="campaigns")
    search_queries = relationship("SearchQuery", back_populates="campaign", cascade="all, delete-orphan")
    blog_sources = relationship("BlogSource", back_populates="campaign", cascade="all, delete-orphan")
    leads = relationship("Lead", back_populates="campaign", cascade="all, delete-orphan")
    outreach_emails = relationship("OutreachEmail", back_populates="campaign", cascade="all, delete-orphan")


class SearchQuery(Base):
    __tablename__ = "search_queries"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    query_string = Column(String(500), nullable=False)
    page_offset = Column(Integer, default=0, nullable=False)
    used_at = Column(DateTime, server_default=func.now())

    campaign = relationship("Campaign", back_populates="search_queries")
    blog_sources = relationship("BlogSource", back_populates="query")


class BlogSource(Base):
    __tablename__ = "blog_sources"
    __table_args__ = (
        UniqueConstraint("campaign_id", "url", name="uq_blog_source_campaign_url"),
    )

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    url = Column(String(1000), nullable=False)
    blog_name = Column(String(255), nullable=True)
    query_id = Column(Integer, ForeignKey("search_queries.id", ondelete="SET NULL"), nullable=True)
    found_at = Column(DateTime, server_default=func.now())

    campaign = relationship("Campaign", back_populates="blog_sources")
    query = relationship("SearchQuery", back_populates="blog_sources")
    leads = relationship("Lead", back_populates="source_blog")


class Lead(Base):
    __tablename__ = "leads"
    __table_args__ = (
        UniqueConstraint("campaign_id", "email", name="uq_lead_campaign_email"),
    )

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    email = Column(String(255), nullable=False)
    source_blog_id = Column(Integer, ForeignKey("blog_sources.id", ondelete="SET NULL"), nullable=True)
    validity_status = Column(_enum(ValidityStatus), default=ValidityStatus.unverified, nullable=False)
    validated_at = Column(DateTime, nullable=True)
    is_duplicate = Column(Boolean, default=False, nullable=False)

    campaign = relationship("Campaign", back_populates="leads")
    source_blog = relationship("BlogSource", back_populates="leads")
    outreach_emails = relationship("OutreachEmail", back_populates="lead", cascade="all, delete-orphan")


class OutreachEmail(Base):
    __tablename__ = "outreach_emails"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    subject = Column(String(500), nullable=False)
    body = Column(Text, nullable=False)
    status = Column(_enum(OutreachStatus), default=OutreachStatus.pending, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    approved_at = Column(DateTime, nullable=True)
    # Message-ID of the outreach email we sent — used for email thread continuity
    message_id = Column(String(500), nullable=True)

    lead = relationship("Lead", back_populates="outreach_emails")
    campaign = relationship("Campaign", back_populates="outreach_emails")
    sent_logs = relationship("SentLog", back_populates="outreach_email", cascade="all, delete-orphan")
    replies = relationship("EmailReply", back_populates="outreach_email", cascade="all, delete-orphan")


class SentLog(Base):
    __tablename__ = "sent_log"

    id = Column(Integer, primary_key=True, index=True)
    outreach_email_id = Column(Integer, ForeignKey("outreach_emails.id", ondelete="CASCADE"), nullable=False)
    sent_at = Column(DateTime, server_default=func.now())
    status = Column(_enum(SentStatus), default=SentStatus.sent, nullable=False)
    open_count = Column(Integer, default=0, nullable=False)
    last_opened_at = Column(DateTime, nullable=True)
    retry_count = Column(Integer, default=0, nullable=False)
    gmail_thread_id = Column(String(255), nullable=True)

    outreach_email = relationship("OutreachEmail", back_populates="sent_logs")


class EmailReply(Base):
    __tablename__ = "email_replies"

    id = Column(Integer, primary_key=True, index=True)
    outreach_email_id = Column(Integer, ForeignKey("outreach_emails.id", ondelete="CASCADE"), nullable=False)
    from_email = Column(String(255), nullable=False)
    from_name = Column(String(255), nullable=True)
    subject = Column(String(500), nullable=True)
    body = Column(Text, nullable=False)
    received_at = Column(DateTime, server_default=func.now())
    message_id = Column(String(500), nullable=True, unique=True)
    sentiment = Column(String(20), nullable=True)
    sentiment_score = Column(Float, nullable=True)
    priority = Column(String(20), nullable=True)

    outreach_email = relationship("OutreachEmail", back_populates="replies")
    ai_response = relationship(
        "AIResponse", back_populates="reply",
        uselist=False, cascade="all, delete-orphan"
    )


class AIResponse(Base):
    __tablename__ = "ai_responses"

    id = Column(Integer, primary_key=True, index=True)
    reply_id = Column(Integer, ForeignKey("email_replies.id", ondelete="CASCADE"), nullable=False, unique=True)
    suggested_subject = Column(String(500), nullable=True)
    suggested_body = Column(Text, nullable=True)
    user_edited_subject = Column(String(500), nullable=True)
    user_edited_body = Column(Text, nullable=True)
    is_approved = Column(Boolean, default=False, nullable=False)
    is_sent = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    # Full chain of Message-IDs for the thread: "orig_id reply1_id our_reply_id ..."
    thread_references = Column(Text, nullable=True)

    reply = relationship("EmailReply", back_populates="ai_response")


class AppSettings(Base):
    """Simple key/value store for app-wide state (quota timestamps, job progress, etc.)."""
    __tablename__ = "app_settings"

    key = Column(String(255), primary_key=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
