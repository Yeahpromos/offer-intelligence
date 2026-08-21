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
from decimal import Decimal, InvalidOperation
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
MAX_BRAND_MEDIA_TREND_RANGE_DAYS = 731
TIER1_MANUAL_SOURCE = "offer-intelligence-tier1-add"
TIER1_NAME = "Tier 1"
DEFAULT_AFF_PROPORTION = 0.75
MANAGED_TIER_NAMES = {"Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"}
MONTH_KEY_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
MERCHANT_AOV_ESTIMATES_TABLE = "cnpscy_oi_merchant_aov_estimates"
MERCHANT_AOV_ESTIMATES_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS cnpscy_oi_merchant_aov_estimates (
  estimateId          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  merchantId          VARCHAR(32) NOT NULL,
  merchantName        VARCHAR(255) DEFAULT NULL,
  aov                 DECIMAL(12, 6) NOT NULL,
  currency            VARCHAR(8) DEFAULT NULL,
  sampleProductCount  SMALLINT UNSIGNED NOT NULL DEFAULT 5,
  method              VARCHAR(64) NOT NULL DEFAULT 'five_product_average',
  sourceFile          VARCHAR(255) NOT NULL,
  sourceDate          DATE NOT NULL,
  importedBy          VARCHAR(128) DEFAULT NULL,
  createdAt           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (estimateId),
  UNIQUE KEY uq_merchant_aov_source_date (merchantId, sourceDate),
  KEY idx_merchant_aov_latest (merchantId, sourceDate),
  KEY idx_merchant_aov_method (method)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
""".strip()
MONTHLY_NEW_MERCHANTS_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS cnpscy_oi_monthly_new_merchants (
  recordId         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reportMonth      VARCHAR(7) NOT NULL,
  merchantId       VARCHAR(64) DEFAULT NULL,
  merchantName     VARCHAR(180) NOT NULL,
  businessManager  VARCHAR(128) DEFAULT NULL,
  program          VARCHAR(128) DEFAULT NULL,
  platform         VARCHAR(128) DEFAULT NULL,
  gmvRequirement   VARCHAR(255) DEFAULT NULL,
  pastMonthPurchase VARCHAR(255) DEFAULT NULL,
  independentWebsites VARCHAR(255) DEFAULT NULL,
  reviewSummary    VARCHAR(255) DEFAULT NULL,
  ourCommission    DECIMAL(7, 2) DEFAULT NULL,
  presetCommission DECIMAL(7, 2) DEFAULT NULL,
  isPriority       TINYINT(1) NOT NULL DEFAULT 0,
  gmvMonthlyTarget DECIMAL(18, 2) DEFAULT NULL,
  completionReward VARCHAR(1000) DEFAULT NULL,
  createdBy        VARCHAR(128) DEFAULT NULL,
  updatedBy        VARCHAR(128) DEFAULT NULL,
  createdAt        DATETIME NOT NULL,
  updatedAt        DATETIME NOT NULL,
  PRIMARY KEY (recordId),
  UNIQUE KEY uq_monthly_new_merchant_id (reportMonth, merchantId),
  UNIQUE KEY uq_monthly_new_merchant_name (reportMonth, merchantName),
  KEY idx_monthly_new_month (reportMonth)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
""".strip()
MONTHLY_NEW_MERCHANT_COLUMN_MIGRATIONS = {
    "program": (
        "ALTER TABLE cnpscy_oi_monthly_new_merchants "
        "ADD COLUMN program VARCHAR(128) DEFAULT NULL AFTER businessManager"
    ),
    "platform": (
        "ALTER TABLE cnpscy_oi_monthly_new_merchants "
        "ADD COLUMN platform VARCHAR(128) DEFAULT NULL AFTER program"
    ),
    "gmvRequirement": (
        "ALTER TABLE cnpscy_oi_monthly_new_merchants "
        "ADD COLUMN gmvRequirement VARCHAR(255) DEFAULT NULL AFTER platform"
    ),
    "pastMonthPurchase": (
        "ALTER TABLE cnpscy_oi_monthly_new_merchants "
        "ADD COLUMN pastMonthPurchase VARCHAR(255) DEFAULT NULL AFTER gmvRequirement"
    ),
    "independentWebsites": (
        "ALTER TABLE cnpscy_oi_monthly_new_merchants "
        "ADD COLUMN independentWebsites VARCHAR(255) DEFAULT NULL AFTER pastMonthPurchase"
    ),
    "reviewSummary": (
        "ALTER TABLE cnpscy_oi_monthly_new_merchants "
        "ADD COLUMN reviewSummary VARCHAR(255) DEFAULT NULL AFTER independentWebsites"
    ),
    "ourCommission": (
        "ALTER TABLE cnpscy_oi_monthly_new_merchants "
        "ADD COLUMN ourCommission DECIMAL(7, 2) DEFAULT NULL AFTER reviewSummary"
    ),
    "presetCommission": (
        "ALTER TABLE cnpscy_oi_monthly_new_merchants "
        "ADD COLUMN presetCommission DECIMAL(7, 2) DEFAULT NULL AFTER ourCommission"
    ),
    "isPriority": (
        "ALTER TABLE cnpscy_oi_monthly_new_merchants "
        "ADD COLUMN isPriority TINYINT(1) NOT NULL DEFAULT 0 AFTER presetCommission"
    ),
}
MONTHLY_NEW_MERCHANT_ANNOTATIONS_TABLE = "cnpscy_oi_monthly_new_merchant_annotations"
MONTHLY_NEW_MERCHANT_ANNOTATIONS_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS cnpscy_oi_monthly_new_merchant_annotations (
  recordId                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reportMonth              VARCHAR(7) NOT NULL,
  merchantId               VARCHAR(64) NOT NULL,
  merchantNameSnapshot     VARCHAR(180) DEFAULT NULL,
  businessManagerSnapshot  VARCHAR(128) DEFAULT NULL,
  sourceAddedAt            DATETIME DEFAULT NULL,
  isPriority               TINYINT(1) NOT NULL DEFAULT 0,
  gmvMonthlyTarget         DECIMAL(18, 2) DEFAULT NULL,
  completionReward         VARCHAR(1000) DEFAULT NULL,
  createdBy                VARCHAR(128) DEFAULT NULL,
  updatedBy                VARCHAR(128) DEFAULT NULL,
  createdAt                DATETIME NOT NULL,
  updatedAt                DATETIME NOT NULL,
  PRIMARY KEY (recordId),
  UNIQUE KEY uq_monthly_new_merchant_annotation (reportMonth, merchantId),
  KEY idx_monthly_new_merchant_priority (reportMonth, isPriority, sourceAddedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
""".strip()
MONTHLY_NEW_MERCHANT_DATE_COLUMNS = (
    "advert_add_time",
    "advert_addtime",
    "advert_created_at",
    "advert_create_time",
    "advert_createtime",
    "advert_create_date",
    "advert_apply_time",
    "advert_reg_time",
    "advert_start_time",
    "advert_start_date",
    "advert_online_time",
    "advert_publish_time",
    "created_at",
    "create_time",
    "createtime",
    "createdAt",
    "add_time",
    "addtime",
    "ctime",
    "reg_time",
    "register_time",
    "joined_at",
    "onboarded_at",
    "onboarding_date",
    "launch_date",
    "start_time",
    "start_date",
    "online_time",
    "publish_time",
)
MONTHLY_NEW_MERCHANT_BD_COLUMNS = (
    "advert_bd",
    "advert_bd_name",
    "bd",
    "bd_name",
    "business_manager",
    "businessManager",
    "account_manager",
    "accountManager",
    "sales_manager",
    "manager_name",
    "owner_name",
    "advert_manager",
    "advert_owner",
    "advert_admin",
    "advert_business",
    "advert_charge_name",
    "advert_follow_user",
)
_monthly_new_merchants_schema_ready = False
_monthly_new_merchants_schema_lock = threading.Lock()


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


def commission_percent_ratio(value: Any) -> float:
    """Convert a YeahPromos percentage value such as 7.5 into 0.075."""
    return max(0.0, to_float(value)) / 100


def commission_rate_from_amount(revenue: Any, commission: Any) -> float:
    revenue_value = to_float(revenue)
    if revenue_value <= 0:
        return 0.0
    return max(0.0, to_float(commission) / revenue_value)


def commission_amount_epc(commission: Any, clicks: Any) -> float:
    """Return the commission amount earned per click."""
    clicks_value = to_float(clicks)
    if clicks_value <= 0:
        return 0.0
    return to_float(commission) / clicks_value


def latest_merchant_aov_estimates(
    conn,
    merchant_ids: list[Any] | set[Any] | tuple[Any, ...],
) -> dict[str, dict[str, Any]]:
    """Return the newest persisted five-product AOV estimate per merchant."""
    required_columns = {
        "estimateId", "merchantId", "aov", "currency", "sampleProductCount",
        "method", "sourceFile", "sourceDate",
    }
    if not required_columns.issubset(table_columns(conn, MERCHANT_AOV_ESTIMATES_TABLE)):
        return {}

    normalized_ids = {
        str(merchant_id or "").strip()
        for merchant_id in merchant_ids
        if DIGITS_RE.match(str(merchant_id or "").strip())
    }
    if not normalized_ids:
        return {}

    result: dict[str, dict[str, Any]] = {}
    rows = fetch_all(
        conn,
        f"""
        SELECT e.merchantId, e.aov, e.currency, e.sampleProductCount,
               e.method, e.sourceFile, e.sourceDate
        FROM {q(MERCHANT_AOV_ESTIMATES_TABLE)} e
        LEFT JOIN {q(MERCHANT_AOV_ESTIMATES_TABLE)} newer
          ON newer.merchantId = e.merchantId
         AND (
              newer.sourceDate > e.sourceDate
              OR (newer.sourceDate = e.sourceDate AND newer.estimateId > e.estimateId)
         )
        WHERE newer.estimateId IS NULL
        """,
    )
    for row in rows:
        merchant_id = str(row.get("merchantId") or "").strip()
        if merchant_id in normalized_ids:
            result[merchant_id] = row
    return result


def resolve_merchant_aov(
    orders: Any,
    revenue: Any,
    estimate: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Resolve an AOV value and provenance without leaving inference to the UI."""
    order_count = to_float(orders)
    revenue_amount = to_float(revenue)
    if order_count > 0 and revenue_amount > 0:
        return {
            "aov": clean_decimal(revenue_amount / order_count, 6),
            "aovType": "actual",
            "aovSource": "cnpscy_amazon_order",
            "aovMethod": "revenue_divided_by_orders",
            "aovCurrency": None,
            "aovSampleProductCount": None,
            "aovSourceFile": None,
            "aovSourceDate": None,
        }

    estimate_value = to_float((estimate or {}).get("aov"))
    if estimate_value > 0:
        return {
            "aov": clean_decimal(estimate_value, 6),
            "aovType": "tentative",
            "aovSource": MERCHANT_AOV_ESTIMATES_TABLE,
            "aovMethod": (estimate or {}).get("method") or "five_product_average",
            "aovCurrency": (estimate or {}).get("currency") or None,
            "aovSampleProductCount": int((estimate or {}).get("sampleProductCount") or 5),
            "aovSourceFile": (estimate or {}).get("sourceFile") or None,
            "aovSourceDate": (estimate or {}).get("sourceDate") or None,
        }

    return {
        "aov": None,
        "aovType": "unavailable",
        "aovSource": None,
        "aovMethod": None,
        "aovCurrency": None,
        "aovSampleProductCount": None,
        "aovSourceFile": None,
        "aovSourceDate": None,
    }


def read_static_merchant_ids() -> list[str]:
    """? db_offers_cache.json ? static_merchant_ids.json ???? merchant ID ???"""
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
        "aggregation": "calendar_month",
        "cumulative": False,
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
        row["allEpc"] = round(commission_amount_epc(row["payout"], clicks), 6)
        row["affEpc"] = round(commission_amount_epc(row["affiliatePayout"], clicks), 6)
        row["epc"] = row["affEpc"]
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

    Tier membership comes from cnpscy_oi_tier_assignments. Orders, revenue,
    payout, and active merchants use cnpscy_order_new_aggregate; clicks use
    cnpscy_amazon_click. These are the same sources used by Report Overview,
    so the tier matrix reconciles with its headline metrics.
    """
    cache_key = f"tier_summary:{month or ''}"
    now = time.time()
    cached = _status_cache.get(cache_key)
    if cached is not None and now - cached[0] < STATUS_CACHE_TTL:
        return cached[1]

    with db_connection() as conn:
        start, end = resolve_tier_report_date_range(month=month)
        month = start.strftime("%Y-%m")
        start_key = start.strftime("%Y%m%d")
        end_key = end.strftime("%Y%m%d")

        aggregate_columns = table_columns(conn, "cnpscy_order_new_aggregate")
        aggregate_id = pick_column(aggregate_columns, ["advert_id", "merchant_id"])
        aggregate_date = pick_column(aggregate_columns, ["order_time_day", "time_day"])
        click_columns = table_columns(conn, "cnpscy_amazon_click")
        click_id = pick_column(click_columns, ["advert_id", "merchant_id"])
        click_date = pick_column(click_columns, ["time_day", "click_time_day"])
        click_metric = pick_column(click_columns, ["click", "clicks", "click_num"])

        if aggregate_id and aggregate_date:
            aggregate_subquery = f"""
                SELECT
                    CAST(a.{q(aggregate_id)} AS CHAR) AS merchantId,
                    {sum_expr("a", aggregate_columns, ["order_num", "orders"], "orders")},
                    {sum_expr("a", aggregate_columns, ["amount", "sales_amount", "revenue"], "revenue")},
                    {sum_expr("a", aggregate_columns, ["payout", "commission"], "payout")}
                FROM {q("cnpscy_order_new_aggregate")} a
                WHERE a.{q(aggregate_date)} BETWEEN %s AND %s
                GROUP BY a.{q(aggregate_id)}
            """
            click_join = ""
            click_select = "0 AS clicks"
            params: tuple[Any, ...] = (start_key, end_key)
            if click_id and click_date and click_metric:
                click_join = f"""
                    LEFT JOIN (
                        SELECT
                            CAST(c.{q(click_id)} AS CHAR) AS merchantId,
                            SUM(COALESCE(c.{q(click_metric)}, 0)) AS clicks
                        FROM {q("cnpscy_amazon_click")} c
                        WHERE c.{q(click_date)} BETWEEN %s AND %s
                        GROUP BY c.{q(click_id)}
                    ) c ON t.merchantId = c.merchantId
                """
                click_select = "COALESCE(SUM(c.clicks), 0) AS clicks"
                params += (start_key, end_key)

            rows = fetch_all(
                conn,
                f"""
                SELECT
                    t.tier,
                    COUNT(DISTINCT t.merchantId) AS assignedBrandCount,
                    COUNT(DISTINCT a.merchantId) AS brandCount,
                    COALESCE(SUM(a.orders), 0) AS orders,
                    COALESCE(SUM(a.revenue), 0) AS revenue,
                    {click_select},
                    COALESCE(SUM(a.payout), 0) AS payout
                FROM cnpscy_oi_tier_assignments t
                LEFT JOIN ({aggregate_subquery}) a
                    ON t.merchantId = a.merchantId
                {click_join}
                GROUP BY t.tier
                ORDER BY FIELD(t.tier, 'Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'BLACK TIER')
                """,
                params,
            )
        else:
            metrics_columns = table_columns(conn, "cnpscy_oi_offer_monthly_amazon_metrics")
            metrics_id = pick_column(metrics_columns, ["merchantId"])
            if not metrics_id:
                _status_cache[cache_key] = (now, {"ok": False, "month": month, "tiers": [], "total": None})
                return _status_cache[cache_key][1]

            rows = fetch_all(
                conn,
                f"""
                SELECT
                    t.tier,
                    COUNT(DISTINCT t.merchantId) AS assignedBrandCount,
                    COUNT(DISTINCT CASE
                        WHEN COALESCE(m.orders, 0) > 0 OR COALESCE(m.revenue, 0) > 0 OR COALESCE(m.clicks, 0) > 0
                        THEN t.merchantId END
                    ) AS brandCount,
                    COALESCE(SUM(m.orders), 0) AS orders,
                    COALESCE(SUM(m.revenue), 0) AS revenue,
                    COALESCE(SUM(m.clicks), 0) AS clicks,
                    COALESCE(SUM(m.payout), 0) AS payout
                FROM cnpscy_oi_tier_assignments t
                LEFT JOIN cnpscy_oi_offer_monthly_amazon_metrics m
                    ON t.merchantId = m.{q(metrics_id)} AND m.month = %s
                GROUP BY t.tier
                ORDER BY FIELD(t.tier, 'Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'BLACK TIER')
                """,
                (month,),
            )

        tier_columns = table_columns(conn, "cnpscy_oi_tier_assignments")
        moved_from_column = pick_column(tier_columns, ["movedFromTier", "moved_from_tier"])
        moved_at_column = pick_column(tier_columns, ["movedAt", "moved_at"])
        move_counts: dict[str, dict[str, int]] = {}
        if moved_from_column and moved_at_column:
            start_timestamp = f"{start.isoformat()} 00:00:00"
            end_timestamp = f"{(end + dt.timedelta(days=1)).isoformat()} 00:00:00"
            exit_rows = fetch_all(
                conn,
                f"""
                SELECT {q(moved_from_column)} AS tier,
                       COUNT(DISTINCT merchantId) AS tierExits
                FROM cnpscy_oi_tier_assignments
                WHERE {q(moved_at_column)} >= %s
                  AND {q(moved_at_column)} < %s
                  AND {q(moved_from_column)} IS NOT NULL
                  AND {q(moved_from_column)} <> tier
                GROUP BY {q(moved_from_column)}
                """,
                (start_timestamp, end_timestamp),
            )
            entry_rows = fetch_all(
                conn,
                f"""
                SELECT tier,
                       COUNT(DISTINCT merchantId) AS newEntries
                FROM cnpscy_oi_tier_assignments
                WHERE {q(moved_at_column)} >= %s
                  AND {q(moved_at_column)} < %s
                  AND {q(moved_from_column)} IS NOT NULL
                  AND {q(moved_from_column)} <> tier
                GROUP BY tier
                """,
                (start_timestamp, end_timestamp),
            )
            for row in exit_rows:
                tier_name = str(row.get("tier") or "")
                move_counts.setdefault(tier_name, {})["tierExits"] = int(to_float(row.get("tierExits")))
            for row in entry_rows:
                tier_name = str(row.get("tier") or "")
                move_counts.setdefault(tier_name, {})["newEntries"] = int(to_float(row.get("newEntries")))

        tiers = []
        total_brands = 0
        total_assigned_brands = 0
        total_orders = 0
        total_revenue = 0.0
        total_clicks = 0.0
        total_payout = 0.0
        total_new_entries = 0
        total_tier_exits = 0

        for row in rows:
            brands = int(to_float(row.get("brandCount")))
            assigned_brands = int(to_float(row.get("assignedBrandCount")))
            orders = int(to_float(row.get("orders")))
            revenue = to_float(row.get("revenue"))
            clicks = to_float(row.get("clicks"))
            payout = to_float(row.get("payout"))
            conversion = orders / clicks if clicks > 0 else 0.0
            tier_name = str(row["tier"])
            tier_moves = move_counts.get(tier_name, {})
            new_entries = int(tier_moves.get("newEntries", 0))
            tier_exits = int(tier_moves.get("tierExits", 0))

            tiers.append({
                "tier": tier_name,
                "brandCount": brands,
                "assignedBrandCount": assigned_brands,
                "orders": orders,
                "revenue": round(revenue, 2),
                "clicks": int(clicks),
                "payout": round(payout, 2),
                "conversionRate": round(conversion, 6),
                "newEntries": new_entries,
                "tierExits": tier_exits,
            })
            total_brands += brands
            total_assigned_brands += assigned_brands
            total_orders += orders
            total_revenue += revenue
            total_clicks += clicks
            total_payout += payout
            total_new_entries += new_entries
            total_tier_exits += tier_exits

        total_conversion = total_orders / total_clicks if total_clicks > 0 else 0.0
        total = {
            "brandCount": total_brands,
            "assignedBrandCount": total_assigned_brands,
            "orders": total_orders,
            "revenue": round(total_revenue, 2),
            "clicks": int(total_clicks),
            "payout": round(total_payout, 2),
            "conversionRate": round(total_conversion, 6),
            "newEntries": total_new_entries,
            "tierExits": total_tier_exits,
        }

        payload = {
            "ok": True,
            "checkedAt": utc_now_iso(),
            "month": month,
            "tiers": tiers,
            "total": total,
            "source": {
                "tierAssignments": "cnpscy_oi_tier_assignments",
                "ordersRevenuePayout": "cnpscy_order_new_aggregate" if aggregate_id and aggregate_date else "cnpscy_oi_offer_monthly_amazon_metrics",
                "clicks": "cnpscy_amazon_click" if click_id and click_date and click_metric else None,
                "tierMoves": "cnpscy_oi_tier_assignments.movedAt" if moved_from_column and moved_at_column else None,
            },
        }

    _status_cache[cache_key] = (now, payload)
    return payload


def static_chatbot_generated_at() -> str | None:
    """? db_offers_cache.json summary ???????????"""
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
        # 与 Tier Sheet（tier_report_metrics_map / merge_tier_report_metrics）同口径：
        # orders = SUM(total_purchases)，dpv/atc 取 order 表 detail_page_views/add_to_carts。
        # 若 total_purchases 列缺失，回退为明细行数 COUNT(*)，避免查询报错。
        orders_expr = (
            f"SUM(COALESCE(o.total_purchases, 0)) AS {q('orders')}"
            if "total_purchases" in order_cols
            else f"COUNT(*) AS {q('orders')}"
        )
        rows = fetch_all(
            conn,
            f"""
            SELECT {month_sql} AS month,
                   {orders_expr},
                   {sum_expr("o", order_cols, ["amount", "sales_amount", "revenue"], "revenue")},
                   {sum_expr("o", order_cols, ["payout", "commission"], "payout")},
                   {sum_expr("o", order_cols, ["aff_payout", "affiliate_payout"], "affiliatePayout")},
                   {sum_expr("o", order_cols, ["total_clicks", "clicks", "click_num"], "clicks")},
                   {sum_expr("o", order_cols, ["detail_page_views", "dpv", "dpv_num"], "dpv")},
                   {sum_expr("o", order_cols, ["add_to_carts", "atc", "atc_num"], "atc")},
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

    # click 子查询仅用于 order 表 clicks 为 0 时的兜底（与 Tier Sheet 同规则）
    click_cols = table_columns(conn, "cnpscy_amazon_click")
    click_id = pick_column(click_cols, ["advert_id", "merchant_id"])
    click_date = pick_column(click_cols, ["time_day", "click_time_day"])
    if click_id and click_date:
        month_sql = month_expr("c", click_date)
        rows = fetch_all(
            conn,
            f"""
            SELECT {month_sql} AS month,
                   {sum_expr("c", click_cols, ["click", "clicks", "click_num"], "rawClicks")}
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
            if not to_float(target.get("clicks")) and to_float(formatted.get("rawClicks")):
                target["clicks"] = formatted["rawClicks"]

    for row in by_month.values():
        clicks = to_float(row.get("clicks"))
        orders = to_float(row.get("orders"))
        revenue = to_float(row.get("revenue"))
        row["allEpc"] = round(commission_amount_epc(row.get("payout"), clicks), 6)
        row["affEpc"] = round(commission_amount_epc(row.get("affiliatePayout"), clicks), 6)
        row["epc"] = row["affEpc"]
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


def merchant_payload(
    merchant_id: str,
    product_limit: int = 50,
    months: int = 12,
    minimal: bool = False,
) -> dict[str, Any]:
    if not DIGITS_RE.match(merchant_id):
        raise ValueError("merchantId must be numeric")
    cache_key = f"{'min:' if minimal else ''}{merchant_id}:{product_limit}:{months}"
    now = time.time()
    cached = _merchant_cache.get(cache_key)
    if cached is not None and now - cached[0] < MERCHANT_CACHE_TTL:
        return cached[1]
    with db_connection() as conn:
        if minimal:
            # 趋势分析只需要月度指标，跳过慢的 merchant_base / merchant_products。
            # merchant_base 主查询和 merchant_products JOIN 大表可耗时数十秒，
            # 会触发前端 fetchMerchantMetrics 20s 超时 → 退化为估算趋势（数据失真）。
            payload = {
                "ok": True,
                "checkedAt": utc_now_iso(),
                "merchantId": merchant_id,
                "merchant": None,
                "products": [],
                "monthlyAmazonMetrics": merchant_amazon_metrics(conn, merchant_id, months),
                "monthlyAggregateMetrics": [],
            }
        else:
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


def tier1_merchant_search_payload(query_text: str, limit: int = 10) -> dict[str, Any]:
    """Search active YeahPromos merchants for the Tier 1 management flow."""
    query_text = str(query_text or "").strip()
    if len(query_text) < 2:
        return {"ok": True, "checkedAt": utc_now_iso(), "query": query_text, "results": []}

    with db_connection() as conn:
        params: list[Any] = []
        predicates = []
        if DIGITS_RE.match(query_text):
            predicates.append("a.advert_id = %s")
            params.append(query_text)
        predicates.append("a.advert_name LIKE %s")
        params.append(f"%{query_text}%")
        rows = fetch_all(
            conn,
            f"""
            SELECT
                CAST(a.advert_id AS CHAR) AS merchantId,
                a.advert_name AS merchantName,
                COALESCE(NULLIF(TRIM(at.advert_type_name), ''), 'Unknown') AS network,
                t.tier AS currentTier,
                COALESCE(NULLIF(TRIM(sm.sheetCategory), ''), 'Uncategorized') AS category,
                COALESCE(NULLIF(TRIM(sm.region), ''), '') AS country
            FROM cnpscy_advert a
            LEFT JOIN cnpscy_advert_type at
                ON a.advert_advertiser = at.advert_type_id
                AND at.advert_type_parent_id = 53
            LEFT JOIN cnpscy_oi_tier_assignments t
                ON t.merchantId = CAST(a.advert_id AS CHAR)
            LEFT JOIN cnpscy_oi_offer_sheet_metadata sm
                ON sm.merchantId = CAST(a.advert_id AS CHAR)
            WHERE a.advert_isdel = 1
              AND ({" OR ".join(predicates)})
            ORDER BY
                CASE
                    WHEN CAST(a.advert_id AS CHAR) = %s THEN 0
                    WHEN LOWER(TRIM(a.advert_name)) = LOWER(%s) THEN 1
                    ELSE 2
                END,
                a.advert_name ASC,
                a.advert_id ASC
            LIMIT {int(max(1, min(limit, 25)))}
            """,
            tuple(params + [query_text, query_text]),
        )

    return {
        "ok": True,
        "checkedAt": utc_now_iso(),
        "query": query_text,
        "results": [compact_api_row(row) for row in rows],
    }


def tier1_additions_payload(limit: int = 100) -> dict[str, Any]:
    """Return the latest Tier 1 migration record for each merchant added by this tool."""
    with db_connection() as conn:
        rows = fetch_all(
            conn,
            f"""
            SELECT
                h.eventId AS migrationId,
                h.merchantId,
                COALESCE(NULLIF(TRIM(a.advert_name), ''), NULLIF(TRIM(h.merchantName), ''), h.merchantId) AS merchantName,
                COALESCE(NULLIF(TRIM(at.advert_type_name), ''), 'Unknown') AS network,
                h.sourceTier AS previousTier,
                h.targetTier AS targetTier,
                t.tier AS currentTier,
                h.movedAt AS addedAt,
                h.movedBy AS addedBy
            FROM cnpscy_oi_tier_move_history h
            INNER JOIN (
                SELECT merchantId, MAX(eventId) AS eventId
                FROM cnpscy_oi_tier_move_history
                WHERE targetTier = %s
                  AND source = %s
                GROUP BY merchantId
            ) latest
                ON latest.eventId = h.eventId
            LEFT JOIN cnpscy_oi_tier_assignments t
                ON t.merchantId = h.merchantId
            LEFT JOIN cnpscy_advert a
                ON a.advert_id = CAST(h.merchantId AS UNSIGNED)
                AND a.advert_isdel = 1
            LEFT JOIN cnpscy_advert_type at
                ON a.advert_advertiser = at.advert_type_id
                AND at.advert_type_parent_id = 53
            ORDER BY h.movedAt DESC, h.eventId DESC
            LIMIT {int(max(1, min(limit, 250)))}
            """,
            (TIER1_NAME, TIER1_MANUAL_SOURCE),
        )

    additions = [compact_api_row(row) for row in rows]
    return {
        "ok": True,
        "checkedAt": utc_now_iso(),
        "tier": TIER1_NAME,
        "count": len(additions),
        "additions": additions,
    }


def add_merchant_to_tier1(
    merchant_id: str,
    updated_by: str,
    expected_tier: str | None = None,
) -> dict[str, Any]:
    """Assign an active YeahPromos merchant to Tier 1 with provenance."""
    merchant_id = str(merchant_id or "").strip()
    if not DIGITS_RE.match(merchant_id):
        raise ValueError("merchantId must be numeric")

    expected_tier = str(expected_tier or "").strip()
    updated_by = str(updated_by or "offer-intelligence-ui").strip()[:128] or "offer-intelligence-ui"
    moved_at = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)

    with db_connection() as conn:
        try:
            conn.begin()
            merchant = fetch_one(
                conn,
                """
                SELECT
                    CAST(a.advert_id AS CHAR) AS merchantId,
                    a.advert_name AS merchantName,
                    COALESCE(NULLIF(TRIM(at.advert_type_name), ''), 'Unknown') AS network
                FROM cnpscy_advert a
                LEFT JOIN cnpscy_advert_type at
                    ON a.advert_advertiser = at.advert_type_id
                    AND at.advert_type_parent_id = 53
                WHERE a.advert_id = %s
                  AND a.advert_isdel = 1
                LIMIT 1
                FOR UPDATE
                """,
                (merchant_id,),
            )
            if not merchant:
                conn.rollback()
                return {
                    "ok": False,
                    "code": "merchant_not_found",
                    "error": "Merchant was not found or is inactive.",
                }

            assignment = fetch_one(
                conn,
                """
                SELECT merchantId, tier
                FROM cnpscy_oi_tier_assignments
                WHERE merchantId = %s
                LIMIT 1
                FOR UPDATE
                """,
                (merchant_id,),
            )
            current_tier = str((assignment or {}).get("tier") or "").strip()
            merchant = {
                **merchant,
                "currentTier": current_tier,
            }

            if current_tier and current_tier not in MANAGED_TIER_NAMES:
                conn.rollback()
                return {
                    "ok": False,
                    "code": "unsupported_tier",
                    "error": f"Merchant has an unsupported current tier: {current_tier}.",
                    "merchant": compact_api_row(merchant),
                }

            if expected_tier != current_tier:
                conn.rollback()
                return {
                    "ok": False,
                    "code": "tier_changed",
                    "error": "Merchant tier changed after search. Search again before confirming.",
                    "merchant": compact_api_row(merchant),
                }

            if current_tier == TIER1_NAME:
                conn.rollback()
                return {
                    "ok": False,
                    "code": "already_tier1",
                    "error": "Merchant is already in Tier 1.",
                    "merchant": compact_api_row(merchant),
                }

            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO cnpscy_oi_tier_assignments
                        (merchantId, tier, source, movedFromTier, movedAt, updatedBy)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        tier = VALUES(tier),
                        source = VALUES(source),
                        movedFromTier = VALUES(movedFromTier),
                        movedAt = VALUES(movedAt),
                        updatedBy = VALUES(updatedBy)
                    """,
                    (
                        merchant_id,
                        TIER1_NAME,
                        TIER1_MANUAL_SOURCE,
                        current_tier or None,
                        moved_at,
                        updated_by,
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO cnpscy_oi_tier_move_history
                        (merchantId, merchantName, sourceTier, targetTier, source, movedAt, movedBy)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        merchant_id,
                        str(merchant.get("merchantName") or "").strip() or None,
                        current_tier or None,
                        TIER1_NAME,
                        TIER1_MANUAL_SOURCE,
                        moved_at,
                        updated_by,
                    ),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    _tier_sheet_cache.clear()
    return {
        "ok": True,
        "tier": TIER1_NAME,
        "merchant": compact_api_row({
            **merchant,
            "previousTier": current_tier,
            "currentTier": TIER1_NAME,
            "addedAt": moved_at,
            "addedBy": updated_by,
        }),
        "migration": compact_api_row({
            "merchantId": merchant_id,
            "merchantName": merchant.get("merchantName"),
            "sourceTier": current_tier,
            "targetTier": TIER1_NAME,
            "movedAt": moved_at,
            "movedBy": updated_by,
            "source": TIER1_MANUAL_SOURCE,
        }),
    }


def normalize_monthly_new_merchant_month(value: Any = None) -> str:
    text = str(value or "").strip()
    if not text:
        text = dt.datetime.now(REPORTING_TZ).strftime("%Y-%m")
    if not MONTH_KEY_RE.match(text):
        raise ValueError("month must use YYYY-MM format")
    return text


def _monthly_new_merchant_text(
    payload: dict[str, Any],
    key: str,
    *,
    required: bool = False,
    maximum: int,
) -> str:
    value = str(payload.get(key) or "").strip()
    if required and not value:
        raise ValueError(f"{key} is required")
    if len(value) > maximum:
        raise ValueError(f"{key} must be {maximum} characters or fewer")
    return value


def _monthly_new_merchant_record_id(value: Any) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    if not DIGITS_RE.match(text) or int(text) <= 0:
        raise ValueError("recordId must be a positive integer")
    return int(text)


def _monthly_new_merchant_gmv_target(value: Any) -> Decimal | None:
    text = str(value if value is not None else "").strip()
    if not text:
        return None
    try:
        amount = Decimal(text)
    except (InvalidOperation, ValueError):
        raise ValueError("gmvMonthlyTarget must be a valid number") from None
    if not amount.is_finite() or amount < 0:
        raise ValueError("gmvMonthlyTarget must be zero or greater")
    if amount > Decimal("9999999999999999.99"):
        raise ValueError("gmvMonthlyTarget is too large")
    try:
        return amount.quantize(Decimal("0.01"))
    except InvalidOperation:
        raise ValueError("gmvMonthlyTarget must be a valid number") from None


def _monthly_new_merchant_commission(value: Any, field: str) -> Decimal | None:
    text = str(value if value is not None else "").strip()
    if not text:
        return None
    if text.endswith("%"):
        text = text[:-1].strip()
    text = text.replace(",", "").replace(" ", "")
    try:
        amount = Decimal(text)
    except (InvalidOperation, ValueError):
        raise ValueError(f"{field} must be a valid percentage") from None
    if not amount.is_finite() or amount < 0 or amount > 100:
        raise ValueError(f"{field} must be between 0 and 100")
    try:
        return amount.quantize(Decimal("0.01"))
    except InvalidOperation:
        raise ValueError(f"{field} must be a valid percentage") from None


def _monthly_new_merchant_priority(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None or value == "":
        return False
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    raise ValueError("isPriority must be a boolean")


def _monthly_new_merchant_values(
    payload: dict[str, Any],
    *,
    updated_by: str,
) -> dict[str, Any]:
    report_month = normalize_monthly_new_merchant_month(payload.get("reportMonth"))
    merchant_id = _monthly_new_merchant_text(
        payload,
        "merchantId",
        maximum=64,
    )
    if merchant_id and not DIGITS_RE.match(merchant_id):
        raise ValueError("merchantId must be numeric")

    merchant_name = _monthly_new_merchant_text(
        payload,
        "merchantName",
        required=True,
        maximum=180,
    )
    actor = str(updated_by or "offer-intelligence-ui").strip()[:128] or "offer-intelligence-ui"
    return {
        "recordId": _monthly_new_merchant_record_id(payload.get("recordId")),
        "reportMonth": report_month,
        "merchantId": merchant_id,
        "merchantName": merchant_name,
        "businessManager": _monthly_new_merchant_text(
            payload,
            "businessManager",
            maximum=128,
        ),
        "program": _monthly_new_merchant_text(payload, "program", maximum=128),
        "platform": _monthly_new_merchant_text(payload, "platform", maximum=128),
        "gmvRequirement": _monthly_new_merchant_text(
            payload,
            "gmvRequirement",
            maximum=255,
        ),
        "pastMonthPurchase": _monthly_new_merchant_text(
            payload,
            "pastMonthPurchase",
            maximum=255,
        ),
        "independentWebsites": _monthly_new_merchant_text(
            payload,
            "independentWebsites",
            maximum=255,
        ),
        "reviewSummary": _monthly_new_merchant_text(
            payload,
            "reviewSummary",
            maximum=255,
        ),
        "ourCommission": _monthly_new_merchant_commission(
            payload.get("ourCommission"),
            "ourCommission",
        ),
        "presetCommission": _monthly_new_merchant_commission(
            payload.get("presetCommission"),
            "presetCommission",
        ),
        "isPriority": _monthly_new_merchant_priority(payload.get("isPriority")),
        "gmvMonthlyTarget": _monthly_new_merchant_gmv_target(
            payload.get("gmvMonthlyTarget")
        ),
        "completionReward": _monthly_new_merchant_text(
            payload,
            "completionReward",
            maximum=1000,
        ),
        "updatedBy": actor,
    }


def ensure_monthly_new_merchants_schema(conn) -> None:
    global _monthly_new_merchants_schema_ready
    if _monthly_new_merchants_schema_ready:
        return
    with _monthly_new_merchants_schema_lock:
        if _monthly_new_merchants_schema_ready:
            return
        with conn.cursor() as cursor:
            cursor.execute(MONTHLY_NEW_MERCHANTS_TABLE_DDL)
            cursor.execute(MONTHLY_NEW_MERCHANT_ANNOTATIONS_TABLE_DDL)
        TABLE_COLUMNS_CACHE.pop("cnpscy_oi_monthly_new_merchants", None)
        columns = table_columns(conn, "cnpscy_oi_monthly_new_merchants")
        for column, ddl in MONTHLY_NEW_MERCHANT_COLUMN_MIGRATIONS.items():
            if column in columns:
                continue
            with conn.cursor() as cursor:
                cursor.execute(ddl)
            columns.add(column)
        TABLE_COLUMNS_CACHE.pop("cnpscy_oi_monthly_new_merchants", None)
        _monthly_new_merchants_schema_ready = True


def _monthly_new_merchant_record(conn, record_id: int) -> dict[str, Any] | None:
    return fetch_one(
        conn,
        """
        SELECT
            recordId,
            reportMonth,
            merchantId,
            merchantName,
            businessManager,
            program,
            platform,
            gmvRequirement,
            pastMonthPurchase,
            independentWebsites,
            reviewSummary,
            ourCommission,
            presetCommission,
            isPriority,
            gmvMonthlyTarget,
            completionReward,
            createdBy,
            updatedBy,
            createdAt,
            updatedAt
        FROM cnpscy_oi_monthly_new_merchants
        WHERE recordId = %s
        LIMIT 1
        """,
        (record_id,),
    )


def _monthly_new_merchant_api_record(
    row: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if row is None:
        return None
    record: dict[str, Any] = {}
    for key, value in row.items():
        if isinstance(value, Decimal):
            value = float(value)
        elif isinstance(value, dt.datetime):
            value = value.isoformat(timespec="seconds")
        elif isinstance(value, dt.date):
            value = value.isoformat()
        record[key] = value
    if "isPriority" in record:
        record["isPriority"] = bool(record["isPriority"])
    return record


def _monthly_new_merchant_month_range(report_month: str) -> tuple[dt.datetime, dt.datetime]:
    year, month = (int(part) for part in report_month.split("-", 1))
    start = dt.datetime(year, month, 1)
    if month == 12:
        end = dt.datetime(year + 1, 1, 1)
    else:
        end = dt.datetime(year, month + 1, 1)
    return start, end


def _monthly_new_merchant_source_column_info(conn) -> dict[str, str]:
    try:
        rows = fetch_all(conn, f"SHOW COLUMNS FROM {q('cnpscy_advert')}")
    except Exception as error:
        raise OfferDbError("Unable to inspect the YeahPromos merchant table") from error
    info = {
        str(row.get("Field") or ""): str(row.get("Type") or "").lower()
        for row in rows
        if row.get("Field")
    }
    if not info:
        raise OfferDbError("cnpscy_advert has no readable columns")
    return info


def _monthly_new_merchant_heuristic_date_column(column_info: dict[str, str]) -> str | None:
    candidates: list[tuple[int, str]] = []
    for column, column_type in column_info.items():
        lowered = column.lower()
        if any(token in lowered for token in ("update", "modify", "login", "delete")):
            continue
        if not any(
            token in lowered
            for token in (
                "create",
                "created",
                "addtime",
                "add_time",
                "apply",
                "reg",
                "join",
                "onboard",
                "launch",
                "start",
                "online",
                "publish",
            )
        ):
            continue
        score = 0
        if any(token in column_type for token in ("date", "time", "timestamp")):
            score += 8
        if lowered.startswith("advert_"):
            score += 4
        if "create" in lowered or "created" in lowered:
            score += 4
        if "add" in lowered:
            score += 3
        if lowered.endswith("_at") or lowered.endswith("time"):
            score += 2
        candidates.append((score, column))
    return max(candidates, default=(0, ""))[1] or None


def _monthly_new_merchant_heuristic_bd_column(column_info: dict[str, str]) -> str | None:
    candidates: list[tuple[int, str]] = []
    for column, column_type in column_info.items():
        lowered = column.lower()
        if lowered.endswith("_id") or lowered in {"id", "advert_id"}:
            continue
        score = 0
        if lowered in {"bd", "bd_name"} or lowered.endswith("_bd") or lowered.endswith("_bd_name"):
            score += 10
        if "business" in lowered and "manager" in lowered:
            score += 8
        if "account" in lowered and "manager" in lowered:
            score += 7
        if "sales" in lowered and "manager" in lowered:
            score += 6
        if not score:
            continue
        if any(token in column_type for token in ("char", "text")):
            score += 3
        candidates.append((score, column))
    return max(candidates, default=(0, ""))[1] or None


def _monthly_new_merchant_source_config(conn) -> dict[str, Any]:
    column_info = _monthly_new_merchant_source_column_info(conn)
    columns = set(column_info)
    merchant_id_column = pick_column(columns, ["advert_id", "merchant_id", "merchantId", "id"])
    merchant_name_column = pick_column(
        columns,
        ["advert_name", "merchant_name", "merchantName", "brand_name", "name"],
    )
    source_date_column = pick_column(columns, list(MONTHLY_NEW_MERCHANT_DATE_COLUMNS))
    source_date_column = source_date_column or _monthly_new_merchant_heuristic_date_column(column_info)
    source_bd_column = pick_column(columns, list(MONTHLY_NEW_MERCHANT_BD_COLUMNS))
    source_bd_column = source_bd_column or _monthly_new_merchant_heuristic_bd_column(column_info)
    if source_bd_column and not any(
        token in column_info.get(source_bd_column, "")
        for token in ("char", "text")
    ):
        source_bd_column = None
    if not merchant_id_column:
        raise OfferDbError("cnpscy_advert is missing a merchant ID column")
    if not source_date_column:
        raise OfferDbError("cnpscy_advert is missing a merchant onboarding date column")
    return {
        "columns": columns,
        "merchantIdColumn": merchant_id_column,
        "merchantNameColumn": merchant_name_column,
        "sourceDateColumn": source_date_column,
        "sourceBdColumn": source_bd_column,
    }


def _monthly_new_merchant_source_datetime_expr(column: str) -> str:
    text = f"TRIM(CAST({qualified('a', column)} AS CHAR))"
    return (
        "CASE "
        f"WHEN {text} REGEXP '^[0-9]{{8}}$' THEN STR_TO_DATE({text}, '%%Y%%m%%d') "
        f"WHEN {text} REGEXP '^[0-9]{{13}}$' THEN FROM_UNIXTIME(CAST({text} AS UNSIGNED) / 1000) "
        f"WHEN {text} REGEXP '^[0-9]{{10}}$' THEN FROM_UNIXTIME(CAST({text} AS UNSIGNED)) "
        f"ELSE CAST(NULLIF({text}, '') AS DATETIME) END"
    )


def _monthly_new_merchant_source_rows(
    conn,
    report_month: str,
    merchant_id: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    config = _monthly_new_merchant_source_config(conn)
    columns = config["columns"]
    id_column = config["merchantIdColumn"]
    name_column = config["merchantNameColumn"]
    date_column = config["sourceDateColumn"]
    bd_column = config["sourceBdColumn"]
    source_date_expr = _monthly_new_merchant_source_datetime_expr(date_column)
    metadata_columns = table_columns(conn, "cnpscy_oi_offer_sheet_metadata")
    has_metadata_bd = "businessManager" in metadata_columns

    name_expr = (
        f"NULLIF(TRIM(CAST({qualified('a', name_column)} AS CHAR)), '')"
        if name_column
        else "NULL"
    )
    bd_expressions = []
    if bd_column:
        bd_expressions.append(
            f"NULLIF(TRIM(CAST({qualified('a', bd_column)} AS CHAR)), '')"
        )
    if has_metadata_bd:
        bd_expressions.append("NULLIF(TRIM(sm.businessManager), '')")
    bd_expr = f"COALESCE({', '.join(bd_expressions)})" if bd_expressions else "NULL"
    metadata_join = (
        "LEFT JOIN cnpscy_oi_offer_sheet_metadata sm "
        f"ON sm.merchantId = CAST({qualified('a', id_column)} AS CHAR)"
        if has_metadata_bd
        else ""
    )

    start, end = _monthly_new_merchant_month_range(report_month)
    predicates = [f"{source_date_expr} >= %s", f"{source_date_expr} < %s"]
    params: list[Any] = [start, end]
    active_column = pick_column(columns, ["advert_isdel", "is_delete", "isdel", "deleted"])
    if active_column:
        if active_column.lower() == "advert_isdel":
            predicates.append(f"{qualified('a', active_column)} = 1")
        else:
            predicates.append(f"COALESCE({qualified('a', active_column)}, 0) = 0")
    if merchant_id:
        predicates.append(f"CAST({qualified('a', id_column)} AS CHAR) = %s")
        params.append(merchant_id)

    rows = fetch_all(
        conn,
        f"""
        SELECT
            CAST({qualified('a', id_column)} AS CHAR) AS merchantId,
            COALESCE({name_expr}, CAST({qualified('a', id_column)} AS CHAR)) AS merchantName,
            {bd_expr} AS businessManager,
            {source_date_expr} AS sourceAddedAt
        FROM cnpscy_advert a
        {metadata_join}
        WHERE {' AND '.join(predicates)}
        ORDER BY sourceAddedAt DESC, merchantName ASC, merchantId ASC
        """,
        tuple(params),
    )
    unique_rows = []
    seen_merchant_ids = set()
    for row in rows:
        normalized_id = str(row.get("merchantId") or "").strip()
        if not normalized_id or normalized_id in seen_merchant_ids:
            continue
        seen_merchant_ids.add(normalized_id)
        row["merchantId"] = normalized_id
        row["reportMonth"] = report_month
        unique_rows.append(row)
    return unique_rows, config


def _monthly_new_merchant_annotation_record(
    conn,
    report_month: str,
    merchant_id: str,
) -> dict[str, Any] | None:
    return fetch_one(
        conn,
        f"""
        SELECT
            recordId,
            reportMonth,
            merchantId,
            merchantNameSnapshot,
            businessManagerSnapshot,
            sourceAddedAt,
            isPriority,
            gmvMonthlyTarget,
            completionReward,
            createdBy,
            updatedBy,
            createdAt,
            updatedAt
        FROM {MONTHLY_NEW_MERCHANT_ANNOTATIONS_TABLE}
        WHERE reportMonth = %s AND merchantId = %s
        LIMIT 1
        """,
        (report_month, merchant_id),
    )


def _monthly_new_merchant_merged_record(
    source: dict[str, Any] | None,
    annotation: dict[str, Any] | None,
    legacy: dict[str, Any] | None,
) -> dict[str, Any]:
    source = source or {}
    annotation = annotation or {}
    legacy = legacy or {}
    annotation_exists = bool(annotation)
    merchant_id = str(
        source.get("merchantId")
        or annotation.get("merchantId")
        or legacy.get("merchantId")
        or ""
    ).strip()
    record = {
        "recordId": int(annotation.get("recordId") or legacy.get("recordId") or 0),
        "reportMonth": str(
            source.get("reportMonth")
            or annotation.get("reportMonth")
            or legacy.get("reportMonth")
            or ""
        ),
        "merchantId": merchant_id,
        "merchantName": str(
            source.get("merchantName")
            or annotation.get("merchantNameSnapshot")
            or legacy.get("merchantName")
            or merchant_id
        ).strip(),
        "businessManager": str(
            source.get("businessManager")
            or annotation.get("businessManagerSnapshot")
            or legacy.get("businessManager")
            or ""
        ).strip(),
        "sourceAddedAt": source.get("sourceAddedAt") or annotation.get("sourceAddedAt"),
        "addedAt": source.get("sourceAddedAt") or annotation.get("sourceAddedAt") or legacy.get("createdAt"),
        "sourceLinked": bool(source),
        "isPriority": bool(annotation.get("isPriority")) if annotation_exists else False,
        "gmvMonthlyTarget": (
            annotation.get("gmvMonthlyTarget")
            if annotation_exists
            else legacy.get("gmvMonthlyTarget")
        ),
        "completionReward": str(
            (
                annotation.get("completionReward")
                if annotation_exists
                else legacy.get("completionReward")
            )
            or ""
        ).strip(),
        "createdBy": annotation.get("createdBy") or legacy.get("createdBy"),
        "updatedBy": annotation.get("updatedBy") or legacy.get("updatedBy"),
        "createdAt": annotation.get("createdAt") or legacy.get("createdAt"),
        "updatedAt": annotation.get("updatedAt") or legacy.get("updatedAt"),
    }
    return _monthly_new_merchant_api_record(record) or {}


def monthly_new_merchants_payload(month: Any = None) -> dict[str, Any]:
    report_month = normalize_monthly_new_merchant_month(month)
    with db_connection() as conn:
        ensure_monthly_new_merchants_schema(conn)
        rows = fetch_all(
            conn,
            """
            SELECT
                recordId,
                reportMonth,
                merchantId,
                merchantName,
                businessManager,
                program,
                platform,
                gmvRequirement,
                pastMonthPurchase,
                independentWebsites,
                reviewSummary,
                ourCommission,
                presetCommission,
                isPriority,
                gmvMonthlyTarget,
                completionReward,
                createdBy,
                updatedBy,
                createdAt,
                updatedAt
            FROM cnpscy_oi_monthly_new_merchants
            WHERE reportMonth = %s
            ORDER BY
                isPriority DESC,
                updatedAt DESC,
                merchantName ASC,
                recordId DESC
            """,
            (report_month,),
        )

    records = [_monthly_new_merchant_api_record(row) for row in rows]
    gmv_target_total = sum(
        float(record.get("gmvMonthlyTarget") or 0)
        for record in records
    )
    return {
        "ok": True,
        "checkedAt": utc_now_iso(),
        "month": report_month,
        "count": len(records),
        "gmvTargetCount": sum(
            1 for record in records if record.get("gmvMonthlyTarget") is not None
        ),
        "gmvTargetTotal": gmv_target_total,
        "priorityCount": sum(1 for record in records if record.get("isPriority")),
        "source": "cnpscy_oi_monthly_new_merchants",
        "records": records,
    }


def upsert_monthly_new_merchant(
    payload: dict[str, Any],
    *,
    updated_by: str,
) -> dict[str, Any]:
    values = _monthly_new_merchant_values(payload, updated_by=updated_by)
    record_id = values["recordId"]
    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)

    with db_connection() as conn:
        ensure_monthly_new_merchants_schema(conn)
        try:
            conn.begin()
            if record_id is not None:
                existing = fetch_one(
                    conn,
                    """
                    SELECT recordId
                    FROM cnpscy_oi_monthly_new_merchants
                    WHERE recordId = %s
                    LIMIT 1
                    FOR UPDATE
                    """,
                    (record_id,),
                )
                if not existing:
                    conn.rollback()
                    return {
                        "ok": False,
                        "code": "record_not_found",
                        "error": "Monthly new merchant record was not found.",
                    }

            duplicate_sql = """
                SELECT recordId
                FROM cnpscy_oi_monthly_new_merchants
                WHERE reportMonth = %s
                  AND (
                    merchantName = %s
            """
            duplicate_params: list[Any] = [
                values["reportMonth"],
                values["merchantName"],
            ]
            if values["merchantId"]:
                duplicate_sql += " OR merchantId = %s"
                duplicate_params.append(values["merchantId"])
            duplicate_sql += ")"
            if record_id is not None:
                duplicate_sql += " AND recordId <> %s"
                duplicate_params.append(record_id)
            duplicate_sql += " LIMIT 1 FOR UPDATE"
            duplicate = fetch_one(conn, duplicate_sql, tuple(duplicate_params))
            if duplicate:
                conn.rollback()
                return {
                    "ok": False,
                    "code": "duplicate_month_merchant",
                    "error": "This merchant is already recorded for the selected month.",
                }

            with conn.cursor() as cursor:
                if record_id is None:
                    cursor.execute(
                        """
                        INSERT INTO cnpscy_oi_monthly_new_merchants
                            (
                                reportMonth,
                                merchantId,
                                merchantName,
                                businessManager,
                                program,
                                platform,
                                gmvRequirement,
                                pastMonthPurchase,
                                independentWebsites,
                                reviewSummary,
                                ourCommission,
                                presetCommission,
                                isPriority,
                                gmvMonthlyTarget,
                                completionReward,
                                createdBy,
                                updatedBy,
                                createdAt,
                                updatedAt
                            )
                        VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s, %s, %s, %s
                        )
                        """,
                        (
                            values["reportMonth"],
                            values["merchantId"] or None,
                            values["merchantName"],
                            values["businessManager"] or None,
                            values["program"] or None,
                            values["platform"] or None,
                            values["gmvRequirement"] or None,
                            values["pastMonthPurchase"] or None,
                            values["independentWebsites"] or None,
                            values["reviewSummary"] or None,
                            values["ourCommission"],
                            values["presetCommission"],
                            int(values["isPriority"]),
                            values["gmvMonthlyTarget"],
                            values["completionReward"] or None,
                            values["updatedBy"],
                            values["updatedBy"],
                            now,
                            now,
                        ),
                    )
                    record_id = int(cursor.lastrowid)
                else:
                    cursor.execute(
                        """
                        UPDATE cnpscy_oi_monthly_new_merchants
                        SET
                            reportMonth = %s,
                            merchantId = %s,
                            merchantName = %s,
                            businessManager = %s,
                            program = %s,
                            platform = %s,
                            gmvRequirement = %s,
                            pastMonthPurchase = %s,
                            independentWebsites = %s,
                            reviewSummary = %s,
                            ourCommission = %s,
                            presetCommission = %s,
                            isPriority = %s,
                            gmvMonthlyTarget = %s,
                            completionReward = %s,
                            updatedBy = %s,
                            updatedAt = %s
                        WHERE recordId = %s
                        """,
                        (
                            values["reportMonth"],
                            values["merchantId"] or None,
                            values["merchantName"],
                            values["businessManager"] or None,
                            values["program"] or None,
                            values["platform"] or None,
                            values["gmvRequirement"] or None,
                            values["pastMonthPurchase"] or None,
                            values["independentWebsites"] or None,
                            values["reviewSummary"] or None,
                            values["ourCommission"],
                            values["presetCommission"],
                            int(values["isPriority"]),
                            values["gmvMonthlyTarget"],
                            values["completionReward"] or None,
                            values["updatedBy"],
                            now,
                            record_id,
                        ),
                    )
            record = _monthly_new_merchant_record(conn, int(record_id))
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return {
        "ok": True,
        "action": "created" if values["recordId"] is None else "updated",
        "record": _monthly_new_merchant_api_record(record),
    }


def delete_monthly_new_merchant(
    record_id: Any,
    *,
    deleted_by: str,
) -> dict[str, Any]:
    normalized_id = _monthly_new_merchant_record_id(record_id)
    if normalized_id is None:
        raise ValueError("recordId is required")
    actor = str(deleted_by or "offer-intelligence-ui").strip()[:128] or "offer-intelligence-ui"

    with db_connection() as conn:
        ensure_monthly_new_merchants_schema(conn)
        try:
            conn.begin()
            record = fetch_one(
                conn,
                """
                SELECT
                    recordId,
                    reportMonth,
                    merchantId,
                    merchantName,
                    businessManager,
                    program,
                    platform,
                    gmvRequirement,
                    pastMonthPurchase,
                    independentWebsites,
                    reviewSummary,
                    ourCommission,
                    presetCommission,
                    isPriority,
                    gmvMonthlyTarget,
                    completionReward,
                    createdBy,
                    updatedBy,
                    createdAt,
                    updatedAt
                FROM cnpscy_oi_monthly_new_merchants
                WHERE recordId = %s
                LIMIT 1
                FOR UPDATE
                """,
                (normalized_id,),
            )
            if not record:
                conn.rollback()
                return {
                    "ok": False,
                    "code": "record_not_found",
                    "error": "Monthly new merchant record was not found.",
                }
            with conn.cursor() as cursor:
                cursor.execute(
                    "DELETE FROM cnpscy_oi_monthly_new_merchants WHERE recordId = %s",
                    (normalized_id,),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return {
        "ok": True,
        "action": "deleted",
        "deletedBy": actor,
        "record": _monthly_new_merchant_api_record(record),
    }


# ?? payload cache ????????????????????????????????????????????????????

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
BRAND_MEDIA_TREND_CACHE_TTL = int(os.environ.get("OFFER_DB_BRAND_MEDIA_TREND_CACHE_TTL", "300"))
CHATBOT_CACHE_TTL = int(os.environ.get("OFFER_DB_CHATBOT_CACHE_TTL", "300"))  # 5 minutes
_bg_refresh_running: dict[str, bool] = {}
_merchant_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_search_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_status_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_tier_sheet_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_publisher_portfolio_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_brand_media_trend_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_chatbot_cache: dict[str, tuple[float, dict[str, Any]]] = {}
# In-memory cache for offers payload (avoids 23MB disk read + json.loads per request)
_offers_memory_cache: tuple[float, dict[str, Any]] | None = None
# In-memory cache for publishers payload
_publishers_memory_cache: tuple[float, dict[str, Any]] | None = None
# ?? ThreadingHTTPServer ??????? offers ???? MySQL /tmp ??
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
    """? cnpscy_oi_* ??/????? offer ?? + ???? + ?????

    ????? protected_data/db_offers_cache.json?TTL 6 ????
    ???????????????? 23MB json.loads?
    ????????????????????????
    ? force_refresh=True ??????????
    """
    global _offers_memory_cache
    now = time.time()

    # Memory cache ? avoid 23MB file read + json.loads on warm requests
    if not force_refresh and _offers_memory_cache is not None:
        ts, payload = _offers_memory_cache
        if now - ts < CACHE_TTL_SECONDS:
            return payload
        # TTL expired: fall through to file cache

    # File cache ? shared across Vercel instances
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
                            # ??????????????????
                            if _offers_memory_cache is not None:
                                ts, curr = _offers_memory_cache
                                if time.time() - ts < 60:  # 60?????????
                                    return
                            payload = _build_offers_payload(month)
                            _save_cache(OFFERS_CACHE_FILE, payload)
                            _offers_memory_cache = (time.time(), payload)
                    finally:
                        _bg_refresh_running["offers"] = False

                threading.Thread(target=_refresh_offers, daemon=True).start()
            return cached

    # No cache available at all: build from DB
    # ????? ThreadingHTTPServer ????????? MySQL /tmp ??
    with _offers_rebuild_lock:
        # Double-check: ?????????????
        if not force_refresh and _offers_memory_cache is not None:
            ts, cached = _offers_memory_cache
            if now - ts < CACHE_TTL_SECONDS:
                return cached
        payload = _build_offers_payload(month)
        _save_cache(OFFERS_CACHE_FILE, payload)
        _offers_memory_cache = (now, payload)
    return payload


def chatbot_offers_payload() -> dict[str, Any]:
    """Fresh offers data for the chatbot, using the 24h cache as a fast first-hit
    fallback and refreshing in the background every CHATBOT_CACHE_TTL seconds.

    The chatbot needs current merchant metrics (clicks, orders, revenue, etc.)
    that match what the Tier Sheet shows.  This function uses the main offers
    memory cache (pre-warmed at startup) to serve the first request instantly,
    then triggers a background rebuild so the next request within the TTL is
    returned from the chatbot's own short-TTL cache.
    """
    now = time.time()
    cached = _chatbot_cache.get("payload")
    if cached is not None and now - cached[0] < CHATBOT_CACHE_TTL:
        return cached[1]

    # Fast path: serve from the pre-warmed 24h memory cache immediately,
    # then rebuild in the background so chatbot data stays fresh.
    if _offers_memory_cache is not None:
        ts, mem_payload = _offers_memory_cache
        result = {
            "offers": mem_payload.get("offers", []),
            "paymentRecords": mem_payload.get("paymentRecords", []),
            "summary": mem_payload.get("summary", {}),
            "month": mem_payload.get("month", ""),
        }
        _chatbot_cache["payload"] = (now, result)

        # Background refresh: after the TTL expires the chatbot will serve
        # the new result.  Only trigger when no rebuild is already running.
        if not _bg_refresh_running.get("chatbot"):
            _bg_refresh_running["chatbot"] = True
            def _refresh_chatbot():
                try:
                    fresh = _build_offers_payload()
                    fresh_result = {
                        "offers": fresh.get("offers", []),
                        "paymentRecords": fresh.get("paymentRecords", []),
                        "summary": fresh.get("summary", {}),
                        "month": fresh.get("month", ""),
                    }
                    _chatbot_cache["payload"] = (time.time(), fresh_result)
                finally:
                    _bg_refresh_running["chatbot"] = False
            threading.Thread(target=_refresh_chatbot, daemon=True).start()
        return result

    # Cold start: no memory cache at all — fall back to full DB query
    payload = _build_offers_payload()
    result = {
        "offers": payload.get("offers", []),
        "paymentRecords": payload.get("paymentRecords", []),
        "summary": payload.get("summary", {}),
        "month": payload.get("month", ""),
    }
    _chatbot_cache["payload"] = (now, result)
    return result


def offer_network_fallback_map(
    conn,
    merchant_ids: list[str],
    cached_payload: dict[str, Any] | None,
) -> dict[str, str]:
    """?? network ??????? network ???

    ???????????? network????????????
    ?? cnpscy_advert_type ??????? cnpscy_advertiser_performance_daily_view ????
    """
    network_map: dict[str, str] = {}

    # 1) ???????? network
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

    # 2) ????? ? ? advert_type????????
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
            row = fetch_one(conn, "SELECT MAX(order_time_day) AS d FROM cnpscy_amazon_order")
            d = str(row["d"] or "").strip() if row else ""
            month = f"{d[:4]}-{d[4:6]}" if len(d) >= 6 else ""

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

        # Payment records start month (24 ???????????? /tmp)
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

        # ?? core query: tier + advert + metrics ??
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
                NULL AS productCount
            FROM cnpscy_oi_tier_assignments t
            LEFT JOIN cnpscy_advert a
                ON a.advert_id = CAST(t.merchantId AS UNSIGNED) AND a.advert_isdel = 1
            LEFT JOIN (
                SELECT merchantId, MAX(network) AS network
                FROM cnpscy_oi_payment_records
                GROUP BY merchantId
            ) pr_net ON t.merchantId = pr_net.merchantId
            GROUP BY t.merchantId
            """,
        )

        # Tier Sheet 口径的商家指标（明细表聚合），与 tier_sheet_payload 同口径
        metrics_map: dict[str, dict[str, Any]] = {}
        if month:
            range_start, range_end = resolve_tier_report_date_range(month=month)
            start_day = int(range_start.strftime("%Y%m%d"))
            end_day = int(range_end.strftime("%Y%m%d"))
            metrics_map = tier_report_metrics_map(conn, start_day, end_day)

        # ?? lookup maps (separate fast queries, merge in Python) ??
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

        # Persisted five-product estimates are only used when the selected
        # report range has neither positive orders nor positive revenue.
        aov_estimate_map = latest_merchant_aov_estimates(
            conn,
            [row.get("merchantId") for row in core_offers],
        )

        # Network fallback: ?? network ?????????????????
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

        # ?? merge all into offers ??
        offers = []
        for o in core_offers:
            mid = o["merchantId"]

            # 指标：Tier Sheet 口径（最新月明细聚合），与 tier_sheet_payload 一致
            metrics = metrics_map.get(mid) or {}
            o["clicks"] = metrics.get("clicks")
            o["orders"] = metrics.get("orders")
            o["salesAmount"] = metrics.get("revenue")
            o["epc"] = metrics.get("epc")
            o["allEpc"] = metrics.get("allEpc")
            o["affEpc"] = metrics.get("affEpc")
            o.update(resolve_merchant_aov(
                metrics.get("orders"),
                metrics.get("revenue"),
                aov_estimate_map.get(mid),
            ))
            o["conversionRate"] = metrics.get("conversionRate")
            o["payout"] = metrics.get("payout")
            o["affiliatePayout"] = metrics.get("affiliatePayout")
            o["allCommissionRate"] = metrics.get("allCommissionRate") or o.get("commissionRate")
            o["affCommissionRate"] = metrics.get("affCommissionRate")
            if o["affCommissionRate"] in (None, "") and o["allCommissionRate"] not in (None, ""):
                o["affCommissionRate"] = clean_decimal(to_float(o["allCommissionRate"]) * DEFAULT_AFF_PROPORTION, 4)
            o["dpv"] = metrics.get("dpv")
            o["atc"] = metrics.get("atc")
            o["directSales"] = metrics.get("directSales")
            o["haloSales"] = metrics.get("haloSales")

            # visual status
            vs = vs_map.get(mid)
            o["visualStatusColor"] = vs["color"] if vs else None
            o["visualStatusCode"] = vs["reason_code"] if vs else None
            o["visualStatusReason"] = vs["reason_text"] if vs else None
            o["visualStatusSource"] = vs["source"] if vs else None

            # network from advert_type (?? pr_net ? 'Unknown' ???)
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

            # product keywords ? only productAsins kept in core payload for ASIN search;
            # productTitles / productKeywords / productNameCount / productAsinCount
            # are loaded lazily via /api/ui/db/keywords when chatbot needs them.
            pk = pk_map.get(mid)
            if pk:
                o["productAsins"] = pk.get("productAsins")
            else:
                o["productAsins"] = None

            # ??????????????? affCommission?DB ???? affiliatePayout
            o["affCommission"] = o.get("affiliatePayout")

            offers.append(o)

        # ?? top ASINs per merchant (aggregated from products view) ??
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

        # ?? payment records (?? 24 ??????????? /tmp) ??
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
                   paymentStatus, rawStatus, paymentMadeDate, lastCheckedDate,
                   currency, isPlaceholder, notes
            FROM cnpscy_oi_payment_records
            WHERE reportMonthKey >= %s
            ORDER BY reportMonthKey DESC, merchantId
            """,
            (payment_start_month,),
        )

        # ?? payment risk per merchant (?? 24 ??) ??
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

        # ?? prior month revenues (single query, merge in Python) ??
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

        # ?? merge top ASINs + payment risk + computed fields into offers ??
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

        # ?? payment records (with computed fields matching static shape) ??
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

        # ?? payment summary ??
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

        # ?? summary ??
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

        # ?? build tier sheets from offers data ??
        TIER_ORDER = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
        SHEET_COLUMNS = [
            ("merchantId", "Merchant ID"),
            ("merchantName", "Merchant Name"),
            ("brand", "Brand"),
            ("network", "Network"),
            ("allCommissionRate", "ALL Commission"),
            ("affCommissionRate", "AFF Commission"),
            ("orders", "Order count"),
            ("salesAmount", "Revenue"),
            ("epc", "Backend EPC"),
            ("allEpc", "EPC(All)"),
            ("affEpc", "EPC(Aff)"),
            ("aov", "AOV"),
            ("aovType", "AOV Type"),
            ("aovMethod", "AOV Method"),
            ("aovSource", "AOV Source"),
            ("aovSampleProductCount", "AOV Sample Products"),
            ("aovCurrency", "AOV Currency"),
            ("aovSourceDate", "AOV Source Date"),
            ("aovSourceFile", "AOV Source File"),
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
    aov_estimates: dict[str, dict[str, Any]] | None = None,
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
        all_commission = to_float(order.get("payout"))
        aff_commission = to_float(order.get("affiliatePayout"))
        configured_all_rate = row.get("ALL Commission", row.get("Commission Rate"))
        all_rate = commission_percent_ratio(configured_all_rate)
        if not all_rate:
            all_rate = commission_rate_from_amount(revenue, all_commission)
        aff_proportion = commission_percent_ratio(order.get("affProportion")) or DEFAULT_AFF_PROPORTION
        aff_rate = all_rate * aff_proportion if all_rate else commission_rate_from_amount(revenue, aff_commission)
        all_epc = commission_amount_epc(all_commission, clicks)
        aff_epc = commission_amount_epc(aff_commission, clicks)
        aov_details = resolve_merchant_aov(
            orders,
            revenue,
            (aov_estimates or {}).get(merchant_id),
        )

        row.update({
            "ALL Commission": clean_decimal(all_rate * 100, 4),
            "AFF Commission": clean_decimal(aff_rate * 100, 4),
            "Order count": clean_decimal(orders, 0),
            "Revenue": clean_decimal(revenue, 2),
            # Generic/legacy EPC is publisher-facing, so it aliases EPC(Aff).
            "Backend EPC": clean_decimal(aff_epc, 6),
            "EPC(All)": clean_decimal(all_epc, 6),
            "EPC(Aff)": clean_decimal(aff_epc, 6),
            "AOV": aov_details["aov"],
            "AOV Type": aov_details["aovType"],
            "AOV Method": aov_details["aovMethod"],
            "AOV Source": aov_details["aovSource"],
            "AOV Sample Products": aov_details["aovSampleProductCount"],
            "AOV Currency": aov_details["aovCurrency"],
            "AOV Source Date": aov_details["aovSourceDate"],
            "AOV Source File": aov_details["aovSourceFile"],
            "Conversion Rate": clean_decimal(orders / clicks if clicks else 0, 8),
            "Clicks": clean_decimal(clicks, 0),
            "DPV": clean_decimal(order.get("dpv"), 0),
            "ATC": clean_decimal(order.get("atc"), 0),
            "Payout": clean_decimal(order.get("payout"), 2),
            "Affiliate Payout": clean_decimal(order.get("affiliatePayout"), 2),
        })
        row.pop("Commission Rate", None)
        merged.append(row)
    return merged


def tier_report_metrics_map(
    conn,
    start_day: int,
    end_day: int,
    tier: str | None = None,
) -> dict[str, dict[str, Any]]:
    """按 Tier Sheet 口径从明细表聚合商家指标。

    与 ``tier_sheet_payload`` 使用同一批表（cnpscy_amazon_order + cnpscy_amazon_click）
    和同一套合并规则（``merge_tier_report_metrics``），保证 offers/chatbot 与
    Tier Sheet 在相同日期区间下指标一致。

    返回 merchantId -> {orders, revenue, epc, aov, conversionRate, clicks,
                       dpv, atc, payout, affiliatePayout, directSales, haloSales}。
    tier 为 None 时聚合全部商家，否则只聚合该 tier 的商家。
    """
    tier_join = ""
    tier_clause = ""
    if tier:
        tier_join = (
            " INNER JOIN cnpscy_oi_tier_assignments t"
            " ON o.advert_id = CAST(t.merchantId AS UNSIGNED)"
        )
        tier_clause = " AND t.tier = %s"
    order_sql = f"""
        SELECT
            CAST(o.advert_id AS CHAR) AS merchantId,
            SUM(COALESCE(o.total_purchases, 0)) AS orders,
            SUM(COALESCE(o.amount, 0)) AS revenue,
            SUM(COALESCE(o.payout, 0)) AS payout,
            SUM(COALESCE(o.aff_payout, 0)) AS affiliatePayout,
            MAX(a.advert_money) AS configuredAllCommission,
            COALESCE(
                100 * SUM(COALESCE(o.aff_payout, 0)) / NULLIF(SUM(COALESCE(o.payout, 0)), 0),
                MAX(o.aff_proportion)
            ) AS affProportion,
            SUM(COALESCE(o.detail_page_views, 0)) AS dpv,
            SUM(COALESCE(o.add_to_carts, 0)) AS atc,
            SUM(COALESCE(o.total_clicks, 0)) AS orderClicks,
            SUM(COALESCE(o.directSales, 0)) AS directSales,
            SUM(COALESCE(o.haloSales, 0)) AS haloSales
        FROM cnpscy_amazon_order o
        {tier_join}
        LEFT JOIN cnpscy_advert a ON a.advert_id = o.advert_id AND a.advert_isdel = 1
        WHERE o.order_time_day BETWEEN %s AND %s{tier_clause}
        GROUP BY o.advert_id
    """
    click_join = ""
    click_tier_clause = ""
    if tier:
        click_join = (
            " INNER JOIN cnpscy_oi_tier_assignments t"
            " ON c.advert_id = CAST(t.merchantId AS UNSIGNED)"
        )
        click_tier_clause = " AND t.tier = %s"
    click_sql = f"""
        SELECT
            CAST(c.advert_id AS CHAR) AS merchantId,
            SUM(COALESCE(c.click, 0)) AS trackedClicks
        FROM cnpscy_amazon_click c
        {click_join}
        WHERE c.time_day BETWEEN %s AND %s{click_tier_clause}
        GROUP BY c.advert_id
    """
    args = [start_day, end_day]
    if tier:
        args.append(tier)
    order_rows = fetch_all(conn, order_sql, tuple(args))
    click_rows = fetch_all(conn, click_sql, tuple(args))

    # 复用 Tier Sheet 的合并规则，保证口径完全一致
    base_rows = [
        {
            "Merchant ID": str(r["merchantId"] or "").strip(),
            "ALL Commission": r.get("configuredAllCommission"),
        }
        for r in order_rows
        if str(r["merchantId"] or "").strip()
    ]
    merged = merge_tier_report_metrics(base_rows, order_rows, click_rows)
    order_map = {str(r["merchantId"] or "").strip(): r for r in order_rows}

    field_map = {
        "Order count": "orders",
        "Revenue": "revenue",
        "Backend EPC": "epc",
        "EPC(All)": "allEpc",
        "EPC(Aff)": "affEpc",
        "AOV": "aov",
        "Conversion Rate": "conversionRate",
        "Clicks": "clicks",
        "DPV": "dpv",
        "ATC": "atc",
        "Payout": "payout",
        "Affiliate Payout": "affiliatePayout",
        "ALL Commission": "allCommissionRate",
        "AFF Commission": "affCommissionRate",
    }
    result: dict[str, dict[str, Any]] = {}
    for row in merged:
        mid = str(row.get("Merchant ID") or "").strip()
        if not mid:
            continue
        metrics = {
            offer_field: row.get(sheet_field)
            for sheet_field, offer_field in field_map.items()
        }
        src = order_map.get(mid, {})
        metrics["directSales"] = src.get("directSales")
        metrics["haloSales"] = src.get("haloSales")
        result[mid] = metrics
    return result


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
        metadata_columns = table_columns(conn, "cnpscy_oi_offer_sheet_metadata")
        agency_expression = "MAX(sm.agency)" if "agency" in metadata_columns else "NULL"
        bd_expression = (
            "MAX(sm.businessManager)"
            if tier_name == TIER1_NAME and "businessManager" in metadata_columns
            else "NULL"
        )
        if compact:
            base_rows = fetch_all(
                conn,
                f"""
                SELECT
                    MAX(COALESCE(CAST(a.advert_id AS CHAR), t.merchantId)) AS `Merchant ID`,
                    MAX(a.advert_name) AS `Merchant Name`,
                    MAX(a.advert_name) AS `Brand`,
                    MAX(COALESCE(NULLIF(TRIM(at.advert_type_name), ''), 'Unknown')) AS `Network`,
                    {agency_expression} AS `Agency`,
                    {bd_expression} AS `BD`,
                    MAX(a.advert_money) AS `ALL Commission`,
                    MAX(sm.region) AS `COUNTRY`
                FROM cnpscy_oi_tier_assignments t
                LEFT JOIN cnpscy_advert a
                    ON a.advert_id = CAST(t.merchantId AS UNSIGNED) AND a.advert_isdel = 1
                LEFT JOIN cnpscy_advert_type at
                    ON a.advert_advertiser = at.advert_type_id AND at.advert_type_parent_id = 53
                LEFT JOIN cnpscy_oi_offer_sheet_metadata sm ON t.merchantId = sm.merchantId
                WHERE t.tier = %s
                GROUP BY t.merchantId
                ORDER BY CAST(t.merchantId AS UNSIGNED)
                """,
                (tier_name,),
            )
        else:
            base_rows = fetch_all(
            conn,
            f"""
            SELECT
                MAX(COALESCE(CAST(a.advert_id AS CHAR), t.merchantId)) AS `Merchant ID`,
                MAX(a.advert_name) AS `Merchant Name`,
                MAX(a.advert_name) AS `Brand`,
                MAX(COALESCE(NULLIF(TRIM(at.advert_type_name), ''), pr_net.network, 'Unknown')) AS `Network`,
                {agency_expression} AS `Agency`,
                {bd_expression} AS `BD`,
                MAX(a.advert_money) AS `ALL Commission`,
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
        if tier_name != TIER1_NAME:
            for row in base_rows:
                row.pop("BD", None)
        order_rows = fetch_all(
            conn,
            """
            SELECT
                CAST(o.advert_id AS CHAR) AS merchantId,
                SUM(COALESCE(o.total_purchases, 0)) AS orders,
                SUM(COALESCE(o.amount, 0)) AS revenue,
                SUM(COALESCE(o.payout, 0)) AS payout,
                SUM(COALESCE(o.aff_payout, 0)) AS affiliatePayout,
                COALESCE(
                    100 * SUM(COALESCE(o.aff_payout, 0)) / NULLIF(SUM(COALESCE(o.payout, 0)), 0),
                    MAX(o.aff_proportion)
                ) AS affProportion,
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
        aov_estimates = latest_merchant_aov_estimates(
            conn,
            [row.get("Merchant ID") for row in base_rows],
        )

    rows = merge_tier_report_metrics(base_rows, order_rows, click_rows, aov_estimates)
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
            "merchantTables": ["cnpscy_advert", "cnpscy_advert_type", "cnpscy_oi_offer_sheet_metadata"],
            "tierTable": "cnpscy_oi_tier_assignments",
            "aovEstimateTable": MERCHANT_AOV_ESTIMATES_TABLE,
        },
    }
    _tier_sheet_cache[cache_key] = (now, result)
    return result


def product_keywords_payload(force_refresh: bool = False) -> dict[str, Any]:
    """? cnpscy_oi_product_keywords ??????????
    ?? window.PRODUCT_KEYWORDS ? shape?????? db_keywords_cache.json?
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


# ?? publishers cache ??????????????????????????????????????????????????


PUBLISHER_PORTFOLIO_MARKET_SQL = """
CASE
    WHEN a.advert_url_real LIKE '%%www.amazon.co.uk%%' THEN 'amazon.co.uk'
    WHEN a.advert_url_real LIKE '%%www.amazon.com.mx%%' THEN 'amazon.com.mx'
    WHEN a.advert_url_real LIKE '%%www.amazon.com%%' THEN 'amazon.com'
    WHEN a.advert_url_real LIKE '%%www.amazon.de%%' THEN 'amazon.de'
    WHEN a.advert_url_real LIKE '%%www.amazon.fr%%' THEN 'amazon.fr'
    WHEN a.advert_url_real LIKE '%%www.amazon.ca%%' THEN 'amazon.ca'
    WHEN a.advert_url_real LIKE '%%www.amazon.it%%' THEN 'amazon.it'
    WHEN a.advert_url_real LIKE '%%www.amazon.es%%' THEN 'amazon.es'
    WHEN a.advert_url_real LIKE '%%www.amazon.nl%%' THEN 'amazon.nl'
    WHEN a.last_redirect_domain LIKE '%%www.amazon.co.uk%%' THEN 'amazon.co.uk'
    WHEN a.last_redirect_domain LIKE '%%www.amazon.com.mx%%' THEN 'amazon.com.mx'
    WHEN a.last_redirect_domain LIKE '%%www.amazon.com%%' THEN 'amazon.com'
    WHEN a.last_redirect_domain LIKE '%%www.amazon.de%%' THEN 'amazon.de'
    WHEN a.last_redirect_domain LIKE '%%www.amazon.fr%%' THEN 'amazon.fr'
    WHEN a.last_redirect_domain LIKE '%%www.amazon.ca%%' THEN 'amazon.ca'
    WHEN a.last_redirect_domain LIKE '%%www.amazon.it%%' THEN 'amazon.it'
    WHEN a.last_redirect_domain LIKE '%%www.amazon.es%%' THEN 'amazon.es'
    WHEN a.last_redirect_domain LIKE '%%www.amazon.nl%%' THEN 'amazon.nl'
    WHEN aa.advert_store_country_name LIKE 'US%%' THEN 'amazon.com'
    WHEN aa.advert_store_country_name LIKE 'GB%%' THEN 'amazon.co.uk'
    WHEN aa.advert_store_country_name LIKE 'UK%%' THEN 'amazon.co.uk'
    WHEN aa.advert_store_country_name LIKE 'DE%%' THEN 'amazon.de'
    WHEN aa.advert_store_country_name LIKE 'FR%%' THEN 'amazon.fr'
    WHEN aa.advert_store_country_name LIKE 'CA%%' THEN 'amazon.ca'
    WHEN aa.advert_store_country_name LIKE 'IT%%' THEN 'amazon.it'
    WHEN aa.advert_store_country_name LIKE 'ES%%' THEN 'amazon.es'
    WHEN aa.advert_store_country_name LIKE 'MX%%' THEN 'amazon.com.mx'
    WHEN aa.advert_store_country_name LIKE 'NL%%' THEN 'amazon.nl'
    ELSE 'Unknown'
END
""".strip()


PUBLISHER_PORTFOLIO_SQL = f"""
SELECT
    o.user_id,
    o.advert_id AS merchant_id,
    MAX(a.advert_name) AS merchant_name,
    MAX(COALESCE(NULLIF(TRIM(sm.sheetCategory), ''), cat.mainCategory, 'Uncategorized')) AS category,
    MAX(COALESCE(NULLIF(TRIM(at.advert_type_name), ''), 'Unknown')) AS network,
    MAX(COALESCE(NULLIF(TRIM(t.tier), ''), 'Unknown')) AS tier,
    MAX(a.advert_money) AS commission_rate,
    {PUBLISHER_PORTFOLIO_MARKET_SQL} AS market,
    CASE
        WHEN MAX(o.order_clicks) > 0 THEN MAX(o.order_clicks)
        ELSE COALESCE(MAX(c.tracked_clicks), 0)
    END AS clicks,
    MAX(o.dpv) AS dpv,
    MAX(o.atc) AS atc,
    MAX(o.orders) AS orders,
    MAX(o.sales) AS sales,
    MAX(o.all_commission) AS all_commission,
    MAX(o.aff_commission) AS aff_commission
FROM (
    SELECT
        user_id,
        advert_id,
        SUM(COALESCE(total_clicks, 0)) AS order_clicks,
        SUM(COALESCE(detail_page_views, 0)) AS dpv,
        SUM(COALESCE(add_to_carts, 0)) AS atc,
        SUM(COALESCE(total_purchases, 0)) AS orders,
        SUM(COALESCE(amount, 0)) AS sales,
        SUM(COALESCE(payout, 0)) AS all_commission,
        SUM(COALESCE(aff_payout, 0)) AS aff_commission
    FROM cnpscy_amazon_order
    WHERE user_id = %s
      AND advert_id IS NOT NULL
      AND advert_id > 0
      {{order_date_filter}}
    GROUP BY user_id, advert_id
) o
LEFT JOIN (
    SELECT
        user_id,
        advert_id,
        SUM(COALESCE(click, 0)) AS tracked_clicks
    FROM cnpscy_amazon_click
    WHERE user_id = %s
      AND advert_id IS NOT NULL
      AND advert_id > 0
      {{click_date_filter}}
    GROUP BY user_id, advert_id
) c
    ON o.user_id = c.user_id
    AND o.advert_id = c.advert_id
LEFT JOIN cnpscy_advert a ON o.advert_id = a.advert_id
LEFT JOIN (
    SELECT advert_id, MAX(advert_store_country_name) AS advert_store_country_name
    FROM cnpscy_advert_all
    GROUP BY advert_id
) aa ON o.advert_id = aa.advert_id
LEFT JOIN cnpscy_advert_type at
    ON a.advert_advertiser = at.advert_type_id AND at.advert_type_parent_id = 53
LEFT JOIN cnpscy_oi_offer_sheet_metadata sm
    ON CAST(o.advert_id AS CHAR) = sm.merchantId
LEFT JOIN cnpscy_oi_tier_assignments t
    ON CAST(o.advert_id AS CHAR) = t.merchantId
LEFT JOIN (
    SELECT
        mc2.merchantId,
        MAX(c_main.categoryName) AS mainCategory
    FROM cnpscy_oi_merchant_category mc2
    LEFT JOIN cnpscy_oi_category c_main
        ON mc2.categoryId = c_main.categoryId AND c_main.level = 1
    GROUP BY mc2.merchantId
) cat ON CAST(o.advert_id AS CHAR) = cat.merchantId
GROUP BY o.user_id, o.advert_id, market
"""


BRAND_MEDIA_TREND_SQL = """
SELECT
    o.advert_id AS merchant_id,
    o.user_id,
    COALESCE(NULLIF(MAX(u.user_name), ''), CAST(o.user_id AS CHAR)) AS user_name,
    COALESCE(NULLIF(MAX(u.admin_name), ''), 'Unknown') AS admin_name,
    COALESCE(NULLIF(MAX(a.advert_name), ''), CAST(o.advert_id AS CHAR)) AS merchant_name,
    o.order_time_day AS order_day,
    SUM(COALESCE(o.amount, 0)) AS revenue,
    SUM(COALESCE(o.total_purchases, 0)) AS orders,
    SUM(COALESCE(o.payout, 0)) AS all_commission,
    SUM(COALESCE(o.aff_payout, 0)) AS aff_commission
FROM cnpscy_amazon_order o
LEFT JOIN (
    SELECT
        u.user_id,
        MAX(NULLIF(TRIM(u.user_name), '')) AS user_name,
        COALESCE(MAX(NULLIF(TRIM(ad.admin_name), '')), 'Unknown') AS admin_name
    FROM v_maxai_cnpscy_user u
    LEFT JOIN cnpscy_admins ad
        ON CAST(u.admin_id_look AS CHAR) = CAST(ad.admin_code AS CHAR)
        AND ad.is_delete = 0
    GROUP BY u.user_id
) u ON o.user_id = u.user_id
LEFT JOIN (
    SELECT advert_id, MAX(NULLIF(TRIM(advert_name), '')) AS advert_name
    FROM cnpscy_advert
    GROUP BY advert_id
) a ON o.advert_id = a.advert_id
WHERE o.advert_id = %s
  AND o.user_id IS NOT NULL
  AND o.user_id > 0
  AND o.order_time_day BETWEEN %s AND %s
GROUP BY o.advert_id, o.user_id, o.order_time_day
ORDER BY o.order_time_day ASC, revenue DESC, o.user_id ASC
"""


def _brand_media_trend_date(value: Any) -> str | None:
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    text = str(value or "").strip()
    if re.match(r"^\d{8}$", text):
        try:
            return dt.datetime.strptime(text, "%Y%m%d").date().isoformat()
        except ValueError:
            return None
    try:
        return dt.date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def brand_media_trend_from_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Normalize merchant × publisher × day rows for the UI trend renderer.

    A point is emitted only when the order table has a record for that
    publisher/date. A zero-revenue record remains a real point; an absent
    publisher/date remains absent so the browser can render a line gap.
    """
    publishers_by_id: dict[int, dict[str, Any]] = {}
    observed_dates: set[str] = set()
    merchant_name = ""
    total_revenue = 0.0
    total_orders = 0
    total_all_commission = 0.0
    total_aff_commission = 0.0

    for row in rows:
        try:
            user_id = int(row.get("user_id") or 0)
        except (TypeError, ValueError):
            continue
        day = _brand_media_trend_date(row.get("order_day"))
        if user_id <= 0 or day is None:
            continue

        row_merchant_name = str(row.get("merchant_name") or "").strip()
        if row_merchant_name and not merchant_name:
            merchant_name = row_merchant_name
        user_name = str(row.get("user_name") or user_id).strip() or str(user_id)
        admin_name = str(row.get("admin_name") or "Unknown").strip() or "Unknown"
        revenue = to_float(row.get("revenue"))
        orders = int(to_float(row.get("orders")))
        all_commission = to_float(row.get("all_commission"))
        aff_commission = to_float(row.get("aff_commission"))

        publisher = publishers_by_id.setdefault(
            user_id,
            {
                "userId": user_id,
                "userName": user_name,
                "adminName": admin_name,
                "_points": {},
                "totalRevenue": 0.0,
                "totalOrders": 0,
                "totalAllCommission": 0.0,
                "totalAffCommission": 0.0,
            },
        )
        if publisher["userName"] == str(user_id) and user_name != str(user_id):
            publisher["userName"] = user_name
        if publisher["adminName"] == "Unknown" and admin_name != "Unknown":
            publisher["adminName"] = admin_name

        point = publisher["_points"].setdefault(
            day,
            {
                "date": day,
                "revenue": 0.0,
                "orders": 0,
                "allCommission": 0.0,
                "affCommission": 0.0,
            },
        )
        point["revenue"] += revenue
        point["orders"] += orders
        point["allCommission"] += all_commission
        point["affCommission"] += aff_commission
        publisher["totalRevenue"] += revenue
        publisher["totalOrders"] += orders
        publisher["totalAllCommission"] += all_commission
        publisher["totalAffCommission"] += aff_commission

        observed_dates.add(day)
        total_revenue += revenue
        total_orders += orders
        total_all_commission += all_commission
        total_aff_commission += aff_commission

    publishers: list[dict[str, Any]] = []
    observation_count = 0
    for publisher in publishers_by_id.values():
        points = [
            {
                "date": point["date"],
                "revenue": round(point["revenue"], 2),
                "orders": point["orders"],
                "allCommission": round(point["allCommission"], 2),
                "affCommission": round(point["affCommission"], 2),
            }
            for point in publisher.pop("_points").values()
        ]
        points.sort(key=lambda point: point["date"])
        observation_count += len(points)
        publishers.append(
            {
                **publisher,
                "totalRevenue": round(publisher["totalRevenue"], 2),
                "totalOrders": publisher["totalOrders"],
                "totalAllCommission": round(publisher["totalAllCommission"], 2),
                "totalAffCommission": round(publisher["totalAffCommission"], 2),
                "activeDays": len(points),
                "firstActiveDate": points[0]["date"] if points else None,
                "lastActiveDate": points[-1]["date"] if points else None,
                "points": points,
            }
        )

    publishers.sort(
        key=lambda publisher: (
            -float(publisher["totalRevenue"]),
            str(publisher["userName"]).casefold(),
            int(publisher["userId"]),
        )
    )
    dates = sorted(observed_dates)
    return {
        "merchantName": merchant_name,
        "publishers": publishers,
        "summary": {
            "activePublisherCount": len(publishers),
            "totalRevenue": round(total_revenue, 2),
            "totalOrders": total_orders,
            "totalAllCommission": round(total_all_commission, 2),
            "totalAffCommission": round(total_aff_commission, 2),
            "activeDayCount": len(dates),
            "observationCount": observation_count,
            "firstActiveDate": dates[0] if dates else None,
            "lastActiveDate": dates[-1] if dates else None,
        },
    }


def brand_media_trend_payload(
    merchant_id: int,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    """Return daily revenue series for every active publisher of one merchant."""
    try:
        normalized_merchant_id = int(merchant_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("merchantId must be a positive integer") from exc
    if normalized_merchant_id <= 0:
        raise ValueError("merchantId must be a positive integer")

    raw_start = str(start_date or "").strip()
    raw_end = str(end_date or "").strip()
    if bool(raw_start) != bool(raw_end):
        raise ValueError("startDate and endDate must be provided together")
    range_start = parse_tier_report_date(raw_start)
    range_end = parse_tier_report_date(raw_end)
    if raw_start and range_start is None:
        raise ValueError("startDate must use YYYY-MM-DD format")
    if raw_end and range_end is None:
        raise ValueError("endDate must use YYYY-MM-DD format")
    if range_start is None:
        range_end = reporting_today() - dt.timedelta(days=DEFAULT_REPORTING_DELAY_DAYS)
        range_start = range_end - dt.timedelta(days=89)
    if range_start > range_end:
        raise ValueError("startDate cannot be after endDate")
    range_days = (range_end - range_start).days + 1
    if range_days > MAX_BRAND_MEDIA_TREND_RANGE_DAYS:
        raise ValueError(
            f"date range cannot exceed {MAX_BRAND_MEDIA_TREND_RANGE_DAYS} days"
        )

    cache_key = "|".join(
        [
            str(normalized_merchant_id),
            range_start.isoformat(),
            range_end.isoformat(),
        ]
    )
    now = time.time()
    cached = _brand_media_trend_cache.get(cache_key)
    if cached is not None and now - cached[0] < BRAND_MEDIA_TREND_CACHE_TTL:
        return cached[1]

    with db_connection() as conn:
        rows = fetch_all(
            conn,
            BRAND_MEDIA_TREND_SQL,
            (
                normalized_merchant_id,
                int(range_start.strftime("%Y%m%d")),
                int(range_end.strftime("%Y%m%d")),
            ),
        )

    normalized = brand_media_trend_from_rows(rows)
    result = {
        "ok": True,
        "generatedAt": utc_now_iso(),
        "source": "cnpscy_amazon_order",
        "grain": "advert_id + user_id + order_time_day",
        "metric": "amount",
        "metricLabel": "Revenue",
        "gapRule": "No order-table row is emitted for a missing publisher/date.",
        "merchant": {
            "merchantId": normalized_merchant_id,
            "merchantName": normalized["merchantName"] or str(normalized_merchant_id),
        },
        "dateRange": {
            "startDate": range_start.isoformat(),
            "endDate": range_end.isoformat(),
            "dayCount": range_days,
        },
        "summary": normalized["summary"],
        "publishers": normalized["publishers"],
    }
    _brand_media_trend_cache[cache_key] = (now, result)
    return result


def _publisher_metric_bucket() -> dict[str, Any]:
    return {
        "clicks": 0,
        "dpv": 0,
        "atc": 0,
        "orders": 0,
        "sales": 0.0,
        "allCommission": 0.0,
        "affCommission": 0.0,
        "aov": None,
        "epc": 0.0,
        "allEpc": 0.0,
        "affEpc": 0.0,
        "conversionRate": 0.0,
        "effectiveCommissionRate": None,
    }


def _accumulate_publisher_metric(target: dict[str, Any], row: dict[str, Any]) -> None:
    target["clicks"] += int(row.get("clicks") or 0)
    target["dpv"] += int(row.get("dpv") or 0)
    target["atc"] += int(row.get("atc") or 0)
    target["orders"] += int(row.get("orders") or 0)
    target["sales"] += float(row.get("sales") or 0)
    target["allCommission"] += float(row.get("all_commission") or 0)
    target["affCommission"] += float(row.get("aff_commission") or 0)


def _finalize_publisher_metric(metric: dict[str, Any]) -> None:
    clicks = int(metric.get("clicks") or 0)
    orders = int(metric.get("orders") or 0)
    sales = float(metric.get("sales") or 0)
    all_commission = float(metric.get("allCommission") or 0)
    aff_commission = float(metric.get("affCommission") or 0)
    metric["aov"] = sales / orders if orders > 0 else None
    metric["allEpc"] = commission_amount_epc(all_commission, clicks)
    metric["affEpc"] = commission_amount_epc(aff_commission, clicks)
    metric["epc"] = metric["affEpc"]
    metric["conversionRate"] = orders / clicks if clicks > 0 else 0.0
    metric["effectiveCommissionRate"] = all_commission / sales * 100 if sales > 0 else None


def publisher_portfolios_from_rows(
    rows: list[dict[str, Any]],
) -> tuple[dict[int, list[dict[str, Any]]], dict[int, str]]:
    """Aggregate publisher × merchant × market query rows into portfolio records."""
    by_user: dict[int, dict[int, dict[str, Any]]] = {}
    merchant_name_map: dict[int, str] = {}

    for row in rows:
        user_id = int(row.get("user_id") or 0)
        merchant_id = int(row.get("merchant_id") or 0)
        if user_id <= 0 or merchant_id <= 0:
            continue

        merchant_name = str(row.get("merchant_name") or merchant_id).strip()
        merchant_name_map.setdefault(merchant_id, merchant_name)
        user_merchants = by_user.setdefault(user_id, {})
        merchant = user_merchants.get(merchant_id)
        if merchant is None:
            raw_rate = row.get("commission_rate")
            merchant = {
                "merchantId": merchant_id,
                "merchantName": merchant_name,
                "category": str(row.get("category") or "Uncategorized").strip() or "Uncategorized",
                "network": str(row.get("network") or "Unknown").strip() or "Unknown",
                "tier": str(row.get("tier") or "Unknown").strip() or "Unknown",
                "commissionRate": float(raw_rate) if raw_rate not in (None, "") else None,
                "markets": {},
                "total": _publisher_metric_bucket(),
            }
            user_merchants[merchant_id] = merchant

        market = str(row.get("market") or "Unknown").strip() or "Unknown"
        market_metric = merchant["markets"].setdefault(market, _publisher_metric_bucket())
        _accumulate_publisher_metric(market_metric, row)
        _accumulate_publisher_metric(merchant["total"], row)

    result: dict[int, list[dict[str, Any]]] = {}
    for user_id, user_merchants in by_user.items():
        merchants = list(user_merchants.values())
        for merchant in merchants:
            _finalize_publisher_metric(merchant["total"])
            for market_metric in merchant["markets"].values():
                _finalize_publisher_metric(market_metric)
        merchants.sort(
            key=lambda merchant: (
                float(merchant["total"].get("sales") or 0),
                int(merchant["total"].get("orders") or 0),
                merchant["merchantName"].lower(),
            ),
            reverse=True,
        )
        result[user_id] = merchants
    return result, merchant_name_map


def publisher_portfolio_summary(merchants: list[dict[str, Any]]) -> dict[str, Any]:
    total = _publisher_metric_bucket()
    category_stats: dict[str, dict[str, Any]] = {}
    weighted_rate_numerator = 0.0
    weighted_rate_denominator = 0.0
    fallback_rates: list[float] = []

    for merchant in merchants:
        metrics = merchant.get("total") or {}
        _accumulate_publisher_metric(
            total,
            {
                "clicks": metrics.get("clicks"),
                "dpv": metrics.get("dpv"),
                "atc": metrics.get("atc"),
                "orders": metrics.get("orders"),
                "sales": metrics.get("sales"),
                "all_commission": metrics.get("allCommission"),
                "aff_commission": metrics.get("affCommission"),
            },
        )
        category = str(merchant.get("category") or "Uncategorized")
        category_row = category_stats.setdefault(
            category,
            {"category": category, "merchantCount": 0, "orders": 0, "sales": 0.0, "allCommission": 0.0},
        )
        category_row["merchantCount"] += 1
        category_row["orders"] += int(metrics.get("orders") or 0)
        category_row["sales"] += float(metrics.get("sales") or 0)
        category_row["allCommission"] += float(metrics.get("allCommission") or 0)

        rate = merchant.get("commissionRate")
        if rate not in (None, ""):
            numeric_rate = float(rate)
            fallback_rates.append(numeric_rate)
            sales = float(metrics.get("sales") or 0)
            if sales > 0:
                weighted_rate_numerator += numeric_rate * sales
                weighted_rate_denominator += sales

    _finalize_publisher_metric(total)
    categories = sorted(
        category_stats.values(),
        key=lambda row: (float(row["sales"]), int(row["merchantCount"]), row["category"].lower()),
        reverse=True,
    )
    total_sales = float(total["sales"] or 0)
    for row in categories:
        row["salesShare"] = float(row["sales"] or 0) / total_sales if total_sales > 0 else 0

    weighted_rate = None
    if weighted_rate_denominator > 0:
        weighted_rate = weighted_rate_numerator / weighted_rate_denominator
    elif fallback_rates:
        weighted_rate = sum(fallback_rates) / len(fallback_rates)

    return {
        "merchantCount": len(merchants),
        "total": total,
        "weightedCommissionRate": weighted_rate,
        "topCategory": categories[0]["category"] if categories else None,
        "categories": categories,
    }


def publishers_payload(force_refresh: bool = False) -> dict[str, Any]:
    """? db_publishers_cache.json ??????????

    ?? offers_payload ?????: ???? + ???? + TTL + ?????
    ??? scripts/build_publishers_data.py ???
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


def publisher_portfolio_payload(
    user_id: int,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    """Return one publisher's merchant portfolio, optionally for an exact date range."""
    try:
        normalized_user_id = int(user_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("userId must be a positive integer") from exc
    if normalized_user_id <= 0:
        raise ValueError("userId must be a positive integer")

    raw_start = str(start_date or "").strip()
    raw_end = str(end_date or "").strip()
    range_start = parse_tier_report_date(raw_start)
    range_end = parse_tier_report_date(raw_end)
    if raw_start and range_start is None:
        raise ValueError("startDate must use YYYY-MM-DD format")
    if raw_end and range_end is None:
        raise ValueError("endDate must use YYYY-MM-DD format")
    if range_start and range_end:
        if range_start > range_end:
            raise ValueError("startDate cannot be after endDate")
        if (range_end - range_start).days + 1 > MAX_TIER_REPORT_RANGE_DAYS:
            raise ValueError(f"date range cannot exceed {MAX_TIER_REPORT_RANGE_DAYS} days")

    cache_key = "|".join(
        [
            str(normalized_user_id),
            range_start.isoformat() if range_start else "",
            range_end.isoformat() if range_end else "",
        ]
    )
    now = time.time()
    cached = _publisher_portfolio_cache.get(cache_key)
    if cached is not None and now - cached[0] < PUBLISHERS_CACHE_TTL:
        return cached[1]

    order_params: list[Any] = [normalized_user_id]
    click_params: list[Any] = [normalized_user_id]
    order_date_filter = ""
    click_date_filter = ""
    if range_start is not None and range_end is not None:
        order_date_filter = "AND order_time_day BETWEEN %s AND %s"
        click_date_filter = "AND time_day BETWEEN %s AND %s"
        date_params = [
            int(range_start.strftime("%Y%m%d")),
            int(range_end.strftime("%Y%m%d")),
        ]
        order_params.extend(date_params)
        click_params.extend(date_params)
    elif range_start is not None:
        order_date_filter = "AND order_time_day >= %s"
        click_date_filter = "AND time_day >= %s"
        date_param = int(range_start.strftime("%Y%m%d"))
        order_params.append(date_param)
        click_params.append(date_param)
    elif range_end is not None:
        order_date_filter = "AND order_time_day <= %s"
        click_date_filter = "AND time_day <= %s"
        date_param = int(range_end.strftime("%Y%m%d"))
        order_params.append(date_param)
        click_params.append(date_param)

    with db_connection() as conn:
        rows = fetch_all(
            conn,
            PUBLISHER_PORTFOLIO_SQL.format(
                order_date_filter=order_date_filter,
                click_date_filter=click_date_filter,
            ),
            tuple(order_params + click_params),
        )
        user_rows = fetch_all(
            conn,
            """
            SELECT
                u.user_id,
                u.user_name,
                COALESCE(ad.admin_name, 'Unknown') AS admin_name
            FROM v_maxai_cnpscy_user u
            LEFT JOIN cnpscy_admins ad
                ON CAST(u.admin_id_look AS CHAR) = CAST(ad.admin_code AS CHAR)
                AND ad.is_delete = 0
            WHERE u.user_id = %s
            LIMIT 1
            """,
            (normalized_user_id,),
        )

    merchants_by_user, _ = publisher_portfolios_from_rows(rows)
    merchants = merchants_by_user.get(normalized_user_id, [])
    user_row = user_rows[0] if user_rows else {}
    result = {
        "ok": True,
        "generatedAt": utc_now_iso(),
        "source": "cnpscy_amazon_order",
        "clickSource": (
            "cnpscy_amazon_order.total_clicks with "
            "cnpscy_amazon_click.click fallback"
        ),
        "grain": "user_id + advert_id",
        "dateRange": {
            "startDate": range_start.isoformat() if range_start else None,
            "endDate": range_end.isoformat() if range_end else None,
        },
        "publisher": {
            "userId": normalized_user_id,
            "userName": str(user_row.get("user_name") or normalized_user_id),
            "adminName": str(user_row.get("admin_name") or "Unknown"),
        },
        "summary": publisher_portfolio_summary(merchants),
        "merchants": merchants,
    }
    _publisher_portfolio_cache[cache_key] = (now, result)
    return result


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
