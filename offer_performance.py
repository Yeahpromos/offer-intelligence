"""Read-only, campaign-window reporting. Workbook membership is not attribution."""
import datetime as dt
import json
import re
import math
from pathlib import Path

import offer_db as db

METRICS = ("revenue", "clicks", "dpv", "atc", "orders", "commission")
ORDER_FIELDS = {
    "revenue": ["amount", "sales_amount", "revenue"],
    "clicks": ["total_clicks", "clicks", "click_num"],
    "dpv": ["detail_page_views", "dpv"], "atc": ["add_to_carts", "atc"],
    "orders": ["total_purchases", "orders", "order_count"],
    "commission": ["payout", "commission"],
}


def catalog():
    return json.loads((Path(__file__).parent / "protected_data/offer_promotion_batches.json").read_text(encoding="utf-8"))


def date_window(launch_date=None, start_date=None, end_date=None):
    def parse(value):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(value or "")):
            raise ValueError("Dates must use YYYY-MM-DD")
        return dt.date.fromisoformat(value)
    if bool(start_date) != bool(end_date):
        raise ValueError("Provide both startDate and endDate")
    start = parse(start_date or launch_date)
    end = parse(end_date) if end_date else start + dt.timedelta(days=6)
    days = (end - start).days + 1
    if not 1 <= days <= 92:
        raise ValueError("Choose a period of 1 to 92 days")
    return {"startDate": start.isoformat(), "endDate": end.isoformat(), "days": days,
            "beforeStart": (start - dt.timedelta(days=days)).isoformat(),
            "beforeEnd": (start - dt.timedelta(days=1)).isoformat()}


def month_keys(start):
    date = dt.date.fromisoformat(start).replace(day=1)
    months = []
    for _ in range(6):
        date = (date - dt.timedelta(days=1)).replace(day=1)
        months.append(date.strftime("%Y-%m"))
    return list(reversed(months))


def target_identity(row):
    """Only record-level destination evidence identifies the promoted target.

    A merchant's default URL or a purchased ASIN cannot establish which link a
    publisher promoted. Keep purchased items separate and unknown links unknown.
    """
    asin = str(row.get("target_asin") or "").strip().upper()
    url = str(row.get("target_url") or "").strip()
    kind = str(row.get("link_type") or "").strip().lower()
    if not re.fullmatch(r"B[A-Z0-9]{9}", asin):
        match = re.search(r"(?:/dp/|/gp/product/|[?&]asin=)(B[A-Z0-9]{9})(?:[/?&#]|$)", url, re.I)
        asin = match.group(1).upper() if match else ""
    if asin:
        return "asin", asin
    if kind in {"storefront", "store", "brand_store"} or re.search(r"/(?:stores|shop)/", url, re.I):
        return "storefront", ""
    return "unknown", ""


def _latest_date(conn, table, columns):
    day = db.pick_column(columns, ["order_time_day", "time_day", "click_time_day", "order_date", "date"])
    if not day:
        return None
    latest = db.fetch_all(conn, f"SELECT MAX({db._normalized_date_key_sql('r', day)}) AS latest FROM {db.q(table)} r")
    return db.normalize_day(latest[0].get("latest")) if latest else None


def _read(conn, table, columns, ids, start, end, fields, detail=False, monthly=False, period_window=None, known_watermark=None):
    merchant = db.pick_column(columns, ["advert_id", "merchant_id"])
    day = db.pick_column(columns, ["order_time_day", "time_day", "click_time_day", "order_date", "date"])
    if not merchant or not day:
        return [], {}, None
    date_expr = db._normalized_date_key_sql("r", day)
    day_expr = f"LEFT(CAST({date_expr} AS CHAR), 6)" if monthly else date_expr
    if period_window:
        # Relationship queries need two totals per edge, not a row per edge/day.
        anchor = int(period_window["startDate"].replace("-", ""))
        before = int(period_window["beforeStart"].replace("-", ""))
        day_expr = f"CASE WHEN {date_expr} < {anchor} THEN {before} ELSE {anchor} END"
        end = min(end, known_watermark)
    select = [f"CAST(r.{db.q(merchant)} AS CHAR) AS merchantId", f"{day_expr} AS day"]
    group = [f"r.{db.q(merchant)}", day_expr]
    supported = {}
    for metric in METRICS:
        column = db.pick_column(columns, fields.get(metric, []))
        supported[metric] = bool(column)
        select.append(f"SUM(COALESCE(r.{db.q(column)}, 0)) AS {db.q(metric)}" if column else f"NULL AS {db.q(metric)}")
    if detail:
        for alias, candidates in {
            "publisherId": ["user_id", "publisher_id", "media_id"],
            "target_asin": ["promoted_asin", "target_asin", "link_asin"],
            "target_url": ["tracking_url", "destination_url", "target_url", "link_url"],
            "link_type": ["link_type", "linkType"],
            "purchasedAsin": ["asin", "product_asin", "item_asin", "amazon_asin"] if table == "cnpscy_amazon_order" else [],
        }.items():
            column = db.pick_column(columns, candidates)
            expr = f"COALESCE(CAST(r.{db.q(column)} AS CHAR), '')" if column else "''"
            select.append(f"{expr} AS {db.q(alias)}")
            if column:
                group.append(expr)
    placeholders = ",".join(["%s"] * len(ids))
    rows = db.fetch_all(conn, f"SELECT {', '.join(select)} FROM {db.q(table)} r "
                        f"WHERE r.{db.q(merchant)} IN ({placeholders}) AND {date_expr} BETWEEN %s AND %s "
                        f"GROUP BY {', '.join(group)} LIMIT 25001",
                        (*ids, int(start.replace("-", "")), int(end.replace("-", ""))))
    if len(rows) > 25000:
        raise ValueError("Too many detail rows; choose a shorter date range")
    # A watermark describes observed data recency, not proven ingestion completeness.
    watermark = known_watermark or _latest_date(conn, table, columns)
    return rows, supported, watermark


