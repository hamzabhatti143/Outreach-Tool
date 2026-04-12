from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.models import OutreachEmail, OutreachStatus
from tools.mailer import send_email


async def run_sender_agent(
    outreach_email_ids: list[int],
    db: AsyncSession,
) -> dict[str, Any]:
    """
    For each approved outreach_email_id, send the email and log the result.
    Only sends emails with status=approved.
    Returns summary of sent/failed counts.
    """
    sent = 0
    failed = 0
    errors: list[dict[str, Any]] = []

    for email_id in outreach_email_ids:
        # Verify it's approved before sending
        result = await db.execute(
            select(OutreachEmail).where(
                OutreachEmail.id == email_id,
                OutreachEmail.status == OutreachStatus.approved,
            )
        )
        outreach = result.scalar_one_or_none()

        if not outreach:
            errors.append({"id": email_id, "error": "Not found or not approved"})
            failed += 1
            continue

        send_result = await send_email(email_id, db)

        if send_result["status"] == "sent":
            sent += 1
        else:
            failed += 1
            errors.append({"id": email_id, "error": send_result.get("error")})

    return {"sent": sent, "failed": failed, "errors": errors}
