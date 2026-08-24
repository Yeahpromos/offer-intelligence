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
        "admin_name": "timmy",
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
        "admin_name": "timmy",
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
        "admin_name": "stella",
        "order_day": 20260702,
        "revenue": 0,
        "orders": 0,
        "all_commission": 0,
        "aff_commission": 0,
    },
    {
        "merchant_id": 101,
        "merchant_name": "Alpha",
        "user_id": 7,
        "user_name": "Media Seven",
        "admin_name": "timmy",
        "order_day": 20260701,
        "clicks": 120,
        "metric_source": "clicks",
    },
    {
        "merchant_id": 101,
        "merchant_name": "Alpha",
        "user_id": 7,
        "user_name": "Media Seven",
        "admin_name": "timmy",
        "order_day": 20260702,
        "clicks": 80,
        "metric_source": "clicks",
    },
]


SANKEY_ROWS = [
    {
        "merchant_id": 101,
        "merchant_name": "Alpha",
        "user_id": 7,
        "user_name": "Media Seven",
        "admin_name": "timmy",
        "product_key": "ASIN-A",
        "revenue": 80,
    },
    {
        "merchant_id": 101,
        "merchant_name": "Alpha",
        "user_id": 7,
        "user_name": "Media Seven",
        "admin_name": "timmy",
        "product_key": "ASIN-A",
        "revenue": 20,
    },
    {
        "merchant_id": 101,
        "merchant_name": "Alpha",
        "user_id": 8,
        "user_name": "Media Eight",
        "admin_name": "stella",
        "product_key": "ASIN-A",
        "revenue": 40,
    },
    {
        "merchant_id": 101,
        "merchant_name": "Alpha",
        "user_id": 7,
        "user_name": "Media Seven",
        "admin_name": "timmy",
        "product_key": "ASIN-B",
        "revenue": 5,
    },
    {
        "merchant_id": 101,
        "merchant_name": "Alpha",
        "user_id": 8,
        "user_name": "Media Eight",
        "admin_name": "stella",
        "product_key": "ASIN-B",
        "revenue": 10,
    },
    {
        "merchant_id": 101,
        "merchant_name": "Alpha",
        "user_id": 8,
        "user_name": "Media Eight",
        "admin_name": "stella",
        "product_key": "ASIN-ZERO",
        "revenue": 0,
    },
]

