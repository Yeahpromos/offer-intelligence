from http.server import BaseHTTPRequestHandler

from auth import _read_json_body, require_page_access, send_json
from chat_agent_http import handle_agent_request
from agent_agui import handle_agui_request
from llm_classify import classify_intent, generate_analysis_text


CHAT_ROUTES = {"analyze", "classify", "agent", "agui"}


def handle_analyze(target):
    length = int(target.headers.get("Content-Length") or 0)
    if length <= 0 or length > 16384:
        send_json(target, 400, {"ok": False, "error": "Request body is too large"})
        return

    try:
        body = _read_json_body(target)
    except Exception:
        send_json(target, 400, {"ok": False, "error": "Invalid JSON body"})
        return

    summary = body.get("summary")
    if not isinstance(summary, dict):
        send_json(target, 400, {"ok": False, "error": "summary must be a JSON object"})
        return

    language = str(body.get("language") or "en").strip()
    if language not in ("en", "zh"):
        language = "en"

    text = generate_analysis_text(summary, language)
    if text is None:
        send_json(target, 200, {"ok": False, "error": "LLM analysis unavailable"})
    else:
        send_json(target, 200, {"ok": True, "text": text})


def handle_classify(target):
    length = int(target.headers.get("Content-Length") or 0)
    if length <= 0 or length > 2048:
        send_json(target, 400, {"ok": False, "error": "Request body is too large"})
        return

    try:
        body = _read_json_body(target)
    except Exception:
        send_json(target, 400, {"ok": False, "error": "Invalid JSON body"})
        return

    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        send_json(target, 400, {"ok": False, "error": "prompt is required"})
        return

    categories = body.get("categories") or []
    if not isinstance(categories, list):
        categories = []

    result = classify_intent(prompt, categories)
    if result is None:
        send_json(target, 200, {"intent": None, "params": None})
    else:
        send_json(target, 200, result)


def dispatch_request(target, method, route):
    if route not in CHAT_ROUTES:
        send_json(target, 404, {"ok": False, "error": "Unknown chat route"})
        return

    if route == "agui":
        handle_agui_request(target, method)
        return

    if method == "OPTIONS":
        send_json(target, 204, {})
        return

    if method != "POST":
        send_json(target, 405, {"ok": False, "error": "Method not allowed"})
        return

    if not require_page_access(target, "agent" if route == "agent" else "dashboard"):
        return

    if route == "classify":
        handle_classify(target)
    elif route == "agent":
        handle_agent_request(target)
    else:
        handle_analyze(target)


class handler(BaseHTTPRequestHandler):
    def _dispatch(self, method):
        route = str(self.headers.get("X-Oi-Chat-Route") or "").strip()
        dispatch_request(self, method, route)

    def do_OPTIONS(self):
        self._dispatch("OPTIONS")

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")
