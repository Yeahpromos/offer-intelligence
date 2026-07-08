from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from http.cookies import SimpleCookie
from typing import Any


SESSION_COOKIE = "oi_session"
HASH_PREFIX = "pbkdf2_sha256"
DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60


def _json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def send_json(target, status: int, payload: Any, methods: str = "GET, POST, OPTIONS") -> None:
    body = b"" if status == 204 else _json_bytes(payload)
    target.send_response(status)
    target.send_header("Cache-Control", "no-store")
    target.send_header("Content-Type", "application/json; charset=utf-8")
    target.send_header("Content-Length", str(len(body)))
    target.send_header("Access-Control-Allow-Methods", methods)
    target.send_header("Access-Control-Allow-Headers", "Content-Type")
    target.end_headers()
    if body:
        target.wfile.write(body)


def auth_enabled() -> bool:
    value = os.environ.get("OI_AUTH_ENABLED", "1").strip().lower()
    return value not in {"0", "false", "no", "off"}


def admin_username() -> str:
    return os.environ.get("OI_ADMIN_USERNAME", "admin").strip() or "admin"


def _password_hash() -> str:
    return os.environ.get("OI_ADMIN_PASSWORD_HASH", "").strip()


def _plain_password() -> str:
    return os.environ.get("OI_ADMIN_PASSWORD", "").strip()


def session_secret() -> str:
    return os.environ.get("OI_SESSION_SECRET", "").strip()


def session_ttl_seconds() -> int:
    try:
        value = int(os.environ.get("OI_SESSION_TTL_SECONDS", str(DEFAULT_SESSION_TTL_SECONDS)))
    except ValueError:
        value = DEFAULT_SESSION_TTL_SECONDS
    return max(300, min(value, 30 * 24 * 60 * 60))


def auth_config_status() -> dict[str, Any]:
    missing = []
    if not session_secret():
        missing.append("OI_SESSION_SECRET")
    if not (_password_hash() or _plain_password()):
        missing.append("OI_ADMIN_PASSWORD_HASH")
    return {
        "enabled": auth_enabled(),
        "configured": not missing,
        "missing": missing,
        "username": admin_username(),
    }


def b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def make_password_hash(password: str, iterations: int = 210000, salt: str | None = None) -> str:
    salt = salt or secrets.token_urlsafe(18)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return f"{HASH_PREFIX}${iterations}${salt}${b64url_encode(digest)}"


def verify_password(password: str) -> bool:
    configured_hash = _password_hash()
    if configured_hash:
        try:
            prefix, iterations, salt, expected = configured_hash.split("$", 3)
            if prefix != HASH_PREFIX:
                return False
            digest = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode("utf-8"),
                salt.encode("utf-8"),
                int(iterations),
            )
            return hmac.compare_digest(b64url_encode(digest), expected)
        except (TypeError, ValueError, OverflowError):
            return False

    plain = _plain_password()
    return bool(plain) and hmac.compare_digest(password, plain)