PRODUCT_ROWS = [
    {"asin": "ASIN-A", "productName": "Widget A"},
    {"asin": "ASIN-B", "productName": "Widget B"},
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
    assert_equal(normalized["summary"]["totalClicks"], 200, "total clicks")


    sankey = offer_db.brand_media_sankey_from_rows(
        SANKEY_ROWS,
        product_rows=PRODUCT_ROWS,
        merchant_id=101,
        merchant_name="Alpha",
    )
    assert_equal(sankey["available"], True, "Sankey should be available")
    assert_equal(sankey["brand"]["label"], "Alpha", "Sankey brand label")
    assert_equal(sankey["summary"]["productCount"], 2, "Sankey product count")
    assert_equal(sankey["summary"]["mediaCount"], 2, "Sankey media count")
    assert_equal(sankey["summary"]["linkCount"], 6, "Sankey link count")
    assert_close(sankey["summary"]["totalRevenue"], 155, "Sankey total revenue")
    product_labels = {
        node["label"] for node in sankey["nodes"] if node["type"] == "product"
    }
    assert_equal(product_labels, {"Widget A", "Widget B"}, "Sankey product metadata")
    product_media_revenue = sum(
        link["value"]
        for link in sankey["links"]
        if str(link["source"]).startswith("product:")
    )
    assert_close(product_media_revenue, 155, "Sankey product-media reconciliation")

    media_seven = normalized["publishers"][0]
    media_eight = normalized["publishers"][1]
    assert_equal(media_seven["userId"], 7, "publisher ordering")
    assert_equal(media_seven["adminName"], "timmy", "publisher manager association")
    assert_equal(media_eight["adminName"], "stella", "second publisher manager association")
    assert_equal(media_seven["totalClicks"], 200, "publisher click total")
    assert_equal(
        [point["date"] for point in media_seven["clickPoints"]],
        ["2026-07-01", "2026-07-02"],
        "click-only dates should be preserved for the click chart",
    )
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
        assert_equal(params, (101, 20260701, 20260731, 101, 20260701, 20260731), "trend SQL params")
        if "GROUP BY o.advert_id, o.user_id, o.order_time_day" not in sql:
            raise AssertionError("trend query must aggregate at merchant + publisher + day grain")
        if "GROUP BY c.advert_id, c.user_id, c.time_day" not in sql:
            raise AssertionError("trend query must aggregate clicks at merchant + publisher + day grain")
        if "FROM v_maxai_cnpscy_user" not in sql or "FROM cnpscy_user" in sql:
            raise AssertionError("trend query must read publisher names from v_maxai_cnpscy_user")
        if "cnpscy_admins" not in sql or "admin_id_look" not in sql or "admin_name" not in sql:
            raise AssertionError("trend query must associate publisher managers through cnpscy_admins")
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



    def fake_sankey_table_columns(_conn, table):
        if table == "cnpscy_amazon_order":
            return {"advert_id", "user_id", "order_time_day", "amount", "asin"}
        return set()

    sankey_params = []

    def fake_sankey_fetch_all(_conn, sql, params=None):
        sankey_params.append(params)
        if params is None or params[0] != 101 or params[1] > params[2]:
            raise AssertionError(f"invalid Sankey SQL params: {params!r}")
        if "product_key" not in sql or "GROUP BY" not in sql or "HAVING SUM" not in sql:
            raise AssertionError("Sankey query must aggregate by product and media")
        if "asin" not in sql:
            raise AssertionError("Sankey query must use the discovered product identifier")
        if "CAST(REPLACE(REPLACE(LEFT(CAST(" not in sql or "AS UNSIGNED) BETWEEN %s AND %s" not in sql:
            raise AssertionError("Sankey query must normalize DATE/DATETIME and YYYYMMDD date values")
        return SANKEY_ROWS

    with (
        patch.object(offer_db, "db_connection", fake_connection),
        patch.object(offer_db, "table_columns", fake_sankey_table_columns),
        patch.object(offer_db, "fetch_all", fake_sankey_fetch_all),
        patch.object(offer_db, "merchant_products", lambda *_args, **_kwargs: PRODUCT_ROWS),
    ):
        offer_db._brand_media_sankey_cache = {}
        sankey_payload = offer_db.brand_media_sankey_payload(
            101,
            start_date="2026-07-01",
            end_date="2026-07-31",
        )
        single_day_sankey_payload = offer_db.brand_media_sankey_payload(
            101,
            start_date="2026-07-01",
            end_date="2026-07-01",
        )

    assert_equal(
        sankey_params,
        [(101, 20260701, 20260731), (101, 20260701, 20260701)],
        "Sankey inclusive SQL ranges",
    )
    assert_equal(single_day_sankey_payload["dateRange"]["dayCount"], 1, "single-day Sankey range")
    assert_equal(sankey_payload["source"], "cnpscy_amazon_order + cnpscy_amazon_product", "Sankey source")
    assert_equal(sankey_payload["grain"], "advert_id + product + user_id", "Sankey grain")
    assert_equal(sankey_payload["merchant"]["merchantName"], "Alpha", "Sankey payload merchant")
    assert_equal(sankey_payload["dateRange"]["dayCount"], 31, "Sankey inclusive date range")
    assert_equal(sankey_payload["sankey"]["summary"]["productCount"], 2, "Sankey payload products")

    assert_equal(payload["source"], "cnpscy_amazon_order + cnpscy_amazon_click", "trend source")
    assert_equal(payload["grain"], "advert_id + user_id + day + metric", "trend grain")
    assert_equal(payload["clickSource"], "cnpscy_amazon_click", "click source")
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
