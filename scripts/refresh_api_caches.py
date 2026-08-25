#!/usr/bin/env python3
"""Rebuild db_offers_cache.json, db_keywords_cache.json and db_publishers_cache.json.

Called by the daily GitHub Actions workflow after DB sync completes.
Can also be run locally:

    python scripts/refresh_api_caches.py
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from offer_db import (
    KEYWORDS_CACHE_FILE,
    OFFERS_CACHE_FILE,
    _save_cache,
    offers_payload,
    product_keywords_payload,
    sync_amazon_offer_base_merchants_to_tier1,
)


def main() -> None:
    print("=== refresh_api_caches ===\n")

    print("[1/4] Syncing new Amazon offer-base merchants to Tier 1 ...", flush=True)
    tier1_sync = sync_amazon_offer_base_merchants_to_tier1()
    print(
        "  "
        f"candidates: {tier1_sync['candidateCount']}; "
        f"inserted: {tier1_sync['insertedCount']}; "
        f"skipped: {tier1_sync['skippedCount']}\n"
    )

    print("[2/4] Rebuilding offers cache (force_refresh=True) ...", flush=True)
    t0 = time.time()
    offers = offers_payload(force_refresh=True)
    elapsed = time.time() - t0
    print(f"  offers: {offers['summary']['offerCount']} merchants")
    sheets = offers.get("sheets", [])
    for s in sheets:
        print(f"    {s['name']}: {len(s.get('rows', []))} rows")
    print(f"  payments: {len(offers.get('paymentRecords', []))} records")
    print(f"  completed in {elapsed:.0f}s")
    print("  saving to disk ...", flush=True)
    _save_cache(OFFERS_CACHE_FILE, offers)
    print(f"  saved to {OFFERS_CACHE_FILE}\n")

    print("[3/4] Rebuilding keywords cache (force_refresh=True) ...", flush=True)
    t0 = time.time()
    kw = product_keywords_payload(force_refresh=True)
    elapsed = time.time() - t0
    print(f"  keywords: {kw['summary']['merchantCount']} merchants")
    print(f"  completed in {elapsed:.0f}s")
    print("  saving to disk ...", flush=True)
    _save_cache(KEYWORDS_CACHE_FILE, kw)
    print(f"  saved to {KEYWORDS_CACHE_FILE}\n")

    print("[4/4] Rebuilding publishers cache (scripts/build_publishers_data.py) ...", flush=True)
    t0 = time.time()
    import subprocess
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "build_publishers_data.py")],
        capture_output=True, text=True, cwd=str(ROOT),
    )
    elapsed = time.time() - t0
    if result.returncode != 0:
        print(f"  FAILED (exit {result.returncode}): {result.stderr.strip()}")
    else:
        print(f"  {result.stdout.strip()}")
    print(f"  completed in {elapsed:.0f}s\n")

    print("=== cache refresh complete ===")


if __name__ == "__main__":
    main()
