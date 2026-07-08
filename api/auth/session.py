from http.server import BaseHTTPRequestHandler

from auth import handle_auth_options, handle_auth_session


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        handle_auth_options(self)

    def do_GET(self):
        handle_auth_session(self)
