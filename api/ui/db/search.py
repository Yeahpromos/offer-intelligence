from http.server import BaseHTTPRequestHandler

from auth import require_auth
from offer_db import (
    first_query_value,
    handle_options,
    int_query_value,
    parse_query,
    read_static_merchant_ids,
    search_payload,
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
        text = first_query_value(query, "q")
        limit = int_query_value(query, "limit", 15, 1, 25)
        if len(text) < 2:
            send_json(self, 200, {"ok": True, "query": text, "results": []})
            return
        try:
            public_ids = set(read_static_merchant_ids())
            payload = search_payload(text, limit=max(50, limit * 4))
            payload["results"] = [
                row for row in payload.get("results", [])
                if str(row.get("merchantId") or "") in public_ids
            ][:limit]
            send_json(self, 200, payload)
        except Exception as error:
            send_db_error(self, error)
