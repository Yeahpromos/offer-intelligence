#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from offer_db import (  # noqa: E402
    count_distinct_for_ids,
    db_connection,
    latest_dates,
    read_static_merchant_ids,
    recent_month_summary,
    static_chatbot_generated_at,
)


def comparable_date(value):
    if not value:
        return ""
    digits = re.sub(r"\D", "", str(value))
    return digits[:8] if len(digits) >= 8 else digits


def add_date_check(failures, label, actual, minimum):
    if not minimum:
        return
    actual_key = comparable_date(actual)
    minimum_key = comparable_date(minimum)
    if not actual_key or actual_key < minimum_key:
        failures.append(f"{label} latest date {actual or 'missing'} is below required {minimum}")


def add_coverage_check(failures, label, coverage, minimum):
    if minimum is None:
        return
    if not coverage.get("available"):
        failures.append(f"{label} coverage table or id column is unavailable")
        return
    value = coverage.get("coverage")
    if value is None or value < minimum:
        failures.append(f"{label} coverage {value} is below required {minimum}")


def build_parser():
    parser = argparse.ArgumentParser(description="Validate Offer Intelligence database migration readiness.")
    parser.add_argument("--min-amazon-order-date", default="", help="Minimum MAX(order_time_day), e.g. 2026-07-01.")
    parser.add_argument("--min-amazon-click-date", default="", help="Minimum MAX(time_day), e.g. 2026-07-01.")
    parser.add_argument("--min-aggregate-date", default="", help="Minimum MAX(order_time_day) for aggregate table.")
    parser.add_argument("--min-product-date", default="", help="Minimum product updated_at date.")
    parser.add_argument("--min-advert-coverage", type=float, default=1.0)
    parser.add_argument("--min-product-coverage", type=float, default=0.99)
    parser.add_argument("--min-product-extra-coverage", type=float, default=0.90)
    parser.add_argument("--output", default="", help="Optional JSON output path for CI or release evidence.")
    return parser


def main():
    args = build_parser().parse_args()
    failures = []
    static_ids = read_static_merchant_ids()
    if not static_ids:
        failures.append("No numeric Merchant IDs were found in protected_data/chatbot_data.js")

    with db_connection() as conn:
        latest = latest_dates(conn)
        coverage = {
            "staticNumericMerchantIds": len(static_ids),
            "cnpscy_advert": count_distinct_for_ids(conn, "cnpscy_advert", ["advert_id", "merchant_id"], static_ids),
            "cnpscy_amazon_product": count_distinct_for_ids(conn, "cnpscy_amazon_product", ["advert_id", "merchant_id"], static_ids),
            "cnpscy_amazon_product_extra": count_distinct_for_ids(conn, "cnpscy_amazon_product_extra", ["advert_id", "merchant_id"], static_ids),
        }
        recent = recent_month_summary(conn)

    add_date_check(failures, "Amazon order", latest["amazonOrders"].get("latest"), args.min_amazon_order_date)
    add_date_check(failures, "Amazon click", latest["amazonClicks"].get("latest"), args.min_amazon_click_date)
    add_date_check(failures, "Aggregate order", latest["aggregateOrders"].get("latest"), args.min_aggregate_date)
    add_date_check(failures, "Product", latest["products"].get("latest"), args.min_product_date)
    add_coverage_check(failures, "cnpscy_advert", coverage["cnpscy_advert"], args.min_advert_coverage)
    add_coverage_check(failures, "cnpscy_amazon_product", coverage["cnpscy_amazon_product"], args.min_product_coverage)
    add_coverage_check(
        failures,
        "cnpscy_amazon_product_extra",
        coverage["cnpscy_amazon_product_extra"],
        args.min_product_extra_coverage,
    )

    payload = {
        "ok": not failures,
        "failures": failures,
        "staticSnapshot": {
            "generatedAt": static_chatbot_generated_at(),
            "merchantIds": len(static_ids),
        },
        "latestDates": latest,
        "coverage": coverage,
        "recentMonths": recent,
    }

    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
