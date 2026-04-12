from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Boolean,
    ForeignKey, Enum, func
)
from sqlalchemy.orm import declarative_base, relationship
import enum

Base = declarative_base()


class CampaignStatus(str, enum.Enum):
    idle = "idle"
    running = "running"
    completed = "completed"
    error = "error"


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

    campaigns = relationship("Campaign", back_populates="user", cascade="all, delete-orphan")


class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    niche = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False)
    status = Column(_enum(CampaignStatus), default=CampaignStatus.idle, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

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
    used_at = Column(DateTime, server_default=func.now())

    campaign = relationship("Campaign", back_populates="search_queries")
    blog_sources = relationship("BlogSource", back_populates="query")


class BlogSource(Base):
    __tablename__ = "blog_sources"

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

    lead = relationship("Lead", back_populates="outreach_emails")
    campaign = relationship("Campaign", back_populates="outreach_emails")
    sent_logs = relationship("SentLog", back_populates="outreach_email", cascade="all, delete-orphan")


class SentLog(Base):
    __tablename__ = "sent_log"

    id = Column(Integer, primary_key=True, index=True)
    outreach_email_id = Column(Integer, ForeignKey("outreach_emails.id", ondelete="CASCADE"), nullable=False)
    sent_at = Column(DateTime, server_default=func.now())
    status = Column(_enum(SentStatus), default=SentStatus.sent, nullable=False)
    open_count = Column(Integer, default=0, nullable=False)
    last_opened_at = Column(DateTime, nullable=True)
    retry_count = Column(Integer, default=0, nullable=False)

    outreach_email = relationship("OutreachEmail", back_populates="sent_logs")
