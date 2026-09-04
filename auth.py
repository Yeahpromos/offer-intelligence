from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from http.cookies import SimpleCookie
from typing import Any, Callable, Literal, Mapping, TypeAlias


SESSION_COOKIE = "oi_session"
HASH_PREFIX = "pbkdf2_sha256"
DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
PAYMENT_SYNC_TOKEN_HEADER = "X-Payment-Sync-Token"
AccessLevel: TypeAlias = Literal[0, 1, 2]
VALID_ACCESS_LEVELS = {0, 1, 2}
PAGE_NAMES = (
    "offer-list-tracker",
    "payments",
    "publishers",
    "monthly-new-merchants",
    "brand-media",
    "revenue-flow",
    "google-ads",
    "sheets",
    "category",
    "tier",
    "dashboard",
    "agent",
)
AUTH_DB_ENV_KEYS = (
    "OFFER_DB_HOST",
    "OFFER_DB_NAME",
    "OFFER_DB_USER",
    "OFFER_DB_PASSWORD",
)


class AuthConfigurationError(RuntimeError):
    """认证依赖未配置或生产环境错误地关闭认证。"""


class AuthDependencyError(RuntimeError):
    """认证依赖不可用，但不向客户端暴露底层异常。"""


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


def llm_enabled() -> bool:
    value = os.environ.get("OI_LLM_ENABLED", "1").strip().lower()
    return value not in {"0", "false", "no", "off"}


def agent_enabled() -> bool:
    value = os.environ.get("OI_AGENT_ENABLED", "1").strip().lower()
    return value not in {"0", "false", "no", "off"}


def agent_runtime_config() -> dict[str, Any]:
    """Public, non-secret runtime bootstrap; CopilotKit is the production default."""
    mode = os.environ.get("OI_AGENT_RUNTIME_MODE", "copilotkit").strip().lower()
    return {
        "enabled": agent_enabled() and mode == "copilotkit",
        "endpoint": "/api/copilotkit",
        "authority": "python-registry",
        "fallback": "modern",
    }


def normalize_username(value: Any) -> str:
    """将用户输入规范化为数据库查询和 Session 使用的身份键。"""
    if value is None:
        return ""
    return str(value).strip().casefold()


