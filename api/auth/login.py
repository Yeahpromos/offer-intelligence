from http.server import BaseHTTPRequestHandler

from auth import handle_auth_login, handle_auth_options


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        handle_auth_options(self)

    def do_POST(self):
        handle_auth_login(self)
