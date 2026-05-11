import re
import json
import asyncio
from html import unescape
from urllib.parse import urljoin, urlparse
import httpx
from bs4 import BeautifulSoup

EMAIL_REGEX = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"
)

SKIP_EXTENSIONS = (".jpg", ".jpeg", ".png", ".gif", ".pdf", ".svg", ".webp", ".mp4")
SKIP_DOMAINS = ("facebook.com", "twitter.com", "linkedin.com", "instagram.com", "youtube.com", "sentry.io")

SKIP_EMAIL_PATTERNS = (
    "example.com", "sentry", "wixpress", "wordpress.org",
    "schema.org", "w3.org", "googleapis", "gstatic",
)

SKIP_DOMAIN_EXTENSIONS = (
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
    ".css", ".js", ".woff", ".ttf", ".mp4",
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


def _decode_cloudflare_email(encoded: str) -> str:
    try:
        data = bytes.fromhex(encoded)
        key = data[0]
        return "".join(chr(b ^ key) for b in data[1:])
    except Exception:
        return ""


def _extract_from_jsonld(obj: object, emails: set[str]) -> None:
    if isinstance(obj, dict):
        for key, val in obj.items():
            if key in ("email", "contactEmail") and isinstance(val, str):
                if EMAIL_REGEX.match(val):
                    emails.add(val)
            else:
                _extract_from_jsonld(val, emails)
    elif isinstance(obj, list):
        for item in obj:
            _extract_from_jsonld(item, emails)


def _extract_emails_from_html(html: str) -> set[str]:
    emails: set[str] = set()

    decoded = unescape(html)
    emails.update(EMAIL_REGEX.findall(decoded))

    soup = BeautifulSoup(html, "html.parser")

    for tag in soup.find_all("a", href=True):
        href: str = tag["href"]
        if href.lower().startswith("mailto:"):
            addr = href[7:].split("?")[0].strip()
            if addr and EMAIL_REGEX.match(addr):
                emails.add(addr)

    for tag in soup.find_all(attrs={"data-cfemail": True}):
        decoded_email = _decode_cloudflare_email(tag["data-cfemail"])
        if decoded_email and EMAIL_REGEX.match(decoded_email):
            emails.add(decoded_email)

    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            _extract_from_jsonld(data, emails)
        except Exception:
            pass

    for tag in soup.find_all(attrs={"data-email": True}):
        val = tag["data-email"]
        if EMAIL_REGEX.match(val):
            emails.add(val)

    result = set()
    for e in emails:
        el = e.lower()
        if len(e) >= 100:
            continue
        if any(p in el for p in SKIP_EMAIL_PATTERNS):
            continue
        domain_part = el.split("@")[-1] if "@" in el else ""
        if any(domain_part.endswith(ext) for ext in SKIP_DOMAIN_EXTENSIONS):
            continue
        result.add(el)
    return result


def _is_skippable_url(url: str) -> bool:
    parsed = urlparse(url)
    if any(d in parsed.netloc for d in SKIP_DOMAINS):
        return True
    if any(parsed.path.lower().endswith(ext) for ext in SKIP_EXTENSIONS):
        return True
    return False


def _get_pages_to_check(url: str) -> list[str]:
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    candidates = [
        url,
        urljoin(base, "/contact"),
        urljoin(base, "/contact-us"),
        urljoin(base, "/about"),
        urljoin(base, "/about-us"),
        urljoin(base, "/write-for-us"),
        urljoin(base, "/guest-post"),
        urljoin(base, "/advertise"),
        # Common on SaaS / service-based sites
        urljoin(base, "/team"),
        urljoin(base, "/press"),
        urljoin(base, "/partnerships"),
        urljoin(base, "/contribute"),
        urljoin(base, "/work-with-us"),
    ]
    seen: set[str] = set()
    result = []
    for p in candidates:
        if p not in seen:
            seen.add(p)
            result.append(p)
    return result


async def scrape_emails(url: str) -> list[str]:
    """
    Scrape emails from a blog URL. Fetches all candidate pages concurrently.
    """
    pages = _get_pages_to_check(url)
    all_emails: set[str] = set()

    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
        async def fetch_page(page_url: str) -> set[str]:
            if _is_skippable_url(page_url):
                return set()
            try:
                response = await client.get(page_url, headers=HEADERS)
                if response.status_code == 200:
                    return _extract_emails_from_html(response.text)
            except Exception as e:
                print(f"[scraper] Failed {page_url}: {type(e).__name__}: {e}")
            return set()

        results = await asyncio.gather(*[fetch_page(p) for p in pages])
        for found in results:
            all_emails.update(found)

    return list(all_emails)
