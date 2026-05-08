import re

_PATTERNS = [
    (r"asyncpg[^\s]*", "db"),
    (r"postgresql\+asyncpg://[^\s]*", "db-url-redacted"),
    (r"sqlalchemy[^\s]*", "orm"),
    (r"psycopg[^\s]*", "db-driver"),
    (r"\(Background on this error at:.*?\)", ""),
]


def sanitize_error(exc: Exception | str) -> str:
    msg = str(exc)
    for pattern, replacement in _PATTERNS:
        msg = re.sub(pattern, replacement, msg, flags=re.IGNORECASE)
    return msg.strip() or "An internal error occurred"
