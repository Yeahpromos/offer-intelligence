"""Promotion reporting regression tests. No database or external API requests."""
import datetime as dt
import sys
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import offer_performance as p
from scripts.test_vercel_db_wsgi import load_app_module, request


class PromotionTests(unittest.TestCase):
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
        def read(conn, table, columns, ids, start, end, fields, detail=False, monthly=False):
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
