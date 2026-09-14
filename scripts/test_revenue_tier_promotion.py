import datetime as dt
import sqlite3
import unittest
from unittest.mock import patch

import promote_revenue_tier4 as rule


class Cursor:
    def __init__(self, conn):
        self.conn = conn
        self.raw = conn.raw.cursor()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.raw.close()

    def execute(self, sql, params=()):
        if self.conn.fail_history and "INSERT INTO cnpscy_oi_tier_move_history" in sql:
            raise RuntimeError("audit unavailable")
        return self.raw.execute(sql.replace("%s", "?").replace("FOR UPDATE", ""), params)

    def fetchall(self):
        return [dict(r) for r in self.raw.fetchall()]

    def fetchone(self):
        row = self.raw.fetchone()
        return dict(row) if row else None

    @property
    def rowcount(self):
        return self.raw.rowcount

    @property
    def lastrowid(self):
        return self.raw.lastrowid


class Connection:
    def __init__(self):
        self.raw = sqlite3.connect(":memory:")
        self.raw.row_factory = sqlite3.Row
        self.fail_history = False

    def cursor(self):
        return Cursor(self)

    def begin(self):
        self.raw.execute("BEGIN")

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()


class PromotionTests(unittest.TestCase):
    def setUp(self):
        self.conn = Connection()
        self.addCleanup(self.conn.raw.close)
        self.conn.raw.executescript("""
            CREATE TABLE cnpscy_oi_tier_assignments (merchantId TEXT PRIMARY KEY, tier TEXT,
                source TEXT, movedFromTier TEXT, movedAt TEXT, updatedBy TEXT);
            CREATE TABLE cnpscy_advert (advert_id INTEGER PRIMARY KEY, advert_name TEXT);
            CREATE TABLE cnpscy_amazon_order (advert_id INTEGER, order_time_day INTEGER, amount REAL);
            CREATE TABLE cnpscy_oi_tier_move_history (eventId INTEGER PRIMARY KEY,
                merchantId TEXT, merchantName TEXT, sourceTier TEXT, targetTier TEXT,
                source TEXT, movedAt TEXT, movedBy TEXT);
        """)
        for mid, tier in [(1,'Tier 4'),(2,'Tier 4'),(3,'Tier 1'),(4,'Tier 2'),(5,'Tier 3'),(6,'BLACK TIER'),(7,'Tier 4'),(8,'Tier 4')]:
            self.conn.raw.execute("INSERT INTO cnpscy_oi_tier_assignments (merchantId,tier) VALUES (?,?)",(str(mid),tier))
            self.conn.raw.execute("INSERT INTO cnpscy_advert VALUES (?,?)",(mid,f'Merchant {mid}'))
        self.conn.raw.executemany("INSERT INTO cnpscy_amazon_order VALUES (?,?,?)", [
            (1,20260816,10),(1,20260914,20),(2,20260815,999), (2,20260915,999),
            (3,20260901,100),(4,20260901,100),(5,20260901,100),(6,20260901,100),
            (7,20260901,50),(7,20260902,-50),(8,20260901,-10)
        ])
        self.conn.commit()

    def test_scope_dates_dry_run_and_idempotent_audited_write(self):
        preview = rule.promote(self.conn, dt.date(2026,9,14))
        self.assertEqual(preview['startDate'],'2026-08-16')
        self.assertEqual([r['merchantId'] for r in preview['candidates']],['1'])
        self.assertEqual(preview['promoted'],[])
        result = rule.promote(self.conn, dt.date(2026,9,14), apply=True)
        self.assertEqual(result['promoted'][0]['revenue'],30)
        row = dict(self.conn.raw.execute("SELECT * FROM cnpscy_oi_tier_assignments WHERE merchantId='1'").fetchone())
        self.assertEqual((row['tier'],row['movedFromTier'],row['source']),('Tier 3','Tier 4',rule.SOURCE))
        audit = dict(self.conn.raw.execute("SELECT * FROM cnpscy_oi_tier_move_history").fetchone())
        self.assertEqual((audit['sourceTier'],audit['targetTier'],audit['movedBy']),('Tier 4','Tier 3',rule.ACTOR))
        self.assertEqual(audit['movedAt'],row['movedAt'])
        self.assertEqual(rule.promote(self.conn, dt.date(2026,9,14),apply=True)['promoted'],[])
        self.assertEqual(self.conn.raw.execute('SELECT COUNT(*) FROM cnpscy_oi_tier_move_history').fetchone()[0],1)

    def test_audit_failure_rolls_back_tier_update(self):
        self.conn.fail_history = True
        with self.assertRaisesRegex(RuntimeError,'audit unavailable'):
            rule.promote(self.conn, dt.date(2026,9,14), apply=True)
        self.assertEqual(self.conn.raw.execute("SELECT tier FROM cnpscy_oi_tier_assignments WHERE merchantId='1'").fetchone()[0],'Tier 4')

    def test_concurrent_manual_tier_change_is_preserved(self):
        with patch.object(rule.db,'fetch_one',return_value={'tier':'Tier 2'}):
            result = rule.promote(self.conn,dt.date(2026,9,14),apply=True)
        self.assertEqual(result['skipped'],['1'])
        self.assertEqual(result['promoted'],[])
        self.assertEqual(self.conn.raw.execute('SELECT COUNT(*) FROM cnpscy_oi_tier_move_history').fetchone()[0],0)


if __name__ == '__main__':
    unittest.main()
