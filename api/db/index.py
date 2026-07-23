from http import HTTPStatus
from io import BytesIO

from auth import require_auth
from offer_db import (
    first_query_value,
    handle_options,
    int_query_value,
    merchant_payload,
    offers_payload,
    parse_query,
    product_keywords_payload,
    publishers_payload,
    require_db_token,
    search_payload,
    send_db_error,
    send_json,
    status_payload,
    tier_sheet_payload,
    tier_summary_payload,
)


class WsgiTarget:
    def __init__(self, environ):
        path = str(environ.get("PATH_INFO") or "")
        query = str(environ.get("QUERY_STRING") or "")
        self.path = f"{path}?{query}" if query else path
        self.headers = self._request_headers(environ)
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
    try:
        send_json(
            target,
            200,
            merchant_payload(merchant_id, product_limit=limit, months=months),
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


def handle_ui_keywords(target):
    try:
        send_json(target, 200, product_keywords_payload())
    except Exception as error:
        send_db_error(target, error)


def handle_ui_publishers(target, query):
    try:
        send_json(target, 200, publishers_payload(
            force_refresh=first_query_value(query, "refresh").lower() in {"1", "true", "yes"}
        ))
    except Exception as error:
        send_db_error(target, error)


def handle_ui_offers(target, query):
    try:
        send_json(
            target,
            200,
            offers_payload(month=first_query_value(query, "month") or None),
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


def app(environ, start_response):
    target = WsgiTarget(environ)
    method = str(environ.get("REQUEST_METHOD") or "GET").upper()
    route = str(target.headers.get("X-Oi-Db-Route") or "").strip()
    query = parse_query(target)

    if method == "OPTIONS":
        handle_options(target)
    elif method != "GET":
        send_json(target, 405, {"ok": False, "error": "Method not allowed"})
    elif route in {"ui-keywords", "ui-offers", "ui-tier-sheet", "ui-tier-summary", "ui-publishers"}:
        if require_auth(target):
            if route == "ui-keywords":
                handle_ui_keywords(target)
            elif route == "ui-publishers":
                handle_ui_publishers(target, query)
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
