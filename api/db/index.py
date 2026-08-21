from http import HTTPStatus
from io import BytesIO
import json

from auth import _read_json_body, require_auth, session_payload
from offer_db import (
    DIGITS_RE,
    add_merchant_to_tier1,
    delete_monthly_new_merchant,
    first_query_value,
    handle_options,
    int_query_value,
    merchant_payload,
    monthly_new_merchants_payload,
    offers_payload,
    parse_query,
    product_keywords_payload,
    brand_media_trend_payload,
    publisher_portfolio_payload,
    publishers_payload,
    read_static_merchant_ids,
    require_db_token,
    search_payload,
    send_db_error,
    send_json,
    status_payload,
    tier1_additions_payload,
    tier1_merchant_search_payload,
    tier_sheet_payload,
    tier_summary_payload,
    upsert_monthly_new_merchant,
)


class WsgiTarget:
    def __init__(self, environ):
        path = str(environ.get("PATH_INFO") or "")
        query = str(environ.get("QUERY_STRING") or "")
        self.path = f"{path}?{query}" if query else path
        self.headers = self._request_headers(environ)
        self.headers["Content-Length"] = str(environ.get("CONTENT_LENGTH") or "")
        self.rfile = environ.get("wsgi.input")
        self.status = 500
        self.response_headers = []
        self.wfile = BytesIO()

    @staticmethod
    def _request_headers(environ):
        headers = {}
        for key, value in environ.items():
            if key.startswith("HTTP_"):
                name = "-".join(part.title() for part in key[5:].split("_"))
                headers[name] = str(value)
        return headers

    def send_response(self, status):
        self.status = int(status)

    def send_header(self, name, value):
        self.response_headers.append((str(name), str(value)))

    def end_headers(self):
        return None


def handle_status(target, query):
    try:
        include_coverage = first_query_value(query, "coverage").lower() in {"1", "true", "yes"}
        send_json(
            target,
            200,
            status_payload(
                month=first_query_value(query, "month"),
                include_coverage=include_coverage,
            ),
        )
    except Exception as error:
        send_db_error(target, error)


def handle_merchant(target, query):
    merchant_id = first_query_value(query, "merchantId")
    if not merchant_id:
        send_json(target, 400, {"ok": False, "error": "merchantId is required"})
        return
    limit = int_query_value(query, "limit", 50, 1, 100)
    months = int_query_value(query, "months", 12, 1, 36)
    minimal = first_query_value(query, "minimal", "").lower() in {"1", "true", "yes"}
    try:
        send_json(
            target,
            200,
            merchant_payload(merchant_id, product_limit=limit, months=months, minimal=minimal),
        )
    except ValueError as error:
        send_json(target, 400, {"ok": False, "error": str(error)})
    except Exception as error:
        send_db_error(target, error)


def handle_search(target, query):
    text = first_query_value(query, "q")
    limit = int_query_value(query, "limit", 25, 1, 50)
    try:
        send_json(target, 200, search_payload(text, limit=limit))
    except Exception as error:
        send_db_error(target, error)


def handle_ui_status(target, query):
    try:
        send_json(target, 200, status_payload(month=first_query_value(query, "month")))
    except Exception as error:
        send_db_error(target, error)


def handle_ui_merchant(target, query):
    merchant_id = first_query_value(query, "merchantId")
    if not merchant_id:
        send_json(target, 400, {"ok": False, "error": "merchantId is required"})
        return
    if not DIGITS_RE.match(merchant_id):
        send_json(target, 400, {"ok": False, "error": "merchantId must be numeric"})
        return
    if merchant_id not in set(read_static_merchant_ids()):
        send_json(target, 404, {"ok": False, "error": "merchantId is not in the public snapshot"})
        return
    limit = int_query_value(query, "limit", 20, 1, 50)
    months = int_query_value(query, "months", 12, 1, 24)
    minimal = first_query_value(query, "minimal", "").lower() in {"1", "true", "yes"}
    try:
        send_json(
            target,
            200,
            merchant_payload(merchant_id, product_limit=limit, months=months, minimal=minimal),
        )
    except ValueError as error:
        send_json(target, 400, {"ok": False, "error": str(error)})
    except Exception as error:
        send_db_error(target, error)


