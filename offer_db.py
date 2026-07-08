from __future__ import annotations

import datetime as dt
import hmac
import json
import os
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

from browser_payloads import read_browser_payload


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
    target.send_response(status)
    target.send_header("Access-Control-Allow-Origin", "*")
    target.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Offer-Db-Token")
    target.send_header("Access-Control-Allow-Methods", methods)
    target.send_header("Cache-Control", "no-store")
    target.send_header("Content-Type", "application/json; charset=utf-8")
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
        "read_timeout": int(os.environ.get("OFFER_DB_READ_TIMEOUT", "20")),
        "write_timeout": int(os.environ.get("OFFER_DB_WRITE_TIMEOUT", "20")),
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


def read_static_chatbot_text() -> str:
    try:
        return read_browser_payload("chatbot_data.js")
    except OSError:
        pass

    candidates = []
    explicit_url = os.environ.get("OFFER_STATIC_DATA_URL", "").strip()
    if explicit_url:
        candidates.append(explicit_url)
    for key in ("VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL"):
        host = os.environ.get(key, "").strip()
        if host:
            candidates.append(
                f"https://{host.removeprefix('https://').removeprefix('http://')}/api/auth/data?file=chatbot_data.js"
            )

    for url in candidates:
        try:
            with urlopen(url, timeout=15) as response:
                return response.read().decode("utf-8", "replace")
        except OSError:
            continue
    return ""


def read_static_merchant_ids() -> list[str]:
    text = read_static_chatbot_text()
    if not text:
        return read_static_merchant_id_manifest().get("merchantIds", [])
    match = re.search(r"window\.CHATBOT_DATA\s*=\s*(\{.*\});\s*$", text, re.S)
    if not match:
        return read_static_merchant_id_manifest().get("merchantIds", [])
    payload = json.loads(match.group(1))
    ids = []
    seen = set()
    for offer in payload.get("offers", []):
        merchant_id = re.sub(r"\.0$", "", str(offer.get("merchantId") or "").strip())
        if DIGITS_RE.match(merchant_id) and merchant_id not in seen:
            ids.append(merchant_id)
            seen.add(merchant_id)
    return ids


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


def latest_dates(conn) -> dict[str, Any]:
    sources = {
        "amazonOrders": ("cnpscy_amazon_order", ["order_time_day"]),
        "amazonClicks": ("cnpscy_amazon_click", ["time_day", "click_time_day"]),
        "aggregateOrders": ("cnpscy_order_new_aggregate", ["order_time_day", "time_day"]),
        "products": ("cnpscy_amazon_product", ["updated_at", "update_time", "created_at"]),
        "productExtra": ("cnpscy_amazon_product_extra", ["updated_at", "update_time", "created_at"]),
    }
    output = {}
    for key, (table, candidates) in sources.items():
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


def recent_month_summary(conn, months: int = 3) -> dict[str, list[dict[str, Any]]]:
    output: dict[str, list[dict[str, Any]]] = {}

    order_cols = table_columns(conn, "cnpscy_amazon_order")
    order_date = pick_column(order_cols, ["order_time_day"])
    order_id = pick_column(order_cols, ["advert_id", "merchant_id"])
    if order_date and order_id:
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
            GROUP BY month
            ORDER BY month DESC
            LIMIT {int(months)}
            """,
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
            GROUP BY month
            ORDER BY month DESC
            LIMIT {int(months)}
            """,
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
                   {sum_expr("a", aggregate_cols, ["amount", "sales_amount", "revenue"], "revenue")},
                   {sum_expr("a", aggregate_cols, ["payout", "commission"], "payout")},
                   {sum_expr("a", aggregate_cols, ["order_num", "orders"], "orders")}
            FROM {q("cnpscy_order_new_aggregate")} a
            GROUP BY month
            ORDER BY month DESC
            LIMIT {int(months)}
            """,
        )
        output["aggregateOrders"] = [format_metric_row(row) for row in rows]

    return output


def daily_status_trend(
    conn,
    days: int | None = None,
    delay_days: int | None = None,
    latest: dict[str, Any] | None = None,
    month: str | None = None,
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
    complete_through = min(primary_latest, expected_complete)
    bucket: dict[str, dict[str, Any]] = {}
    start_key = start.strftime("%Y%m%d")
    end_key = end.strftime("%Y%m%d")

    aggregate_cols = table_columns(conn, "cnpscy_order_new_aggregate")
    aggregate_date = pick_column(aggregate_cols, ["order_time_day", "time_day"])
    if aggregate_date:
        rows = fetch_all(
            conn,
            f"""
            SELECT CAST(a.{q(aggregate_date)} AS CHAR) AS day,
                   COUNT(*) AS aggregateRows,
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
            for key in ("aggregateRows", "orders", "revenue", "payout", "affiliatePayout", "cpcLeads"):
                number = to_float(row.get(key))
                target[key] = int(number) if number.is_integer() else round(number, 6)

    order_cols = table_columns(conn, "cnpscy_amazon_order")
    order_date = pick_column(order_cols, ["order_time_day"])
    if order_date:
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
        complete_through = min(latest_in_range, expected_complete)
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


def status_payload(month: str | None = None) -> dict[str, Any]:
    with db_connection() as conn:
        static_ids = read_static_merchant_ids()
        latest = latest_dates(conn)
        coverage = {
            "staticNumericMerchantIds": len(static_ids),
            "cnpscy_advert": count_distinct_for_ids(conn, "cnpscy_advert", ["advert_id", "merchant_id"], static_ids),
            "cnpscy_amazon_product": count_distinct_for_ids(conn, "cnpscy_amazon_product", ["advert_id", "merchant_id"], static_ids),
            "cnpscy_amazon_product_extra": count_distinct_for_ids(conn, "cnpscy_amazon_product_extra", ["advert_id", "merchant_id"], static_ids),
            "cnpscy_order_new_aggregate": count_distinct_for_ids(conn, "cnpscy_order_new_aggregate", ["advert_id", "merchant_id"], static_ids),
        }
        return {
            "ok": True,
            "checkedAt": utc_now_iso(),
            "staticSnapshot": {
                "generatedAt": static_chatbot_generated_at(),
                "merchantIds": len(static_ids),
            },
            "latestDates": latest,
            "coverage": coverage,
            "dailyTrend": daily_status_trend(conn, latest=latest, month=month),
            "recentMonths": recent_month_summary(conn),
        }


def static_chatbot_generated_at() -> str | None:
    text = read_static_chatbot_text()
    if not text:
        return read_static_merchant_id_manifest().get("generatedAt")
    match = re.search(r'"generatedAt"\s*:\s*"([^"]+)"', text[:5000])
    return match.group(1) if match else read_static_merchant_id_manifest().get("generatedAt")


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
        first_expr(sources, ["network", "agency", "platform", "source"], "network"),
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
    with db_connection() as conn:
        merchant = merchant_base(conn, merchant_id)
        return {
            "ok": True,
            "checkedAt": utc_now_iso(),
            "merchantId": merchant_id,
            "merchant": merchant,
            "products": merchant_products(conn, merchant_id, product_limit),
            "monthlyAmazonMetrics": merchant_amazon_metrics(conn, merchant_id, months),
            "monthlyAggregateMetrics": merchant_aggregate_metrics(conn, merchant_id, months),
        }


def search_payload(query_text: str, limit: int = 25) -> dict[str, Any]:
    query_text = query_text.strip()
    if len(query_text) < 2:
        return {"ok": True, "checkedAt": utc_now_iso(), "query": query_text, "results": []}
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
            first_expr(sources, ["network", "agency", "platform", "source"], "network"),
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
