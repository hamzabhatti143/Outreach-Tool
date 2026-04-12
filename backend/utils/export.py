import io
import csv
from typing import Any


def leads_to_csv(leads: list[dict[str, Any]]) -> str:
    """Convert lead dicts to CSV string."""
    if not leads:
        return ""

    output = io.StringIO()
    fieldnames = ["id", "email", "source_blog", "validity_status", "validated_at", "is_duplicate"]
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for lead in leads:
        writer.writerow(lead)

    return output.getvalue()


def sources_to_csv(sources: list[dict[str, Any]]) -> str:
    """Convert blog source dicts to CSV string."""
    if not sources:
        return ""

    output = io.StringIO()
    fieldnames = ["id", "blog_name", "url", "query_string", "email_count", "found_at"]
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for source in sources:
        writer.writerow(source)

    return output.getvalue()
