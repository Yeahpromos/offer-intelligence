from http.server import BaseHTTPRequestHandler
import datetime as dt
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


TIER_MOVE_TARGETS = {"Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"}


def _json_bytes(payload):
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _send_json(target, status, payload):
    body = _json_bytes(payload)
    target.send_response(status)
    target.send_header("Access-Control-Allow-Origin", "*")
    target.send_header("Access-Control-Allow-Headers", "Content-Type, X-Tier-Move-Token")
    target.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    target.send_header("Cache-Control", "no-store")
    target.send_header("Content-Type", "application/json; charset=utf-8")
    target.send_header("Content-Length", str(len(body)))
    target.end_headers()
    target.wfile.write(body)


def _canonical_tier(value):
    text = str(value or "").strip()
    lowered = text.lower()
    if lowered in {"black", "black tier"}:
        return "BLACK TIER"
    if lowered.startswith("tier"):
        parts = "".join(ch for ch in lowered if ch.isdigit())
        if parts in {"1", "2", "3", "4"}:
            return f"Tier {parts}"
    return text


def _clean_move(record):
    if not isinstance(record, dict):
        return None
    source_tier = _canonical_tier(record.get("sourceTier") or record.get("source_tier"))
    target_tier = _canonical_tier(record.get("targetTier") or record.get("target_tier"))
    if source_tier not in TIER_MOVE_TARGETS or target_tier not in TIER_MOVE_TARGETS:
        return None
    if source_tier == target_tier:
        return None
    merchant_id = re.sub(r"\.0$", "", str(record.get("merchantId") or record.get("merchant_id") or "").strip())
    merchant_name = str(record.get("merchantName") or record.get("merchant_name") or "").strip()
    row_key = str(record.get("key") or record.get("rowKey") or record.get("row_key") or "").strip()
    if not merchant_id and not row_key:
        return None
    return {
        "key": row_key,
        "merchantId": merchant_id,
        "merchantName": merchant_name,
        "sourceTier": source_tier,
        "targetTier": target_tier,
        "movedAt": str(record.get("movedAt") or record.get("moved_at") or dt.datetime.now(dt.timezone.utc).isoformat()),
    }


def _clean_moves(records):
    return [move for move in (_clean_move(record) for record in records or []) if move]


def _webhook_url():
    return (
        os.environ.get("TIER_MOVES_WEBHOOK_URL")
        or os.environ.get("TIER_MOVES_SCRIPT_URL")
        or ""
    ).strip()


def _webhook_secret():
    return os.environ.get("TIER_MOVES_WEBHOOK_SECRET", "").strip()


def _admin_token():
    return os.environ.get("TIER_MOVES_ADMIN_TOKEN", "").strip()


def _client_token(headers):
    return (
        headers.get("X-Tier-Move-Token")
        or headers.get("x-tier-move-token")
        or ""
    ).strip()


def _require_admin(target):
    expected = _admin_token()
    if not expected:
        return True
    if _client_token(target.headers) == expected:
        return True
    _send_json(target, 401, {"ok": False, "configured": True, "error": "Tier move admin token is required"})
    return False


def _read_json_body(target):
    length = int(target.headers.get("Content-Length") or 0)
    if length <= 0:
        return {}
    raw = target.rfile.read(length).decode("utf-8")
    return json.loads(raw or "{}")


def _call_webhook(method, payload=None):
    url = _webhook_url()
    if not url:
        return 503, {
            "ok": False,
            "configured": False,
            "moves": [],
            "error": "TIER_MOVES_WEBHOOK_URL is not configured",
        }

    secret = _webhook_secret()
    if method == "GET":
        params = {"action": "list"}
        if secret:
            params["secret"] = secret
        separator = "&" if "?" in url else "?"
        request = Request(f"{url}{separator}{urlencode(params)}", headers={"Accept": "application/json"})
    else:
        body = dict(payload or {})
        if secret:
            body["secret"] = secret
        request = Request(
            url,
            data=_json_bytes(body),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": "YeahPromos-Offer-Intelligence/1.0",
            },
            method="POST",
        )

    try:
        with urlopen(request, timeout=30) as response:
            text = response.read().decode("utf-8", "replace")
            try:
                data = json.loads(text or "{}")
            except json.JSONDecodeError:
                data = {"ok": False, "error": text[:500]}
            status = response.status if getattr(response, "status", None) else 200
            return status, data
    except HTTPError as error:
        body = error.read().decode("utf-8", "replace")[:500]
        return error.code, {"ok": False, "configured": True, "error": body}
    except (URLError, TimeoutError, OSError) as error:
        return 502, {"ok": False, "configured": True, "error": str(error)}


def handle_tier_moves(target, method):
    if method == "OPTIONS":
        _send_json(target, 204, {})
        return

    if method == "GET":
        status, payload = _call_webhook("GET")
        payload.setdefault("configured", bool(_webhook_url()))
        payload.setdefault("moves", [])
        _send_json(target, status, payload)
        return

    if method != "POST":
        _send_json(target, 405, {"ok": False, "error": "Method not allowed"})
        return

    if not _require_admin(target):
        return

    try:
        body = _read_json_body(target)
    except (ValueError, json.JSONDecodeError):
        _send_json(target, 400, {"ok": False, "error": "Invalid JSON body"})
        return

    action = str(body.get("action") or "replace").strip().lower()
    if action not in {"replace", "upsert", "clear"}:
        _send_json(target, 400, {"ok": False, "error": "Unsupported tier move action"})
        return

    payload = {
        "action": action,
        "moves": _clean_moves(body.get("moves") or []),
        "updatedBy": str(body.get("updatedBy") or "offer-intelligence-ui").strip(),
        "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    status, response = _call_webhook("POST", payload)
    response.setdefault("configured", bool(_webhook_url()))
    _send_json(target, status, response)


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        handle_tier_moves(self, "OPTIONS")

    def do_GET(self):
        handle_tier_moves(self, "GET")

    def do_POST(self):
        handle_tier_moves(self, "POST")
