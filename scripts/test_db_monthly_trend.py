from __future__ import annotations

import datetime as dt
import unittest
from unittest.mock import patch

import offer_db


class RecentMonthSummaryTests(unittest.TestCase):
    def test_report_status_skips_expensive_coverage_queries_by_default(self) -> None:
        with (
            patch.object(offer_db, "db_connection") as mocked_connection,
            patch.object(offer_db, "read_static_merchant_ids", return_value=["1", "2"]),
            patch.object(offer_db, "latest_dates", return_value={}),
            patch.object(offer_db, "daily_status_trend", return_value={}),
            patch.object(offer_db, "recent_month_summary", return_value={}),
            patch.object(offer_db, "count_distinct_for_ids") as coverage_query,
            patch.object(offer_db, "static_chatbot_generated_at", return_value=None),
        ):
            mocked_connection.return_value.__enter__.return_value = object()
            result = offer_db.status_payload("2026-06")

        self.assertEqual(result["coverage"], {"staticNumericMerchantIds": 2})
        coverage_query.assert_not_called()

    def test_new_calendar_month_queries_live_rows_through_today(self) -> None:
        columns = {
            "cnpscy_amazon_click": {"time_day", "advert_id", "click"},
            "cnpscy_order_new_aggregate": {"order_time_day", "advert_id", "amount", "order_num"},
        }
        calls: list[tuple[str, tuple[str, str]]] = []

        def fake_fetch_all(_conn, sql, params=()):
            calls.append((sql, params))
            return []

        with (
            patch.object(offer_db, "reporting_today", return_value=dt.date(2026, 8, 13)),
            patch.object(offer_db, "table_columns", side_effect=lambda _conn, table: columns[table]),
            patch.object(offer_db, "fetch_all", side_effect=fake_fetch_all),
        ):
            result = offer_db.recent_month_summary(
                object(),
                end_month="2026-08",
                include_amazon_orders=False,
            )

        self.assertEqual(result["window"]["startMonth"], "2026-03")
        self.assertEqual(result["window"]["endMonth"], "2026-08")
        self.assertEqual(result["window"]["throughDate"], "2026-08-13")
        self.assertTrue(all(params == ("20260301", "20260813") for _, params in calls))

    def test_selected_month_defines_a_bounded_six_month_window(self) -> None:
        columns = {
            "cnpscy_amazon_order": {"order_time_day", "advert_id", "amount", "payout"},
            "cnpscy_amazon_click": {"time_day", "advert_id", "click"},
            "cnpscy_order_new_aggregate": {"order_time_day", "advert_id", "amount", "order_num"},
        }
        calls: list[tuple[str, tuple[str, str]]] = []

        def fake_fetch_all(_conn, sql, params=()):
            calls.append((sql, params))
            if "cnpscy_order_new_aggregate" in sql:
                return [{"month": "202606", "aggregateRows": 29442, "activeBrands": 1362, "revenue": 10877607.62, "orders": 58328}]
            if "cnpscy_amazon_click" in sql:
                return [{"month": "202606", "clickRows": 99610, "clicks": 1101264}]
            return [{"month": "202606", "orderRows": 100, "revenue": 1000, "payout": 100}]

        with (
            patch.object(offer_db, "reporting_today", return_value=dt.date(2026, 7, 13)),
            patch.object(offer_db, "table_columns", side_effect=lambda _conn, table: columns[table]),
            patch.object(offer_db, "fetch_all", side_effect=fake_fetch_all),
        ):
            result = offer_db.recent_month_summary(object(), end_month="2026-06")

        self.assertEqual(result["window"]["startMonth"], "2026-01")
        self.assertEqual(result["window"]["endMonth"], "2026-06")
        self.assertEqual(result["window"]["throughDate"], "2026-06-30")
        self.assertEqual(result["aggregateOrders"][0]["month"], "2026-06")
        self.assertEqual(result["aggregateOrders"][0]["orders"], 58328)
        self.assertEqual(result["amazonClicks"][0]["clicks"], 1101264)
        self.assertTrue(all(params == ("20260101", "20260630") for _, params in calls))
        aggregate_sql = next(sql for sql, _ in calls if "cnpscy_order_new_aggregate" in sql)
        self.assertIn("COUNT(DISTINCT `a`.`advert_id`) AS `activeBrands`", aggregate_sql)

    def test_daily_complete_date_uses_the_slowest_required_source(self) -> None:
        columns = {
            "cnpscy_order_new_aggregate": {"order_time_day", "advert_id", "amount", "order_num"},
            "cnpscy_amazon_order": {"order_time_day", "advert_id", "amount"},
            "cnpscy_amazon_click": {"time_day", "advert_id", "click"},
        }

        def fake_fetch_all(_conn, sql, _params=()):
            if "cnpscy_order_new_aggregate" in sql:
                return [
                    {"day": "20260710", "aggregateRows": 10, "activeBrands": 8, "orders": 100, "revenue": 1000},
                    {"day": "20260711", "aggregateRows": 8, "activeBrands": 7, "orders": 80, "revenue": 800},
                    {"day": "20260712", "aggregateRows": 2, "activeBrands": 2, "orders": 10, "revenue": 100},
                ]
            if "cnpscy_amazon_click" in sql:
                return [{"day": "20260710", "clickRows": 100, "clicks": 1000}]
            return []

        latest = {
            "aggregateOrders": {"latest": "2026-07-12"},
            "amazonClicks": {"latest": "2026-07-10"},
            "amazonOrders": {"latest": "2026-07-10"},
        }
        with (
            patch.object(offer_db, "reporting_today", return_value=dt.date(2026, 7, 13)),
            patch.object(offer_db, "table_columns", side_effect=lambda _conn, table: columns[table]),
            patch.object(offer_db, "fetch_all", side_effect=fake_fetch_all),
        ):
            result = offer_db.daily_status_trend(object(), latest=latest, month="2026-07")

        self.assertEqual(result["observedThrough"], "2026-07-10")
        self.assertEqual(result["aggregation"], "calendar_day")
        self.assertFalse(result["cumulative"])
        rows_by_date = {row["date"]: row for row in result["rows"]}
        self.assertEqual(rows_by_date["2026-07-10"]["state"], "observed")
        self.assertEqual(rows_by_date["2026-07-11"]["state"], "stale")
        self.assertEqual(rows_by_date["2026-07-11"]["orders"], 80)
        self.assertEqual(rows_by_date["2026-07-12"]["state"], "delay")


