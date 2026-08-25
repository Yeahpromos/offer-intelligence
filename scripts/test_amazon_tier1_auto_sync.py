from contextlib import contextmanager
import datetime as dt
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import offer_db


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _traceback):
        return False

    def execute(self, sql, params=()):
        self.connection.executed.append((sql, params))
        self.rowcount = 1


class FakeConnection:
    def __init__(self):
        self.begun = False
        self.committed = False
        self.rolled_back = False
        self.executed = []

    def begin(self):
        self.begun = True

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def cursor(self):
        return FakeCursor(self)


@contextmanager
def fake_db_connection(connection):
    yield connection


def main():
    connection = FakeConnection()
    original_db_connection = offer_db.db_connection
    original_fetch_all = offer_db.fetch_all
    try:
        offer_db.db_connection = lambda: fake_db_connection(connection)
        captured = {}

        def fake_fetch_all(_conn, sql, params=()):
            captured["sql"] = sql
            captured["params"] = params
            return [
                {"merchantId": "406173", "merchantName": "USKEYVISION"},
                {"merchantId": "406220", "merchantName": "AOCHUAN"},
            ]

        offer_db.fetch_all = fake_fetch_all
        result = offer_db.sync_amazon_offer_base_merchants_to_tier1(
            start_at="2026-07-15 00:00:00",
            source=offer_db.TIER1_AMAZON_BACKFILL_SOURCE,
            updated_by="codex-dbeaver-backfill",
            now=dt.datetime(2026, 8, 25, 12, 0, tzinfo=offer_db.REPORTING_TZ),
        )

        assert result["insertedCount"] == 2
        assert result["skippedCount"] == 0
        assert result["managerUpdatedCount"] == 2
        assert connection.begun and connection.committed and not connection.rolled_back
        assert "LOWER(TRIM(at.advert_type_name)) = 'amazon'" in captured["sql"]
        assert "a.advert_isdel = 1" in captured["sql"]
        assert "a.advert_status = 1" in captured["sql"]
        assert "a.is_published = 1" in captured["sql"]
        assert "t.merchantId IS NULL" in captured["sql"]
        assert len(captured["params"]) == 2

        assignment_writes = [
            (sql, params)
            for sql, params in connection.executed
            if "INSERT IGNORE INTO cnpscy_oi_tier_assignments" in sql
        ]
        history_writes = [
            (sql, params)
            for sql, params in connection.executed
            if "INSERT INTO cnpscy_oi_tier_move_history" in sql
        ]
        metadata_writes = [
            (sql, params)
            for sql, params in connection.executed
            if "INSERT INTO cnpscy_oi_offer_sheet_metadata" in sql
        ]
        assert len(assignment_writes) == 2
        assert len(history_writes) == 2
        assert len(metadata_writes) == 2
        assert all("ON DUPLICATE KEY UPDATE" not in sql for sql, _params in assignment_writes)
        assert all(params[1] == "Tier 1" for _sql, params in assignment_writes)
        assert all(params[2] == offer_db.TIER1_AMAZON_BACKFILL_SOURCE for _sql, params in assignment_writes)
        assert all(params[1] == "Timmy" for _sql, params in metadata_writes)

        print("Amazon Tier 1 auto-sync checks passed")
    finally:
        offer_db.db_connection = original_db_connection
        offer_db.fetch_all = original_fetch_all


if __name__ == "__main__":
    main()
