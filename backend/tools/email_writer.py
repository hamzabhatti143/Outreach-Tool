import os
import json
import re
import asyncio
from typing import Any
from openai import AsyncOpenAI, RateLimitError, APIConnectionError, APITimeoutError
from dotenv import load_dotenv

load_dotenv()

client = AsyncOpenAI(
    api_key=os.getenv("GEMINI_API_KEY", ""),
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
)

# All instructions in the system prompt so they are shared across calls (prompt caching)
SYSTEM_PROMPT = (
    "You are an outreach specialist. Given a blog name, niche, and URL, "
    "write a short personalized cold email. "
    "Rules: subject under 55 chars, body exactly 2 paragraphs (3 sentences each), "
    "professional tone, ends with one clear CTA, no clichés like 'I hope this finds you well'. "
    'Output ONLY valid JSON: {"subject": "...", "body": "..."}'
)


def _extract_json(text: str) -> dict:
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if fenced:
        text = fenced.group(1)
    return json.loads(text)


async def generate_outreach(
    blog_name: str,
    niche: str,
    url: str,
    campaign_id: int,
) -> dict[str, Any]:
    """Generate a personalized outreach email. Returns {"subject": str, "body": str}."""
    user_msg = f"Blog: {blog_name}\nNiche: {niche}\nURL: {url}"

    for attempt in range(4):
        try:
            response = await client.chat.completions.create(
                model="gemini-2.5-flash",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=400,
                temperature=0.7,
            )
            content = response.choices[0].message.content or "{}"
            result = _extract_json(content)
            return {
                "subject": result.get("subject", "Collaboration Opportunity"),
                "body": result.get("body", ""),
            }
        except RateLimitError:
            if attempt == 3:
                raise
            wait = 15 * (attempt + 1)
            print(f"[email_writer] Rate limited — retrying in {wait}s (attempt {attempt + 1}/4)")
            await asyncio.sleep(wait)
        except (APIConnectionError, APITimeoutError) as exc:
            if attempt == 3:
                raise
            wait = 5 * (2 ** attempt)  # 5s, 10s, 20s
            print(f"[email_writer] Network error ({type(exc).__name__}) — retrying in {wait}s (attempt {attempt + 1}/4)")
            await asyncio.sleep(wait)
        except Exception:
            raise
