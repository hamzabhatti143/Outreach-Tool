import os
import smtplib
import logging
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")


async def check_smtp_connection() -> dict[str, bool | str]:
    """Verify SMTP connection on startup. Returns status dict."""
    if not SMTP_USER or not SMTP_PASS:
        logger.warning("[SMTP] SMTP credentials not configured — skipping health check")
        return {"ok": False, "error": "SMTP credentials not set"}

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
        logger.info("[SMTP] Connection verified successfully")
        return {"ok": True, "error": None}
    except Exception as e:
        logger.warning(f"[SMTP] Health check failed: {e}")
        return {"ok": False, "error": str(e)}