def _empty(supported):
    return {key: 0 if supported.get(key) else None for key in METRICS}


def _add(target, row, supported):
    for key in METRICS:
        if supported.get(key) and row.get(key) is not None:
            value = float(row.get(key) or 0)
            if not math.isfinite(value):
                raise ValueError("Reporting source contains a non-finite metric")
            target[key] = round((target.get(key) or 0) + value, 6)


def _mask_pending(item, window, watermark):
    for period, first in (("before", window["beforeStart"]), ("after", window["startDate"])):
        if not watermark or watermark < first:
            item[period] = dict.fromkeys(METRICS)


def summarize(rows, ids, window, supported, monthly_rows=(), watermark=None):
    result = {mid: {"merchantId": mid, "before": _empty(supported), "after": _empty(supported), "daily": [], "monthly": []} for mid in ids}
    daily = {}
    monthly = {}
    for row in rows:
        mid, day = str(row["merchantId"]), db.normalize_day(row["day"])
        if mid not in result or not day or not window["beforeStart"] <= day <= window["endDate"] or (watermark and day > watermark):
            continue
        key = (mid, day)
        _add(daily.setdefault(key, _empty(supported)), row, supported)
    for (mid, day), metrics in sorted(daily.items()):
        result[mid]["daily"].append({"date": day, **metrics})
        period = "after" if window["startDate"] <= day <= window["endDate"] else "before"
        _add(result[mid][period], metrics, supported)
    for row in monthly_rows:
        mid, month = str(row["merchantId"]), str(row["day"])
        if mid in result:
            month = month[:4] + "-" + month[4:6] if "-" not in month else month[:7]
            _add(monthly.setdefault((mid, month), _empty(supported)), row, supported)
    for mid, target in result.items():
        _mask_pending(target, window, watermark)
        for month in month_keys(window["startDate"]):
            first = dt.date.fromisoformat(month + "-01")
            last = ((first + dt.timedelta(days=32)).replace(day=1) - dt.timedelta(days=1)).isoformat()
            metrics = monthly.get((mid, month), _empty(supported)) if watermark and last <= watermark else dict.fromkeys(METRICS)
            target["monthly"].append({"month": month, **metrics})
    return list(result.values())


def summarize_details(rows, window, supported, watermark):
    media, links = {}, {}
    for row in rows:
        day = db.normalize_day(row["day"])
        if not day or not window["beforeStart"] <= day <= window["endDate"] or (watermark and day > watermark):
            continue
        period = "after" if window["startDate"] <= day <= window["endDate"] else "before"
        mid = str(row["merchantId"])
        uid = str(row.get("publisherId") or "")
        kind, asin = target_identity(row)
        purchased = str(row.get("purchasedAsin") or "").strip().upper()
        if not re.fullmatch(r"B[A-Z0-9]{9}", purchased):
            purchased = ""
        for bucket, key in ((media, (mid, uid)), (links, (mid, uid, kind, asin, purchased))):
            item = bucket.setdefault(key, {"merchantId": mid, "publisherId": uid, "linkType": kind, "asin": asin, "purchasedAsin": purchased,
                                          "before": _empty({}), "after": _empty({})})
            _add(item[period], row, supported)
    for item in list(media.values()) + list(links.values()):
        _mask_pending(item, window, watermark)
    return list(media.values()), list(links.values())


