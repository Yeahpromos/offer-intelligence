from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import offer_db


original_builder = offer_db._build_offers_payload
original_cache = dict(offer_db._offers_range_cache)
calls: list[dict[str, object]] = []


def fake_builder(
    *,
    month: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    persist_cache: bool = True,
) -> dict[str, object]:
    calls.append({
        "month": month,
        "start_date": start_date,
        "end_date": end_date,
        "persist_cache": persist_cache,
    })
    return {
        "ok": True,
        "month": month,
        "startDate": start_date,
        "endDate": end_date,
        "offers": [],
    }


try:
    offer_db._build_offers_payload = fake_builder  # type: ignore[assignment]
    offer_db._offers_range_cache.clear()

    first = offer_db.offers_payload(start_date="2026-08-01", end_date="2026-08-07")
    second = offer_db.offers_payload(start_date="2026-08-01", end_date="2026-08-07")
    assert first is second, "identical date ranges should use the range cache"
    assert len(calls) == 1, "the cached date range should only build once"
    assert calls[0] == {
        "month": "2026-08",
        "start_date": "2026-08-01",
        "end_date": "2026-08-07",
        "persist_cache": False,
    }
    assert first["startDate"] == "2026-08-01"
    assert first["endDate"] == "2026-08-07"

    try:
        offer_db.offers_payload(start_date="2026-08-08", end_date="2026-08-01")
    except ValueError as error:
        assert "after" in str(error)
    else:
        raise AssertionError("reversed date ranges should be rejected")
finally:
    offer_db._build_offers_payload = original_builder  # type: ignore[assignment]
    offer_db._offers_range_cache.clear()
    offer_db._offers_range_cache.update(original_cache)


print("Offer Tracker date range checks passed")
