#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _load_dotenv(path: str = ".env") -> None:
    env_path = ROOT / path
    if not env_path.is_file():
        return
    with env_path.open("r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_dotenv()

from offer_db import db_connection, fetch_all, utc_now_iso

AMAZON_DOMAIN_MAP = {
    "www.amazon.com": "amazon.com",
    "www.amazon.co.uk": "amazon.co.uk",
    "www.amazon.de": "amazon.de",
    "www.amazon.fr": "amazon.fr",
    "www.amazon.ca": "amazon.ca",
    "www.amazon.it": "amazon.it",
    "www.amazon.es": "amazon.es",
    "www.amazon.com.mx": "amazon.com.mx",
    "www.amazon.nl": "amazon.nl",
}

# Country → market fallback when URL is empty
# advert_store_country_name format: e.g. "US/United States(US)" or "UK"
COUNTRY_TO_MARKET = {
    "US": "amazon.com",
    "GB": "amazon.co.uk",
    "UK": "amazon.co.uk",
    "DE": "amazon.de",
    "FR": "amazon.fr",
    "CA": "amazon.ca",
    "IT": "amazon.it",
    "ES": "amazon.es",
    "MX": "amazon.com.mx",
    "NL": "amazon.nl",
}

# Build SQL CASE expression for market extraction from advert URL
# Note: ORDER matters — more specific patterns should come first
# Use %% to escape % for PyMySQL's mogrify
_MARKET_WHEN_SQL = "\n".join(
    f"      WHEN a.advert_url_real LIKE '%%{domain}%%' THEN '{code}'"
    for domain, code in AMAZON_DOMAIN_MAP.items()
)

# Fallback: check redirect domains when advert_url_real is empty
_REDIRECT_WHEN_SQL = "\n".join(
    f"      WHEN a.last_redirect_domain LIKE '%%{domain}%%' THEN '{code}'"
    for domain, code in AMAZON_DOMAIN_MAP.items()
)

# Fallback: check advert_store_country_name from advert_all
_COUNTRY_WHEN_SQL = "\n".join(
    f"      WHEN aa.advert_store_country_name LIKE '{code.upper()}%%' THEN '{market}'"
    for code, market in COUNTRY_TO_MARKET.items()
)

# ── 防止 LEFT JOIN 行倍增的去重子查询 ──────────────────────────
# cnpscy_advert / cnpscy_advert_all 可能存在多条 advert_id 记录，
# 直接 LEFT JOIN 会导致 cnpscy_amazon_order 的行被复制，SUM 翻倍。
# 用 GROUP BY advert_id 确保每个 advert 只参与一次 JOIN。
_ADVERT_SUBQ = """(
    SELECT advert_id,
           MIN(advert_url_real) AS advert_url_real,
           MIN(last_redirect_domain) AS last_redirect_domain,
           MIN(advert_name) AS advert_name,
           MIN(advert_advertiser) AS advert_advertiser
    FROM cnpscy_advert
    GROUP BY advert_id
)"""

_ADVERT_ALL_SUBQ = """(
    SELECT advert_id,
           MIN(advert_store_country_name) AS advert_store_country_name
    FROM cnpscy_advert_all
    GROUP BY advert_id
)"""

# ── clicks 来源：cnpscy_amazon_click（直接按 user_id 聚合）───────
# clicks 的权威数据源是 cnpscy_amazon_click 表。
# 该表直接有 user_id 字段（媒体id），可直接按 user_id + marketplace 聚合。
# 不再需要按订单占比分配。

# 每个 user（Publisher）的总 clicks，按市场分组
CLICK_USER_SQL = """
SELECT c.user_id, c.marketplace, SUM(c.click) AS total_clicks
FROM cnpscy_amazon_click c
WHERE c.click IS NOT NULL AND c.click > 0
  AND c.user_id IS NOT NULL AND c.user_id > 0
  AND c.marketplace IS NOT NULL AND c.marketplace != ''
GROUP BY c.user_id, c.marketplace
"""

# 每个 user 的每日 clicks（按 user_id + marketplace + day）
CLICK_USER_DAILY_SQL = """
SELECT c.user_id, c.marketplace, CAST(c.time_day AS CHAR) AS day, SUM(c.click) AS day_clicks
FROM cnpscy_amazon_click c
WHERE c.click IS NOT NULL AND c.click > 0
  AND c.user_id IS NOT NULL AND c.user_id > 0
  AND c.marketplace IS NOT NULL AND c.marketplace != ''
  AND c.time_day IS NOT NULL AND c.time_day > 0
GROUP BY c.user_id, c.marketplace, c.time_day
"""

AGG_SQL = f"""
SELECT
  o.user_id,
  CASE
{_MARKET_WHEN_SQL}
{_REDIRECT_WHEN_SQL}
{_COUNTRY_WHEN_SQL}
      ELSE 'Unknown'
  END AS market,
  0 AS clicks,  -- 占位，将在 Python 中按比例分配覆盖
  SUM(o.detail_page_views) AS dpv,
  SUM(o.add_to_carts) AS atc,
  SUM(o.total_purchases) AS orders,
  SUM(o.amount) AS sales,
  SUM(o.payout) AS all_commission,
  SUM(o.aff_payout) AS aff_commission
FROM cnpscy_amazon_order o
LEFT JOIN {_ADVERT_SUBQ} a ON o.advert_id = a.advert_id
LEFT JOIN {_ADVERT_ALL_SUBQ} aa ON o.advert_id = aa.advert_id
WHERE o.user_id IS NOT NULL AND o.user_id > 0
GROUP BY o.user_id, market
"""

# 查询每个 publisher 关联的联盟（network）
NETWORK_SQL = f"""
SELECT DISTINCT o.user_id, TRIM(at.advert_type_name) AS network
FROM cnpscy_amazon_order o
LEFT JOIN {_ADVERT_SUBQ} a ON o.advert_id = a.advert_id
LEFT JOIN cnpscy_advert_type at
    ON a.advert_advertiser = at.advert_type_id AND at.advert_type_parent_id = 53
WHERE o.user_id IS NOT NULL AND o.user_id > 0
  AND at.advert_type_name IS NOT NULL AND TRIM(at.advert_type_name) != ''
"""

# 查询每个 publisher 的链接类型（product / storefront）
# Amazon 商品链接的常见模式：/dp/ASIN, /gp/product/ASIN, /exec/obidos/ASIN, &asin= 参数
LINK_TYPE_SQL = f"""
SELECT
  o.user_id,
  CASE
    WHEN a.advert_url_real LIKE '%%/dp/%%' THEN 'product'
    WHEN a.advert_url_real LIKE '%%/gp/product/%%' THEN 'product'
    WHEN a.advert_url_real LIKE '%%/exec/obidos/%%' THEN 'product'
    WHEN a.advert_url_real LIKE '%%&asin=%%' THEN 'product'
    WHEN a.advert_url_real LIKE '%%?asin=%%' THEN 'product'
    ELSE 'storefront'
  END AS link_type,
  SUM(o.clicks) AS clicks,
  SUM(o.detail_page_views) AS dpv,
  SUM(o.add_to_carts) AS atc,
  SUM(o.total_purchases) AS orders,
  SUM(o.amount) AS sales,
  SUM(o.payout) AS all_commission,
  SUM(o.aff_payout) AS aff_commission
FROM cnpscy_amazon_order o
LEFT JOIN {_ADVERT_SUBQ} a ON o.advert_id = a.advert_id
WHERE o.user_id IS NOT NULL AND o.user_id > 0
GROUP BY o.user_id, link_type
"""

# 查询每个 publisher 关联的 merchant 轻量索引。
# 完整 AOV / category / commission 指标由按需 portfolio API 从数据库读取，
# 避免把相同的商家明细重复塞进全量 publisher 缓存。
MERCHANT_SQL = f"""
SELECT DISTINCT o.user_id, a.advert_id AS merchant_id, a.advert_name AS merchant_name
FROM cnpscy_amazon_order o
LEFT JOIN {_ADVERT_SUBQ} a ON o.advert_id = a.advert_id
WHERE o.user_id IS NOT NULL AND o.user_id > 0
  AND a.advert_id IS NOT NULL AND a.advert_id > 0
"""

# 按天聚合（用于前端精确日期筛选）
DAILY_SQL = f"""
SELECT
  o.user_id,
  CAST(o.order_time_day AS CHAR) AS day,
  CASE
{_MARKET_WHEN_SQL}
{_REDIRECT_WHEN_SQL}
{_COUNTRY_WHEN_SQL}
      ELSE 'Unknown'
  END AS market,
  0 AS clicks,  -- 占位，将在 Python 中按比例分配覆盖
  SUM(o.detail_page_views) AS dpv,
  SUM(o.add_to_carts) AS atc,
  SUM(o.total_purchases) AS orders,
  SUM(o.amount) AS sales,
  SUM(o.payout) AS all_commission,
  SUM(o.aff_payout) AS aff_commission
FROM cnpscy_amazon_order o
LEFT JOIN {_ADVERT_SUBQ} a ON o.advert_id = a.advert_id
LEFT JOIN {_ADVERT_ALL_SUBQ} aa ON o.advert_id = aa.advert_id
WHERE o.user_id IS NOT NULL AND o.user_id > 0
  AND o.order_time_day IS NOT NULL
GROUP BY o.user_id, day, market
"""

CACHE_FILE = ROOT / "protected_data" / "db_publishers_cache.json"


def build_publishers_payload() -> dict:
    with db_connection() as conn:
        # 1) 查询聚合后的订单数据（MySQL 端 GROUP BY user_id, market）
        rows = fetch_all(conn, AGG_SQL)

        # 1b) 从 cnpscy_amazon_click 表直接按 (user_id, marketplace) 聚合 clicks
        #     click 表有 user_id 字段，可直接归因，无需按订单占比推算。
        click_user_rows = fetch_all(conn, CLICK_USER_SQL)
        user_market_clicks: dict[tuple[int, str], int] = {}
        for r in click_user_rows:
            uid = int(r["user_id"])
            market = str(r["marketplace"])
            user_market_clicks[(uid, market)] = int(r["total_clicks"] or 0)

        # ── 按 (user_id, marketplace, day) 聚合每日 clicks ──
        click_daily_user_rows = fetch_all(conn, CLICK_USER_DAILY_SQL)
        daily_click_map: dict[tuple[int, str, str], int] = {}  # (uid, market, day) -> clicks
        for r in click_daily_user_rows:
            uid = int(r["user_id"])
            market = str(r["marketplace"])
            day_raw = str(r["day"]).strip()
            if len(day_raw) < 8:
                continue
            day_key = f"{day_raw[:4]}-{day_raw[4:6]}-{day_raw[6:8]}"
            daily_click_map[(uid, market, day_key)] = int(r["day_clicks"] or 0)

        # 2) 获取所有用户和管理员映射
        admins_map = _load_admin_map(conn)

        # 3) 查询每个 publisher 的联盟（network）
        network_rows = fetch_all(conn, NETWORK_SQL)
        networks_by_user: dict[int, list[str]] = {}
        for nr in network_rows:
            uid = int(nr["user_id"])
            net = str(nr["network"]).strip()
            if net:
                networks_by_user.setdefault(uid, []).append(net)

        # 4) 查询每个 publisher 的链接类型
        link_type_rows = fetch_all(conn, LINK_TYPE_SQL)
        link_types_by_user: dict[int, dict[str, dict]] = {}
        for lr in link_type_rows:
            uid = int(lr["user_id"])
            lt = str(lr["link_type"]).strip()
            if lt:
                if uid not in link_types_by_user:
                    link_types_by_user[uid] = {}
                link_types_by_user[uid][lt] = {
                    "clicks": int(lr["clicks"] or 0),
                    "dpv": int(lr["dpv"] or 0),
                    "atc": int(lr["atc"] or 0),
                    "orders": int(lr["orders"] or 0),
                    "sales": float(lr["sales"] or 0),
                    "allCommission": float(lr["all_commission"] or 0),
                    "affCommission": float(lr["aff_commission"] or 0),
                }

        # 5) 查询每个 publisher 关联的 merchants
        merchant_rows = fetch_all(conn, MERCHANT_SQL)
        merchants_by_user: dict[int, list[dict]] = {}
        merchant_name_map: dict[int, str] = {}
        for merchant_row in merchant_rows:
            user_id = int(merchant_row["user_id"])
            merchant_id = int(merchant_row["merchant_id"])
            merchant_name = str(merchant_row["merchant_name"] or "")
            merchants_by_user.setdefault(user_id, []).append(
                {"merchantId": merchant_id, "merchantName": merchant_name}
            )
            merchant_name_map.setdefault(merchant_id, merchant_name)

        # 6) 查询按天聚合数据（用于前端精确日期筛选）
        daily_rows = fetch_all(conn, DAILY_SQL)

        daily_data: dict[str, list[dict]] = {}  # "2026-07-10" -> rows
        days_set: set[str] = set()
        for dr in daily_rows:
            uid = int(dr["user_id"])
            day_raw = str(dr["day"]).strip()
            if not day_raw or len(day_raw) < 8:
                continue
            # 格式化为 YYYY-MM-DD
            day_key = f"{day_raw[:4]}-{day_raw[4:6]}-{day_raw[6:8]}"
            days_set.add(day_key)
            if day_key not in daily_data:
                daily_data[day_key] = []
            market = str(dr["market"])
            # 用 click 表的直接聚合值覆盖 DAILY_SQL 占位
            daily_click = daily_click_map.get((uid, market, day_key), 0)
            daily_data[day_key].append({
                "userId": uid,
                "market": market,
                "clicks": daily_click,
                "dpv": int(dr["dpv"] or 0),
                "atc": int(dr["atc"] or 0),
                "orders": int(dr["orders"] or 0),
                "sales": float(dr["sales"] or 0),
                "allCommission": float(dr["all_commission"] or 0),
                "affCommission": float(dr["aff_commission"] or 0),
            })

        # 补充 click-only 日期：click 表有数据但 order 表无对应行
        for (uid, market, day_key), click_val in daily_click_map.items():
            if click_val <= 0:
                continue
            days_set.add(day_key)
            if day_key not in daily_data:
                daily_data[day_key] = []
            # 检查该 (uid, market, day_key) 是否已在 daily_data 中
            already = any(
                e["userId"] == uid and e["market"] == market
                for e in daily_data.get(day_key, [])
            )
            if not already:
                daily_data[day_key].append({
                    "userId": uid,
                    "market": market,
                    "clicks": click_val,
                    "dpv": 0, "atc": 0, "orders": 0,
                    "sales": 0.0, "allCommission": 0.0, "affCommission": 0.0,
                })

        # 7) 聚合数据: { userId -> { ... } }
        publishers: dict[int, dict] = {}
        summary = {
            "totalPublishers": 0,
            "totalClicks": 0, "totalDpv": 0, "totalAtc": 0, "totalOrders": 0,
            "totalSales": 0.0, "totalAllCommission": 0.0, "totalAffCommission": 0.0,
        }
        markets_set: set[str] = set()
        all_networks_set: set[str] = set()
        all_link_types_set: set[str] = set()

        for row in rows:
            uid = int(row["user_id"])
            market = str(row["market"])
            markets_set.add(market)

            if uid not in publishers:
                networks = networks_by_user.get(uid, [])
                link_types = link_types_by_user.get(uid, {})
                merchants = merchants_by_user.get(uid, [])
                for net in networks:
                    all_networks_set.add(net)
                for lt in link_types:
                    all_link_types_set.add(lt)

                publishers[uid] = {
                    "userId": uid,
                    "userName": str(uid),
                    "adminName": "Unknown",
                    "networks": sorted(set(networks)),
                    "linkTypes": link_types,
                    "merchantIds": sorted(set(m["merchantId"] for m in merchants)),
                    "markets": {},
                    "total": {"clicks": 0, "dpv": 0, "atc": 0, "orders": 0,
                              "sales": 0.0, "allCommission": 0.0, "affCommission": 0.0},
                }

            # 用比例分配的 clicks 覆盖 AGG_SQL 占位值
            row["clicks"] = user_market_clicks.get((uid, market), 0)

            pub = publishers[uid]
            _accumulate(pub["total"], row)
            if market not in pub["markets"]:
                pub["markets"][market] = {"clicks": 0, "dpv": 0, "atc": 0, "orders": 0,
                                          "sales": 0.0, "allCommission": 0.0, "affCommission": 0.0}
            _accumulate(pub["markets"][market], row)

        # 7) 填充用户名称和经理信息
        _fill_user_info(conn, publishers, admins_map)

        # 8) 计算 summary
        for pub in publishers.values():
            summary["totalClicks"] += pub["total"]["clicks"]
            summary["totalDpv"] += pub["total"]["dpv"]
            summary["totalAtc"] += pub["total"]["atc"]
            summary["totalOrders"] += pub["total"]["orders"]
            summary["totalSales"] += pub["total"]["sales"]
            summary["totalAllCommission"] += pub["total"]["allCommission"]
            summary["totalAffCommission"] += pub["total"]["affCommission"]
        summary["totalPublishers"] = len(publishers)

        # 清理 publisher 层级中的 Unknown 市场条目
        for pub in publishers.values():
            pub["markets"].pop("Unknown", None)

        payload = {
            "generatedAt": utc_now_iso(),
            "publishers": sorted(publishers.values(), key=lambda p: p["total"]["clicks"], reverse=True),
            "summary": summary,
            "markets": sorted(m for m in markets_set if m != "Unknown"),
            "networks": sorted(all_networks_set),
            "linkTypes": sorted(all_link_types_set),
            "merchantNameMap": {str(k): v for k, v in merchant_name_map.items()},
            "days": sorted(days_set),
            "dailyRows": daily_data,
        }
        return payload


def _accumulate(target: dict, row: dict) -> None:
    target["clicks"] += int(row["clicks"] or 0)
    target["dpv"] += int(row["dpv"] or 0)
    target["atc"] += int(row["atc"] or 0)
    target["orders"] += int(row["orders"] or 0)
    target["sales"] += float(row["sales"] or 0)
    target["allCommission"] += float(row["all_commission"] or 0)
    target["affCommission"] += float(row["aff_commission"] or 0)


def _load_admin_map(conn) -> dict[str, str]:
    """admin_code -> admin_name"""
    rows = fetch_all(
        conn,
        "SELECT admin_code, admin_name FROM cnpscy_admins WHERE is_delete = 0 AND admin_code IS NOT NULL AND admin_code != ''"
    )
    return {str(r["admin_code"]).strip(): str(r["admin_name"]) for r in rows}


def _fill_user_info(conn, publishers: dict, admins_map: dict[str, str]) -> None:
    """批量查询用户名称和管理员"""
    uids = list(publishers.keys())
    if not uids:
        return
    placeholders = ", ".join(["%s"] * len(uids))
    rows = fetch_all(
        conn,
        f"SELECT user_id, user_name, admin_id_look FROM v_maxai_cnpscy_user WHERE user_id IN ({placeholders})",
        tuple(uids),
    )
    for row in rows:
        uid = int(row["user_id"])
        if uid in publishers:
            publishers[uid]["userName"] = str(row["user_name"] or uid)
            admin_code = str(row["admin_id_look"] or "").strip()
            publishers[uid]["adminName"] = admins_map.get(admin_code, "Unknown")


def main():
    payload = build_publishers_payload()
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = CACHE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, default=str), encoding="utf-8")
    tmp.replace(CACHE_FILE)
    print(f"OK: {CACHE_FILE} ({len(payload['publishers'])} publishers, {len(payload['markets'])} markets)")


if __name__ == "__main__":
    main()
