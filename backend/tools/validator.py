import asyncio
import dns.resolver
import smtplib
import socket
from concurrent.futures import ThreadPoolExecutor
from email_validator import validate_email as _validate_email_lib, EmailNotValidError
from typing import Any

_executor = ThreadPoolExecutor(max_workers=20, thread_name_prefix="validator")


def _validate_sync(email: str) -> dict[str, Any]:
    """Synchronous validation — runs in a thread pool to avoid blocking the event loop."""
    # Step 1: Syntax
    try:
        valid = _validate_email_lib(email, check_deliverability=False)
        normalized = valid.normalized
    except EmailNotValidError as e:
        return {"email": email, "status": "invalid", "reason": f"Syntax: {e}"}

    domain = normalized.split("@")[1]

    # Step 2: MX record (3s timeout)
    try:
        resolver = dns.resolver.Resolver()
        resolver.lifetime = 3.0
        mx_records = resolver.resolve(domain, "MX")
        mx_host = str(sorted(mx_records, key=lambda r: r.preference)[0].exchange).rstrip(".")
    except Exception as e:
        return {"email": normalized, "status": "invalid", "reason": f"No MX record: {e}"}

    # Step 3: SMTP RCPT TO soft check (3s timeout)
    try:
        with smtplib.SMTP(mx_host, 25, timeout=3) as smtp:
            smtp.ehlo_or_helo_if_needed()
            smtp.mail("probe@outreach-tool.com")
            code, _ = smtp.rcpt(normalized)
            if code == 250:
                return {"email": normalized, "status": "valid", "reason": "SMTP accepted"}
            else:
                return {"email": normalized, "status": "invalid", "reason": f"SMTP rejected: {code}"}
    except (smtplib.SMTPConnectError, socket.timeout, OSError):
        return {"email": normalized, "status": "valid", "reason": "MX verified (SMTP unreachable)"}
    except Exception as e:
        return {"email": normalized, "status": "valid", "reason": f"MX verified (SMTP error: {e})"}


async def validate_email(email: str) -> dict[str, Any]:
    """Non-blocking email validation — offloads blocking DNS/SMTP work to thread pool."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _validate_sync, email)
