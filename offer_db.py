from __future__ import annotations

import datetime as dt
import gzip
import hmac
import json
import os
import re
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse



ROOT = Path(__file__).resolve().parent
IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9_]+$")
DIGITS_RE = re.compile(r"^\d+$")
TABLE_COLUMNS_CACHE: dict[str, set[str]] = {}

DB_ENV_KEYS = (
    "OFFER_DB_HOST",
    "OFFER_DB_NAME",
    "OFFER_DB_USER",
    "OFFER_DB_PASSWORD",
)
REPORTING_TZ = dt.timezone(dt.timedelta(hours=8))
DEFAULT_REPORTING_DELAY_DAYS = 2
DEFAULT_DAILY_TREND_DAYS = 14
DEFAULT_MONTHLY_TREND_MONTHS = 6
MAX_TIER_REPORT_RANGE_DAYS = 366


class OfferDbError(RuntimeError):
    status = 502
    public_message = "Database query failed"


class OfferDbConfigError(OfferDbError):
    status = 503
    public_message = "Offer database is not configured"


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def send_json(target, status: int, payload: Any, methods: str = "GET, OPTIONS") -> None:
    body = b"" if status == 204 else _json_bytes(payload)
    # Gzip compression for large payloads (>1KB) when client supports it
    accepts_gzip = "gzip" in (getattr(target, "headers", None) or {}).get("Accept-Encoding", "")
    did_compress = False
    if accepts_gzip and len(body) > 1024:
        body = gzip.compress(body, compresslevel=6)
        did_compress = True
    target.send_response(status)
    target.send_header("Access-Control-Allow-Origin", "*")
    target.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Offer-Db-Token")
    target.send_header("Access-Control-Allow-Methods", methods)
    target.send_header("Cache-Control", "no-store")
    target.send_header("Content-Type", "application/json; charset=utf-8")
    if did_compress:
        target.send_header("Content-Encoding", "gzip")
        target.send_header("Vary", "Accept-Encoding")
    target.send_header("Content-Length", str(len(body)))
    target.end_headers()
    if body:
        target.wfile.write(body)


def handle_options(target, methods: str = "GET, OPTIONS") -> None:
    send_json(target, 204, {}, methods=methods)


def parse_query(target) -> dict[str, list[str]]:
    return parse_qs(urlparse(target.path).query)


def first_query_value(query: dict[str, list[str]], key: str, default: str = "") -> str:
    values = query.get(key) or []
    return str(values[0]).strip() if values else default


