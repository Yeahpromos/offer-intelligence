"""Revenue ordering, merchant/date isolation, code fallback and cache migration."""
import datetime as dt
import sqlite3
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import offer_db


class OfferAsinRankingTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript("""
            CREATE TABLE cnpscy_oi_offer_products (merchantId TEXT, asin TEXT);
            CREATE TABLE cnpscy_amazon_order
                (advert_id INTEGER, asin TEXT, order_time_day INTEGER, amount REAL);
        """)
        self.conn.executemany("INSERT INTO cnpscy_oi_offer_products VALUES (?, ?)", [
            ("1", f"B00000000{i}") for i in range(1, 8)
        ] + [("1", " b000000001 "), ("1", "invalid"), ("2", "B000000001")])
        self.offers = [
            {"merchantId": "1", "productAsins": "B000000000|B000000005"},
            {"merchantId": "2", "productAsins": []},
            {"merchantId": "3", "productAsins": ["B000000003", "b000000001"]},
            {"merchantId": "4"},
        ]
        self.columns = {"advert_id", "asin", "order_time_day", "amount"}

    def rank(self, start="2026-09-01", end="2026-09-07"):
        def fetch(conn, sql, params=()):
            return [dict(row) for row in conn.execute(sql.replace("%s", "?"), params)]

        with patch.object(offer_db, "fetch_all", side_effect=fetch), patch.object(
            offer_db, "table_columns", return_value=self.columns
        ):
            return offer_db.offer_asin_rankings(
                self.conn, self.offers, dt.date.fromisoformat(start), dt.date.fromisoformat(end)
            )

    def test_sum_revenue_inclusive_dates_ties_and_merchant_isolation(self):
        self.conn.executemany("INSERT INTO cnpscy_amazon_order VALUES (?, ?, ?, ?)", [
            (1, "B000000007", 20260901, 120),
            (1, " b000000007 ", 20260907, 80),
            (1, "B000000006", 20260903, 150),
            (1, "B000000006", 20260904, -50),
            (1, "B000000005", 20260904, 100),
            (1, "B000000003", 20260905, 0),
            (1, "B000000002", 20260905, -30),
            (1, "B000000001", 20260831, 9000),
            (1, "B000000001", 20260908, 9000),
            (2, "B000000001", 20260904, 5000),
            (9, "B000000009", 20260904, 99999),
            (1, "Storefront", 20260904, 99999),
        ])
        ranked = self.rank()
        self.assertEqual(ranked["1"][:5], [
            "B000000007", "B000000005", "B000000006", "B000000000", "B000000001"
        ])
        self.assertEqual(len(ranked["1"]), 8)  # Keep complete catalog for ASIN search.
        self.assertEqual(ranked["2"], ["B000000001"])
        self.assertNotIn("9", ranked)
        self.assertEqual(self.rank("2026-09-08", "2026-09-08")["1"][0], "B000000001")

    def test_all_fallbacks_are_sorted_and_short_lists_stay_short(self):
        ranked = self.rank()
        self.assertEqual(ranked["1"][:5], [f"B00000000{i}" for i in range(5)])
        self.assertEqual(ranked["3"], ["B000000001", "B000000003"])
        self.assertEqual(ranked["4"], [])

    def test_more_than_five_positive_products_and_order_only_product(self):
        self.conn.executemany("INSERT INTO cnpscy_amazon_order VALUES (?, ?, ?, ?)", [
            (1, f"B00000000{i}", 20260901, i * 10) for i in range(1, 10)
        ])
        self.assertEqual(self.rank()["1"][:5], [f"B00000000{i}" for i in [9, 8, 7, 6, 5]])

    def test_missing_asin_or_revenue_column_uses_code_order(self):
        for column in ["asin", "amount"]:
            with self.subTest(column=column):
                self.columns.remove(column)
                self.assertEqual(self.rank()["1"][:5], [f"B00000000{i}" for i in range(5)])
                self.columns.add(column)

    def test_old_snapshots_are_rebuilt_even_when_memory_and_file_are_fresh(self):
        stale = {"offers": [{"topAsins": ["B000000001"]}]}
        ranked = {"asinRankingVersion": offer_db.OFFER_ASIN_RANKING_VERSION, "offers": []}
        with patch.object(offer_db, "_offers_memory_cache", (time.time(), stale)), patch.object(
            offer_db, "_load_any_cache", return_value=stale
        ), patch.object(offer_db, "_build_offers_payload", return_value=ranked) as build, patch.object(
            offer_db, "_save_cache"
        ) as save:
            self.assertIs(offer_db.offers_payload(), ranked)
            self.assertIs(offer_db.offers_payload(), ranked)
            build.assert_called_once()
            save.assert_called_once()


if __name__ == "__main__":
    unittest.main()
