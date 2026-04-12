import os
from typing import Any
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

SYSTEM_PROMPT = """You are an expert outreach specialist. Write concise, personalized cold outreach emails.
Output ONLY valid JSON with exactly two keys: "subject" and "body". No preamble, no explanation."""

USER_TEMPLATE = """Write a cold outreach email to a blog.
Blog name: {blog_name}
Niche: {niche}
Blog URL: {url}

Requirements:
- Subject: compelling, under 60 chars, no clickbait
- Body: 3-4 short paragraphs, personalized, professional, ends with clear CTA
- Mention you read their blog and reference the niche specifically
- Do not use generic filler phrases like "I hope this email finds you well"
- Output only JSON: {{"subject": "...", "body": "..."}}"""


async def generate_outreach(
    blog_name: str,
    niche: str,
    url: str,
    campaign_id: int,
) -> dict[str, Any]:
    """
    Generate a personalized outreach email for a blog.
    Single LLM call. Returns {"subject": str, "body": str}.
    """
    prompt = USER_TEMPLATE.format(blog_name=blog_name, niche=niche, url=url)

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        max_tokens=600,
        temperature=0.7,
        response_format={"type": "json_object"},
    )

    content = response.choices[0].message.content or "{}"
    import json
    result = json.loads(content)

    return {
        "subject": result.get("subject", "Collaboration Opportunity"),
        "body": result.get("body", ""),
    }
