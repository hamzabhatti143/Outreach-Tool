import asyncio
import logging
from datetime import datetime
from typing import Any, Callable
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update as sa_update, delete as sa_delete
from db.models import OutreachEmail, OutreachStatus
from tools.mailer import send_email

logger = logging.getLogger(__name__)

_SEND_DELAY_SECONDS = 10  # Delay between sends to avoid Gmail rate limiting


async def run_sender_agent(
    outreach_email_ids: list[int],
    db: AsyncSession,
) -> dict[str, Any]:
    """
    Send a list of outreach emails. Dedup is enforced atomically inside send_email —
    duplicate calls for the same ID are safe and simply return "skipped".
    Deletes each row after successful send so it disappears from the outreach list.
    Returns summary of sent/skipped/failed counts.
    """
    sent = 0
    skipped = 0
    failed = 0
    errors: list[dict[str, Any]] = []

    # Deduplicate the incoming ID list before processing
    seen: set[int] = set()
    unique_ids = [i for i in outreach_email_ids if not (i in seen or seen.add(i))]  # type: ignore[func-returns-value]

    for email_id in unique_ids:
        # Quick pre-check: skip if obviously not approved
        result = await db.execute(
            select(OutreachEmail.status).where(OutreachEmail.id == email_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            errors.append({"id": email_id, "error": "Not found"})
            failed += 1
            continue
        status_val = row.value if hasattr(row, "value") else str(row)
        if status_val not in ("approved", "sent"):
            errors.append({"id": email_id, "error": f"Status is {status_val}, not approved"})
            failed += 1
            continue

        send_result = await send_email(email_id, db)

        if send_result["status"] in ("sent", "skipped"):
            sent += 1
            # Remove from outreach list after sending
            await db.execute(sa_delete(OutreachEmail).where(OutreachEmail.id == email_id))
            await db.commit()
        else:
            failed += 1
            errors.append({"id": email_id, "error": send_result.get("error")})

    return {"sent": sent, "skipped": skipped, "failed": failed, "errors": errors}


async def auto_send_campaign(
    campaign_id: int,
    is_stopped: Callable[[], bool],
) -> dict[str, Any]:
    """
    Auto-approve all pending emails for a campaign then send them with rate-limit delay.
    Called by the pipeline so emails send themselves without user interaction.
    Deletes each row after successful send.
    Respects the pipeline stop signal between sends.
    """
    from db.database import retry_session

    # Auto-approve all pending emails for this campaign
    async with retry_session() as db:
        await db.execute(
            sa_update(OutreachEmail)
            .where(
                OutreachEmail.campaign_id == campaign_id,
                OutreachEmail.status == OutreachStatus.pending,
            )
            .values(status=OutreachStatus.approved, approved_at=datetime.utcnow())
        )
        await db.commit()

        # Collect the IDs that are now approved
        id_result = await db.execute(
            select(OutreachEmail.id).where(
                OutreachEmail.campaign_id == campaign_id,
                OutreachEmail.status == OutreachStatus.approved,
            )
        )
        email_ids = [row[0] for row in id_result.all()]

    if not email_ids:
        return {"sent": 0, "skipped": 0, "failed": 0}

    sent = skipped = failed = 0

    for i, email_id in enumerate(email_ids):
        if is_stopped():
            logger.info("[auto_send] Campaign %d: stop requested, halting at email %d/%d",
                        campaign_id, i + 1, len(email_ids))
            break

        async with retry_session() as db:
            try:
                result = await send_email(email_id, db)
                if result["status"] in ("sent", "skipped"):
                    sent += 1
                    # Remove from outreach list after sending
                    await db.execute(sa_delete(OutreachEmail).where(OutreachEmail.id == email_id))
                    await db.commit()
                else:
                    failed += 1
                    logger.warning("[auto_send] email %d failed: %s", email_id, result.get("error"))
            except Exception as exc:
                failed += 1
                logger.error("[auto_send] email %d error: %s", email_id, exc)

        # Rate-limit delay — interruptible by stop signal
        if i < len(email_ids) - 1:
            for _ in range(_SEND_DELAY_SECONDS):
                if is_stopped():
                    break
                await asyncio.sleep(1)

    logger.info("[auto_send] Campaign %d complete: sent=%d skipped=%d failed=%d",
                campaign_id, sent, skipped, failed)
    return {"sent": sent, "skipped": skipped, "failed": failed}
