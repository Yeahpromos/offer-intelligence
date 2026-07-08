from http.server import BaseHTTPRequestHandler

from auth import require_auth
from offer_db import first_query_value, handle_options, parse_query, send_db_error, send_json, status_payload


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        handle_options(self)

    def do_GET(self):
        if not require_auth(self):
            return
        try:
            query = parse_query(self)
            send_json(self, 200, status_payload(month=first_query_value(query, "month")))
        except Exception as error:
            send_db_error(self, error)
