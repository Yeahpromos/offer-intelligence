#!/usr/bin/env python3
"""
从 chatbot_data.js 和 feishu CSV 同步数据到 cnpscy_oi_* 实体表。

数据流向:
  chatbot_data.js ──→ cnpscy_oi_tier_assignments  (分层分配)
  chatbot_data.js ──→ cnpscy_oi_category           (分类定义)
                   ──→ cnpscy_oi_merchant_category  (商户-分类关联)
  chatbot_data.js ──→ cnpscy_oi_tier_visual_status  (分层颜色标记)

幂等 — 可安全重复运行。使用 INSERT ... ON DUPLICATE KEY UPDATE。
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# 前端 visualStatusForTierRow 的颜色列候选键（来自 app.js line 9-12）
TIER_VISUAL_STATUS_COLOR_KEYS = [
    "visualStatusColor", "visual_status_color",
    "Visual Status Color", "Visual Status",
    "Color",
]
TIER_VISUAL_STATUS_CODE_KEYS = [
    "visualStatusCode", "visual_status_code",
    "Visual Status Code", "Reason Code",
]
TIER_VISUAL_STATUS_REASON_KEYS = [
    "visualStatusReason", "visual_status_reason",
    "Visual Status Reason", "Reason Text",
]
TIER_VISUAL_STATUS_SOURCE_KEYS = [
    "visualStatusSource", "visual_status_source",
    "Visual Status Source", "Source",
]


# ── helpers ────────────────────────────────────────────────────────

OFFERS_CACHE_PATH = ROOT / "protected_data" / "db_offers_cache.json"


def load_offers_from_cache() -> list[dict]:
    """从 db_offers_cache.json 加载 offer 列表（替代旧的 chatbot_data.js）。"""
    if not OFFERS_CACHE_PATH.exists():
        raise FileNotFoundError(f"db_offers_cache.json not found at {OFFERS_CACHE_PATH}")
    try:
        payload = json.loads(OFFERS_CACHE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        raise RuntimeError(f"Failed to parse {OFFERS_CACHE_PATH}: {e}") from e
    return payload.get("offers", [])


def load_sheets_from_cache() -> list[dict]:
    """从 db_offers_cache.json 加载 sheets 列表（替代旧的 sheet_report_data.js）。
    每个 sheet 含 name / headers / rows（rows 是 dict 列表）。
    """
    if not OFFERS_CACHE_PATH.exists():
        raise FileNotFoundError(f"db_offers_cache.json not found at {OFFERS_CACHE_PATH}")
    try:
        payload = json.loads(OFFERS_CACHE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        raise RuntimeError(f"Failed to parse {OFFERS_CACHE_PATH}: {e}") from e
    return payload.get("sheets", [])


def db_connection():
    """创建 MySQL 连接（复用 offer_db.py 的配置模式）。"""
    try:
        import pymysql
    except ImportError:
        sys.exit("PyMySQL not installed. Run: pip install pymysql")

    required = ["OFFER_DB_HOST", "OFFER_DB_NAME", "OFFER_DB_USER", "OFFER_DB_PASSWORD"]
    missing = [k for k in required if not os.environ.get(k, "").strip()]
    if missing:
        sys.exit(f"Missing env vars: {', '.join(missing)}")

    return pymysql.connect(
        host=os.environ["OFFER_DB_HOST"].strip(),
        port=int(os.environ.get("OFFER_DB_PORT", "3306")),
        database=os.environ["OFFER_DB_NAME"].strip(),
        user=os.environ["OFFER_DB_USER"].strip(),
        password=os.environ["OFFER_DB_PASSWORD"],
        charset="utf8mb4",
        connect_timeout=30,
        read_timeout=60,
        write_timeout=60,
        ssl=None,
        autocommit=True,
    )


def upsert(conn, table: str, rows: list[dict], key_columns: list[str]) -> int:
    """批量 UPSERT：key 冲突时更新，否则插入。返回写入行数。"""
    if not rows:
        return 0

    columns = list(rows[0].keys())
    col_names = ", ".join(f"`{c}`" for c in columns)

    update_parts = [f"`{c}` = VALUES(`{c}`)" for c in columns if c not in key_columns]

    if update_parts:
        placeholders = ", ".join(["%s"] * len(columns))
        sql = (
            f"INSERT INTO `{table}` ({col_names}) VALUES ({placeholders}) "
            f"ON DUPLICATE KEY UPDATE {', '.join(update_parts)}"
        )
    else:
        # 所有列都是主键列 — 用 INSERT IGNORE 去重
        placeholders = ", ".join(["%s"] * len(columns))
        sql = f"INSERT IGNORE INTO `{table}` ({col_names}) VALUES ({placeholders})"

    values_list = [tuple(row.get(c) for c in columns) for row in rows]

    written = 0
    batch_size = 100
    with conn.cursor() as cur:
        for i in range(0, len(values_list), batch_size):
            batch = values_list[i:i + batch_size]
            cur.executemany(sql, batch)
            written += len(batch)
        conn.commit()
    return written


# ── sync functions ──────────────────────────────────────────────────

def sync_tiers(conn, offers: list[dict]) -> int:
    """从 offers 提取分层分配 → cnpscy_oi_tier_assignments。"""
    print("[sync] cnpscy_oi_tier_assignments ...")
    rows = []
    for o in offers:
        mid = str(o.get("merchantId", "")).strip()
        tier = str(o.get("tier", "")).strip()
        if not mid or not tier:
            continue
        rows.append({
            "merchantId": mid,
            "tier": tier,
            "source": "chatbot_data_snapshot",
            "movedFromTier": None,
            "movedAt": None,
            "updatedBy": "sync_oi_tables.py",
        })
    n = upsert(conn, "cnpscy_oi_tier_assignments", rows, ["merchantId"])
    print(f"  → upserted {n} rows")
    return n


def sync_categories(conn, offers: list[dict], feishu_rows: list[dict]) -> int:
    """从 chatbot_data 和飞书 CSV 提取分类 → cnpscy_oi_category + cnpscy_oi_merchant_category。
    同时写入 categoryNameCn（类目中文名）。"""
    print("[sync] cnpscy_oi_category + cnpscy_oi_merchant_category ...")

    # 收集主分类和子分类
    main_cats: dict[str, dict] = {}   # name → {categoryName, level, source, sortOrder, categoryNameCn}
    sub_cats: dict[str, dict] = {}    # (mainName, subName) → {categoryName, parentCategoryName, level, source, categoryNameCn}

    # 来源 1: chatbot_data.js offers
    for o in offers:
        main = (o.get("mainCategory") or "").strip()
        sub = (o.get("subCategory") or "").strip()
        source = (o.get("categorySource") or "chatbot_data").strip()
        if main:
            entry = main_cats.get(main)
            if entry is None:
                entry = {"categoryName": main, "level": 1, "source": source, "sortOrder": 0, "categoryNameCn": None}
                main_cats[main] = entry
            # 补充 CN 名（offer 中可能有 mainCategoryCn）
            cn = (o.get("mainCategoryCn") or "").strip()
            if cn and not entry.get("categoryNameCn"):
                entry["categoryNameCn"] = cn
        if main and sub:
            key = f"{main}::{sub}"
            if key not in sub_cats:
                sub_cats[key] = {"categoryName": sub, "parentCategoryName": main, "level": 2, "source": source, "categoryNameCn": None}

    # 来源 2: feishu CSV
    for row in feishu_rows:
        main = (row.get("mainCategory") or "").strip()
        sub = (row.get("subCategory") or "").strip()
        main_cn = (row.get("mainCategoryCn") or "").strip()
        sub_cn = (row.get("subCategoryCn") or "").strip()
        if main:
            entry = main_cats.get(main)
            if entry is None:
                entry = {"categoryName": main, "level": 1, "source": "feishu", "sortOrder": 0, "categoryNameCn": None}
                main_cats[main] = entry
            if main_cn and not entry.get("categoryNameCn"):
                entry["categoryNameCn"] = main_cn
        if main and sub:
            key = f"{main}::{sub}"
            entry = sub_cats.get(key)
            if entry is None:
                entry = {"categoryName": sub, "parentCategoryName": main, "level": 2, "source": "feishu", "categoryNameCn": None}
                sub_cats[key] = entry
            if sub_cn and not entry.get("categoryNameCn"):
                entry["categoryNameCn"] = sub_cn

    # 插入主分类
    main_rows = []
    for info in main_cats.values():
        row = {"categoryName": info["categoryName"], "level": info["level"], "source": info.get("source", "feishu"), "sortOrder": info.get("sortOrder", 0)}
        if info.get("categoryNameCn"):
            row["categoryNameCn"] = info["categoryNameCn"]
        main_rows.append(row)
    n_main = upsert(conn, "cnpscy_oi_category", main_rows, ["categoryName"])
    print(f"  → main categories: {len(main_rows)}")

    # 查询主分类的 categoryId
    with conn.cursor() as cur:
        cur.execute("SELECT categoryId, categoryName FROM cnpscy_oi_category WHERE level = 1")
        main_id_map = {row[1]: row[0] for row in cur.fetchall()}

    # 插入子分类（带 parentCategoryId）
    sub_rows = []
    for key, info in sub_cats.items():
        parent_id = main_id_map.get(info["parentCategoryName"])
        if parent_id is None:
            continue
        row = {
            "categoryName": info["categoryName"],
            "parentCategoryId": parent_id,
            "level": 2,
            "source": info.get("source", "feishu"),
            "sortOrder": 0,
        }
        if info.get("categoryNameCn"):
            row["categoryNameCn"] = info["categoryNameCn"]
        sub_rows.append(row)
    n_sub = upsert(conn, "cnpscy_oi_category", sub_rows, ["categoryName", "parentCategoryId"])
    print(f"  → sub categories: {len(sub_rows)}")

    # 查询所有分类的 categoryId
    with conn.cursor() as cur:
        cur.execute("SELECT categoryId, categoryName FROM cnpscy_oi_category")
        cat_id_map = {row[1]: row[0] for row in cur.fetchall()}

    # 插入商户-分类关联
    merchant_cat_rows: list[dict] = []
    seen = set()
    for o in offers:
        mid = str(o.get("merchantId", "")).strip()
        main = (o.get("mainCategory") or "").strip()
        sub = (o.get("subCategory") or "").strip()
        if not mid:
            continue

        # 关联主分类
        cid = cat_id_map.get(main)
        if cid and (mid, cid) not in seen:
            merchant_cat_rows.append({"merchantId": mid, "categoryId": cid})
            seen.add((mid, cid))

        # 关联子分类
        cid = cat_id_map.get(sub)
        if cid and (mid, cid) not in seen:
            merchant_cat_rows.append({"merchantId": mid, "categoryId": cid})
            seen.add((mid, cid))

    n_mc = upsert(conn, "cnpscy_oi_merchant_category", merchant_cat_rows, ["merchantId", "categoryId"])
    print(f"  → merchant-category links: {len(merchant_cat_rows)}")

    main_cn_count = sum(1 for info in main_cats.values() if info.get("categoryNameCn"))
    sub_cn_count = sum(1 for info in sub_cats.values() if info.get("categoryNameCn"))
    print(f"  → categories with CN name: {main_cn_count} main + {sub_cn_count} sub")

    return n_main + n_sub + n_mc


# ── visual status rules (computed here, stored in the database) ──────

def _first_present_in_row(row: dict, keys: list) -> str:
    for k in keys:
        v = row.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


def _normalize_color(value: str | None) -> str | None:
    """Normalize stored colors; ``none`` is an explicit database value."""
    if not value:
        return None
    text = str(value).strip().lower()
    if text in ("green", "yellow", "red"):
        return text
    if text in ("none", "neutral", "no color", "no-color", "clear"):
        return "none"
    return None


def _explicit_color(row: dict) -> str | None:
    """对应 explicitVisualStatusColor。"""
    nested_color = ""
    vs = row.get("visualStatus")
    if isinstance(vs, dict):
        nested_color = str(vs.get("color", "")).strip()
    raw = nested_color or _first_present_in_row(row, TIER_VISUAL_STATUS_COLOR_KEYS)
    return _normalize_color(raw)


def _number(value) -> float | None:
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _rule_reason(row: dict, fallback: str) -> str:
    return _first_present_in_row(
        row,
        ["Tier Reason", "Reason", "tier_reason", "tierReason", "reason"],
    ) or fallback


def _determine_color_from_sheet(sheet_name: str, row: dict) -> tuple[str, str, str, str]:
    """Compute the color that will be stored in ``cnpscy_oi_tier_visual_status``.

    Explicit Sheet/database values win. Otherwise the former UI rules are
    evaluated here so every consumer reads the same persisted result.
    Returns ``(color, reason_code, reason_text, source)``.
    """
    explicit = _explicit_color(row)
    if explicit is not None:
        code = _first_present_in_row(row, TIER_VISUAL_STATUS_CODE_KEYS)
        reason = _first_present_in_row(row, TIER_VISUAL_STATUS_REASON_KEYS)
        return (
            explicit,
            code or ("explicit_none" if explicit == "none" else "explicit"),
            reason or f"Explicit color={explicit}",
            "manual",
        )

    reason = _rule_reason(row, "")
    reason_lower = reason.lower()

    if sheet_name == "Tier 1":
        rank_text = _first_present_in_row(row, ["Original Rank", "originalRank"])
        rank = _number(rank_text)
        fallback = f"Original Rank={rank_text}" if rank_text else "Original Rank unavailable"
        if rank is not None and rank >= 40:
            return ("green", "tier1_online", reason or fallback, "rule")
        return ("yellow", "tier1_not_ready", reason or fallback, "rule")

    if sheet_name == "Tier 2":
        phase = _first_present_in_row(row, ["Phase", "phase"])
        phase_lower = phase.lower()
        fallback = f"Phase={phase}" if phase else "Phase unavailable"
        if "growing" in phase_lower:
            return ("green", "tier2_growing", reason or fallback, "rule")
        if "stable" in phase_lower:
            return ("yellow", "tier2_stable", reason or fallback, "rule")
        if "declining" in phase_lower:
            return ("red", "tier2_declining", reason or fallback, "rule")
        return ("none", "no_rule_match", reason or fallback, "rule")

    if sheet_name == "Tier 3":
        if re.search(r"new june raw offer with orders|moved from tier 4", reason_lower):
            return ("green", "tier3_new_or_promoted", reason, "rule")
        if re.search(r"moved from tier 2|declined|declining", reason_lower):
            return ("red", "tier3_demoted_or_declining", reason, "rule")
        return ("none", "tier3_default", reason or "Tier 3 — no highlight", "rule")

    if sheet_name == "Tier 4":
        if "new june raw offer" in reason_lower:
            return ("green", "tier4_new_offer", reason, "rule")
        if re.search(r"moved to tier 4|moved/kept in tier 4|0 orders|no june .*raw data", reason_lower):
            return ("red", "tier4_demoted_or_inactive", reason, "rule")
        return ("none", "no_rule_match", reason or "Tier 4 — no rule match", "rule")

    return ("none", "no_rule_match", reason or f"{sheet_name} — no rule match", "rule")


def sync_visual_status(conn, sheets: list[dict]) -> int:
    """Compute and store visual status for every row in each Tier sheet.

    去重：同一 merchantId 在多个 sheet 中出现时，
    按优先级保留（Tier 1 > Tier 2 > Tier 3 > Tier 4 > BLACK TIER）。
    """
    print("[sync] cnpscy_oi_tier_visual_status (stored rule results) ...")

    tier_sheets = {"Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"}
    merchant_rows: dict[str, dict] = {}  # merchantId → row dict (+ _sheet key)

    for sheet in sheets:
        name = sheet.get("name", "")
        if name not in tier_sheets:
            continue
        rows = sheet.get("rows", [])
        if not rows:
            continue
        sheet_stored = 0
        for row in rows:
            mid = str(row.get("Merchant ID", "")).strip()
            if not mid:
                continue

            color, code, text, source = _determine_color_from_sheet(name, row)

            existing = merchant_rows.get(mid)
            if existing and tier_priority(existing["_sheet"]) <= tier_priority(name):
                continue  # 已有更高优先级的 sheet 数据

            merchant_rows[mid] = {
                "merchantId": mid,
                "color": color,
                "reason_code": code,
                "reason_text": text[:512] if text else "",
                "source": source,
                "updatedBy": "sync_oi_tables.py",
                "_sheet": name,
            }
            sheet_stored += 1

        print(f"  → Sheet '{name}': {len(rows)} rows, {sheet_stored} stored statuses")

    all_rows = list(merchant_rows.values())
    for r in all_rows:
        del r["_sheet"]

    n = upsert(conn, "cnpscy_oi_tier_visual_status", all_rows, ["merchantId"])
    print(f"  → upserted {n} rows")

    # 分布统计
    dist = Counter(r["color"] for r in all_rows)
    for c in ("green", "yellow", "red", "none"):
        print(f"  → {c}: {dist.get(c, 0)}")

    return n


def tier_priority(name: str) -> int:
    """Tier sheet 优先级（数字越小优先级越高）。"""
    order = {"Tier 1": 0, "Tier 2": 1, "Tier 3": 2, "Tier 4": 3, "BLACK TIER": 4}
    return order.get(name, 99)


def load_product_keywords_csv() -> list[dict]:
    """读取 data/product_name_keywords_t1_t3.csv。"""
    csv_path = ROOT / "data" / "product_name_keywords_t1_t3.csv"
    if not csv_path.exists():
        print(f"[warn] product keywords CSV not found at {csv_path}, skipping")
        return []
    with csv_path.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader)


# ── product keywords sync ──────────────────────────────────────────

def sync_product_keywords(conn, csv_rows: list[dict]) -> int:
    """将 product_name_keywords_t1_t3.csv 的数据写入 cnpscy_oi_product_keywords。"""
    print("[sync] cnpscy_oi_product_keywords ...")
    if not csv_rows:
        print("  → no CSV rows, skipping")
        return 0

    rows = []
    for r in csv_rows:
        mid = str(r.get("merchantId", "")).strip()
        if not mid:
            continue
        rows.append({
            "merchantId": mid,
            "merchantName": str(r.get("merchantName", "")).strip() or None,
            "brandKey": str(r.get("brandKey", "")).strip() or None,
            "productNameCount": int(r.get("productNameCount", 0) or 0),
            "productAsinCount": int(r.get("productAsinCount", 0) or 0),
            "productAsins": str(r.get("productAsins", "")).strip() or None,
            "productTitles": str(r.get("productTitles", "")).strip() or None,
            "productKeywords": str(r.get("productKeywords", "")).strip() or None,
        })

    n = upsert(conn, "cnpscy_oi_product_keywords", rows, ["merchantId"])
    print(f"  → upserted {n} rows")
    return n


# ── payment records sync ─────────────────────────────────────────

def _num(value) -> float | None:
    """将字符串/数值转为 float，失败返回 None。"""
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").replace("$", "").replace("%", ""))
    except (ValueError, TypeError):
        return None


def sync_payment_records(conn, payment_records: list[dict]) -> int:
    """将 paymentRecords 写入 cnpscy_oi_payment_records。"""
    print("[sync] cnpscy_oi_payment_records ...")
    if not payment_records:
        print("  → no payment records, skipping")
        return 0

    rows = []
    for r in payment_records:
        rid = str(r.get("id") or "").strip()
        if not rid:
            continue
        rows.append({
            "id": rid[:128],
            "merchantId": str(r.get("merchantId") or "").strip()[:32] or None,
            "levantaBrandId": str(r.get("levantaBrandId") or "").strip()[:32] or None,
            "merchantName": str(r.get("merchantName") or "").strip()[:255] or None,
            "network": str(r.get("network") or "Levanta").strip()[:64],
            "region": str(r.get("region") or "").strip()[:16] or None,
            "tier": str(r.get("tier") or "Unknown").strip()[:32],
            "category": str(r.get("category") or "Uncategorized").strip()[:128],
            "categoryPath": str(r.get("categoryPath") or "").strip()[:255] or None,
            "mainCategory": str(r.get("mainCategory") or "").strip()[:128] or None,
            "subCategory": str(r.get("subCategory") or "").strip()[:128] or None,
            "mainCategoryCn": str(r.get("mainCategoryCn") or "").strip()[:128] or None,
            "subCategoryCn": str(r.get("subCategoryCn") or "").strip()[:128] or None,
            "reportMonth": str(r.get("reportMonth") or "").strip()[:16],
            "reportYear": int(r.get("reportYear") or 0),
            "reportMonthKey": str(r.get("reportMonthKey") or "").strip()[:7],
            "revenueMade": _num(r.get("revenueMade")) or 0,
            "commissionMade": _num(r.get("commissionMade")) or 0,
            "expectedPaymentAmount": _num(r.get("expectedPaymentAmount")) or 0,
            "paidAmount": _num(r.get("paidAmount")) or 0,
            "remainingAmount": _num(r.get("remainingAmount")) or 0,
            "paymentCycle": int(_num(r.get("paymentCycle")) or 60),
            "paymentAvailabilityDate": str(r.get("paymentAvailabilityDate") or r.get("expectedPaymentDate") or "").strip()[:16] or None,
            "expectedPaymentDate": str(r.get("expectedPaymentDate") or "").strip()[:16] or None,
            "paymentStatus": str(r.get("paymentStatus") or "Unknown").strip()[:16],
            "rawStatus": str(r.get("rawStatus") or "").strip()[:32] or None,
            "lastCheckedDate": str(r.get("lastCheckedDate") or "").strip()[:16] or None,
            "currency": str(r.get("currency") or "USD").strip()[:8],
            "isPlaceholder": 1 if r.get("isPlaceholder") else 0,
            "notes": str(r.get("notes") or "").strip()[:1024] or None,
        })

    n = upsert(conn, "cnpscy_oi_payment_records", rows, ["id"])
    print(f"  → upserted {n} rows")

    status_dist = Counter(r["paymentStatus"] for r in rows)
    for status in ("Paid", "Pending", "Unpaid", "Overdue", "Partial"):
        if status_dist.get(status):
            print(f"  → {status}: {status_dist[status]}")

    return n


# ── sheet metadata sync ──────────────────────────────────────────

# Google Sheet 列名候选键（按优先级排列）
SHEET_REASON_KEYS = ["Tier Reason", "Reason", "tier_reason", "tierReason", "reason"]
SHEET_RECOMMENDATION_KEYS = ["Recommendation", "recommendation", "Recommendation Notes"]
SHEET_RECOMMENDED_LINK_KEYS = ["Recommended Link", "recommendedLink", "Recommended Traffic"]
SHEET_PHASE_KEYS = ["Phase", "phase"]
SHEET_PUBLISHER_COUNT_KEYS = ["Publisher Count", "publisherCount"]
SHEET_SUCCESS_RATE_KEYS = ["Success Rate", "successRate"]
SHEET_PUBLISHER_COUNT_JUNE_KEYS = ["Publisher Count June", "publisherCountJune"]
SHEET_SUCCESS_RATE_JUNE_KEYS = ["Success Rate June", "successRateJune"]
SHEET_COMPLETION_RATE_KEYS = ["Completion Rate", "completionRate", "Complete Rate"]
SHEET_TIMELINE_KEYS = ["Timeline", "timeline"]
SHEET_BEST_SUB_BSR_KEYS = ["Best Sub Category BSR", "bestSubCategoryBsr", "Best BSR"]
SHEET_PAYMENT_CYCLE_KEYS = ["Payment Cycle", "paymentCycle", "paymentCycleDays", "Payment Term Days"]
SHEET_COUNTRY_KEYS = ["COUNTRY", "Country", "country", "Region", "region"]
SHEET_CATEGORY_KEYS = ["Sheet Category", "Category", "category"]


def _sheet_value(row: dict, keys: list) -> str:
    """从 sheet 行中按优先级取第一个非空值。"""
    for k in keys:
        v = row.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


def sync_sheet_metadata(conn, sheets: list[dict], offers: list[dict]) -> int:
    """从 sheet_report_data.js 的 tier sheet 行和 chatbot_data offers
    提取运营元数据 → cnpscy_oi_offer_sheet_metadata。
    """
    print("[sync] cnpscy_oi_offer_sheet_metadata ...")

    tier_sheets = {"Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"}
    merchant_rows: dict[str, dict] = {}

    # 来源 1: Google Sheets 的 tier sheet 行
    for sheet in sheets:
        name = sheet.get("name", "")
        if name not in tier_sheets:
            continue
        rows = sheet.get("rows", [])
        if not rows:
            continue
        for row in rows:
            mid = str(row.get("Merchant ID", "")).strip()
            if not mid:
                continue

            existing = merchant_rows.get(mid) or {}
            existing["merchantId"] = mid

            # 字符串/文本字段（只在尚未设置时写入，优先第一个来源）
            for field, keys in [
                ("reason", SHEET_REASON_KEYS),
                ("recommendation", SHEET_RECOMMENDATION_KEYS),
                ("recommendedLink", SHEET_RECOMMENDED_LINK_KEYS),
                ("phase", SHEET_PHASE_KEYS),
                ("publisherCount", SHEET_PUBLISHER_COUNT_KEYS),
                ("publisherCountJune", SHEET_PUBLISHER_COUNT_JUNE_KEYS),
                ("timeline", SHEET_TIMELINE_KEYS),
                ("bestSubCategoryBsr", SHEET_BEST_SUB_BSR_KEYS),
                ("sheetCategory", SHEET_CATEGORY_KEYS),
            ]:
                if not existing.get(field):
                    val = _sheet_value(row, keys)
                    if val:
                        existing[field] = val[:512] if field in ("reason", "recommendation", "recommendedLink") else val[:255]

            # 数值字段
            for field, keys in [
                ("successRate", SHEET_SUCCESS_RATE_KEYS),
                ("successRateJune", SHEET_SUCCESS_RATE_JUNE_KEYS),
                ("completionRate", SHEET_COMPLETION_RATE_KEYS),
            ]:
                if existing.get(field) is None:
                    val = _num(_sheet_value(row, keys))
                    if val is not None:
                        existing[field] = round(val, 6)

            # 账期（Sheet 中的整数天数）
            if existing.get("paymentCycle") is None:
                val = _num(_sheet_value(row, SHEET_PAYMENT_CYCLE_KEYS))
                if val is not None and val > 0:
                    existing["paymentCycle"] = int(val)
                    existing["paymentCycleSource"] = "google_sheet"

            # region/country
            if not existing.get("region"):
                val = _sheet_value(row, SHEET_COUNTRY_KEYS)
                if val:
                    # 简单标准化
                    val_upper = val.upper().strip()
                    region_map = {"USA": "US", "GB": "UK", "GBR": "UK", "CAN": "CA", "FRA": "FR", "DEU": "DE"}
                    existing["region"] = region_map.get(val_upper, val_upper)[:16]

            if not existing.get("sourceSheet"):
                existing["sourceSheet"] = name

            merchant_rows[mid] = existing

    # 来源 2: chatbot_data.js offers 中的计算字段
    for o in offers:
        mid = str(o.get("merchantId", "")).strip()
        if not mid:
            continue

        existing = merchant_rows.get(mid) or {}
        existing["merchantId"] = mid

        # 分类来源优先级
        if not existing.get("categorySource"):
            sheet_cat = existing.get("sheetCategory") or ""
            feishu_main = str(o.get("feishuMainCategory") or "").strip()
            levanta_cat = str(o.get("levantaCategory") or "").strip()
            if sheet_cat:
                existing["categorySource"] = "Google Sheet"
            elif feishu_main:
                existing["categorySource"] = "Feishu"
            elif levanta_cat:
                existing["categorySource"] = "Levanta"
            else:
                existing["categorySource"] = "Source"

        for field in ("rowNumber", "originalRank"):
            if existing.get(field) is None:
                val = o.get(field)
                if val is not None:
                    existing[field] = int(val) if str(val).lstrip("-").isdigit() else None

        for field in ("backendMatchStatus",):
            if not existing.get(field):
                val = str(o.get(field) or "").strip()
                if val and val != "not_available":
                    existing[field] = val[:64]

        for field in ("mainCategoryBsr", "subcategoryBsr"):
            if not existing.get(field):
                val = str(o.get(field) or "").strip()
                if val:
                    existing[field] = val[:64]

        # paymentCycle (从 offer 级别，若 Sheet 未设置)
        if existing.get("paymentCycle") is None:
            pc = o.get("paymentCycle")
            if pc is not None:
                existing["paymentCycle"] = int(_num(pc) or 60)
            if not existing.get("paymentCycleSource"):
                pc_source = str(o.get("paymentCycleSource") or "").strip()
                existing["paymentCycleSource"] = pc_source if pc_source else "network_default"

        # 占位字段（当前全为默认值，预留后续填充）
        existing.setdefault("hasDiscount", 0)
        existing.setdefault("cpc", None)

        merchant_rows[mid] = existing

    # 构建写入行（补充默认值）
    all_rows = []
    for mid, info in merchant_rows.items():
        all_rows.append({
            "merchantId": mid,
            "reason": info.get("reason") or None,
            "recommendation": info.get("recommendation") or None,
            "recommendedLink": info.get("recommendedLink") or None,
            "phase": info.get("phase") or None,
            "publisherCount": info.get("publisherCount") or None,
            "successRate": info.get("successRate"),
            "publisherCountJune": info.get("publisherCountJune") or None,
            "successRateJune": info.get("successRateJune"),
            "completionRate": info.get("completionRate"),
            "timeline": info.get("timeline") or None,
            "bestSubCategoryBsr": info.get("bestSubCategoryBsr") or None,
            "paymentCycle": info.get("paymentCycle"),
            "paymentCycleSource": info.get("paymentCycleSource") or "network_default",
            "sheetCategory": info.get("sheetCategory") or None,
            "categorySource": info.get("categorySource") or None,
            "sourceSheet": info.get("sourceSheet") or None,
            "rowNumber": info.get("rowNumber"),
            "originalRank": info.get("originalRank"),
            "backendMatchStatus": info.get("backendMatchStatus") or None,
            "mainCategoryBsr": info.get("mainCategoryBsr") or None,
            "subcategoryBsr": info.get("subcategoryBsr") or None,
            "region": info.get("region") or None,
            "hasDiscount": int(info.get("hasDiscount") or 0),
            "discountInfo": info.get("discountInfo") or None,
            "dealInfo": info.get("dealInfo") or None,
            "cpc": info.get("cpc"),
        })

    n = upsert(conn, "cnpscy_oi_offer_sheet_metadata", all_rows, ["merchantId"])
    print(f"  → upserted {n} rows (from {len(tier_sheets)} tier sheets + offers)")

    region_dist = Counter(r["region"] for r in all_rows if r["region"])
    if region_dist:
        print(f"  → region distribution: {dict(region_dist.most_common(10))}")

    return n


# ── main ────────────────────────────────────────────────────────────

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync non-manual Offer Intelligence support tables."
    )
    parser.add_argument(
        "--sync-tier-assignments",
        action="store_true",
        help=(
            "Manual-only override: copy snapshot tiers into "
            "cnpscy_oi_tier_assignments. Omitted by scheduled automation."
        ),
    )
    parser.add_argument(
        "--sync-visual-status",
        action="store_true",
        help=(
            "Manual-only override: recompute and store tier row colors. "
            "Omitted by scheduled automation."
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None):
    args = parse_args(argv)
    print("=== sync_oi_tables ===\n")

    # 1. 加载数据源
    print("[load] db_offers_cache.json (offers) ...")
    offers = load_offers_from_cache()
    print(f"  → {len(offers)} offers loaded\n")

    print("[load] feishu_merchant_categories.csv ...")
    feishu_rows = load_feishu_csv()
    print(f"  → {len(feishu_rows)} rows loaded\n")

    print("[load] db_offers_cache.json (sheets) ...")
    sheets = load_sheets_from_cache()
    tier_sheet_count = sum(1 for s in sheets if s.get("name") in ("Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"))
    print(f"  → {len(sheets)} sheets ({tier_sheet_count} tier sheets)\n")

    print("[load] product_name_keywords_t1_t3.csv ...")
    keyword_rows = load_product_keywords_csv()
    print(f"  → {len(keyword_rows)} merchants\n")

    # 2. 连接数据库
    print("[db] connecting ...")
    conn = db_connection()
    print("  → connected\n")

    try:
        # 3. 同步各表
        if args.sync_tier_assignments:
            n1 = sync_tiers(conn, offers)
        else:
            n1 = None
            print("[paused] cnpscy_oi_tier_assignments (manual changes only)")
        print()
        n2 = sync_categories(conn, offers, feishu_rows)
        print()
        if args.sync_visual_status:
            n3 = sync_visual_status(conn, sheets)
        else:
            n3 = None
            print("[paused] cnpscy_oi_tier_visual_status (manual changes only)")
        print()
        n4 = sync_product_keywords(conn, keyword_rows)
        print()
        n5 = sync_sheet_metadata(conn, sheets, offers)
        print()

        # 4. 汇总
        print("=== sync complete ===")
        print(
            "  cnpscy_oi_tier_assignments:      "
            f"{n1 if n1 is not None else 'paused (manual only)'}"
        )
        print(f"  cnpscy_oi_category:              {n2} category rows (incl. merchant links)")
        print(
            "  cnpscy_oi_tier_visual_status:    "
            f"{n3 if n3 is not None else 'paused (manual only)'}"
        )
        print(f"  cnpscy_oi_product_keywords:      {n4} merchants")
        print(f"  cnpscy_oi_offer_sheet_metadata:  {n5} merchants")
        print(f"  cnpscy_oi_payment_records:       (handled by sync_levanta_payments.py)")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