def _signature(payload: str) -> str:
    digest = hmac.new(session_secret().encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
    return b64url_encode(digest)


def create_session(username: str) -> tuple[str, int]:
    expires_at = int(time.time()) + session_ttl_seconds()
    payload = b64url_encode(
        _json_bytes(
            {
                "sub": username,
                "role": "admin",
                "exp": expires_at,
                "iat": int(time.time()),
            }
        )
    )
    return f"{payload}.{_signature(payload)}", expires_at


def parse_cookies(headers) -> SimpleCookie:
    cookies = SimpleCookie()
    raw = headers.get("Cookie") or headers.get("cookie") or ""
    if raw:
        cookies.load(raw)
    return cookies


def session_payload(headers) -> dict[str, Any] | None:
    if not auth_enabled():
        return {"sub": "disabled-auth", "role": "admin", "exp": int(time.time()) + session_ttl_seconds()}
    if not auth_config_status()["configured"]:
        return None
    cookie = parse_cookies(headers).get(SESSION_COOKIE)
    if not cookie:
        return None
    value = cookie.value
    try:
        payload, signature = value.split(".", 1)
        if not hmac.compare_digest(_signature(payload), signature):
            return None
        parsed = json.loads(b64url_decode(payload).decode("utf-8"))
        if int(parsed.get("exp") or 0) < int(time.time()):
            return None
        if parsed.get("role") != "admin":
            return None
        return parsed
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def is_authenticated(target) -> bool:
    return session_payload(target.headers) is not None


def _is_secure_request(target) -> bool:
    forwarded = (target.headers.get("X-Forwarded-Proto") or target.headers.get("x-forwarded-proto") or "").lower()
    if forwarded == "https":
        return True
    host = (target.headers.get("Host") or target.headers.get("host") or "").lower()
    hostname = host.split(":", 1)[0]
    return hostname not in {"127.0.0.1", "localhost"}


def _cookie_header(value: str, max_age: int, secure: bool) -> str:
    parts = [
        f"{SESSION_COOKIE}={value}",
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        f"Max-Age={max_age}",
    ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def clear_cookie_header(secure: bool) -> str:
    return _cookie_header("", 0, secure)


def require_auth(target) -> bool:
    if not auth_enabled():
        return True
    status = auth_config_status()
    if not status["configured"]:
        send_json(
            target,
            503,
            {
                "ok": False,
                "authenticated": False,
                "configured": False,
                "error": "Login is not configured on the server.",
                "missing": status["missing"],
            },
        )
        return False
    if is_authenticated(target):
        return True
    send_json(target, 401, {"ok": False, "authenticated": False, "error": "Login is required."})
    return False


def _read_json_body(target) -> dict[str, Any]:
    length = int(target.headers.get("Content-Length") or 0)
    if length <= 0:
        return {}
    if length > 4096:
        raise ValueError("Request body is too large")
    raw = target.rfile.read(length).decode("utf-8")
    return json.loads(raw or "{}")


def handle_auth_options(target) -> None:
    send_json(target, 204, {})


def handle_auth_session(target) -> None:
    if not auth_enabled():
        send_json(target, 200, {"ok": True, "authenticated": True, "authDisabled": True, "user": {"role": "admin"}})
        return
    status = auth_config_status()
    if not status["configured"]:
        send_json(
            target,
            503,
            {
                "ok": False,
                "authenticated": False,
                "configured": False,
                "missing": status["missing"],
                "error": "Login is not configured on the server.",
            },
        )
        return
    payload = session_payload(target.headers)
    if not payload:
        send_json(target, 401, {"ok": False, "authenticated": False, "configured": True})
        return
    send_json(
        target,
        200,
        {
            "ok": True,
            "authenticated": True,
            "configured": True,
            "user": {
                "username": payload.get("sub"),
                "role": payload.get("role"),
                "expiresAt": payload.get("exp"),
            },
        },
    )


def handle_auth_login(target) -> None:
    if not auth_enabled():
        send_json(target, 200, {"ok": True, "authenticated": True, "authDisabled": True})
        return
    status = auth_config_status()
    if not status["configured"]:
        send_json(
            target,
            503,
            {
                "ok": False,
                "authenticated": False,
                "configured": False,
                "missing": status["missing"],
                "error": "Login is not configured on the server.",
            },
        )
        return
    try:
        body = _read_json_body(target)
    except (ValueError, json.JSONDecodeError):
        send_json(target, 400, {"ok": False, "error": "Invalid login request."})
        return

    username = str(body.get("username") or "").strip()
    password = str(body.get("password") or "")
    if username != admin_username() or not verify_password(password):
        time.sleep(0.35)
        send_json(target, 401, {"ok": False, "authenticated": False, "error": "Invalid username or password."})
        return

    session, expires_at = create_session(username)
    response = {
        "ok": True,
        "authenticated": True,
        "user": {"username": username, "role": "admin", "expiresAt": expires_at},
    }
    body_bytes = _json_bytes(response)
    target.send_response(200)
    target.send_header("Cache-Control", "no-store")
    target.send_header("Content-Type", "application/json; charset=utf-8")
    target.send_header("Content-Length", str(len(body_bytes)))
    target.send_header("Set-Cookie", _cookie_header(session, session_ttl_seconds(), _is_secure_request(target)))
    target.end_headers()
    target.wfile.write(body_bytes)


def handle_auth_logout(target) -> None:
    body = _json_bytes({"ok": True, "authenticated": False})
    target.send_response(200)
    target.send_header("Cache-Control", "no-store")
    target.send_header("Content-Type", "application/json; charset=utf-8")
    target.send_header("Content-Length", str(len(body)))
    target.send_header("Set-Cookie", clear_cookie_header(_is_secure_request(target)))
    target.end_headers()
    target.wfile.write(body)