def report(query):
    value = lambda key: db.first_query_value(query, key)
    if value("action") == "catalog":
        return {"ok": True, **catalog()}
    batch = next((b for b in catalog()["batches"] if b["id"] == value("batchId")), None)
    raw_ids = value("merchantIds") or ",".join(o["merchantId"] for o in (batch or {}).get("offers", []))
    ids = list(dict.fromkeys(raw_ids.split(",")))
    if not 1 <= len(ids) <= 200 or any(not re.fullmatch(r"[1-9]\d{0,12}", mid) for mid in ids):
        raise ValueError("Provide 1 to 200 valid Merchant IDs")
    selected = value("merchantId")
    cohort_relations = value("action") == "relations"
    include_relations = bool(selected) or cohort_relations
    if selected and selected not in ids:
        raise ValueError("Selected merchant is outside this batch")
    if selected:
        ids = [selected]
    window = date_window(value("launchDate") or (batch or {}).get("launchDate"), value("startDate"), value("endDate"))
    months = month_keys(window["startDate"])
    history_end = (dt.date.fromisoformat(window["startDate"]).replace(day=1) - dt.timedelta(days=1)).isoformat()
    with db.db_connection() as conn:
        order_cols = db.table_columns(conn, "cnpscy_amazon_order")
        click_cols = db.table_columns(conn, "cnpscy_amazon_click")
        # Choose a single clicks source for all periods and dimensions, never add both.
        has_clicks = all(db.pick_column(click_cols, c) for c in (["advert_id", "merchant_id"], ["time_day", "click_time_day", "date"], ["click", "clicks"]))
        relation_options = {}
        if cohort_relations:
            source_dates = [_latest_date(conn, "cnpscy_amazon_order", order_cols)]
            if has_clicks:
                source_dates.append(_latest_date(conn, "cnpscy_amazon_click", click_cols))
            if any(not day for day in source_dates):
                raise RuntimeError("Reporting sources have no dated records")
            safe_end = (db.reporting_today() - dt.timedelta(days=db.DEFAULT_REPORTING_DELAY_DAYS)).isoformat()
            relation_options = {"period_window": window, "known_watermark": min(*source_dates, safe_end)}
        order_fields = {k: v for k, v in ORDER_FIELDS.items() if k != "clicks" or not has_clicks}
        rows, supported, order_watermark = _read(conn, "cnpscy_amazon_order", order_cols, ids, window["beforeStart"], window["endDate"], order_fields, include_relations, **relation_options)
        if not supported.get("revenue"):
            raise RuntimeError("Amazon reporting columns are unavailable")
        if not order_watermark:
            raise RuntimeError("Amazon reporting source has no dated records")
        watermarks = [order_watermark]
        if has_clicks:
            click_rows, _, click_watermark = _read(conn, "cnpscy_amazon_click", click_cols, ids, window["beforeStart"], window["endDate"], {"clicks": ["click", "clicks"]}, include_relations, **relation_options)
            rows += click_rows
            supported["clicks"] = True
            if not click_watermark:
                raise RuntimeError("Click reporting source has no dated records")
            watermarks.append(click_watermark)
        watermark = min(watermarks) if watermarks else None
        # Future dates and the configured reporting lag are never represented as zeros.
        safe_end = (db.reporting_today() - dt.timedelta(days=db.DEFAULT_REPORTING_DELAY_DAYS)).isoformat()
        watermark = min(watermark, safe_end) if watermark else safe_end
        history = []
        if not include_relations:
            history, _, _ = _read(conn, "cnpscy_amazon_order", order_cols, ids, months[0] + "-01", history_end, order_fields, monthly=True)
            if has_clicks:
                hclicks, _, _ = _read(conn, "cnpscy_amazon_click", click_cols, ids, months[0] + "-01", history_end, {"clicks": ["click", "clicks"]}, monthly=True)
                history += hclicks
        result = {"ok": True, "dateRange": window, "availableThrough": watermark, "generatedAt": db.utc_now_iso(),
                  "supported": supported, "clickSource": "cnpscy_amazon_click" if has_clicks else "cnpscy_amazon_order", "merchants": summarize(rows, ids, window, supported, history, watermark)}
        if cohort_relations:
            result["aggregation"] = "period"
            for merchant in result["merchants"]:
                merchant["daily"] = []
        if include_relations:
            for merchant in result["merchants"]:
                merchant["monthly"] = []
            media, links = summarize_details(rows, window, supported, watermark)
            user_ids = [uid for uid in {x["publisherId"] for x in media} if uid.isdigit() and int(uid) > 0]
            names = {}
            if user_ids:
                users = db.fetch_all(conn, "SELECT CAST(user_id AS CHAR) AS id, MAX(user_name) AS name FROM v_maxai_cnpscy_user WHERE user_id IN (" + ",".join(["%s"] * len(user_ids)) + ") GROUP BY user_id", tuple(user_ids))
                names = {str(u["id"]): u["name"] for u in users}
            for row in media + links:
                row["publisherName"] = names.get(row["publisherId"], row["publisherId"])
            result.update({"media": media, "links": links})
        return result
