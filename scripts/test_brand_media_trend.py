from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import offer_db


ROWS = [
    {
        "merchant_id": 101,
        "merchant_name": "Alpha",
        "user_id": 7,
        "user_name": "Media Seven",
        "order_day": 20260701,
        "revenue": 80.5,
        "orders": 2,
        "all_commission": 12.08,
        "aff_commission": 9.06,
    },
    {
        "merchant_id": 101,
        "merchant_name": "Alpha",
        "user_id": 7,
        "user_name": "Media Seven",
        "order_day": 20260703,
        "revenue": 20,
        "orders": 1,
        "all_commission": 3,
        "aff_commission": 2.25,
    },
    {
        "merchant_id": 101,
        "merchant_name": "Alpha",
        "user_id": 8,
        "user_name": "Media Eight",
        "order_day": 20260702,
        "revenue": 0,
        "orders": 0,
        "all_commission": 0,
        "aff_commission": 0,
    },
]


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_close(actual, expected, label):
    if actual is None or abs(float(actual) - float(expected)) > 0.0001:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


@contextmanager
def fake_connection():
    yield object()


def main():
    normalized = offer_db.brand_media_trend_from_rows(ROWS)
    assert_equal(normalized["merchantName"], "Alpha", "merchant name")
    assert_equal(normalized["summary"]["activePublisherCount"], 2, "active publisher count")
    assert_equal(normalized["summary"]["activeDayCount"], 3, "active day count")
    assert_equal(normalized["summary"]["observationCount"], 3, "observation count")
    assert_close(normalized["summary"]["totalRevenue"], 100.5, "total revenue")

    media_seven = normalized["publishers"][0]
    media_eight = normalized["publishers"][1]
    assert_equal(media_seven["userId"], 7, "publisher ordering")
    assert_equal(
        [point["date"] for point in media_seven["points"]],
        ["2026-07-01", "2026-07-03"],
        "missing date must remain absent instead of being zero-filled",
    )
    assert_equal(media_eight["points"][0]["revenue"], 0.0, "zero revenue must remain a real point")

    invalid_inputs = [
        ({"merchant_id": "invalid"}, "invalid merchant id"),
        ({"merchant_id": 101, "start_date": "2026-07-01"}, "partial date range"),
        (
            {"merchant_id": 101, "start_date": "2026-07-28", "end_date": "2026-07-01"},
            "reversed date range",
        ),
        (
            {"merchant_id": 101, "start_date": "2024-01-01", "end_date": "2026-01-02"},
            "too-long date range",
        ),
    ]
    for kwargs, label in invalid_inputs:
        try:
            offer_db.brand_media_trend_payload(**kwargs)
        except ValueError:
            pass
        else:
            raise AssertionError(f"{label}: expected ValueError")

    def fake_fetch_all(_conn, sql, params=None):
        assert_equal(params, (101, 20260701, 20260731), "trend SQL params")
        if "GROUP BY o.advert_id, o.user_id, o.order_time_day" not in sql:
            raise AssertionError("trend query must aggregate at merchant + publisher + day grain")
        if "FROM v_maxai_cnpscy_user" not in sql or "FROM cnpscy_user" in sql:
            raise AssertionError("trend query must read publisher names from v_maxai_cnpscy_user")
        if "SUM(COALESCE(o.amount, 0)) AS revenue" not in sql:
            raise AssertionError("trend query must use the order amount as revenue")
        if "o.order_time_day BETWEEN %s AND %s" not in sql:
            raise AssertionError("trend query must apply the requested date range")
        return ROWS

    offer_db._brand_media_trend_cache = {}
    with (
        patch.object(offer_db, "db_connection", fake_connection),
        patch.object(offer_db, "fetch_all", fake_fetch_all),
    ):
        payload = offer_db.brand_media_trend_payload(
            101,
            start_date="2026-07-01",
            end_date="2026-07-31",
        )

    assert_equal(payload["source"], "cnpscy_amazon_order", "trend source")
    assert_equal(payload["grain"], "advert_id + user_id + order_time_day", "trend grain")
    assert_equal(payload["merchant"]["merchantName"], "Alpha", "payload merchant name")
    assert_equal(payload["dateRange"]["dayCount"], 31, "inclusive date range")
    assert_equal(payload["gapRule"], "No order-table row is emitted for a missing publisher/date.", "gap contract")
    assert_equal(
        [point["date"] for point in payload["publishers"][0]["points"]],
        ["2026-07-01", "2026-07-03"],
        "payload should preserve the missing-date gap",
    )

    print("Brand media trend aggregation checks passed")


if __name__ == "__main__":
    main()
