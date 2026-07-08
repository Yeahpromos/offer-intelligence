from http.server import BaseHTTPRequestHandler

from auth import require_auth
from offer_db import (
    DIGITS_RE,
    first_query_value,
    handle_options,
    int_query_value,
    merchant_payload,
    parse_query,
    read_static_merchant_ids,
    send_db_error,
    send_json,
)


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        handle_options(self)

    def do_GET(self):
        if not require_auth(self):
            return
        query = parse_query(self)
        merchant_id = first_query_value(query, "merchantId")
        if not merchant_id:
            send_json(self, 400, {"ok": False, "error": "merchantId is required"})
            return
        if not DIGITS_RE.match(merchant_id):
            send_json(self, 400, {"ok": False, "error": "merchantId must be numeric"})
            return
        if merchant_id not in set(read_static_merchant_ids()):
            send_json(self, 404, {"ok": False, "error": "merchantId is not in the public snapshot"})
            return
        limit = int_query_value(query, "limit", 20, 1, 50)
        months = int_query_value(query, "months", 12, 1, 24)
        try:
            send_json(self, 200, merchant_payload(merchant_id, product_limit=limit, months=months))
        except ValueError as error:
            send_json(self, 400, {"ok": False, "error": str(error)})
        except Exception as error:
            send_db_error(self, error)