def normalize_access_level(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    if isinstance(value, str) and not re.fullmatch(r"[+-]?\d+", value.strip()):
        return None
    try:
        level = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return level if level in VALID_ACCESS_LEVELS else None


def can_access_page(level: Any, page: Any) -> bool:
    if page not in PAGE_NAMES:
        return False
    normalized_level = normalize_access_level(level)
    if normalized_level == 0:
        return True
    if normalized_level == 1:
        return page != "google-ads"
    if normalized_level == 2:
        return page == "google-ads"
    return False


def default_page_for_level(level: Any) -> str:
    return "google-ads" if normalize_access_level(level) == 2 else "agent"


def _as_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _as_bool(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _normalize_user_record(record: Mapping[str, Any] | None, include_password_hash: bool = False) -> dict[str, Any] | None:
    if not isinstance(record, Mapping):
        return None
    raw_level = record.get("level")
    normalized_level = normalize_access_level(raw_level)
    try:
        level_value: Any = int(raw_level)
    except (TypeError, ValueError, OverflowError):
        level_value = raw_level
    username = _as_text(record.get("username") or record.get("userName"))
    if not username:
        return None
    user = {
        "id": record.get("id"),
        "username": username,
        "displayName": _as_text(record.get("display_name") or record.get("displayName")),
        "email": _as_text(record.get("email")),
        "level": level_value,
        "isActive": _as_bool(record.get("is_active", record.get("isActive"))),
        "_level_valid": normalized_level is not None,
    }
    if include_password_hash:
        user["_password_hash"] = _as_text(record.get("password_hash") or record.get("passwordHash"))
    return user


def public_user(user: Mapping[str, Any] | None, *, expires_at: int | None = None) -> dict[str, Any] | None:
    if not isinstance(user, Mapping):
        return None
    payload = {
        "id": user.get("id"),
        "username": user.get("username", ""),
        "displayName": user.get("displayName", ""),
        "email": user.get("email", ""),
        "level": user.get("level"),
    }
    if expires_at is not None:
        payload["expiresAt"] = expires_at
    if user.get("authDisabled") is True:
        payload["authDisabled"] = True
    return payload


def _disabled_auth_user() -> dict[str, Any]:
    return {
        "id": None,
        "username": "disabled-auth",
        "displayName": "Local development",
        "email": "",
        "level": 0,
        "isActive": True,
        "_level_valid": True,
        "authDisabled": True,
    }


def is_production_environment() -> bool:
    return os.environ.get("VERCEL_ENV", "").strip().lower() == "production"


def session_secret() -> str:
    return os.environ.get("OI_SESSION_SECRET", "").strip()


def payment_sync_token() -> str:
    return (
        os.environ.get("PAYMENT_SYNC_TOKEN")
        or os.environ.get("OI_PAYMENT_SYNC_TOKEN")
        or ""
    ).strip()


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
    for key in AUTH_DB_ENV_KEYS:
        if not os.environ.get(key, "").strip():
            missing.append(key)
    return {
        "enabled": auth_enabled(),
        "configured": not missing,
        "missing": missing,
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


def verify_password(password: str, encoded_hash: str) -> bool:
    try:
        prefix, iterations_text, salt, expected = str(encoded_hash).split("$", 3)
        iterations = int(iterations_text)
        if prefix != HASH_PREFIX or iterations <= 0 or not salt or not expected:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            str(password).encode("utf-8"),
            salt.encode("utf-8"),
            iterations,
        )
        return hmac.compare_digest(b64url_encode(digest), expected)
    except (TypeError, ValueError, OverflowError):
        return False


def _signature(payload: str) -> str:
    digest = hmac.new(session_secret().encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
    return b64url_encode(digest)


def create_session(username: str) -> tuple[str, int]:
    normalized_username = normalize_username(username)
    if not normalized_username:
        raise ValueError("Session username cannot be empty")
    issued_at = int(time.time())
    expires_at = issued_at + session_ttl_seconds()
    payload = b64url_encode(
        _json_bytes(
            {
                "v": 2,
                "sub": normalized_username,
                "exp": expires_at,
                "iat": issued_at,
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
    if not auth_enabled() and not is_production_environment():
        return {"v": 2, "sub": "disabled-auth", "exp": int(time.time()) + session_ttl_seconds(), "iat": int(time.time())}
    if not auth_enabled() and is_production_environment():
        return None
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
        if not isinstance(parsed, dict):
            return None
        if set(parsed) != {"v", "sub", "exp", "iat"} or type(parsed.get("v")) is not int or parsed.get("v") != 2:
            return None
        normalized_sub = normalize_username(parsed.get("sub"))
        if not isinstance(parsed.get("sub"), str) or not normalized_sub or normalized_sub != parsed.get("sub"):
            return None
        if type(parsed.get("exp")) is not int or parsed["exp"] <= int(time.time()):
            return None
        if type(parsed.get("iat")) is not int or parsed["iat"] <= 0:
            return None
        return parsed
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def user_record_by_username(username: str) -> Mapping[str, Any] | None:
    """读取用户原始认证字段；具体数据库异常由调用方转换为认证依赖错误。"""
    from offer_db import lookup_user_by_username

    return lookup_user_by_username(username)


def _load_user(
    username: str,
    *,
    user_lookup: Callable[[str], Mapping[str, Any] | None] | None = None,
    include_password_hash: bool = False,
) -> dict[str, Any] | None:
    lookup = user_lookup or user_record_by_username
    try:
        record = lookup(username)
    except (AuthConfigurationError, AuthDependencyError):
        raise
    except Exception as exc:
        raise AuthDependencyError("User authentication dependency is unavailable") from exc
    return _normalize_user_record(record, include_password_hash=include_password_hash)


def current_user_from_headers(
    headers,
    *,
    user_lookup: Callable[[str], Mapping[str, Any] | None] | None = None,
) -> dict[str, Any] | None:
    """验证 Session 后重新从数据库读取当前用户，不缓存权限等级。"""
    if not auth_enabled():
        if is_production_environment():
            raise AuthConfigurationError("Authentication cannot be disabled in production")
        return _disabled_auth_user()
    status = auth_config_status()
    if not status["configured"]:
        raise AuthConfigurationError("Authentication is not configured")
    payload = session_payload(headers)
    if not payload:
        return None
    user = _load_user(payload["sub"], user_lookup=user_lookup)
    if not user or not user["isActive"]:
        return None
    return user


def _header_value(headers, name: str) -> str:
    return (
        headers.get(name)
        or headers.get(name.lower())
        or headers.get(name.title())
        or ""
    ).strip()


def _bearer_token(headers) -> str:
    value = _header_value(headers, "Authorization")
    prefix = "Bearer "
    if value[: len(prefix)].lower() != prefix.lower():
        return ""
    return value[len(prefix) :].strip()


def is_payment_sync_authenticated(headers) -> bool:
    expected = payment_sync_token()
    if not expected:
        return False
    candidates = (
        _bearer_token(headers),
        _header_value(headers, PAYMENT_SYNC_TOKEN_HEADER),
    )
    return any(hmac.compare_digest(candidate, expected) for candidate in candidates if candidate)


def is_authenticated(target) -> bool:
    try:
        user = _current_user_for_target(target)
    except (AuthConfigurationError, AuthDependencyError):
        return False
    return bool(user and user.get("_level_valid"))


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


_AUTH_CONTEXT_ATTR = "_oi_auth_context"
_AUTH_CONTEXT_MISSING = object()


def _current_user_for_target(target) -> dict[str, Any] | None:
    cached = getattr(target, _AUTH_CONTEXT_ATTR, _AUTH_CONTEXT_MISSING)
    if cached is not _AUTH_CONTEXT_MISSING:
        if cached.get("error") == "configuration":
            raise AuthConfigurationError("Authentication is not configured")
        if cached.get("error") == "dependency":
            raise AuthDependencyError("User authentication dependency is unavailable")
        return cached.get("user")

    try:
        user = current_user_from_headers(target.headers)
    except AuthConfigurationError:
        setattr(target, _AUTH_CONTEXT_ATTR, {"error": "configuration", "user": None})
        raise
    except AuthDependencyError:
        setattr(target, _AUTH_CONTEXT_ATTR, {"error": "dependency", "user": None})
        raise
    setattr(target, _AUTH_CONTEXT_ATTR, {"error": None, "user": user})
    return user


def current_user_for_target(target) -> dict[str, Any] | None:
    """返回当前请求已验证的用户上下文；同一请求只解析/查库一次。"""
    return _current_user_for_target(target)


def _send_auth_unavailable(target, error: str = "Login is not configured on the server.") -> None:
    status = auth_config_status()
    send_json(
        target,
        503,
        {
            "ok": False,
            "authenticated": False,
            "configured": False if status["missing"] else True,
            "missing": status["missing"],
            "error": error,
        },
    )


def require_auth(target, allow_payment_sync_token: bool = False) -> bool:
    if allow_payment_sync_token and is_payment_sync_authenticated(target.headers):
        setattr(target, _AUTH_CONTEXT_ATTR, {"error": None, "service": "payment-sync", "user": None})
        return True
    try:
        user = _current_user_for_target(target)
    except AuthConfigurationError:
        _send_auth_unavailable(target)
        return False
    except AuthDependencyError:
        _send_auth_unavailable(target, "Authentication service is temporarily unavailable.")
        return False
    if user and user.get("_level_valid"):
        return True
    if user:
        send_json(target, 403, {"ok": False, "authenticated": True, "error": "Access level is invalid."})
        return False
    send_json(target, 401, {"ok": False, "authenticated": False, "error": "Login is required."})
    return False


def require_page_access(target, page: str, allow_payment_sync_token: bool = False) -> bool:
    if page not in PAGE_NAMES:
        send_json(target, 403, {"ok": False, "authenticated": True, "error": "Page access is denied."})
        return False
    if page == "payments" and allow_payment_sync_token and is_payment_sync_authenticated(target.headers):
        setattr(target, _AUTH_CONTEXT_ATTR, {"error": None, "service": "payment-sync", "user": None})
        return True
    try:
        user = _current_user_for_target(target)
    except AuthConfigurationError:
        _send_auth_unavailable(target)
        return False
    except AuthDependencyError:
        _send_auth_unavailable(target, "Authentication service is temporarily unavailable.")
        return False
    if not user:
        send_json(target, 401, {"ok": False, "authenticated": False, "error": "Login is required."})
        return False
    if not user.get("_level_valid"):
        send_json(target, 403, {"ok": False, "authenticated": True, "error": "Access level is invalid."})
        return False
    if not can_access_page(user.get("level"), page):
        send_json(target, 403, {"ok": False, "authenticated": True, "error": "Page access is denied."})
        return False
    return True


def _read_json_body(target, max_size=65536) -> dict[str, Any]:
    length = int(target.headers.get("Content-Length") or 0)
    if length <= 0:
        return {}
    if length > max_size:
        raise ValueError("Request body is too large")
    raw = target.rfile.read(length).decode("utf-8")
    return json.loads(raw or "{}")


def handle_auth_options(target) -> None:
    send_json(target, 204, {})


def handle_auth_session(target) -> None:
    if not auth_enabled():
        if is_production_environment():
            _send_auth_unavailable(target, "Authentication must be enabled in production.")
            return
        user = _disabled_auth_user()
        send_json(
            target,
            200,
            {
                "ok": True,
                "authenticated": True,
                "authDisabled": True,
                "user": public_user(user, expires_at=int(time.time()) + session_ttl_seconds()),
                "llmEnabled": llm_enabled(),
                "agentEnabled": agent_enabled(),
                "agentRuntime": agent_runtime_config(),
            },
        )
        return

    try:
        user = _current_user_for_target(target)
    except AuthConfigurationError:
        _send_auth_unavailable(target)
        return
    except AuthDependencyError:
        _send_auth_unavailable(target, "Authentication service is temporarily unavailable.")
        return

    if not user:
        send_json(target, 401, {"ok": False, "authenticated": False, "configured": True})
        return
    if not user.get("_level_valid"):
        send_json(
            target,
            403,
            {"ok": False, "authenticated": True, "configured": True, "error": "Access level is invalid."},
        )
        return
    send_json(
        target,
        200,
        {
            "ok": True,
            "authenticated": True,
            "configured": True,
            "llmEnabled": llm_enabled(),
            "agentEnabled": agent_enabled(),
            "agentRuntime": agent_runtime_config(),
            "user": public_user(user, expires_at=int(session_payload(target.headers)["exp"])),
        },
    )


def handle_auth_login(target) -> None:
    if not auth_enabled():
        if is_production_environment():
            _send_auth_unavailable(target, "Authentication must be enabled in production.")
            return
        user = _disabled_auth_user()
        send_json(
            target,
            200,
            {
                "ok": True,
                "authenticated": True,
                "authDisabled": True,
                "user": public_user(user, expires_at=int(time.time()) + session_ttl_seconds()),
                "llmEnabled": llm_enabled(),
                "agentEnabled": agent_enabled(),
                "agentRuntime": agent_runtime_config(),
            },
        )
        return
    status = auth_config_status()
    if not status["configured"]:
        _send_auth_unavailable(target)
        return
    try:
        body = _read_json_body(target)
    except (ValueError, json.JSONDecodeError):
        send_json(target, 400, {"ok": False, "error": "Invalid login request."})
        return

    username = normalize_username(body.get("username"))
    password = "" if body.get("password") is None else str(body.get("password"))
    try:
        user = _load_user(username, include_password_hash=True)
    except AuthDependencyError:
        _send_auth_unavailable(target, "Authentication service is temporarily unavailable.")
        return
    if (
        not user
        or not user.get("isActive")
        or not user.get("_level_valid")
        or not verify_password(password, user.get("_password_hash", ""))
    ):
        time.sleep(0.35)
        send_json(target, 401, {"ok": False, "authenticated": False, "error": "Invalid username or password."})
        return

    session, expires_at = create_session(username)
    response = {
        "ok": True,
        "authenticated": True,
        "llmEnabled": llm_enabled(),
        "agentEnabled": agent_enabled(),
        "agentRuntime": agent_runtime_config(),
        "user": public_user(user, expires_at=expires_at),
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