def handle_ui_search(target, query):
    text = first_query_value(query, "q")
    limit = int_query_value(query, "limit", 15, 1, 25)
    if len(text) < 2:
        send_json(target, 200, {"ok": True, "query": text, "results": []})
        return
    try:
        public_ids = set(read_static_merchant_ids())
        payload = search_payload(text, limit=max(50, limit * 4))
        payload["results"] = [
            row
            for row in payload.get("results", [])
            if str(row.get("merchantId") or "") in public_ids
        ][:limit]
        send_json(target, 200, payload)
    except Exception as error:
        send_db_error(target, error)


def handle_ui_keywords(target):
    try:
        send_json(target, 200, product_keywords_payload())
    except Exception as error:
        send_db_error(target, error)


def handle_ui_publishers(target, query):
    try:
        user_id = first_query_value(query, "userId")
        if user_id:
            send_json(
                target,
                200,
                publisher_portfolio_payload(
                    user_id,
                    start_date=first_query_value(query, "startDate") or None,
                    end_date=first_query_value(query, "endDate") or None,
                ),
            )
        else:
            send_json(target, 200, publishers_payload(
                force_refresh=first_query_value(query, "refresh").lower() in {"1", "true", "yes"}
            ))
    except ValueError as error:
        send_json(target, 400, {"ok": False, "error": str(error)})
    except Exception as error:
        send_db_error(target, error)


def handle_ui_brand_media_trend(target, query):
    merchant_id = first_query_value(query, "merchantId")
    if not merchant_id:
        send_json(target, 400, {"ok": False, "error": "merchantId is required"})
        return
    try:
        send_json(
            target,
            200,
            brand_media_trend_payload(
                merchant_id,
                start_date=first_query_value(query, "startDate") or None,
                end_date=first_query_value(query, "endDate") or None,
            ),
        )
    except ValueError as error:
        send_json(target, 400, {"ok": False, "error": str(error)})
    except Exception as error:
        send_db_error(target, error)


def handle_ui_offers(target, query):
    try:
        send_json(
            target,
            200,
            offers_payload(
                month=first_query_value(query, "month") or None,
                start_date=first_query_value(query, "start_date") or None,
                end_date=first_query_value(query, "end_date") or None,
            ),
        )
    except ValueError as error:
        send_json(target, 400, {"ok": False, "error": str(error)})
    except Exception as error:
        send_db_error(target, error)


def handle_ui_tier_summary(target, query):
    try:
        send_json(
            target,
            200,
            tier_summary_payload(month=first_query_value(query, "month") or None),
        )
    except ValueError as error:
        send_json(target, 400, {"ok": False, "error": str(error)})
    except Exception as error:
        send_db_error(target, error)


def handle_ui_tier_sheet(target, query):
    tier = first_query_value(query, "tier")
    if not tier:
        send_json(
            target,
            400,
            {"ok": False, "error": "tier is required (e.g. Tier+1, Tier+2, ...)"},
        )
        return
    try:
        send_json(
            target,
            200,
            tier_sheet_payload(
                tier,
                month=first_query_value(query, "month") or None,
                start_date=first_query_value(query, "start_date") or None,
                end_date=first_query_value(query, "end_date") or None,
                compact=first_query_value(query, "compact").lower() in {"1", "true", "yes"},
            ),
        )
    except ValueError as error:
        send_json(target, 400, {"ok": False, "error": str(error)})
    except Exception as error:
        send_db_error(target, error)


def handle_ui_tier1_merchants(target, query, method):
    if method == "GET":
        action = first_query_value(query, "action", "additions").lower()
        try:
            if action == "search":
                send_json(
                    target,
                    200,
                    tier1_merchant_search_payload(
                        first_query_value(query, "q"),
                        limit=int_query_value(query, "limit", 10, 1, 25),
                    ),
                )
                return
            if action == "additions":
                send_json(
                    target,
                    200,
                    tier1_additions_payload(
                        limit=int_query_value(query, "limit", 100, 1, 250),
                    ),
                )
                return
            send_json(target, 400, {"ok": False, "error": "Unsupported Tier 1 merchant action"})
        except ValueError as error:
            send_json(target, 400, {"ok": False, "error": str(error)})
        except Exception as error:
            send_db_error(target, error)
        return

    if method != "POST":
        send_json(target, 405, {"ok": False, "error": "Method not allowed"})
        return

    try:
        body = _read_json_body(target)
        user = session_payload(target.headers) or {}
        result = add_merchant_to_tier1(
            str(body.get("merchantId") or ""),
            updated_by=str(user.get("sub") or "offer-intelligence-ui"),
            expected_tier=str(body.get("expectedTier") or ""),
        )
        if result.get("ok"):
            result["additions"] = tier1_additions_payload(limit=250).get("additions", [])
            send_json(target, 200, result, methods="GET, POST, OPTIONS")
            return
        status = 404 if result.get("code") == "merchant_not_found" else 409
        send_json(target, status, result, methods="GET, POST, OPTIONS")
    except (ValueError, json.JSONDecodeError):
        send_json(target, 400, {"ok": False, "error": "Invalid Tier 1 merchant request"})
    except Exception as error:
        send_db_error(target, error)


