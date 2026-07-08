from http.server import BaseHTTPRequestHandler

from auth import handle_auth_logout, handle_auth_options


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        handle_auth_options(self)

    def do_POST(self):
        handle_auth_logout(self)
