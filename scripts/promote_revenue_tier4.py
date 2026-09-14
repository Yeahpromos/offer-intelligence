#!/usr/bin/env python3
"""Promote Tier 4 merchants with positive trailing-30-day Amazon revenue."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import offer_db as db
from apply_tier1_business_manager_schema import load_env_file

SOURCE = "revenue_30d_tier4_to_tier3"
ACTOR = "automation:revenue-30d"


def reconcile_visual_status(conn, *, apply: bool) -> list[dict]:
    """Repair rule-derived Tier 4 colors, including earlier audited promotions."""
    rows = db.fetch_all(conn, """
        SELECT v.merchantId, v.color, v.reason_code, v.reason_text, v.source
        FROM cnpscy_oi_tier_assignments t
        INNER JOIN cnpscy_oi_tier_visual_status v ON v.merchantId = t.merchantId
        WHERE t.tier = 'Tier 3' AND t.source = %s AND v.source = 'rule'
          AND v.reason_code IN ('tier4_demoted_or_inactive', 'tier4_new_offer', 'no_rule_match')
        ORDER BY v.merchantId
        FOR UPDATE
    """, (SOURCE,))
    if apply:
        for row in rows:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE cnpscy_oi_tier_visual_status
                    SET color = 'green', reason_code = 'tier3_new_or_promoted',
                        reason_text = 'Moved from Tier 4 after positive trailing-30-day revenue'
                    WHERE merchantId = %s AND source = 'rule'
                """, (str(row["merchantId"]),))
                if cursor.rowcount != 1:
                    raise RuntimeError(f"Visual status changed while locked: {row['merchantId']}")
    return [{"merchantId": str(row["merchantId"]), "before": row,
             "after": {"color": "green", "reason_code": "tier3_new_or_promoted", "source": "rule"}}
            for row in rows]


def promote(conn, as_of: dt.date, *, apply: bool = False) -> dict:
    start = as_of - dt.timedelta(days=29)
    start_key, end_key = int(start.strftime("%Y%m%d")), int(as_of.strftime("%Y%m%d"))
    result = {"rule": SOURCE, "startDate": start.isoformat(), "endDate": as_of.isoformat(),
              "applied": apply, "candidates": [], "promoted": [], "skipped": [], "visualStatusUpdates": []}
    conn.begin()
    try:
        rows = db.fetch_all(conn, """
            SELECT t.merchantId, MAX(a.advert_name) AS merchantName,
                   SUM(COALESCE(o.amount, 0)) AS revenue
            FROM cnpscy_oi_tier_assignments t
            INNER JOIN cnpscy_amazon_order o ON o.advert_id = CAST(t.merchantId AS UNSIGNED)
            LEFT JOIN cnpscy_advert a ON a.advert_id = o.advert_id
            WHERE t.tier = 'Tier 4' AND o.order_time_day BETWEEN %s AND %s
            GROUP BY t.merchantId
            HAVING SUM(COALESCE(o.amount, 0)) > 0
            ORDER BY t.merchantId
        """, (start_key, end_key))
        result["candidates"] = [{**r, "revenue": float(r["revenue"])} for r in rows]
        if not apply:
            result["visualStatusUpdates"] = reconcile_visual_status(conn, apply=False)
            conn.rollback()
            return result
        moved_at = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None, microsecond=0)
        for row in rows:
            mid = str(row["merchantId"])
            current = db.fetch_one(conn, """
                SELECT tier FROM cnpscy_oi_tier_assignments
                WHERE merchantId = %s FOR UPDATE
            """, (mid,))
            if not current or current["tier"] != "Tier 4":
                result["skipped"].append(mid)
                continue
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE cnpscy_oi_tier_assignments
                    SET tier = 'Tier 3', source = %s, movedFromTier = 'Tier 4',
                        movedAt = %s, updatedBy = %s
                    WHERE merchantId = %s AND tier = 'Tier 4'
                """, (SOURCE, moved_at, ACTOR, mid))
                if cursor.rowcount != 1:
                    raise RuntimeError(f"Tier assignment changed while locked: {mid}")
                cursor.execute("""
                    INSERT INTO cnpscy_oi_tier_move_history
                        (merchantId, merchantName, sourceTier, targetTier, source, movedAt, movedBy)
                    VALUES (%s, %s, 'Tier 4', 'Tier 3', %s, %s, %s)
                """, (mid, row.get("merchantName"), SOURCE, moved_at, ACTOR))
                result["promoted"].append({"merchantId": mid, "eventId": cursor.lastrowid,
                                           "revenue": float(row["revenue"])})
        result["visualStatusUpdates"] = reconcile_visual_status(conn, apply=True)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Persist promotions and migration history.")
    parser.add_argument("--as-of", type=dt.date.fromisoformat,
                        default=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date())
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    load_env_file(args.env_file)
    with db.db_connection() as conn:
        required = {
            "cnpscy_oi_tier_assignments": {"merchantId", "tier", "source", "movedFromTier", "movedAt", "updatedBy"},
            "cnpscy_oi_tier_move_history": {"eventId", "merchantId", "merchantName", "sourceTier", "targetTier", "source", "movedAt", "movedBy"},
            "cnpscy_amazon_order": {"advert_id", "order_time_day", "amount"},
            "cnpscy_oi_tier_visual_status": {"merchantId", "color", "reason_code", "reason_text", "source"},
        }
        for table, columns in required.items():
            missing = columns - db.table_columns(conn, table)
            if missing:
                raise RuntimeError(f"Missing required columns in {table}: {sorted(missing)}")
        result = promote(conn, args.as_of, apply=args.apply)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k not in {"candidates", "promoted", "skipped", "visualStatusUpdates"}}, ensure_ascii=False))
    print(f"Candidates: {len(result['candidates'])}; promoted: {len(result['promoted'])}; skipped: {len(result['skipped'])}")
    print(f"Rule-derived visual statuses {'updated' if args.apply else 'to update'}: {len(result['visualStatusUpdates'])}")


if __name__ == "__main__":
    main()