class TierSummaryPayloadTests(unittest.TestCase):
    def test_tier_summary_uses_report_overview_sources_and_database_moves(self) -> None:
        columns = {
            "cnpscy_order_new_aggregate": {"order_time_day", "advert_id", "amount", "payout", "order_num"},
            "cnpscy_amazon_click": {"time_day", "advert_id", "click"},
            "cnpscy_oi_tier_assignments": {"merchantId", "tier", "movedFromTier", "movedAt"},
        }
        calls: list[tuple[str, tuple[str, ...]]] = []

        def fake_fetch_all(_conn, sql, params=()):
            calls.append((sql, params))
            if "AS tierExits" in sql:
                return [{"tier": "Tier 3", "tierExits": 12}]
            if "AS newEntries" in sql:
                return [{"tier": "Tier 2", "newEntries": 7}]
            return [
                {
                    "tier": "Tier 1",
                    "assignedBrandCount": 42,
                    "brandCount": 31,
                    "orders": 1200,
                    "revenue": 250000,
                    "clicks": 20000,
                    "payout": 25000,
                },
                {
                    "tier": "Tier 3",
                    "assignedBrandCount": 370,
                    "brandCount": 160,
                    "orders": 800,
                    "revenue": 150000,
                    "clicks": 10000,
                    "payout": 12000,
                },
            ]

        offer_db._status_cache.clear()
        with (
            patch.object(offer_db, "db_connection") as mocked_connection,
            patch.object(offer_db, "table_columns", side_effect=lambda _conn, table: columns.get(table, set())),
            patch.object(offer_db, "fetch_all", side_effect=fake_fetch_all),
        ):
            mocked_connection.return_value.__enter__.return_value = object()
            result = offer_db.tier_summary_payload("2026-06")
        offer_db._status_cache.clear()

        self.assertTrue(result["ok"])
        self.assertEqual(result["source"]["ordersRevenuePayout"], "cnpscy_order_new_aggregate")
        self.assertEqual(result["source"]["clicks"], "cnpscy_amazon_click")
        self.assertEqual(result["tiers"][0]["brandCount"], 31)
        self.assertEqual(result["tiers"][0]["assignedBrandCount"], 42)
        self.assertEqual(result["tiers"][1]["tierExits"], 12)
        self.assertEqual(result["total"]["revenue"], 400000)
        self.assertEqual(result["total"]["clicks"], 30000)
        self.assertEqual(result["total"]["brandCount"], 191)

        summary_sql, summary_params = calls[0]
        self.assertIn("FROM `cnpscy_order_new_aggregate` a", summary_sql)
        self.assertIn("FROM `cnpscy_amazon_click` c", summary_sql)
        self.assertIn("COUNT(DISTINCT a.merchantId) AS brandCount", summary_sql)
        self.assertEqual(summary_params, ("20260601", "20260630", "20260601", "20260630"))


if __name__ == "__main__":
    unittest.main()