def handle_ui_monthly_new_merchants(target, query, method):
    if method == "GET":
        try:
            send_json(
                target,
                200,
                monthly_new_merchants_payload(
                    first_query_value(query, "month") or None,
                ),
                methods="GET, POST, OPTIONS",
            )
        except ValueError as error:
            send_json(
                target,
                400,
                {"ok": False, "error": str(error)},
                methods="GET, POST, OPTIONS",
            )
        except Exception as error:
            send_db_error(target, error)
        return

    if method != "POST":
        send_json(
            target,
            405,
            {"ok": False, "error": "Method not allowed"},
            methods="GET, POST, OPTIONS",
        )
        return

    try:
        body = _read_json_body(target)
        action = str(body.get("action") or "upsert").strip().lower()
        user = session_payload(target.headers) or {}
        actor = str(user.get("sub") or "offer-intelligence-ui")
        if action == "upsert":
            result = upsert_monthly_new_merchant(body, updated_by=actor)
        elif action == "delete":
            result = delete_monthly_new_merchant(
                body.get("recordId"),
                deleted_by=actor,
            )
        else:
            send_json(
                target,
                400,
                {"ok": False, "error": "Unsupported monthly new merchant action"},
                methods="GET, POST, OPTIONS",
            )
            return

        if result.get("ok"):
            send_json(target, 200, result, methods="GET, POST, OPTIONS")
            return
        status = 404 if result.get("code") == "record_not_found" else 409
        send_json(target, status, result, methods="GET, POST, OPTIONS")
    except (ValueError, json.JSONDecodeError) as error:
        send_json(
            target,
            400,
            {"ok": False, "error": str(error) or "Invalid monthly new merchant request"},
            methods="GET, POST, OPTIONS",
        )
    except Exception as error:
        send_db_error(target, error)


def app(environ, start_response):
    target = WsgiTarget(environ)
    method = str(environ.get("REQUEST_METHOD") or "GET").upper()
    route = str(target.headers.get("X-Oi-Db-Route") or "").strip()
    query = parse_query(target)

    if method == "OPTIONS":
        handle_options(
            target,
            methods=(
                "GET, POST, OPTIONS"
                if route in {"ui-tier1-merchants", "ui-monthly-new-merchants"}
                else "GET, OPTIONS"
            ),
        )
    elif route == "ui-tier1-merchants":
        if require_auth(target):
            handle_ui_tier1_merchants(target, query, method)
    elif route == "ui-monthly-new-merchants":
        if require_auth(target):
            handle_ui_monthly_new_merchants(target, query, method)
    elif method != "GET":
        send_json(target, 405, {"ok": False, "error": "Method not allowed"})
    elif route in {
        "ui-status",
        "ui-merchant",
        "ui-search",
        "ui-keywords",
        "ui-offers",
        "ui-tier-sheet",
        "ui-tier-summary",
        "ui-publishers",
        "ui-brand-media-trend",
    }:
        if require_auth(target):
            if route == "ui-status":
                handle_ui_status(target, query)
            elif route == "ui-merchant":
                handle_ui_merchant(target, query)
            elif route == "ui-search":
                handle_ui_search(target, query)
            elif route == "ui-keywords":
                handle_ui_keywords(target)
            elif route == "ui-publishers":
                handle_ui_publishers(target, query)
            elif route == "ui-brand-media-trend":
                handle_ui_brand_media_trend(target, query)
            elif route == "ui-offers":
                handle_ui_offers(target, query)
            elif route == "ui-tier-sheet":
                handle_ui_tier_sheet(target, query)
            else:
                handle_ui_tier_summary(target, query)
    elif require_db_token(target):
        if route == "status":
            handle_status(target, query)
        elif route == "merchant":
            handle_merchant(target, query)
        elif route == "search":
            handle_search(target, query)
        else:
            send_json(target, 404, {"ok": False, "error": "Unknown database route"})

    phrase = HTTPStatus(target.status).phrase
    start_response(f"{target.status} {phrase}", target.response_headers)
    return [target.wfile.getvalue()]
