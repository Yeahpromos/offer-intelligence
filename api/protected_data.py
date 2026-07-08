from __future__ import annotations

from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from auth import require_auth, send_json
from browser_payloads import BROWSER_PAYLOADS, browser_payload_path


def handle_protected_data(target) -> None:
    if not require_auth(target):
        return
    query = parse_qs(urlparse(target.path).query)
    raw_name = str((query.get("file") or query.get("name") or [""])[0]).strip()
    name = raw_name.split("/")[-1].split("\\")[-1]
    try:
        path = browser_payload_path(name)
    except ValueError:
        send_json(target, 404, {"ok": False, "error": "Unknown browser payload."})
        return
    if not path.is_file():
        send_json(target, 404, {"ok": False, "error": "Browser payload is missing."})
        return

    body = path.read_bytes()
    target.send_response(200)
    target.send_header("Cache-Control", "no-store")
    target.send_header("Content-Type", BROWSER_PAYLOADS[name])
    target.send_header("Content-Length", str(len(body)))
    target.end_headers()
    target.wfile.write(body)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        handle_protected_data(self)

    def do_OPTIONS(self):
        send_json(self, 204, {})