def int_query_value(query: dict[str, list[str]], key: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(first_query_value(query, key, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def _client_token(headers) -> str:
    auth = (headers.get("Authorization") or headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return (headers.get("X-Offer-Db-Token") or headers.get("x-offer-db-token") or "").strip()


def require_db_token(target) -> bool:
    expected = os.environ.get("OFFER_DB_API_TOKEN", "").strip()
    if not expected:
        send_json(
            target,
            503,
            {
                "ok": False,
                "configured": False,
                "error": "OFFER_DB_API_TOKEN is not configured",
            },
        )
        return False
    if hmac.compare_digest(_client_token(target.headers), expected):
        return True
    send_json(target, 401, {"ok": False, "configured": True, "error": "Offer DB API token is required"})
    return False


def public_error_payload(error: BaseException) -> dict[str, Any]:
    if isinstance(error, OfferDbConfigError):
        message = error.public_message
        status = error.status
    elif isinstance(error, OfferDbError):
        message = error.public_message
        status = error.status
    else:
        message = "Database query failed"
        status = 502

    payload: dict[str, Any] = {"ok": False, "error": message}
    if os.environ.get("OFFER_DB_DEBUG_ERRORS", "").strip() == "1":
        payload["detail"] = str(error)[:500]
    payload["status"] = status
    return payload


def send_db_error(target, error: BaseException) -> None:
    payload = public_error_payload(error)
    status = int(payload.pop("status", 502))
    send_json(target, status, payload)


def _import_pymysql():
    try:
        import pymysql  # type: ignore

        return pymysql
    except ImportError as exc:
        raise OfferDbConfigError("PyMySQL is not installed; install requirements.txt") from exc


def db_config() -> dict[str, Any]:
    missing = [key for key in DB_ENV_KEYS if not os.environ.get(key, "").strip()]
    if missing:
        raise OfferDbConfigError(f"Missing database environment variables: {', '.join(missing)}")
    try:
        port = int(os.environ.get("OFFER_DB_PORT", "3306"))
    except ValueError as exc:
        raise OfferDbConfigError("OFFER_DB_PORT must be an integer") from exc
    return {
        "host": os.environ["OFFER_DB_HOST"].strip(),
        "port": port,
        "database": os.environ["OFFER_DB_NAME"].strip(),
        "user": os.environ["OFFER_DB_USER"].strip(),
        "password": os.environ["OFFER_DB_PASSWORD"],
        "charset": "utf8mb4",
        "connect_timeout": int(os.environ.get("OFFER_DB_CONNECT_TIMEOUT", "10")),
        "read_timeout": int(os.environ.get("OFFER_DB_READ_TIMEOUT", "60")),
        "write_timeout": int(os.environ.get("OFFER_DB_WRITE_TIMEOUT", "60")),
        "autocommit": True,
    }


def connect():
    pymysql = _import_pymysql()
    config = db_config()
    config["cursorclass"] = pymysql.cursors.DictCursor
    return pymysql.connect(**config)


@contextmanager
def db_connection():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def q(name: str) -> str:
    if not IDENTIFIER_RE.match(name):
        raise ValueError(f"Unsafe SQL identifier: {name}")
    return f"`{name}`"


def qualified(alias: str, column: str) -> str:
    return f"{q(alias)}.{q(column)}"


def fetch_all(conn, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with conn.cursor() as cursor:
        cursor.execute(sql, params)
        return list(cursor.fetchall())


def fetch_one(conn, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    with conn.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchone()


def _network_rows_map(rows: list[dict[str, Any]]) -> dict[str, str]:
    result: dict[str, str] = {}
    normalized_rows = sorted(
        (
            str(row.get("merchantId") or "").strip(),
            str(row.get("network") or "").strip(),
        )
        for row in rows
    )
    for merchant_id, network in normalized_rows:
        if merchant_id and network and merchant_id not in result:
            result[merchant_id] = network
    return result


def direct_network_map(conn) -> dict[str, str]:
    """Return network mappings from small indexed advertiser tables.

    Do not query ``cnpscy_advertiser_performance_daily_view`` here. MySQL 5.6
    materializes that view before applying merchant filters, and the resulting
    DISTINCT temporary table can exhaust the server's ``/tmp`` filesystem.
    """
    type_rows = fetch_all(
        conn,
        "SELECT CAST(t.merchantId AS CHAR) AS merchantId, "
        "       TRIM(at.advert_type_name) AS network "
        "FROM cnpscy_oi_tier_assignments t "
        "INNER JOIN cnpscy_advert a ON a.advert_id = CAST(t.merchantId AS UNSIGNED) AND a.advert_isdel = 1 "
        "INNER JOIN cnpscy_advert_type at ON a.advert_advertiser = at.advert_type_id "
        "WHERE at.advert_type_parent_id = 53 "
        "AND at.advert_type_name IS NOT NULL AND TRIM(at.advert_type_name) != ''",
    )
    lianmeng_rows = fetch_all(
        conn,
        "SELECT CAST(t.merchantId AS CHAR) AS merchantId, "
        "       TRIM(al.lianmeng) AS network "
        "FROM cnpscy_oi_tier_assignments t "
        "INNER JOIN cnpscy_advert a ON a.advert_id = CAST(t.merchantId AS UNSIGNED) AND a.advert_isdel = 1 "
        "INNER JOIN cnpscy_advert_lianmeng al ON a.advert_name = al.AdvertiserName "
        "WHERE al.lianmeng IS NOT NULL AND TRIM(al.lianmeng) != ''",
    )
    result = _network_rows_map(type_rows)
    result.update(_network_rows_map(lianmeng_rows))
    return result


def offer_network_fallback_map(
    conn,
    merchant_ids: list[Any],
    previous_cache: dict[str, Any] | None,
) -> dict[str, str]:
    requested = {
        str(int(str(merchant_id).strip()))
        for merchant_id in merchant_ids
        if DIGITS_RE.match(str(merchant_id).strip())
    }
    if not requested:
        return {}

    result: dict[str, str] = {}
    for row in (previous_cache or {}).get("offers", []):
        merchant_id = str(row.get("merchantId") or "").strip()
        network = str(row.get("network") or "").strip()
        if merchant_id in requested and network not in ("", "Unknown"):
            result[merchant_id] = network

    unresolved = requested - set(result)
    if unresolved:
        direct = direct_network_map(conn)
        for merchant_id in unresolved:
            if direct.get(merchant_id):
                result[merchant_id] = direct[merchant_id]
    return result


def table_columns(conn, table: str) -> set[str]:
    if table in TABLE_COLUMNS_CACHE:
        return TABLE_COLUMNS_CACHE[table]
    try:
        rows = fetch_all(conn, f"SHOW COLUMNS FROM {q(table)}")
    except Exception:
        TABLE_COLUMNS_CACHE[table] = set()
        return set()
    columns = {str(row.get("Field")) for row in rows if row.get("Field")}
    TABLE_COLUMNS_CACHE[table] = columns
    return columns


def pick_column(columns: set[str], candidates: list[str]) -> str | None:
    if not columns:
        return None
    lower_map = {column.lower(): column for column in columns}
    for candidate in candidates:
        if candidate in columns:
            return candidate
        lowered = candidate.lower()
        if lowered in lower_map:
            return lower_map[lowered]
    return None


def first_expr(sources: list[tuple[str, set[str]]], candidates: list[str], alias: str, default: str = "NULL") -> str:
    expressions = []
    for table_alias, columns in sources:
        column = pick_column(columns, candidates)
        if column:
            expressions.append(qualified(table_alias, column))
    expression = "COALESCE(" + ", ".join(expressions) + ")" if expressions else default
    return f"{expression} AS {q(alias)}"


def sum_expr(table_alias: str, columns: set[str], candidates: list[str], alias: str) -> str:
    column = pick_column(columns, candidates)
    if not column:
        return f"0 AS {q(alias)}"
    return f"SUM(COALESCE({qualified(table_alias, column)}, 0)) AS {q(alias)}"


def month_expr(table_alias: str, date_column: str) -> str:
    return f"LEFT(CAST({qualified(table_alias, date_column)} AS CHAR), 6)"


def normalize_compact_date(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (dt.datetime, dt.date)):
        return value.date().isoformat() if isinstance(value, dt.datetime) else value.isoformat()
    text = str(value).strip()
    if not text:
        return None
    if re.match(r"^\d{8}$", text):
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    if re.match(r"^\d{6}$", text):
        return f"{text[:4]}-{text[4:6]}"
    return text


def normalize_day(value: Any) -> str | None:
    normalized = normalize_compact_date(value)
    if not normalized:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}", normalized):
        return normalized[:10]
    return None


def parse_day(value: Any) -> dt.date | None:
    normalized = normalize_day(value)
    if not normalized:
        return None
    try:
        return dt.date.fromisoformat(normalized)
    except ValueError:
        return None


def reporting_today() -> dt.date:
    return dt.datetime.now(REPORTING_TZ).date()


def month_start(day: dt.date) -> dt.date:
    return day.replace(day=1)


def month_end(day: dt.date) -> dt.date:
    if day.month == 12:
        return day.replace(year=day.year + 1, month=1, day=1) - dt.timedelta(days=1)
    return day.replace(month=day.month + 1, day=1) - dt.timedelta(days=1)


def parse_month_key(value: str | None) -> dt.date | None:
    text = str(value or "").strip()
    if not re.match(r"^\d{4}-\d{2}$", text):
        return None
    try:
        return dt.date.fromisoformat(f"{text}-01")
    except ValueError:
        return None


def parse_tier_report_date(value: str | None) -> dt.date | None:
    text = str(value or "").strip().replace("/", "-")
    if not text:
        return None
    try:
        return dt.date.fromisoformat(text)
    except ValueError:
        return None


def resolve_tier_report_date_range(
    start_date: str | None = None,
    end_date: str | None = None,
    month: str | None = None,
    reference_date: dt.date | None = None,
) -> tuple[dt.date, dt.date]:
    """Resolve an inclusive YeahPromos Amazon report date range."""
    raw_start = str(start_date or "").strip()
    raw_end = str(end_date or "").strip()
    start = parse_tier_report_date(raw_start)
    end = parse_tier_report_date(raw_end)
    if raw_start and start is None:
        raise ValueError("start_date must use YYYY-MM-DD format")
    if raw_end and end is None:
        raise ValueError("end_date must use YYYY-MM-DD format")

    if start is None and end is None:
        month_day = parse_month_key(month)
        if str(month or "").strip() and month_day is None:
            raise ValueError("month must use YYYY-MM format")
        if month_day:
            start = month_day
            end = month_end(month_day)
        else:
            today = reference_date or reporting_today()
            start = month_start(today)
            end = today
    elif start is None:
        start = end
    elif end is None:
        end = start

    if start > end:
        raise ValueError("start_date cannot be after end_date")
    range_days = (end - start).days + 1
    if range_days > MAX_TIER_REPORT_RANGE_DAYS:
        raise ValueError(f"date range cannot exceed {MAX_TIER_REPORT_RANGE_DAYS} days")
    return start, end


def bounded_int_env(key: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(key, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def normalize_month(value: Any) -> str:
    text = str(value or "").strip()
    if re.match(r"^\d{6}$", text):
        return f"{text[:4]}-{text[4:6]}"
    return text


def to_float(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def clean_decimal(value: Any, places: int = 6) -> float:
    return round(to_float(value), places)


def read_static_merchant_ids() -> list[str]:
    """从 db_offers_cache.json 或 static_merchant_ids.json 读取公开 merchant ID 列表。"""
    ids = []
    seen = set()
    if OFFERS_CACHE_FILE.exists():
        try:
            payload = json.loads(OFFERS_CACHE_FILE.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                for offer in payload.get("offers", []):
                    merchant_id = re.sub(r"\.0$", "", str(offer.get("merchantId") or "").strip())
                    if DIGITS_RE.match(merchant_id) and merchant_id not in seen:
                        ids.append(merchant_id)
                        seen.add(merchant_id)
        except (OSError, json.JSONDecodeError):
            pass
    if ids:
        return ids
    return read_static_merchant_id_manifest().get("merchantIds", [])


def read_static_merchant_id_manifest() -> dict[str, Any]:
    for source in (ROOT / "api" / "static_merchant_ids.json", ROOT / "static_merchant_ids.json"):
        if source.exists():
            try:
                payload = json.loads(source.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            ids = []
            seen = set()
            for value in payload.get("merchantIds", []):
                merchant_id = re.sub(r"\.0$", "", str(value or "").strip())
                if DIGITS_RE.match(merchant_id) and merchant_id not in seen:
                    ids.append(merchant_id)
                    seen.add(merchant_id)
            return {"generatedAt": payload.get("generatedAt"), "merchantIds": ids}
    return {"generatedAt": None, "merchantIds": []}


def chunks(values: list[str], size: int):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def count_distinct_for_ids(conn, table: str, id_candidates: list[str], ids: list[str]) -> dict[str, Any]:
    columns = table_columns(conn, table)
    id_column = pick_column(columns, id_candidates)
    if not id_column:
        return {"available": False, "matched": None, "coverage": None}
    matched = 0
    for batch in chunks(ids, 500):
        placeholders = ", ".join(["%s"] * len(batch))
        row = fetch_one(
            conn,
            f"SELECT COUNT(DISTINCT {q(id_column)}) AS matched FROM {q(table)} WHERE {q(id_column)} IN ({placeholders})",
            tuple(batch),
        )
        matched += int(row["matched"] or 0) if row else 0
    total = len(ids)
    return {
        "available": True,
        "matched": matched,
        "total": total,
        "coverage": round(matched / total, 6) if total else None,
    }


def latest_dates(conn, keys: set[str] | None = None) -> dict[str, Any]:
    sources = {
        "amazonOrders": ("cnpscy_amazon_order", ["order_time_day"]),
        "amazonClicks": ("cnpscy_amazon_click", ["time_day", "click_time_day"]),
        "aggregateOrders": ("cnpscy_order_new_aggregate", ["order_time_day", "time_day"]),
        "products": ("cnpscy_amazon_product", ["updated_at", "update_time", "created_at"]),
        "productExtra": ("cnpscy_amazon_product_extra", ["updated_at", "update_time", "created_at"]),
    }
    output = {}
    for key, (table, candidates) in sources.items():
        if keys is not None and key not in keys:
            continue
        columns = table_columns(conn, table)
        column = pick_column(columns, candidates)
        if not column:
            output[key] = {"available": False, "latest": None}
            continue
        row = fetch_one(conn, f"SELECT MAX({q(column)}) AS latest FROM {q(table)}")
        output[key] = {
            "available": True,
            "table": table,
            "column": column,
            "latest": normalize_compact_date(row.get("latest") if row else None),
        }
    return output


def recent_month_summary(
    conn,
    months: int | None = None,
    end_month: str | None = None,
    include_amazon_orders: bool = True,
) -> dict[str, Any]:
    months = bounded_int_env(
        "OFFER_DB_MONTHLY_TREND_MONTHS",
        months or DEFAULT_MONTHLY_TREND_MONTHS,
        3,
        12,
    )
    today = reporting_today()
    requested_end = parse_month_key(end_month)
    end_period = requested_end or month_start(today)
    if end_period > month_start(today):
        end_period = month_start(today)
    end_day = min(today, month_end(end_period)) if end_period == month_start(today) else month_end(end_period)
    end_index = end_period.year * 12 + end_period.month - 1
    start_index = end_index - months + 1
    start_period = dt.date(start_index // 12, start_index % 12 + 1, 1)
    start_key = start_period.strftime("%Y%m%d")
    end_key = end_day.strftime("%Y%m%d")
    output: dict[str, Any] = {
        "window": {
            "startMonth": start_period.strftime("%Y-%m"),
            "endMonth": end_period.strftime("%Y-%m"),
            "throughDate": end_day.isoformat(),
            "months": months,
        }
    }

    order_cols = table_columns(conn, "cnpscy_amazon_order") if include_amazon_orders else set()
    order_date = pick_column(order_cols, ["order_time_day"])
    order_id = pick_column(order_cols, ["advert_id", "merchant_id"])
    if include_amazon_orders and order_date and order_id:
        month_sql = month_expr("o", order_date)
        rows = fetch_all(
            conn,
            f"""
            SELECT {month_sql} AS month,
                   COUNT(*) AS orderRows,
                   {sum_expr("o", order_cols, ["amount", "sales_amount", "revenue"], "revenue")},
                   {sum_expr("o", order_cols, ["payout", "commission"], "payout")},
                   {sum_expr("o", order_cols, ["aff_payout", "affiliate_payout"], "affiliatePayout")},
                   {sum_expr("o", order_cols, ["clicks", "click_num"], "clicks")},
                   {sum_expr("o", order_cols, ["direct_sales", "directSales", "direct_sale_amount"], "directSales")},
                   {sum_expr("o", order_cols, ["halo_sales", "haloSales", "halo_sale_amount"], "haloSales")}
            FROM {q("cnpscy_amazon_order")} o
            WHERE o.{q(order_date)} BETWEEN %s AND %s
            GROUP BY month
            ORDER BY month DESC
            LIMIT {int(months)}
            """,
            (start_key, end_key),
        )
        output["amazonOrders"] = [format_metric_row(row) for row in rows]

    click_cols = table_columns(conn, "cnpscy_amazon_click")
    click_date = pick_column(click_cols, ["time_day", "click_time_day"])
    click_id = pick_column(click_cols, ["advert_id", "merchant_id"])
    if click_date and click_id:
        month_sql = month_expr("c", click_date)
        rows = fetch_all(
            conn,
            f"""
            SELECT {month_sql} AS month,
                   COUNT(*) AS clickRows,
                   {sum_expr("c", click_cols, ["click", "clicks", "click_num"], "clicks")},
                   {sum_expr("c", click_cols, ["dpv", "dpv_num"], "dpv")},
                   {sum_expr("c", click_cols, ["atc", "atc_num"], "atc")}
            FROM {q("cnpscy_amazon_click")} c
            WHERE c.{q(click_date)} BETWEEN %s AND %s
            GROUP BY month
            ORDER BY month DESC
            LIMIT {int(months)}
            """,
            (start_key, end_key),
        )
        output["amazonClicks"] = [format_metric_row(row) for row in rows]

    aggregate_cols = table_columns(conn, "cnpscy_order_new_aggregate")
    aggregate_date = pick_column(aggregate_cols, ["order_time_day", "time_day"])
    aggregate_id = pick_column(aggregate_cols, ["advert_id", "merchant_id"])
    if aggregate_date and aggregate_id:
        month_sql = month_expr("a", aggregate_date)
        rows = fetch_all(
            conn,
            f"""
            SELECT {month_sql} AS month,
                   COUNT(*) AS aggregateRows,
                   COUNT(DISTINCT {qualified('a', aggregate_id)}) AS {q('activeBrands')},
                   {sum_expr("a", aggregate_cols, ["amount", "sales_amount", "revenue"], "revenue")},
                   {sum_expr("a", aggregate_cols, ["payout", "commission"], "payout")},
                   {sum_expr("a", aggregate_cols, ["order_num", "orders"], "orders")}
            FROM {q("cnpscy_order_new_aggregate")} a
            WHERE a.{q(aggregate_date)} BETWEEN %s AND %s
            GROUP BY month
            ORDER BY month DESC
            LIMIT {int(months)}
            """,
            (start_key, end_key),
        )
        output["aggregateOrders"] = [format_metric_row(row) for row in rows]

    return output


def daily_status_trend(
    conn,
    days: int | None = None,
    delay_days: int | None = None,
    latest: dict[str, Any] | None = None,
    month: str | None = None,
    include_amazon_details: bool = True,
) -> dict[str, Any]:
    days = days or bounded_int_env("OFFER_DB_DAILY_TREND_DAYS", DEFAULT_DAILY_TREND_DAYS, 7, 45)
    delay_days = DEFAULT_REPORTING_DELAY_DAYS if delay_days is None else delay_days
    delay_days = bounded_int_env("OFFER_DB_REPORTING_DELAY_DAYS", delay_days, 0, 7)
    today = reporting_today()
    requested_month = parse_month_key(month)
    if requested_month:
        start = requested_month
        end = min(today, month_end(requested_month)) if requested_month.year == today.year and requested_month.month == today.month else month_end(requested_month)
    else:
        start = max(month_start(today), today - dt.timedelta(days=days - 1))
        end = today
    expected_complete = min(end, today - dt.timedelta(days=delay_days)) if end >= month_start(today) else end
    latest = latest or latest_dates(conn)
    primary_latest = parse_day(((latest.get("aggregateOrders") or {}).get("latest"))) or parse_day(((latest.get("amazonOrders") or {}).get("latest"))) or expected_complete
    click_latest = parse_day(((latest.get("amazonClicks") or {}).get("latest")))
    source_complete_through = min(primary_latest, click_latest) if click_latest else primary_latest
    complete_through = min(source_complete_through, expected_complete)
    bucket: dict[str, dict[str, Any]] = {}
    start_key = start.strftime("%Y%m%d")
    end_key = end.strftime("%Y%m%d")

    aggregate_cols = table_columns(conn, "cnpscy_order_new_aggregate")
    aggregate_date = pick_column(aggregate_cols, ["order_time_day", "time_day"])
    aggregate_id = pick_column(aggregate_cols, ["advert_id", "merchant_id"])
    if aggregate_date:
        active_brand_expr = f"COUNT(DISTINCT {qualified('a', aggregate_id)}) AS {q('activeBrands')}" if aggregate_id else f"0 AS {q('activeBrands')}"
        rows = fetch_all(
            conn,
            f"""
            SELECT CAST(a.{q(aggregate_date)} AS CHAR) AS day,
                   COUNT(*) AS aggregateRows,
                   {active_brand_expr},
                   {sum_expr("a", aggregate_cols, ["order_num", "orders"], "orders")},
                   {sum_expr("a", aggregate_cols, ["amount", "sales_amount", "revenue"], "revenue")},
                   {sum_expr("a", aggregate_cols, ["payout", "commission"], "payout")},
                   {sum_expr("a", aggregate_cols, ["aff_payout", "affiliate_payout"], "affiliatePayout")},
                   {sum_expr("a", aggregate_cols, ["cpc_leads", "leads"], "cpcLeads")}
            FROM {q("cnpscy_order_new_aggregate")} a
            WHERE a.{q(aggregate_date)} BETWEEN %s AND %s
            GROUP BY day
            ORDER BY day ASC
            """,
            (start_key, end_key),
        )
        for row in rows:
            day = normalize_day(row.get("day"))
            if not day:
                continue
            target = bucket.setdefault(day, {})
            for key in ("aggregateRows", "activeBrands", "orders", "revenue", "payout", "affiliatePayout", "cpcLeads"):
                number = to_float(row.get(key))
                target[key] = int(number) if number.is_integer() else round(number, 6)

    order_cols = table_columns(conn, "cnpscy_amazon_order") if include_amazon_details else set()
    order_date = pick_column(order_cols, ["order_time_day"])
    if include_amazon_details and order_date:
        rows = fetch_all(
            conn,
            f"""
            SELECT CAST(o.{q(order_date)} AS CHAR) AS day,
                   COUNT(*) AS orders,
                   {sum_expr("o", order_cols, ["amount", "sales_amount", "revenue"], "revenue")},
                   {sum_expr("o", order_cols, ["payout", "commission"], "payout")},
                   {sum_expr("o", order_cols, ["aff_payout", "affiliate_payout"], "affiliatePayout")},
                   {sum_expr("o", order_cols, ["clicks", "click_num"], "orderClicks")},
                   {sum_expr("o", order_cols, ["detail_page_views", "dpv", "dpv_num"], "dpv")},
                   {sum_expr("o", order_cols, ["add_to_carts", "atc", "atc_num"], "atc")},
                   {sum_expr("o", order_cols, ["direct_sales", "directSales", "direct_sale_amount"], "directSales")},
                   {sum_expr("o", order_cols, ["halo_sales", "haloSales", "halo_sale_amount"], "haloSales")}
            FROM {q("cnpscy_amazon_order")} o
            WHERE o.{q(order_date)} BETWEEN %s AND %s
            GROUP BY day
            ORDER BY day ASC
            """,
            (start_key, end_key),
        )
        for row in rows:
            day = normalize_day(row.get("day"))
            if not day:
                continue
            target = bucket.setdefault(day, {})
            for key in ("orderClicks", "dpv", "atc", "directSales", "haloSales"):
                number = to_float(row.get(key))
                target[key] = int(number) if number.is_integer() else round(number, 6)

    click_cols = table_columns(conn, "cnpscy_amazon_click")
    click_date = pick_column(click_cols, ["time_day", "click_time_day"])
    if click_date:
        rows = fetch_all(
            conn,
            f"""
            SELECT CAST(c.{q(click_date)} AS CHAR) AS day,
                   COUNT(*) AS clickRows,
                   {sum_expr("c", click_cols, ["click", "clicks", "click_num"], "clicks")},
                   {sum_expr("c", click_cols, ["dpv", "dpv_num"], "dpv")},
                   {sum_expr("c", click_cols, ["atc", "atc_num"], "atc")}
            FROM {q("cnpscy_amazon_click")} c
            WHERE c.{q(click_date)} BETWEEN %s AND %s
            GROUP BY day
            ORDER BY day ASC
            """,
            (start_key, end_key),
        )
        for row in rows:
            day = normalize_day(row.get("day"))
            if not day:
                continue
            target = bucket.setdefault(day, {})
            for key in ("clickRows", "clicks", "dpv", "atc"):
                number = to_float(row.get(key))
                if key in {"dpv", "atc"} and not number and target.get(key):
                    continue
                target[key] = int(number) if number.is_integer() else round(number, 6)
            if not target.get("clicks") and target.get("clickRows"):
                target["clicks"] = target["clickRows"]

    rows: list[dict[str, Any]] = []
    current = start
    while current <= end:
        key = current.isoformat()
        values = bucket.get(key, {})
        if current > expected_complete:
            state = "delay"
        elif current > complete_through:
            state = "stale"
        else:
            state = "observed"
        clicks = values.get("clicks", values.get("orderClicks", 0))
        orders = values.get("orders", 0)
        revenue = values.get("revenue", 0)
        row = {
            "date": key,
            "state": state,
            "isComplete": state != "delay",
            "source": "cnpscy_order_new_aggregate",
            "aggregateRows": values.get("aggregateRows", 0),
            "activeBrands": values.get("activeBrands", 0),
            "orders": orders,
            "revenue": revenue,
            "clicks": clicks,
            "payout": values.get("payout", 0),
            "affiliatePayout": values.get("affiliatePayout", 0),
            "dpv": values.get("dpv", 0),
            "atc": values.get("atc", 0),
            "directSales": values.get("directSales", 0),
            "haloSales": values.get("haloSales", 0),
        }
        row["epc"] = round(to_float(revenue) / to_float(clicks), 6) if to_float(clicks) else 0
        row["aov"] = round(to_float(revenue) / to_float(orders), 6) if to_float(orders) else 0
        row["conversionRate"] = round(to_float(orders) / to_float(clicks), 6) if to_float(clicks) else 0
        rows.append(row)
        current += dt.timedelta(days=1)

    latest_in_range = None
    for row in rows:
        if target := row.get("date"):
            has_values = to_float(row.get("aggregateRows")) or to_float(row.get("orders")) or to_float(row.get("revenue"))
            if has_values:
                parsed = parse_day(target)
                if parsed and (latest_in_range is None or parsed > latest_in_range):
                    latest_in_range = parsed
    if latest_in_range:
        complete_through = min(latest_in_range, source_complete_through, expected_complete)
        for row in rows:
            parsed = parse_day(row.get("date"))
            if not parsed:
                continue
            if parsed > expected_complete:
                row["state"] = "delay"
                row["isComplete"] = False
            elif parsed > complete_through:
                row["state"] = "stale"
                row["isComplete"] = True
            else:
                row["state"] = "observed"
                row["isComplete"] = True

    return {
        "month": start.strftime("%Y-%m"),
        "aggregation": "calendar_day",
        "cumulative": False,
        "delayDays": delay_days,
        "currentDate": today.isoformat(),
        "observedThrough": complete_through.isoformat(),
        "latestDataDate": (latest_in_range or primary_latest).isoformat(),
        "expectedCompleteThrough": expected_complete.isoformat(),
        "primarySource": "cnpscy_order_new_aggregate",
        "rows": rows,
    }


def format_metric_row(row: dict[str, Any]) -> dict[str, Any]:
    output: dict[str, Any] = {"month": normalize_month(row.get("month"))}
    for key, value in row.items():
        if key == "month":
            continue
        number = to_float(value)
        output[key] = int(number) if number.is_integer() else round(number, 6)
    return output


def status_payload(
    month: str | None = None,
    include_coverage: bool = False,
) -> dict[str, Any]:
    cache_key = f"status:{month or ''}:{include_coverage}"
    now = time.time()
    cached = _status_cache.get(cache_key)
    if cached is not None and now - cached[0] < STATUS_CACHE_TTL:
        return cached[1]
    with db_connection() as conn:
        static_ids = read_static_merchant_ids()
        latest = latest_dates(conn, keys={"aggregateOrders", "amazonClicks"})
        coverage = {"staticNumericMerchantIds": len(static_ids)}
        if include_coverage:
            coverage.update({
                "cnpscy_advert": count_distinct_for_ids(conn, "cnpscy_advert", ["advert_id", "merchant_id"], static_ids),
                "cnpscy_amazon_product": count_distinct_for_ids(conn, "cnpscy_amazon_product", ["advert_id", "merchant_id"], static_ids),
                "cnpscy_amazon_product_extra": count_distinct_for_ids(conn, "cnpscy_amazon_product_extra", ["advert_id", "merchant_id"], static_ids),
                "cnpscy_order_new_aggregate": count_distinct_for_ids(conn, "cnpscy_order_new_aggregate", ["advert_id", "merchant_id"], static_ids),
            })
        payload = {
            "ok": True,
            "checkedAt": utc_now_iso(),
            "staticSnapshot": {
                "generatedAt": static_chatbot_generated_at(),
                "merchantIds": len(static_ids),
            },
            "latestDates": latest,
            "coverage": coverage,
            "dailyTrend": daily_status_trend(
                conn,
                latest=latest,
                month=month,
                include_amazon_details=False,
            ),
            "recentMonths": recent_month_summary(
                conn,
                end_month=month,
                include_amazon_orders=False,
            ),
        }
    _status_cache[cache_key] = (now, payload)
    return payload


def tier_summary_payload(month: str | None = None) -> dict[str, Any]:
    """Return per-tier aggregated metrics for a given month.

    Queries cnpscy_oi_tier_assignments joined with
    cnpscy_oi_offer_monthly_amazon_metrics to produce per-tier
    brand count, orders, revenue, clicks, payout, and conversion rate.
    Falls back to cnpscy_order_new_aggregate if the monthly metrics
    view is unavailable.
    """
    cache_key = f"tier_summary:{month or ''}"
    now = time.time()
    cached = _status_cache.get(cache_key)
    if cached is not None and now - cached[0] < STATUS_CACHE_TTL:
        return cached[1]

    with db_connection() as conn:
        if month is None:
            row = fetch_one(conn, "SELECT MAX(month) AS m FROM cnpscy_oi_offer_monthly_amazon_metrics")
            month = str(row["m"]) if row and row.get("m") else ""

        metrics_columns = table_columns(conn, "cnpscy_oi_offer_monthly_amazon_metrics")
        has_metrics = bool(pick_column(metrics_columns, ["merchantId"]))

        if has_metrics:
            rows = fetch_all(
                conn,
                f"""
                SELECT
                    t.tier,
                    COUNT(DISTINCT t.merchantId) AS brandCount,
                    COALESCE(SUM(m.orders), 0) AS orders,
                    COALESCE(SUM(m.revenue), 0) AS revenue,
                    COALESCE(SUM(m.clicks), 0) AS clicks,
                    COALESCE(SUM(m.payout), 0) AS payout
                FROM cnpscy_oi_tier_assignments t
                LEFT JOIN cnpscy_oi_offer_monthly_amazon_metrics m
                    ON t.merchantId = m.merchantId AND m.month = %s
                GROUP BY t.tier
                ORDER BY FIELD(t.tier, 'Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'BLACK TIER')
                """,
                (month,),
            )
        else:
            # Fallback: use cnpscy_order_new_aggregate
            agg_cols = table_columns(conn, "cnpscy_order_new_aggregate")
            agg_id = pick_column(agg_cols, ["advert_id", "merchant_id"])
            if not agg_id:
                _status_cache[cache_key] = (now, {"ok": False, "month": month, "tiers": [], "total": None})
                return _status_cache[cache_key][1]

            agg_month_col = pick_column(agg_cols, ["order_time_day", "time_day"])
            month_cond = ""
            agg_params: tuple[Any, ...] = ()
            if agg_month_col and month:
                month_start_key = month.replace("-", "") + "01"
                month_end = parse_month_key(month)
                if month_end:
                    import calendar
                    last_day = calendar.monthrange(month_end.year, month_end.month)[1]
                    month_end_key = month.replace("-", "") + str(last_day)
                    month_cond = f"AND a.{q(agg_month_col)} BETWEEN %s AND %s"
                    agg_params = (month_start_key, month_end_key)

            rows = fetch_all(
                conn,
                f"""
                SELECT
                    t.tier,
                    COUNT(DISTINCT CAST(t.merchantId AS UNSIGNED)) AS brandCount,
                    COALESCE(SUM(a.{q(pick_column(agg_cols, ['order_num', 'orders']))}), 0) AS orders,
                    COALESCE(SUM(a.{q(pick_column(agg_cols, ['amount', 'sales_amount', 'revenue']))}), 0) AS revenue,
                    0 AS clicks,
                    COALESCE(SUM(a.{q(pick_column(agg_cols, ['payout', 'commission']))}), 0) AS payout
                FROM cnpscy_oi_tier_assignments t
                INNER JOIN cnpscy_order_new_aggregate a
                    ON CAST(t.merchantId AS UNSIGNED) = a.{q(agg_id)}
                    {month_cond}
                GROUP BY t.tier
                ORDER BY FIELD(t.tier, 'Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'BLACK TIER')
                """,
                agg_params,
            )

        tiers = []
        total_brands = 0
        total_orders = 0
        total_revenue = 0.0
        total_clicks = 0.0
        total_payout = 0.0

        for row in rows:
            brands = int(to_float(row.get("brandCount")))
            orders = int(to_float(row.get("orders")))
            revenue = to_float(row.get("revenue"))
            clicks = to_float(row.get("clicks"))
            payout = to_float(row.get("payout"))
            conversion = orders / clicks if clicks > 0 else 0.0

            tiers.append({
                "tier": str(row["tier"]),
                "brandCount": brands,
                "orders": orders,
                "revenue": round(revenue, 2),
                "clicks": int(clicks),
                "payout": round(payout, 2),
                "conversionRate": round(conversion, 6),
            })
            total_brands += brands
            total_orders += orders
            total_revenue += revenue
            total_clicks += clicks
            total_payout += payout

        total_conversion = total_orders / total_clicks if total_clicks > 0 else 0.0
        total = {
            "brandCount": total_brands,
            "orders": total_orders,
            "revenue": round(total_revenue, 2),
            "clicks": int(total_clicks),
            "payout": round(total_payout, 2),
            "conversionRate": round(total_conversion, 6),
        }

        payload = {
            "ok": True,
            "checkedAt": utc_now_iso(),
            "month": month,
            "tiers": tiers,
            "total": total,
        }

    _status_cache[cache_key] = (now, payload)
    return payload


def static_chatbot_generated_at() -> str | None:
    """从 db_offers_cache.json summary 读取生成的快照时间戳。"""
    if OFFERS_CACHE_FILE.exists():
        try:
            payload = json.loads(OFFERS_CACHE_FILE.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                gen = payload.get("summary", {}).get("generatedAt")
                if gen:
                    return str(gen)
        except (OSError, json.JSONDecodeError):
            pass
    return read_static_merchant_id_manifest().get("generatedAt")


def merchant_base(conn, merchant_id: str) -> dict[str, Any] | None:
    advert_cols = table_columns(conn, "cnpscy_advert")
    if not pick_column(advert_cols, ["advert_id", "merchant_id"]):
        raise OfferDbError("cnpscy_advert is missing an advert id column")

    extra_cols = table_columns(conn, "cnpscy_advert_extra")
    joins = []
    sources = [("a", advert_cols)]
    if pick_column(extra_cols, ["advert_id", "merchant_id"]):
        joins.append(
            f"LEFT JOIN {q('cnpscy_advert_extra')} ae ON ae.{q(pick_column(extra_cols, ['advert_id', 'merchant_id']))} = a.{q(pick_column(advert_cols, ['advert_id', 'merchant_id']))}"
        )
        sources.append(("ae", extra_cols))

    id_column = pick_column(advert_cols, ["advert_id", "merchant_id"])
    selects = [
        f"CAST(a.{q(id_column)} AS CHAR) AS {q('merchantId')}",
        first_expr(sources, ["advert_name", "merchant_name", "brand_name", "name"], "merchantName"),
        first_expr(sources, ["m_id", "levanta_brand_id", "brand_id"], "levantaBrandId"),
        first_expr(sources, ["advert_lianmeng_id", "network", "agency", "platform", "source"], "network"),
        first_expr(sources, ["status", "advert_status", "online_status", "state"], "status"),
        first_expr(sources, ["is_publish", "publish_status", "enabled"], "publishStatus"),
        first_expr(sources, ["advert_money", "commission_rate", "rate", "cps_rate"], "commissionRate"),
        first_expr(sources, ["advert_payout_time", "payment_cycle", "payout_cycle", "payment_days"], "paymentCycle"),
        first_expr(sources, ["updated_at", "update_time"], "updatedAt"),
    ]
    row = fetch_one(
        conn,
        f"""
        SELECT {", ".join(selects)}
        FROM {q("cnpscy_advert")} a
        {" ".join(joins)}
        WHERE a.{q(id_column)} = %s
        LIMIT 1
        """,
        (merchant_id,),
    )
    if not row:
        return None
    row["productCount"] = table_count_for_merchant(conn, "cnpscy_amazon_product", merchant_id)
    row["productExtraCount"] = table_count_for_merchant(conn, "cnpscy_amazon_product_extra", merchant_id)
    return compact_api_row(row)


def table_count_for_merchant(conn, table: str, merchant_id: str) -> int | None:
    columns = table_columns(conn, table)
    id_column = pick_column(columns, ["advert_id", "merchant_id"])
    if not id_column:
        return None
    row = fetch_one(conn, f"SELECT COUNT(*) AS count FROM {q(table)} WHERE {q(id_column)} = %s", (merchant_id,))
    return int(row["count"] or 0) if row else 0


def merchant_products(conn, merchant_id: str, limit: int = 50) -> list[dict[str, Any]]:
    product_cols = table_columns(conn, "cnpscy_amazon_product")
    id_column = pick_column(product_cols, ["advert_id", "merchant_id"])
    if not id_column:
        return []
    extra_cols = table_columns(conn, "cnpscy_amazon_product_extra")
    sources = [("p", product_cols)]
    joins = []
    extra_id = pick_column(extra_cols, ["advert_id", "merchant_id"])
    product_asin = pick_column(product_cols, ["asin", "product_asin"])
    extra_asin = pick_column(extra_cols, ["asin", "product_asin"])
    if extra_id:
        conditions = [f"e.{q(extra_id)} = p.{q(id_column)}"]
        if product_asin and extra_asin:
            conditions.append(f"e.{q(extra_asin)} = p.{q(product_asin)}")
        joins.append(f"LEFT JOIN {q('cnpscy_amazon_product_extra')} e ON {' AND '.join(conditions)}")
        sources.append(("e", extra_cols))

    selects = [
        first_expr(sources, ["asin", "product_asin"], "asin"),
        first_expr(sources, ["product_name", "title", "name"], "productName"),
        first_expr(sources, ["price", "product_price", "sale_price"], "price"),
        first_expr(sources, ["category", "category_name", "main_category"], "category"),
        first_expr(sources, ["category_id", "main_category_id"], "categoryId"),
        first_expr(sources, ["sub_category", "subcategory", "sub_category_name"], "subCategory"),
        first_expr(sources, ["bsr", "best_seller_rank", "rank"], "bsr"),
        first_expr(sources, ["sub_category_bsr", "subcategory_bsr", "best_sub_category_bsr"], "subCategoryBsr"),
        first_expr(sources, ["payout_aff", "commission_rate", "product_commission"], "commissionRate"),
        first_expr(sources, ["updated_at", "update_time", "created_at"], "updatedAt"),
    ]
    order_column = pick_column(product_cols, ["updated_at", "update_time", "created_at"])
    order_sql = f"ORDER BY p.{q(order_column)} DESC" if order_column else ""
    rows = fetch_all(
        conn,
        f"""
        SELECT {", ".join(selects)}
        FROM {q("cnpscy_amazon_product")} p
        {" ".join(joins)}
        WHERE p.{q(id_column)} = %s
        {order_sql}
        LIMIT {int(limit)}
        """,
        (merchant_id,),
    )
    return [compact_api_row(row) for row in rows]


def merchant_amazon_metrics(conn, merchant_id: str, months: int = 12) -> list[dict[str, Any]]:
    order_cols = table_columns(conn, "cnpscy_amazon_order")
    id_column = pick_column(order_cols, ["advert_id", "merchant_id"])
    date_column = pick_column(order_cols, ["order_time_day"])
    by_month: dict[str, dict[str, Any]] = {}
    if id_column and date_column:
        month_sql = month_expr("o", date_column)
        rows = fetch_all(
            conn,
            f"""
            SELECT {month_sql} AS month,
                   COUNT(*) AS orders,
                   {sum_expr("o", order_cols, ["amount", "sales_amount", "revenue"], "revenue")},
                   {sum_expr("o", order_cols, ["payout", "commission"], "payout")},
                   {sum_expr("o", order_cols, ["aff_payout", "affiliate_payout"], "affiliatePayout")},
                   {sum_expr("o", order_cols, ["clicks", "click_num"], "clicks")},
                   {sum_expr("o", order_cols, ["direct_sales", "directSales", "direct_sale_amount"], "directSales")},
                   {sum_expr("o", order_cols, ["halo_sales", "haloSales", "halo_sale_amount"], "haloSales")}
            FROM {q("cnpscy_amazon_order")} o
            WHERE o.{q(id_column)} = %s
            GROUP BY month
            ORDER BY month DESC
            LIMIT {int(months)}
            """,
            (merchant_id,),
        )
        for row in rows:
            formatted = format_metric_row(row)
            by_month[formatted["month"]] = formatted

    click_cols = table_columns(conn, "cnpscy_amazon_click")
    click_id = pick_column(click_cols, ["advert_id", "merchant_id"])
    click_date = pick_column(click_cols, ["time_day", "click_time_day"])
    if click_id and click_date:
        month_sql = month_expr("c", click_date)
        rows = fetch_all(
            conn,
            f"""
            SELECT {month_sql} AS month,
                   COUNT(*) AS clickRows,
                   {sum_expr("c", click_cols, ["click", "clicks", "click_num"], "rawClicks")},
                   {sum_expr("c", click_cols, ["dpv", "dpv_num"], "dpv")},
                   {sum_expr("c", click_cols, ["atc", "atc_num"], "atc")}
            FROM {q("cnpscy_amazon_click")} c
            WHERE c.{q(click_id)} = %s
            GROUP BY month
            ORDER BY month DESC
            LIMIT {int(months)}
            """,
            (merchant_id,),
        )
        for row in rows:
            formatted = format_metric_row(row)
            month = formatted["month"]
            target = by_month.setdefault(month, {"month": month})
            target.update({key: value for key, value in formatted.items() if key != "month"})
            if not to_float(target.get("clicks")) and to_float(formatted.get("rawClicks")):
                target["clicks"] = formatted["rawClicks"]

    for row in by_month.values():
        clicks = to_float(row.get("clicks"))
        orders = to_float(row.get("orders"))
        revenue = to_float(row.get("revenue"))
        row["epc"] = round(revenue / clicks, 6) if clicks else 0
        row["aov"] = round(revenue / orders, 6) if orders else 0
        row["conversionRate"] = round(orders / clicks, 6) if clicks else 0
    return sorted(by_month.values(), key=lambda row: row.get("month") or "", reverse=True)


def merchant_aggregate_metrics(conn, merchant_id: str, months: int = 12) -> list[dict[str, Any]]:
    columns = table_columns(conn, "cnpscy_order_new_aggregate")
    id_column = pick_column(columns, ["advert_id", "merchant_id"])
    date_column = pick_column(columns, ["order_time_day", "time_day"])
    if not id_column or not date_column:
        return []
    month_sql = month_expr("a", date_column)
    rows = fetch_all(
        conn,
        f"""
        SELECT {month_sql} AS month,
               COUNT(*) AS aggregateRows,
               {sum_expr("a", columns, ["amount", "sales_amount", "revenue"], "revenue")},
               {sum_expr("a", columns, ["payout", "commission"], "payout")},
               {sum_expr("a", columns, ["order_num", "orders"], "orders")},
               {sum_expr("a", columns, ["click_num", "clicks"], "clicks")}
        FROM {q("cnpscy_order_new_aggregate")} a
        WHERE a.{q(id_column)} = %s
        GROUP BY month
        ORDER BY month DESC
        LIMIT {int(months)}
        """,
        (merchant_id,),
    )
    return [format_metric_row(row) for row in rows]


def merchant_payload(merchant_id: str, product_limit: int = 50, months: int = 12) -> dict[str, Any]:
    if not DIGITS_RE.match(merchant_id):
        raise ValueError("merchantId must be numeric")
    cache_key = f"{merchant_id}:{product_limit}:{months}"
    now = time.time()
    cached = _merchant_cache.get(cache_key)
    if cached is not None and now - cached[0] < MERCHANT_CACHE_TTL:
        return cached[1]
    with db_connection() as conn:
        merchant = merchant_base(conn, merchant_id)
        payload = {
            "ok": True,
            "checkedAt": utc_now_iso(),
            "merchantId": merchant_id,
            "merchant": merchant,
            "products": merchant_products(conn, merchant_id, product_limit),
            "monthlyAmazonMetrics": merchant_amazon_metrics(conn, merchant_id, months),
            "monthlyAggregateMetrics": merchant_aggregate_metrics(conn, merchant_id, months),
        }
    _merchant_cache[cache_key] = (now, payload)
    return payload


def search_payload(query_text: str, limit: int = 25) -> dict[str, Any]:
    query_text = query_text.strip()
    if len(query_text) < 2:
        return {"ok": True, "checkedAt": utc_now_iso(), "query": query_text, "results": []}
    cache_key = f"search:{query_text}:{limit}"
    now = time.time()
    cached = _search_cache.get(cache_key)
    if cached is not None and now - cached[0] < SEARCH_CACHE_TTL:
        return cached[1]
    with db_connection() as conn:
        columns = table_columns(conn, "cnpscy_advert")
        id_column = pick_column(columns, ["advert_id", "merchant_id"])
        name_column = pick_column(columns, ["advert_name", "merchant_name", "brand_name", "name"])
        if not id_column:
            raise OfferDbError("cnpscy_advert is missing an advert id column")
        sources = [("a", columns)]
        selects = [
            f"CAST(a.{q(id_column)} AS CHAR) AS {q('merchantId')}",
            first_expr(sources, ["advert_name", "merchant_name", "brand_name", "name"], "merchantName"),
            first_expr(sources, ["m_id", "levanta_brand_id", "brand_id"], "levantaBrandId"),
            first_expr(sources, ["advert_lianmeng_id", "network", "agency", "platform", "source"], "network"),
            first_expr(sources, ["status", "advert_status", "online_status", "state"], "status"),
            first_expr(sources, ["advert_money", "commission_rate", "rate", "cps_rate"], "commissionRate"),
        ]
        params: list[Any] = []
        predicates = []
        if DIGITS_RE.match(query_text):
            predicates.append(f"a.{q(id_column)} = %s")
            params.append(query_text)
        if name_column:
            predicates.append(f"a.{q(name_column)} LIKE %s")
            params.append(f"%{query_text}%")
        where = " OR ".join(predicates) or "1 = 0"
        rows = fetch_all(
            conn,
            f"""
            SELECT {", ".join(selects)}
            FROM {q("cnpscy_advert")} a
            WHERE {where}
            ORDER BY a.{q(id_column)} ASC
            LIMIT {int(limit)}
            """,
            tuple(params),
        )
        return {
            "ok": True,
            "checkedAt": utc_now_iso(),
            "query": query_text,
            "results": [compact_api_row(row) for row in rows],
        }
    _search_cache[cache_key] = (now, result)
    return result


# ── payload cache ────────────────────────────────────────────────────

CACHE_DIR = ROOT / "protected_data"
OFFERS_CACHE_FILE = CACHE_DIR / "db_offers_cache.json"
KEYWORDS_CACHE_FILE = CACHE_DIR / "db_keywords_cache.json"
PUBLISHERS_CACHE_FILE = CACHE_DIR / "db_publishers_cache.json"
CACHE_TTL_SECONDS = int(os.environ.get("OFFER_DB_CACHE_TTL", "86400"))  # 24 hours
MERCHANT_CACHE_TTL = int(os.environ.get("OFFER_DB_MERCHANT_CACHE_TTL", "3600"))  # 1 hour
SEARCH_CACHE_TTL = int(os.environ.get("OFFER_DB_SEARCH_CACHE_TTL", "3600"))  # 1 hour
STATUS_CACHE_TTL = int(os.environ.get("OFFER_DB_STATUS_CACHE_TTL", "600"))   # 10 min
TIER_REPORT_CACHE_TTL = int(os.environ.get("OFFER_DB_TIER_REPORT_CACHE_TTL", "300"))
PUBLISHERS_CACHE_TTL = int(os.environ.get("OFFER_DB_PUBLISHERS_CACHE_TTL", "3600"))  # 1 hour
_bg_refresh_running: dict[str, bool] = {}
_merchant_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_search_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_status_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_tier_sheet_cache: dict[str, tuple[float, dict[str, Any]]] = {}
# In-memory cache for offers payload (avoids 23MB disk read + json.loads per request)
_offers_memory_cache: tuple[float, dict[str, Any]] | None = None
# In-memory cache for publishers payload
_publishers_memory_cache: tuple[float, dict[str, Any]] | None = None
# 防止 ThreadingHTTPServer 多线程同时重建 offers 缓存导致 MySQL /tmp 写满
_offers_rebuild_lock = threading.Lock()


def _cache_age(path: Path) -> float | None:
    try:
        return time.time() - path.stat().st_mtime
    except FileNotFoundError:
        return None


def _load_any_cache(path: Path) -> dict[str, Any] | None:
    """Load cache file regardless of freshness. Returns None only if file missing or corrupt."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, FileNotFoundError):
        return None


def _save_cache(path: Path, payload: dict[str, Any]) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, default=str), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        pass  # cache write failure is non-fatal
    finally:
        # Clean up stale tmp file from interrupted writes
        try:
            tmp_path = path.with_suffix(".tmp")
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError:
            pass


def offers_payload(month: str | None = None, force_refresh: bool = False) -> dict[str, Any]:
    """从 cnpscy_oi_* 视图/表返回全量 offer 列表 + 月度指标 + 汇总统计。

    结果缓存到 protected_data/db_offers_cache.json（TTL 6 小时），
    同时保持进程内内存缓存避免重复的 23MB json.loads。
    缓存过期后先返回旧数据（毫秒级），后台异步刷新。
    传 force_refresh=True 可跳过缓存同步重建。
    """
    global _offers_memory_cache
    now = time.time()

    # Memory cache — avoid 23MB file read + json.loads on warm requests
    if not force_refresh and _offers_memory_cache is not None:
        ts, payload = _offers_memory_cache
        if now - ts < CACHE_TTL_SECONDS:
            return payload
        # TTL expired: fall through to file cache

    # File cache — shared across Vercel instances
    if not force_refresh:
        cached = _load_any_cache(OFFERS_CACHE_FILE)
        if cached is not None:
            age = _cache_age(OFFERS_CACHE_FILE)
            if age is not None and age < CACHE_TTL_SECONDS:
                _offers_memory_cache = (now, cached)
                return cached  # fresh from disk
            # Stale: return immediately, trigger background refresh (with lock)
            _offers_memory_cache = (now, cached)
            if not _bg_refresh_running.get("offers"):
                _bg_refresh_running["offers"] = True

                def _refresh_offers():
                    global _offers_memory_cache
                    try:
                        with _offers_rebuild_lock:
                            # 二次检查：另一个线程可能已经刷新过了
                            if _offers_memory_cache is not None:
                                ts, curr = _offers_memory_cache
                                if time.time() - ts < 60:  # 60秒内已经刷过则跳过
                                    return
                            payload = _build_offers_payload(month)
                            _save_cache(OFFERS_CACHE_FILE, payload)
                            _offers_memory_cache = (time.time(), payload)
                    finally:
                        _bg_refresh_running["offers"] = False

                threading.Thread(target=_refresh_offers, daemon=True).start()
            return cached

    # No cache available at all: build from DB
    # 使用锁防止 ThreadingHTTPServer 多线程并发重建导致 MySQL /tmp 写满
    with _offers_rebuild_lock:
        # Double-check: 另一个线程可能已经重建好了
        if not force_refresh and _offers_memory_cache is not None:
            ts, cached = _offers_memory_cache
            if now - ts < CACHE_TTL_SECONDS:
                return cached
        payload = _build_offers_payload(month)
        _save_cache(OFFERS_CACHE_FILE, payload)
        _offers_memory_cache = (now, payload)
    return payload


def offer_network_fallback_map(
    conn,
    merchant_ids: list[str],
    cached_payload: dict[str, Any] | None,
) -> dict[str, str]:
    """仅对 network 缺失的商户回查 network 来源。

    优先从缓存恢复历史已知的 network，再对缓存中找不到的商户
    通过 cnpscy_advert_type 查漏（避免物化 cnpscy_advertiser_performance_daily_view 视图）。
    """
    network_map: dict[str, str] = {}

    # 1) 从旧缓存恢复已知 network
    if cached_payload and isinstance(cached_payload, dict):
        cached_offers = cached_payload.get("offers", [])
        if isinstance(cached_offers, list):
            cache_by_id: dict[str, str] = {}
            for o in cached_offers:
                mid = o.get("merchantId")
                net = o.get("network")
                if mid and net and net not in (None, "", "Unknown"):
                    cache_by_id[mid] = net
            for mid in merchant_ids:
                if mid in cache_by_id:
                    network_map[mid] = cache_by_id[mid]

    # 2) 缓存未命中 → 查 advert_type（避免视图物化）
    db_ids = [mid for mid in merchant_ids if mid and mid not in network_map]
    if db_ids:
        for batch in chunks(db_ids, 500):
            placeholders = ", ".join(["%s"] * len(batch))
            rows = fetch_all(
                conn,
                f"""
                SELECT DISTINCT CAST(t.merchantId AS CHAR) AS merchantId,
                       TRIM(at.advert_type_name) AS network
                FROM cnpscy_oi_tier_assignments t
                INNER JOIN cnpscy_advert a
                    ON a.advert_id = CAST(t.merchantId AS UNSIGNED) AND a.advert_isdel = 1
                INNER JOIN cnpscy_advert_type at
                    ON a.advert_advertiser = at.advert_type_id
                WHERE at.advert_type_parent_id = 53
                  AND at.advert_type_name IS NOT NULL AND TRIM(at.advert_type_name) != ''
                  AND t.merchantId IN ({placeholders})
                """,
                tuple(batch),
            )
            for r in rows:
                mid = r["merchantId"]
                net = (r.get("network") or "").strip()
                if mid and net and mid not in network_map:
                    network_map[mid] = net

    return network_map


def _build_offers_payload(month: str | None = None) -> dict[str, Any]:
    """Internal: heavy DB query to build an offers payload from scratch."""
    with db_connection() as conn:
        if month is None:
            row = fetch_one(conn, "SELECT MAX(month) AS m FROM cnpscy_oi_offer_monthly_amazon_metrics")
            month = str(row["m"]) if row and row.get("m") else ""

        # Derive two prior months for historical revenue columns
        prev_month1 = ""
        prev_month2 = ""
        if month and len(month) == 7 and month[4] == "-":
            try:
                y, m_val = int(month[:4]), int(month[5:7])
                if m_val == 1:
                    prev_month1 = f"{y-1}-12"; prev_month2 = f"{y-1}-11"
                elif m_val == 2:
                    prev_month1 = f"{y}-01"; prev_month2 = f"{y-1}-12"
                else:
                    prev_month1 = f"{y}-{m_val-1:02d}"; prev_month2 = f"{y}-{m_val-2:02d}"
            except (ValueError, IndexError):
                pass

        # Payment records start month (24 个月前，避免全表扫描写满 /tmp)
        payment_start_month = ""
        if month and len(month) == 7 and month[4] == "-":
            try:
                y, m_val = int(month[:4]), int(month[5:7])
                total = y * 12 + m_val - 1 - 23  # 24 months back
                py = total // 12
                pm = total % 12 + 1
                payment_start_month = f"{py}-{pm:02d}"
            except (ValueError, IndexError):
                pass

        # ── core query: tier + advert + metrics ──
        core_offers = fetch_all(
            conn,
            """
            SELECT
                t.merchantId, MAX(t.tier) AS tier,
                MAX(a.advert_name) AS merchantName,
                MAX(CONCAT(t.tier, '::', t.merchantId, '::',
                    COALESCE(a.advert_name, ''))) AS id,
                MAX(a.m_id) AS levantaBrandId,
                MAX(COALESCE(pr_net.network, 'Unknown')) AS network,
                MAX(a.advert_money) AS commissionRate,
                NULL AS productCount,
                MAX(m.clicks) AS clicks, MAX(m.orders) AS orders,
                MAX(m.revenue) AS salesAmount,
                MAX(m.epc) AS epc, MAX(m.aov) AS aov,
                MAX(m.conversionRate) AS conversionRate,
                MAX(m.payout) AS payout,
                MAX(m.affiliatePayout) AS affiliatePayout,
                MAX(m.dpv) AS dpv, MAX(m.atc) AS atc,
                MAX(m.directSales) AS directSales,
                MAX(m.haloSales) AS haloSales
            FROM cnpscy_oi_tier_assignments t
            LEFT JOIN cnpscy_advert a
                ON a.advert_id = CAST(t.merchantId AS UNSIGNED) AND a.advert_isdel = 1
            LEFT JOIN cnpscy_oi_offer_monthly_amazon_metrics m
                ON t.merchantId = m.merchantId AND m.month = %s
            LEFT JOIN (
                SELECT merchantId, MAX(network) AS network
                FROM cnpscy_oi_payment_records
                GROUP BY merchantId
            ) pr_net ON t.merchantId = pr_net.merchantId
            GROUP BY t.merchantId
            """,
            (month,),
        )

        # ── lookup maps (separate fast queries, merge in Python) ──
        # Categories (pre-aggregated per merchant)
        cat_rows = fetch_all(
            conn,
            """
            SELECT mc2.merchantId,
                   MAX(c_main.categoryName) AS mainCategory,
                   MAX(c_sub.categoryName) AS subCategory,
                   MAX(c_main.categoryNameCn) AS mainCategoryCn,
                   MAX(c_sub.categoryNameCn) AS subCategoryCn
            FROM cnpscy_oi_merchant_category mc2
            LEFT JOIN cnpscy_oi_category c_main
                ON mc2.categoryId = c_main.categoryId AND c_main.level = 1
            LEFT JOIN cnpscy_oi_category c_sub
                ON mc2.categoryId = c_sub.categoryId AND c_sub.level = 2
            GROUP BY mc2.merchantId
            """,
        )
        cat_map: dict = {r["merchantId"]: r for r in cat_rows}

        # Sheet metadata (select only needed columns, avoid TEXT bloat)
        sm_rows = fetch_all(
            conn,
            """SELECT merchantId, region, paymentCycle, paymentCycleSource,
                      reason, recommendation, recommendedLink, phase,
                      publisherCount, successRate, publisherCountJune,
                      successRateJune, completionRate, timeline,
                      bestSubCategoryBsr, mainCategoryBsr, subcategoryBsr,
                      sheetCategory, categorySource, backendMatchStatus,
                      hasDiscount, discountInfo, dealInfo, cpc
               FROM cnpscy_oi_offer_sheet_metadata""",
        )
        sm_map: dict = {r["merchantId"]: r for r in sm_rows}

        # Product keywords
        pk_rows = fetch_all(
            conn,
            "SELECT merchantId, productAsins, productTitles, productKeywords, "
            "productNameCount, productAsinCount FROM cnpscy_oi_product_keywords",
        )
        pk_map: dict = {r["merchantId"]: r for r in pk_rows}

        # Visual status
        vs_rows = fetch_all(
            conn,
            "SELECT merchantId, color, reason_code, reason_text, source "
            "FROM cnpscy_oi_tier_visual_status",
        )
        vs_map: dict = {r["merchantId"]: r for r in vs_rows}

        # Network fallback: 只查 network 缺失的商户，避免全量扫描和视图物化
        missing_network_ids = [
            row.get("merchantId")
            for row in core_offers
            if row.get("network") in (None, "Unknown", "")
        ]
        network_map = offer_network_fallback_map(
            conn,
            missing_network_ids,
            _load_any_cache(OFFERS_CACHE_FILE),
        )

        # ── merge all into offers ──
        offers = []
        for o in core_offers:
            mid = o["merchantId"]

            # visual status
            vs = vs_map.get(mid)
            o["visualStatusColor"] = vs["color"] if vs else None
            o["visualStatusCode"] = vs["reason_code"] if vs else None
            o["visualStatusReason"] = vs["reason_text"] if vs else None
            o["visualStatusSource"] = vs["source"] if vs else None

            # network from advert_type (覆盖 pr_net 的 'Unknown' 默认值)
            nm = network_map.get(mid)
            if nm and o.get("network") in (None, "Unknown", ""):
                o["network"] = nm

            # categories
            cat = cat_map.get(mid)
            main_cat = cat["mainCategory"] if cat else None
            sub_cat = cat["subCategory"] if cat else None
            main_cn = cat["mainCategoryCn"] if cat else None
            sub_cn = cat["subCategoryCn"] if cat else None

            # sheet metadata
            sm = sm_map.get(mid)
            sheet_cat = sm["sheetCategory"] if sm else None

            # resolved category
            o["category"] = sheet_cat or main_cat or "Uncategorized"
            o["mainCategory"] = main_cat
            o["subCategory"] = sub_cat
            o["mainCategoryCn"] = main_cn
            o["subCategoryCn"] = sub_cn
            o["categoryPath"] = " > ".join(filter(None, [sheet_cat or main_cat, sub_cat])) or None
            o["sheetCategory"] = sheet_cat
            o["categorySource"] = sm["categorySource"] if sm else None

            # brand = merchantName
            o["brand"] = o["merchantName"]

            # sheet metadata fields
            if sm:
                for key in ("region", "paymentCycle", "paymentCycleSource", "reason",
                            "recommendation", "recommendedLink", "phase",
                            "publisherCount", "successRate", "publisherCountJune",
                            "successRateJune", "completionRate", "timeline",
                            "bestSubCategoryBsr", "mainCategoryBsr", "subcategoryBsr",
                            "backendMatchStatus", "hasDiscount", "discountInfo",
                            "dealInfo", "cpc"):
                    o[key] = sm.get(key)
                # tracking issue
                reason_text = (sm.get("reason") or "") + (sm.get("recommendation") or "")
                o["trackingIssue"] = 1 if "tracking" in reason_text.lower() else 0
            else:
                for key in ("region", "paymentCycle", "paymentCycleSource", "reason",
                            "recommendation", "recommendedLink", "phase",
                            "publisherCount", "successRate", "publisherCountJune",
                            "successRateJune", "completionRate", "timeline",
                            "bestSubCategoryBsr", "mainCategoryBsr", "subcategoryBsr",
                            "backendMatchStatus"):
                    o[key] = None
                o["hasDiscount"] = 0
                o["discountInfo"] = None
                o["dealInfo"] = None
                o["cpc"] = None
                o["trackingIssue"] = 0

            # product keywords — only productAsins kept in core payload for ASIN search;
            # productTitles / productKeywords / productNameCount / productAsinCount
            # are loaded lazily via /api/ui/db/keywords when chatbot needs them.
            pk = pk_map.get(mid)
            if pk:
                o["productAsins"] = pk.get("productAsins")
            else:
                o["productAsins"] = None

            # 字段名映射：前端（旧代码）期望 affCommission，DB 提供的是 affiliatePayout
            o["affCommission"] = o.get("affiliatePayout")

            offers.append(o)

        # ── top ASINs per merchant (aggregated from products view) ──
        asin_rows = fetch_all(
            conn,
            """
            SELECT merchantId,
                   GROUP_CONCAT(DISTINCT asin ORDER BY asin SEPARATOR ',') AS topAsins,
                   COUNT(DISTINCT asin) AS asinCount
            FROM cnpscy_oi_offer_products
            GROUP BY merchantId
            """,
        )
        asin_map: dict[str, dict] = {r["merchantId"]: r for r in asin_rows}

        # ── payment records (限定 24 个月，避免全表扫描写满 /tmp) ──
        payment_records_raw = fetch_all(
            conn,
            """
            SELECT id, merchantId, levantaBrandId, merchantName, network, region,
                   tier, category, categoryPath, mainCategory, subCategory,
                   mainCategoryCn, subCategoryCn,
                   reportMonth, reportYear, reportMonthKey,
                   revenueMade, commissionMade, expectedPaymentAmount,
                   paidAmount, remainingAmount,
                   paymentCycle, paymentAvailabilityDate, expectedPaymentDate,
                   paymentStatus, rawStatus, lastCheckedDate,
                   currency, isPlaceholder, notes
            FROM cnpscy_oi_payment_records
            WHERE reportMonthKey >= %s
            ORDER BY reportMonthKey DESC, merchantId
            """,
            (payment_start_month,),
        )

        # ── payment risk per merchant (限定 24 个月) ──
        payment_risk_rows = fetch_all(
            conn,
            """
            SELECT
                merchantId,
                MAX(CASE WHEN paymentStatus IN ('Unpaid', 'Overdue') THEN 1 ELSE 0 END) AS hasPaymentRisk,
                GROUP_CONCAT(DISTINCT CASE WHEN paymentStatus IN ('Unpaid', 'Overdue', 'Partial')
                    THEN reportMonthKey END ORDER BY reportMonthKey SEPARATOR ',') AS paymentRiskMonths,
                GROUP_CONCAT(DISTINCT reportMonthKey ORDER BY reportMonthKey SEPARATOR ',') AS invoiceMonths,
                GROUP_CONCAT(DISTINCT CASE WHEN paymentStatus = 'Paid'
                    THEN reportMonthKey END ORDER BY reportMonthKey SEPARATOR ',') AS paidInvoiceMonths,
                SUM(CASE WHEN paymentStatus IN ('Unpaid', 'Overdue', 'Partial')
                    THEN remainingAmount ELSE 0 END) AS unpaidCommissionOwed,
                SUM(CASE WHEN paymentStatus IN ('Unpaid', 'Overdue', 'Partial')
                    THEN revenueMade ELSE 0 END) AS unpaidSales
            FROM cnpscy_oi_payment_records
            WHERE reportMonthKey >= %s
            GROUP BY merchantId
            """,
            (payment_start_month,),
        )
        payment_risk_map: dict[str, dict] = {r["merchantId"]: r for r in payment_risk_rows}

        # ── prior month revenues (single query, merge in Python) ──
        prior_revenue_map: dict[str, dict] = {}
        if prev_month1 or prev_month2:
            prior_rows = fetch_all(
                conn,
                """
                SELECT merchantId, month, revenue
                FROM cnpscy_oi_offer_monthly_amazon_metrics
                WHERE month IN (%s, %s)
                """,
                (prev_month1 or None, prev_month2 or None),
            )
            for pr in prior_rows:
                mid = str(pr["merchantId"])
                if mid not in prior_revenue_map:
                    prior_revenue_map[mid] = {}
                prior_revenue_map[mid][str(pr["month"])] = pr["revenue"]

        # ── merge top ASINs + payment risk + computed fields into offers ──
        for o in offers:
            mid = o["merchantId"]

            # computed: dpvPerClick, atcPerClick
            clicks = o.get("clicks") or 0
            if clicks > 0:
                o["dpvPerClick"] = round((o.get("dpv") or 0) / clicks, 6) if o.get("dpv") is not None else None
                o["atcPerClick"] = round((o.get("atc") or 0) / clicks, 6) if o.get("atc") is not None else None
            else:
                o["dpvPerClick"] = None
                o["atcPerClick"] = None

            # computed: historical revenue (from prior months)
            pr = prior_revenue_map.get(mid, {})
            o["mayRevenue"] = float(pr[prev_month1]) if prev_month1 and prev_month1 in pr else None
            o["juneRevenue"] = float(pr[prev_month2]) if prev_month2 and prev_month2 in pr else None

            # top ASINs
            asin_data = asin_map.get(mid)
            if asin_data and asin_data.get("topAsins"):
                o["topAsins"] = [a.strip() for a in str(asin_data["topAsins"]).split(",") if a.strip()]
                o["hasAsin"] = True
            else:
                o["topAsins"] = []
                o["hasAsin"] = False

            # payment risk
            pr = payment_risk_map.get(mid)
            if pr:
                risk_months = str(pr.get("paymentRiskMonths") or "").strip()
                invoice_months = str(pr.get("invoiceMonths") or "").strip()
                paid_months = str(pr.get("paidInvoiceMonths") or "").strip()
                has_risk = bool(int(pr.get("hasPaymentRisk") or 0))
                unpaid = float(pr.get("unpaidCommissionOwed") or 0)

                o["paymentRisk"] = has_risk
                o["paymentRiskMonths"] = [m.strip() for m in risk_months.split(",") if m.strip()] if risk_months else []
                o["invoiceMonths"] = [m.strip() for m in invoice_months.split(",") if m.strip()] if invoice_months else []
                o["paidInvoiceMonths"] = [m.strip() for m in paid_months.split(",") if m.strip()] if paid_months else []
                o["unpaidSales"] = round(float(pr.get("unpaidSales") or 0), 2)
                o["unpaidCommissionOwed"] = round(unpaid, 2)
                o["unpaidCpcCommissionOwed"] = None  # not tracked separately in DB

                if has_risk:
                    o["paymentState"] = "unpaid"
                    month_labels = [m for m in o["paymentRiskMonths"]]
                    o["paymentStatus"] = f"{' + '.join(month_labels)} Not Paid" if month_labels else "Unpaid"
                elif paid_months:
                    o["paymentState"] = "paid"
                    o["paymentStatus"] = f"Paid in {' + '.join(o['paidInvoiceMonths'])}"
                elif invoice_months:
                    o["paymentState"] = "invoice_unknown"
                    o["paymentStatus"] = "No payment issue found"
                else:
                    o["paymentState"] = "not_available"
                    o["paymentStatus"] = "No payment issue found"
            else:
                o["paymentRisk"] = False
                o["paymentRiskMonths"] = []
                o["invoiceMonths"] = []
                o["paidInvoiceMonths"] = []
                o["unpaidSales"] = None
                o["unpaidCommissionOwed"] = None
                o["unpaidCpcCommissionOwed"] = None
                o["paymentState"] = "not_available"
                o["paymentStatus"] = "No payment issue found"

            # split pipe-delimited product keyword fields (productAsins only;
            # productTitles/productKeywords are lazy-loaded via /api/ui/db/keywords)
            for field in ("productAsins",):
                val = o.get(field)
                if isinstance(val, str) and val.strip():
                    o[field] = [item.strip() for item in val.split("|") if item.strip()]
                else:
                    o[field] = []

        # ── payment records (with computed fields matching static shape) ──
        payment_records = []
        for pr in payment_records_raw:
            record = dict(pr)
            # Convert numeric types
            for num_field in ("revenueMade", "commissionMade", "expectedPaymentAmount",
                              "paidAmount", "remainingAmount"):
                if record.get(num_field) is not None:
                    record[num_field] = float(record[num_field])
            if record.get("paymentCycle") is not None:
                record["paymentCycle"] = int(record["paymentCycle"])
            record["isPlaceholder"] = bool(record.get("isPlaceholder"))
            payment_records.append(record)

        # ── payment summary ──
        def _payment_summary(records: list[dict]) -> dict:
            if not records:
                return {
                    "recordCount": 0, "totalRevenueMade": 0, "totalCommissionMade": 0,
                    "totalPaidAmount": 0, "totalUnpaidAmount": 0, "totalPendingAmount": 0,
                    "totalOverdueAmount": 0, "unpaidMerchantCount": 0,
                    "pendingMerchantCount": 0, "paidMerchantCount": 0, "overdueMerchantCount": 0,
                }
            return {
                "recordCount": len(records),
                "totalRevenueMade": round(sum(r.get("revenueMade", 0) or 0 for r in records), 2),
                "totalCommissionMade": round(sum(r.get("commissionMade", 0) or 0 for r in records), 2),
                "totalPaidAmount": round(sum(r.get("paidAmount", 0) or 0 for r in records), 2),
                "totalUnpaidAmount": round(sum(r.get("remainingAmount", 0) or 0 for r in records if r.get("paymentStatus") == "Unpaid"), 2),
                "totalPendingAmount": round(sum(r.get("remainingAmount", 0) or 0 for r in records if r.get("paymentStatus") == "Pending"), 2),
                "totalOverdueAmount": round(sum(r.get("remainingAmount", 0) or 0 for r in records if r.get("paymentStatus") == "Overdue"), 2),
                "unpaidMerchantCount": len(set(r["merchantId"] for r in records if r.get("paymentStatus") == "Unpaid" and r.get("merchantId"))),
                "pendingMerchantCount": len(set(r["merchantId"] for r in records if r.get("paymentStatus") == "Pending" and r.get("merchantId"))),
                "paidMerchantCount": len(set(r["merchantId"] for r in records if r.get("paymentStatus") == "Paid" and r.get("merchantId"))),
                "overdueMerchantCount": len(set(r["merchantId"] for r in records if r.get("paymentStatus") == "Overdue" and r.get("merchantId"))),
            }

        # ── summary ──
        tier_rows = fetch_all(conn,
            "SELECT tier, COUNT(*) AS cnt FROM cnpscy_oi_tier_assignments GROUP BY tier ORDER BY cnt DESC")
        # Build network summary from already-merged offers
        from collections import Counter as _Counter
        _net_counts = _Counter(o.get("network") or "Unknown" for o in offers)
        network_rows = [{"network": k, "cnt": v} for k, v in _net_counts.most_common()]
        cat_rows = fetch_all(conn,
            "SELECT c_main.categoryName, COUNT(DISTINCT mc.merchantId) AS cnt "
            "FROM cnpscy_oi_merchant_category mc "
            "JOIN cnpscy_oi_category c_main ON mc.categoryId = c_main.categoryId AND c_main.level = 1 "
            "GROUP BY c_main.categoryName ORDER BY cnt DESC LIMIT 40")

        summary = {
            "offerCount": len(offers),
            "generatedAt": utc_now_iso(),
            "month": month,
            "tiers": {r["tier"]: r["cnt"] for r in tier_rows},
            "networks": {r["network"] or "Unknown": r["cnt"] for r in network_rows},
            "categories": {r["categoryName"]: r["cnt"] for r in cat_rows},
            "notPaidCount": sum(1 for o in offers if o.get("paymentRisk")),
            "paymentSummary": _payment_summary(payment_records),
        }

        # ── build tier sheets from offers data ──
        TIER_ORDER = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
        SHEET_COLUMNS = [
            ("merchantId", "Merchant ID"),
            ("merchantName", "Merchant Name"),
            ("brand", "Brand"),
            ("network", "Network"),
            ("commissionRate", "Commission Rate"),
            ("orders", "Order count"),
            ("salesAmount", "Revenue"),
            ("epc", "Backend EPC"),
            ("aov", "AOV"),
            ("conversionRate", "Conversion"),
            ("clicks", "Clicks"),
            ("dpv", "DPV"),
            ("atc", "ATC"),
            ("visualStatusColor", "Color"),
            ("visualStatusCode", "Visual Status Code"),
            ("visualStatusReason", "Visual Status Reason"),
            ("visualStatusSource", "Visual Status Source"),
            ("category", "Category"),
            ("region", "COUNTRY"),
            ("reason", "Tier Reason"),
            ("recommendation", "Recommendation"),
            ("phase", "Phase"),
            ("publisherCount", "Publisher Count"),
            ("successRate", "Success Rate"),
            ("publisherCountJune", "Publisher Count June"),
            ("successRateJune", "Success Rate June"),
            ("paymentCycle", "Payment Cycle"),
            ("completionRate", "Completion Rate"),
            ("recommendedLink", "Recommended Link"),
            ("bestSubCategoryBsr", "Best Sub Category BSR"),
            ("hasDiscount", "Has Discount"),
            ("discountInfo", "Discount Info"),
            ("dealInfo", "Deal Info"),
            ("cpc", "CPC"),
            ("backendMatchStatus", "Backend Match Status"),
            ("timeline", "Timeline"),
            ("payout", "Payout"),
            ("affiliatePayout", "Affiliate Payout"),
        ]
        sheet_headers = [col_name for _, col_name in SHEET_COLUMNS]

        def _fmt(val: Any) -> str:
            if val is None:
                return ""
            if isinstance(val, float):
                return f"{val:.2f}"
            return str(val)

        sheets = []
        for tier_name in TIER_ORDER:
            tier_offers = [o for o in offers if o.get("tier") == tier_name]
            if not tier_offers:
                continue
            tier_rows = []
            for o in tier_offers:
                row = {col_name: _fmt(o.get(field)) for field, col_name in SHEET_COLUMNS}
                tier_rows.append(row)
            sheets.append({
                "name": tier_name,
                "headers": sheet_headers,
                "rows": tier_rows,
            })

        result = {
            "ok": True,
            "checkedAt": utc_now_iso(),
            "month": month,
            "offers": [compact_api_row(o) for o in offers],
            "paymentRecords": [compact_api_row(r) for r in payment_records],
            "sheets": sheets,
            "summary": summary,
        }
        _save_cache(OFFERS_CACHE_FILE, result)
        return result


def _tier_report_metric_map(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("merchantId") or "").strip(): row
        for row in rows
        if str(row.get("merchantId") or "").strip()
    }


def merge_tier_report_metrics(
    base_rows: list[dict[str, Any]],
    order_rows: list[dict[str, Any]],
    click_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge metrics using the same advertiser click rule as YeahPromos."""
    orders_by_merchant = _tier_report_metric_map(order_rows)
    clicks_by_merchant = _tier_report_metric_map(click_rows)
    merged: list[dict[str, Any]] = []
    for base in base_rows:
        row = dict(base)
        merchant_id = str(row.get("Merchant ID") or "").strip()
        order = orders_by_merchant.get(merchant_id, {})
        tracked = clicks_by_merchant.get(merchant_id, {})
        order_clicks = to_float(order.get("orderClicks"))
        tracked_clicks = to_float(tracked.get("trackedClicks"))
        clicks = order_clicks if order_clicks > 0 else tracked_clicks
        orders = to_float(order.get("orders"))
        revenue = to_float(order.get("revenue"))

        row.update({
            "Order count": clean_decimal(orders, 0),
            "Revenue": clean_decimal(revenue, 2),
            "Backend EPC": clean_decimal(revenue / clicks if clicks else 0, 6),
            "AOV": clean_decimal(revenue / orders if orders else 0, 6),
            "Conversion Rate": clean_decimal(orders / clicks if clicks else 0, 8),
            "Clicks": clean_decimal(clicks, 0),
            "DPV": clean_decimal(order.get("dpv"), 0),
            "ATC": clean_decimal(order.get("atc"), 0),
            "Payout": clean_decimal(order.get("payout"), 2),
            "Affiliate Payout": clean_decimal(order.get("affiliatePayout"), 2),
        })
        merged.append(row)
    return merged


def tier_sheet_payload(
    tier_name: str,
    month: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    compact: bool = False,
) -> dict[str, Any]:
    """Return a tier sheet backed by the YeahPromos Amazon report tables."""
    valid_tiers = {"Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"}
    if tier_name not in valid_tiers:
        raise ValueError(f"Invalid tier: {tier_name}. Must be one of {sorted(valid_tiers)}")

    range_start, range_end = resolve_tier_report_date_range(start_date, end_date, month)
    start_key = range_start.isoformat()
    end_key = range_end.isoformat()
    start_day = int(range_start.strftime("%Y%m%d"))
    end_day = int(range_end.strftime("%Y%m%d"))
    cache_key = f"tiersheet:{tier_name}:{start_key}:{end_key}:{'compact' if compact else 'full'}"
    now = time.time()
    cached = _tier_sheet_cache.get(cache_key)
    if cached is not None and now - cached[0] < TIER_REPORT_CACHE_TTL:
        return cached[1]

    with db_connection() as conn:
        if compact:
            base_rows = fetch_all(
                conn,
                """
                SELECT
                    MAX(COALESCE(CAST(a.advert_id AS CHAR), t.merchantId)) AS `Merchant ID`,
                    MAX(a.advert_name) AS `Merchant Name`,
                    MAX(a.advert_name) AS `Brand`,
                    MAX(COALESCE(NULLIF(TRIM(at.advert_type_name), ''), 'Unknown')) AS `Network`,
                    MAX(a.advert_money) AS `Commission Rate`
                FROM cnpscy_oi_tier_assignments t
                LEFT JOIN cnpscy_advert a
                    ON a.advert_id = CAST(t.merchantId AS UNSIGNED) AND a.advert_isdel = 1
                LEFT JOIN cnpscy_advert_type at
                    ON a.advert_advertiser = at.advert_type_id AND at.advert_type_parent_id = 53
                WHERE t.tier = %s
                GROUP BY t.merchantId
                ORDER BY CAST(t.merchantId AS UNSIGNED)
                """,
                (tier_name,),
            )
        else:
            base_rows = fetch_all(
            conn,
            """
            SELECT
                MAX(COALESCE(CAST(a.advert_id AS CHAR), t.merchantId)) AS `Merchant ID`,
                MAX(a.advert_name) AS `Merchant Name`,
                MAX(a.advert_name) AS `Brand`,
                MAX(COALESCE(NULLIF(TRIM(at.advert_type_name), ''), pr_net.network, 'Unknown')) AS `Network`,
                MAX(a.advert_money) AS `Commission Rate`,
                MAX(vs.color) AS `Color`,
                MAX(vs.reason_code) AS `Visual Status Code`,
                MAX(vs.reason_text) AS `Visual Status Reason`,
                MAX(vs.source) AS `Visual Status Source`,
                MAX(cat.mainCategory) AS `Category`,
                MAX(sm.region) AS `COUNTRY`,
                MAX(sm.reason) AS `Tier Reason`,
                MAX(sm.recommendation) AS `Recommendation`,
                MAX(sm.phase) AS `Phase`,
                MAX(sm.publisherCount) AS `Publisher Count`,
                MAX(sm.successRate) AS `Success Rate`,
                MAX(sm.publisherCountJune) AS `Publisher Count June`,
                MAX(sm.successRateJune) AS `Success Rate June`,
                MAX(sm.paymentCycle) AS `Payment Cycle`,
                MAX(sm.completionRate) AS `Completion Rate`,
                MAX(sm.recommendedLink) AS `Recommended Link`,
                MAX(sm.bestSubCategoryBsr) AS `Best Sub Category BSR`
            FROM cnpscy_oi_tier_assignments t
            LEFT JOIN cnpscy_advert a
                ON a.advert_id = CAST(t.merchantId AS UNSIGNED) AND a.advert_isdel = 1
            LEFT JOIN (
                SELECT merchantId, MAX(network) AS network
                FROM cnpscy_oi_payment_records
                GROUP BY merchantId
            ) pr_net ON t.merchantId = pr_net.merchantId
            LEFT JOIN cnpscy_advert_type at
                ON a.advert_advertiser = at.advert_type_id AND at.advert_type_parent_id = 53
            LEFT JOIN cnpscy_oi_tier_visual_status vs ON t.merchantId = vs.merchantId
            LEFT JOIN (
                SELECT mc2.merchantId, MAX(c2_main.categoryName) AS mainCategory
                FROM cnpscy_oi_merchant_category mc2
                LEFT JOIN cnpscy_oi_category c2_main
                    ON mc2.categoryId = c2_main.categoryId AND c2_main.level = 1
                GROUP BY mc2.merchantId
            ) cat ON t.merchantId = cat.merchantId
            LEFT JOIN cnpscy_oi_offer_sheet_metadata sm ON t.merchantId = sm.merchantId
            WHERE t.tier = %s
            GROUP BY t.merchantId
            ORDER BY CAST(t.merchantId AS UNSIGNED)
            """,
            (tier_name,),
            )
        order_rows = fetch_all(
            conn,
            """
            SELECT
                CAST(o.advert_id AS CHAR) AS merchantId,
                SUM(COALESCE(o.total_purchases, 0)) AS orders,
                SUM(COALESCE(o.amount, 0)) AS revenue,
                SUM(COALESCE(o.payout, 0)) AS payout,
                SUM(COALESCE(o.aff_payout, 0)) AS affiliatePayout,
                SUM(COALESCE(o.detail_page_views, 0)) AS dpv,
                SUM(COALESCE(o.add_to_carts, 0)) AS atc,
                SUM(COALESCE(o.total_clicks, 0)) AS orderClicks
            FROM cnpscy_amazon_order o
            INNER JOIN cnpscy_oi_tier_assignments t
                ON o.advert_id = CAST(t.merchantId AS UNSIGNED)
            WHERE t.tier = %s AND o.order_time_day BETWEEN %s AND %s
            GROUP BY o.advert_id
            """,
            (tier_name, start_day, end_day),
        )
        click_rows = fetch_all(
            conn,
            """
            SELECT
                CAST(c.advert_id AS CHAR) AS merchantId,
                SUM(COALESCE(c.click, 0)) AS trackedClicks
            FROM cnpscy_amazon_click c
            INNER JOIN cnpscy_oi_tier_assignments t
                ON c.advert_id = CAST(t.merchantId AS UNSIGNED)
            WHERE t.tier = %s AND c.time_day BETWEEN %s AND %s
            GROUP BY c.advert_id
            """,
            (tier_name, start_day, end_day),
        )

    rows = merge_tier_report_metrics(base_rows, order_rows, click_rows)
    headers = list(rows[0].keys()) if rows else []
    result = {
        "ok": True,
        "checkedAt": utc_now_iso(),
        "tier": tier_name,
        "month": range_start.strftime("%Y-%m") if range_start.year == range_end.year and range_start.month == range_end.month else "",
        "startDate": start_key,
        "endDate": end_key,
        "compact": compact,
        "headers": headers,
        "rows": [{key: str(value) if value is not None else "" for key, value in row.items()} for row in rows],
        "source": {
            "report": "YeahPromos Amazon Report",
            "dimension": "advert_id",
            "metricsTables": ["cnpscy_amazon_order", "cnpscy_amazon_click"],
            "merchantTables": ["cnpscy_advert", "cnpscy_advert_type"],
            "tierTable": "cnpscy_oi_tier_assignments",
        },
    }
    _tier_sheet_cache[cache_key] = (now, result)
    return result


def product_keywords_payload(force_refresh: bool = False) -> dict[str, Any]:
    """从 cnpscy_oi_product_keywords 返回产品关键词数据，
    兼容 window.PRODUCT_KEYWORDS 的 shape。结果缓存在 db_keywords_cache.json。
    """
    if not force_refresh:
        cached = _load_any_cache(KEYWORDS_CACHE_FILE)
        if cached is not None:
            age = _cache_age(KEYWORDS_CACHE_FILE)
            if age is not None and age < CACHE_TTL_SECONDS:
                return cached
            if not _bg_refresh_running.get("keywords"):
                _bg_refresh_running["keywords"] = True
                import threading as _th
                _th.Thread(target=lambda: (
                    _save_cache(KEYWORDS_CACHE_FILE, _build_keywords_payload()),
                    _bg_refresh_running.__setitem__("keywords", False)
                ), daemon=True).start()
            return cached

    return _build_keywords_payload()


def _build_keywords_payload() -> dict[str, Any]:
    """Internal: heavy DB query to build keywords payload from scratch."""
    with db_connection() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT
                merchantId, merchantName, brandKey,
                productNameCount, productAsinCount,
                productAsins, productTitles, productKeywords
            FROM cnpscy_oi_product_keywords
            ORDER BY CAST(merchantId AS UNSIGNED)
            """,
        )

    merchants = []
    for r in rows:
        def _split(value: Any) -> list[str]:
            if not value:
                return []
            text = str(value).strip()
            if not text:
                return []
            if "|" in text:
                return [item.strip() for item in text.split("|") if item.strip()]
            return [item.strip() for item in text.split(",") if item.strip()]

        merchants.append({
            "merchantId": str(r.get("merchantId", "")),
            "merchantName": str(r.get("merchantName") or ""),
            "brandKey": str(r.get("brandKey") or ""),
            "productNameCount": int(r.get("productNameCount") or 0),
            "productAsinCount": int(r.get("productAsinCount") or 0),
            "productAsins": _split(r.get("productAsins")),
            "productTitles": _split(r.get("productTitles")),
            "productKeywords": _split(r.get("productKeywords")),
        })

    result = {
        "ok": True,
        "checkedAt": utc_now_iso(),
        "summary": {
            "source": "cnpscy_oi_product_keywords",
            "merchantCount": len(merchants),
        },
        "merchants": merchants,
    }
    _save_cache(KEYWORDS_CACHE_FILE, result)
    return result


# ── publishers cache ──────────────────────────────────────────────────


def publishers_payload(force_refresh: bool = False) -> dict[str, Any]:
    """从 db_publishers_cache.json 读取聚合的媒介数据。

    遵循 offers_payload 的缓存模式: 内存缓存 + 文件缓存 + TTL + 后台刷新。
    数据由 scripts/build_publishers_data.py 构建。
    """
    global _publishers_memory_cache
    now = time.time()

    if not force_refresh and _publishers_memory_cache is not None:
        ts, payload = _publishers_memory_cache
        if now - ts < PUBLISHERS_CACHE_TTL:
            return payload

    if not force_refresh:
        cached = _load_any_cache(PUBLISHERS_CACHE_FILE)
        if cached is not None:
            age = _cache_age(PUBLISHERS_CACHE_FILE)
            if age is not None and age < PUBLISHERS_CACHE_TTL:
                _publishers_memory_cache = (now, cached)
                return cached
            # Stale: return stale, trigger background refresh
            _publishers_memory_cache = (now, cached)
            if not _bg_refresh_running.get("publishers"):
                _bg_refresh_running["publishers"] = True

                def _refresh_publishers():
                    global _publishers_memory_cache
                    try:
                        cached_file = _load_any_cache(PUBLISHERS_CACHE_FILE)
                        if cached_file is not None:
                            _publishers_memory_cache = (time.time(), cached_file)
                    finally:
                        _bg_refresh_running["publishers"] = False

                threading.Thread(target=_refresh_publishers, daemon=True).start()
            return cached

    cached = _load_any_cache(PUBLISHERS_CACHE_FILE)
    if cached is None:
        return {"ok": False, "error": "Publishers cache not built yet. Run scripts/build_publishers_data.py first."}
    _publishers_memory_cache = (now, cached)
    return cached


def compact_api_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    output = {}
    for key, value in row.items():
        if value is None or value == "":
            continue
        if isinstance(value, (dt.datetime, dt.date)):
            value = normalize_compact_date(value)
        output[key] = value
    return output
