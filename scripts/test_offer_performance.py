"""Promotion reporting regression tests. No database or external API requests."""
import datetime as dt
import json
import sys
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import offer_performance as p
from scripts.test_vercel_db_wsgi import load_app_module, request


class PromotionTests(unittest.TestCase):
    def test_storage_full_schema_lookup_uses_zero_row_metadata(self):
        conn = MagicMock()
        cursor = conn.cursor.return_value.__enter__.return_value
        cursor.description = [("advert_id",), ("order_time_day",), ("amount",)]
        with patch.dict(p.db.TABLE_COLUMNS_CACHE, {}, clear=True), patch.object(p.db, "fetch_all", side_effect=Exception(1030, "Got error 28 from storage engine")) as fetch:
            columns = p.db.table_columns(conn, "cnpscy_amazon_order", strict=True)
            self.assertEqual(columns, {"advert_id", "order_time_day", "amount"})
            cursor.execute.assert_called_once_with("SELECT * FROM `cnpscy_amazon_order` LIMIT 0")
            cursor.fetchall.assert_not_called()
            self.assertEqual(p.db.table_columns(conn, "cnpscy_amazon_order", strict=True), columns)
            fetch.assert_called_once()

    def test_failed_schema_lookup_is_retried_after_recovery(self):
        with patch.dict(p.db.TABLE_COLUMNS_CACHE, {}, clear=True), patch.object(p.db, "fetch_all", side_effect=[Exception(2013, "Lost connection"), [{"Field": "amount"}]]) as fetch:
            self.assertEqual(p.db.table_columns(None, "cnpscy_amazon_order"), set())
            self.assertNotIn("cnpscy_amazon_order", p.db.TABLE_COLUMNS_CACHE)
            self.assertEqual(p.db.table_columns(None, "cnpscy_amazon_order"), {"amount"})
            self.assertEqual(fetch.call_count, 2)
        with patch.dict(p.db.TABLE_COLUMNS_CACHE, {}, clear=True), patch.object(p.db, "fetch_all", side_effect=Exception(2013, "Lost connection")):
            with self.assertRaisesRegex(Exception, "Lost connection"):
                p.db.table_columns(None, "cnpscy_amazon_order", strict=True)
        with patch.dict(p.db.TABLE_COLUMNS_CACHE, {}, clear=True), patch.object(p.db, "fetch_all", side_effect=Exception(1146, "Table missing")):
            self.assertEqual(p.db.table_columns(None, "cnpscy_amazon_click", strict=True), set())

    def test_storage_failure_returns_safe_retryable_status(self):
        module = load_app_module()
        error = Exception(1030, "Got error 28 from storage engine: private-server-path")
        with patch.dict("os.environ", {"OI_AUTH_ENABLED": "0", "VERCEL_ENV": "", "VERCEL": ""}), patch.object(module, "offer_performance_report", side_effect=error), self.assertLogs("vercel_db_wsgi", level="ERROR"):
            response = request(module.app, "ui-offer-performance", "merchantIds=101")
        self.assertEqual(response["status"], 503)
        self.assertEqual(json.loads(response["body"])["errorCode"], "db_storage_full")
        self.assertNotIn(b"private-server-path", response["body"])

    def setUp(self):
        self.window = p.date_window("2026-09-07")
        self.supported = dict.fromkeys(p.METRICS, True)

    def row(self, day, **values):
        return {"merchantId": "101", "day": day, **values}

    def test_default_includes_launch_day_and_seven_days_each(self):
        self.assertEqual(self.window, {"startDate": "2026-09-07", "endDate": "2026-09-13", "beforeStart": "2026-08-31", "beforeEnd": "2026-09-06", "days": 7})

    def test_custom_window_crosses_year_and_leap_day(self):
        self.assertEqual(p.date_window(start_date="2026-01-01", end_date="2026-01-14")["beforeStart"], "2025-12-18")
        self.assertEqual(p.date_window("2024-03-01")["beforeStart"], "2024-02-23")
        self.assertEqual(p.month_keys("2026-01-09"), ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"])

    def test_rejects_bad_and_excessive_dates(self):
        for args in ({"launch_date": "2026-02-30"}, {"launch_date": "9/7"}, {"start_date": "2026-09-07"}, {"start_date": "2026-09-07", "end_date": "2026-09-01"}, {"start_date": "2026-01-01", "end_date": "2026-09-01"}):
            with self.subTest(args=args), self.assertRaises(ValueError):
                p.date_window(**args)

    def test_launch_anchored_custom_comparison_excludes_gaps(self):
        window = p.date_window("2026-09-11", "2026-09-13", "2026-09-19")
        self.assertEqual(window["beforeEnd"], "2026-09-10")
        self.assertEqual(window["beforeStart"], "2026-09-04")
        window = p.date_window("2026-09-11", "2026-09-13", "2026-09-19", "2026-08-25", "2026-09-07")
        rows = [self.row(day, revenue=value, publisherId="7") for day, value in [("20260825", 100), ("20260907", 40), ("20260908", 999), ("20260912", 999), ("20260913", 20), ("20260919", 30)]]
        result = p.summarize(rows, ["101"], window, self.supported, watermark="2026-09-19")[0]
        self.assertEqual(result["before"]["revenue"], 140)
        self.assertEqual(result["after"]["revenue"], 50)
        self.assertEqual(len(result["daily"]), 4)
        media, _ = p.summarize_details(rows, window, self.supported, "2026-09-19")
        self.assertEqual(media[0]["before"]["revenue"], 140)
        with patch.object(p.db, "fetch_all", return_value=[]) as fetch:
            p._read(None, "cnpscy_amazon_order", {"advert_id", "order_time_day", "amount"}, ["101"], window["beforeStart"], window["endDate"], p.ORDER_FIELDS, period_window=window, known_watermark="2026-09-19")
        sql = fetch.call_args.args[1]
        self.assertIn("<= 20260907 OR", sql)
        self.assertIn(">= 20260913", sql)

    def test_invalid_comparison_never_queries_database(self):
        for before_start, before_end in [("2026-09-01", "2026-09-11"), ("2026-09-05", "2026-09-04"), ("2026-09-01", ""), ("2025-01-01", "2026-09-10")]:
            with self.subTest(before_start=before_start, before_end=before_end), patch.object(p.db, "db_connection") as conn:
                with self.assertRaises(ValueError):
                    p.report({"merchantIds": ["101"], "launchDate": ["2026-09-11"], "beforeStart": [before_start], "beforeEnd": [before_end]})
                conn.assert_not_called()
        with self.assertRaises(ValueError):
            p.date_window("2026-09-11", "2026-09-10", "2026-09-17")

    def test_exact_ids_boundaries_and_pending_dates(self):
        rows = [self.row("20260830", revenue=999), self.row("20260831", revenue=10), self.row("20260906", revenue=20), self.row("20260907", revenue=40), self.row("20260908", revenue=50), self.row("20260909", revenue=999), self.row("20260914", revenue=999), {"merchantId": "1101", "day": "20260907", "revenue": 999}]
        result = p.summarize(rows, ["101"], self.window, self.supported, watermark="2026-09-08")[0]
        self.assertEqual(result["before"]["revenue"], 30)
        self.assertEqual(result["after"]["revenue"], 90)
        self.assertEqual(len(result["daily"]), 4)
        pending = p.summarize(rows, ["101"], self.window, self.supported, watermark="2026-09-06")[0]
        self.assertTrue(all(v is None for v in pending["after"].values()))

    def test_unsupported_and_incomplete_months_are_null(self):
        supported = {**self.supported, "atc": False}
        report = p.summarize([], ["101"], self.window, supported, [self.row("202608", revenue=700)], "2026-08-15")[0]
        self.assertIsNone(report["monthly"][-1]["revenue"])
        self.assertIsNone(report["monthly"][0]["atc"])
        self.assertIsNone(report["before"]["revenue"])

    def test_targets_require_record_evidence(self):
        for row, expected in [({"purchasedAsin": "B012345678"}, ("unknown", "")), ({"target_url": "https://amazon.com/dp/B012345678?tag=x"}, ("asin", "B012345678")), ({"target_url": "https://amazon.com/stores/Example"}, ("storefront", "")), ({"link_type": "storefront"}, ("storefront", "")), ({"target_asin": "b012345678"}, ("asin", "B012345678")), ({"target_url": "https://amazon.com"}, ("unknown", ""))]:
            self.assertEqual(p.target_identity(row), expected)

    def test_product_link_type_is_distinct_from_purchased_asin(self):
        self.assertEqual(
            p.target_identity({"link_type": "product", "purchasedAsin": "B012345678"}),
            ("product", ""),
        )

    def test_detail_never_allocates_unattributed_clicks_to_asins(self):
        rows = [self.row("20260907", publisherId="7", revenue=100, orders=3, purchasedAsin="B012345678"), self.row("20260907", publisherId="7", clicks=80, target_asin="B098765432"), self.row("20260907", publisherId="8", clicks=20, link_type="storefront"), self.row("20260801", publisherId="7", revenue=999)]
        media, links = p.summarize_details(rows, self.window, self.supported, "2026-09-08")
        self.assertEqual(media[0]["after"]["revenue"], 100)
        self.assertEqual(media[0]["after"]["clicks"], 80)
        self.assertEqual(len(links), 3)
        purchased = next(x for x in links if x["purchasedAsin"])
        self.assertEqual(purchased["linkType"], "unknown")
        self.assertIsNone(purchased["after"]["clicks"])
        promoted = next(x for x in links if x["asin"])
        self.assertIsNone(promoted["after"]["revenue"])
        self.assertNotEqual(promoted["asin"], purchased["purchasedAsin"])

    def test_queries_are_scoped_and_use_purchase_sums(self):
        cols = {"advert_id", "order_time_day", "amount", "total_purchases", "user_id", "asin"}
        with patch.object(p.db, "fetch_all", side_effect=[[], [{"latest": 20260908}]]) as fetch:
            _, supported, latest = p._read(None, "cnpscy_amazon_order", cols, ["101", "202"], "2026-08-31", "2026-09-13", p.ORDER_FIELDS, True)
        sql, args = fetch.call_args_list[0].args[1:]
        self.assertIn("IN (%s,%s)", sql)
        self.assertEqual(args, ("101", "202", 20260831, 20260913))
        self.assertIn("SUM(COALESCE(r.`total_purchases`, 0))", sql)
        self.assertIn("NULL AS `atc`", sql)
        self.assertFalse(supported["atc"])
        self.assertEqual(latest, "2026-09-08")

    def test_same_publisher_and_product_never_merge_across_merchants(self):
        rows = [self.row("20260907", publisherId="7", target_asin="B012345678", revenue=100), {**self.row("20260907", publisherId="7", target_asin="B012345678", revenue=300), "merchantId": "202"}]
        media, links = p.summarize_details(rows, self.window, self.supported, "2026-09-08")
        self.assertEqual(len(media), 2)
        self.assertEqual(len(links), 2)
        self.assertEqual({r["merchantId"]: r["after"]["revenue"] for r in media}, {"101": 100, "202": 300})

    def test_relationship_sql_aggregates_two_periods_and_clips_unavailable_days(self):
        with patch.object(p.db, "fetch_all", return_value=[]) as fetch:
            p._read(None, "cnpscy_amazon_order", {"advert_id", "order_time_day", "amount", "user_id", "asin"}, ["101", "202"], "2026-08-31", "2026-09-13", p.ORDER_FIELDS, detail=True, period_window=self.window, known_watermark="2026-09-08")
        self.assertEqual(fetch.call_count, 1)
        sql, args = fetch.call_args.args[1:]
        self.assertIn("CASE WHEN", sql)
        self.assertIn("THEN 20260831 ELSE 20260907 END", sql)
        self.assertEqual(args, ("101", "202", 20260831, 20260908))

    def test_cohort_relationships_return_exact_edges_without_per_merchant_requests(self):
        rows = [self.row("20260907", publisherId="7", purchasedAsin="B012345678", revenue=100), {**self.row("20260907", publisherId="7", revenue=300), "merchantId": "202"}]
        with patch.object(p.db, "db_connection", return_value=nullcontext(None)), patch.object(p.db, "table_columns", return_value=set()), patch.object(p, "_latest_date", return_value="2026-09-08"), patch.object(p, "_read", return_value=(rows, self.supported, "2026-09-08")) as reader, patch.object(p.db, "fetch_all", return_value=[{"id": "7", "name": "Media Seven"}]), patch.object(p.db, "reporting_today", return_value=dt.date(2026, 9, 10)):
            result = p.report({"action": ["relations"], "merchantIds": ["101,202"], "launchDate": ["2026-09-07"]})
        self.assertEqual(reader.call_count, 1)
        self.assertEqual(reader.call_args.args[3], ["101", "202"])
        self.assertEqual(reader.call_args.kwargs["period_window"], self.window)
        self.assertEqual([r["publisherName"] for r in result["media"]], ["Media Seven", "Media Seven"])
        self.assertEqual({r["merchantId"] for r in result["links"]}, {"101", "202"})
        self.assertEqual(result["aggregation"], "period")
        self.assertTrue(all(not r["daily"] and not r["monthly"] for r in result["merchants"]))

    def test_one_click_source_reporting_lag_and_history(self):
        def read(conn, table, columns, ids, start, end, fields, detail=False, monthly=False, report_window=None):
            self.assertEqual(ids, ["101"])
            supported = {k: k in fields for k in p.METRICS}
            if table.endswith("_order"):
                self.assertNotIn("clicks", fields)
                return [self.row("202603" if monthly else "20260907", revenue=100)], supported, "2026-09-09"
            return [self.row("202603" if monthly else "20260907", clicks=80)], supported, "2026-09-09"
        with patch.object(p.db, "db_connection", return_value=nullcontext(None)), patch.object(p.db, "table_columns", return_value={"advert_id", "time_day", "click"}), patch.object(p.db, "reporting_today", return_value=dt.date(2026, 9, 10)), patch.object(p, "_read", side_effect=read) as reader:
            result = p.report({"merchantIds": ["101"], "launchDate": ["2026-09-07"]})
        self.assertEqual(result["clickSource"], "cnpscy_amazon_click")
        self.assertEqual(result["availableThrough"], "2026-09-08")
        self.assertEqual(result["merchants"][0]["after"]["clicks"], 80)
        self.assertEqual(result["merchants"][0]["monthly"][0]["clicks"], 80)
        self.assertEqual(reader.call_count, 4)

    def test_observation_only_scopes_all_views_and_ignores_legacy_comparison(self):
        rows = [self.row(day, revenue=value, publisherId="7", target_asin="B012345678") for day, value in [("20260910", 999), ("20260911", 20), ("20260912", 30), ("20260913", 40), ("20260914", 999)]]
        for extra in ({}, {"merchantId": ["101"]}, {"action": ["relations"]}):
            with self.subTest(extra=extra), patch.object(p.db, "db_connection", return_value=nullcontext(None)), patch.object(p.db, "table_columns", return_value=set()), patch.object(p, "_latest_date", return_value="2026-09-30"), patch.object(p, "_read", return_value=(rows, self.supported, "2026-09-30")) as reader, patch.object(p.db, "fetch_all", return_value=[]), patch.object(p.db, "reporting_today", return_value=dt.date(2026, 10, 1)):
                result = p.report({"merchantIds": ["101"], "launchDate": ["2026-09-11"], "startDate": ["2026-09-11"], "endDate": ["2026-09-13"], "periodMode": ["observation"], "beforeStart": ["invalid legacy date"], **extra})
            self.assertEqual(reader.call_args_list[0].args[4:6], ("2026-09-11", "2026-09-13"))
            self.assertEqual(result["merchants"][0]["after"]["revenue"], 90)
            self.assertTrue(all(v is None for v in result["merchants"][0]["before"].values()))
            self.assertTrue(all("2026-09-11" <= day["date"] <= "2026-09-13" for day in result["merchants"][0]["daily"]))
            for row in result.get("media", []) + result.get("links", []):
                self.assertEqual(row["after"]["revenue"], 90)
                self.assertTrue(all(v is None for v in row["before"].values()))
            with patch.object(p.db, "fetch_all", return_value=[]) as fetch:
                p._read(None, "cnpscy_amazon_order", {"advert_id", "order_time_day", "amount"}, ["101"], "2026-09-11", "2026-09-13", p.ORDER_FIELDS, period_window=result["dateRange"], known_watermark="2026-09-12")
            self.assertEqual(fetch.call_args.args[2], ("101", 20260911, 20260912))

    def test_empty_source_does_not_claim_zero_performance(self):
        with patch.object(p.db, "db_connection", return_value=nullcontext(None)), patch.object(p.db, "table_columns", return_value=set()), patch.object(p, "_read", return_value=([], self.supported, None)):
            with self.assertRaisesRegex(RuntimeError, "no dated records"):
                p.report({"merchantIds": ["101"], "launchDate": ["2026-09-07"]})

    def test_invalid_ids_and_outside_batch_rejected_before_db(self):
        for query in ({"merchantIds": ["101 OR 1=1"]}, {"merchantIds": ["101"], "merchantId": ["102"]}, {"merchantIds": [",".join(map(str, range(1, 202)))]}):
            with self.assertRaises(ValueError):
                p.report(query)

    def test_workbook_catalog_exact_membership_and_no_activity(self):
        batch = p.catalog()["batches"][0]
        self.assertEqual(len(batch["offers"]), 63)
        self.assertEqual(len({x["merchantId"] for x in batch["offers"]}), 63)
        self.assertEqual(sum(len(x["asins"]) for x in batch["offers"]), 294)
        self.assertEqual(batch["launchDate"], "2026-09-07")
        self.assertEqual(len(batch["sourceSha256"]), 64)
        self.assertFalse(any("revenue" in x for x in batch["offers"]))

    def test_vercel_catalog_auth_and_error_status(self):
        module = load_app_module()
        with patch.dict("os.environ", {"OI_AUTH_ENABLED": "0", "VERCEL_ENV": "", "VERCEL": ""}):
            self.assertEqual(request(module.app, "ui-offer-performance", "action=catalog")["status"], 200)
            self.assertEqual(request(module.app, "ui-offer-performance", "merchantIds=bad")["status"], 400)
            self.assertEqual(request(module.app, "ui-offer-performance", "action=catalog", method="POST")["status"], 405)
        with patch.dict("os.environ", {"OI_AUTH_ENABLED": "1"}), patch("auth.auth_config_status", return_value={"enabled": True, "configured": True, "missing": []}):
            self.assertEqual(request(module.app, "ui-offer-performance", "action=catalog", token="")["status"], 401)


if __name__ == "__main__":
    unittest.main()
