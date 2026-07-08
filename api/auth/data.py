from http.server import BaseHTTPRequestHandler

from api.protected_data import handle_protected_data
from auth import handle_auth_options


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        handle_auth_options(self)

    def do_GET(self):
        handle_protected_data(self)
