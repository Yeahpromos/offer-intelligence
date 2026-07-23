import datetime as dt
import sys
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import offer_db


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_raises(message, callback, label):
    try:
        callback()
    except ValueError as error:
        if message not in str(error):
            raise AssertionError(f"{label}: expected {message!r} in {str(error)!r}") from error
    else:
        raise AssertionError(f"{label}: expected ValueError")


def test_date_ranges():
    assert_equal(
        offer_db.resolve_tier_report_date_range("2026-07-21", "2026-07-22"),
        (dt.date(2026, 7, 21), dt.date(2026, 7, 22)),
        "two-day range",
    )
    assert_equal(
        offer_db.resolve_tier_report_date_range("2026/06/01", "2026/07/15"),
        (dt.date(2026, 6, 1), dt.date(2026, 7, 15)),
        "slash range",
    )
    assert_equal(
        offer_db.resolve_tier_report_date_range("2026-07-21", None),
        (dt.date(2026, 7, 21), dt.date(2026, 7, 21)),
        "single start date",
    )
    assert_equal(
        offer_db.resolve_tier_report_date_range(None, "2026-07-22"),
        (dt.date(2026, 7, 22), dt.date(2026, 7, 22)),
        "single end date",
    )
    assert_equal(
        offer_db.resolve_tier_report_date_range(month="2026-06"),
        (dt.date(2026, 6, 1), dt.date(2026, 6, 30)),
        "legacy month range",
    )
    assert_equal(
        offer_db.resolve_tier_report_date_range(reference_date=dt.date(2026, 7, 22)),
        (dt.date(2026, 7, 1), dt.date(2026, 7, 22)),
        "default current month-to-date",
    )
    assert_raises(
        "cannot be after",
        lambda: offer_db.resolve_tier_report_date_range("2026-07-22", "2026-07-21"),
        "reversed range",
    )
    assert_raises(
        "cannot exceed",
        lambda: offer_db.resolve_tier_report_date_range("2025-01-01", "2026-07-22"),
        "oversized range",
    )


def test_report_payload():
    base_rows = [
        {"Merchant ID": "101", "Merchant Name": "Order Click Merchant", "Brand": "Order Click Merchant", "Network": "Archer"},
        {"Merchant ID": "202", "Merchant Name": "Tracked Click Merchant", "Brand": "Tracked Click Merchant", "Network": "Levanta"},
    ]
    order_rows = [
        {"merchantId": "101", "orders": 2, "revenue": 80, "payout": 8, "affiliatePayout": 6, "dpv": 20, "atc": 5, "orderClicks": 10},
        {"merchantId": "202", "orders": 5, "revenue": 125, "payout": 12.5, "affiliatePayout": 10, "dpv": 40, "atc": 9, "orderClicks": 0},
    ]
    click_rows = [
        {"merchantId": "101", "trackedClicks": 100},
        {"merchantId": "202", "trackedClicks": 50},
    ]
    calls = []

    @contextmanager
    def fake_connection():
        yield object()

    def fake_fetch_all(_conn, sql, params=None):
        calls.append((sql, params))
        if "FROM cnpscy_amazon_order" in sql:
            return order_rows
        if "FROM cnpscy_amazon_click" in sql:
            return click_rows
        if "FROM cnpscy_oi_tier_assignments t" in sql:
            return base_rows
        raise AssertionError(f"Unexpected SQL: {sql}")

    original_connection = offer_db.db_connection
    original_fetch_all = offer_db.fetch_all
    offer_db.db_connection = fake_connection
    offer_db.fetch_all = fake_fetch_all
    offer_db._tier_sheet_cache.clear()
    try:
        payload = offer_db.tier_sheet_payload(
            "Tier 2",
            start_date="2026-06-01",
            end_date="2026-07-15",
            compact=True,
        )
    finally:
        offer_db.db_connection = original_connection
        offer_db.fetch_all = original_fetch_all
        offer_db._tier_sheet_cache.clear()

    assert_equal(payload["startDate"], "2026-06-01", "payload start date")
    assert_equal(payload["endDate"], "2026-07-15", "payload end date")
    assert_equal(payload["source"]["dimension"], "advert_id", "report dimension")
    assert_equal(payload["compact"], True, "compact payload flag")
    assert "May Revenue" not in payload["headers"], payload["headers"]
    assert "June Revenue" not in payload["headers"], payload["headers"]
    assert_equal(payload["rows"][0]["Clicks"], "10.0", "order click source")
    assert_equal(payload["rows"][0]["Revenue"], "80.0", "order revenue")
    assert_equal(payload["rows"][0]["Backend EPC"], "8.0", "order EPC")
    assert_equal(payload["rows"][1]["Clicks"], "50.0", "tracked click fallback")
    assert_equal(payload["rows"][1]["Conversion Rate"], "0.1", "tracked conversion")

    amazon_calls = [(sql, params) for sql, params in calls if "cnpscy_amazon_" in sql]
    assert_equal(len(amazon_calls), 2, "Amazon metric query count")
    for _sql, params in amazon_calls:
        assert_equal(params, ("Tier 2", 20260601, 20260715), "inclusive date parameters")


def test_frontend_contract():
    app = (ROOT / "public" / "app.js").read_text(encoding="utf-8")
    html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
    backend = (ROOT / "offer_db.py").read_text(encoding="utf-8")
    assert 'id="tierStartDate"' in html
    assert 'id="tierEndDate"' in html
    assert 'id="tierDateApply"' in html
    assert html.index('id="tierDateStatus"') < html.index('class="tier-date-range-controls"')
    assert "start_date" in app and "end_date" in app
    for removed in ("May Revenue", "June Revenue"):
        assert removed not in app, f"{removed} still present in app.js"
        assert removed not in backend, f"{removed} still present in offer_db.py"


def main():
    test_date_ranges()
    test_report_payload()
    test_frontend_contract()
    print("Tier report date-range checks passed")


if __name__ == "__main__":
    main()
