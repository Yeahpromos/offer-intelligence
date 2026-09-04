"""受保护的 Agent Trace 写入 HTTP 合同。

该模块复用现有的会话认证和 JSON 响应工具，由本地 ``server.py`` 与
Vercel 的 ``api/chat/stream.py`` 通过 operation 分流调用。
"""

from __future__ import annotations

import os

from agent_trace import (
    TraceConflictError,
    TraceValidationError,
    append_agent_steps,
    complete_agent_run,
    start_agent_run,
)
from auth import _read_json_body, require_page_access, send_json


MAX_REQUEST_BODY_BYTES = 16 * 1024
MAX_TRACE_STEPS = 64
TRACE_DISABLED_VALUES = {"0", "false", "no", "off"}


def agent_trace_enabled() -> bool:
    value = os.environ.get("OI_AGENT_TRACE_ENABLED", "1").strip().lower()
    return value not in TRACE_DISABLED_VALUES


def _send_storage_error(target) -> None:
    send_json(
        target,
        502,
        {"ok": False, "error": "Agent trace storage is unavailable", "errorCode": "trace_write_failed"},
    )


def _request_length(target) -> int:
    try:
        return int(target.headers.get("Content-Length") or 0)
    except (TypeError, ValueError):
        return -1


def _handle_post(target) -> None:
    if not agent_trace_enabled():
        send_json(target, 200, {"ok": True, "disabled": True})
        return

    length = _request_length(target)
    if length <= 0 or length > MAX_REQUEST_BODY_BYTES:
        send_json(target, 400, {"ok": False, "error": "Request body is too large"})
        return
    try:
        body = _read_json_body(target, max_size=MAX_REQUEST_BODY_BYTES)
    except Exception:
        send_json(target, 400, {"ok": False, "error": "Invalid JSON body"})
        return
    if not isinstance(body, dict):
        send_json(target, 400, {"ok": False, "error": "JSON body must be an object"})
        return

    action = str(body.get("action") or "").strip().lower()
    if action not in {"start", "append", "complete"}:
        send_json(target, 400, {"ok": False, "error": "action must be start, append, or complete"})
        return
    if action == "append":
        steps = body.get("steps")
        if not isinstance(steps, list) or not steps:
            send_json(target, 400, {"ok": False, "error": "steps must be a non-empty array"})
            return
        if len(steps) > MAX_TRACE_STEPS:
            send_json(target, 400, {"ok": False, "error": "steps cannot contain more than 64 items"})
            return

    try:
        if action == "start":
            result = start_agent_run(body)
        elif action == "append":
            result = append_agent_steps(body)
        else:
            result = complete_agent_run(body)
    except TraceValidationError as error:
        send_json(target, 400, {"ok": False, "error": str(error)})
        return
    except TraceConflictError as error:
        send_json(target, 409, {"ok": False, "error": str(error)})
        return
    except Exception:
        _send_storage_error(target)
        return
    send_json(target, 200, result)


def handle_agent_trace(target, method: str) -> None:
    method = str(method or "").strip().upper()
    if method == "OPTIONS":
        send_json(target, 204, {})
        return
    if method not in {"POST"}:
        send_json(target, 405, {"ok": False, "error": "Method not allowed"})
        return
    if not require_page_access(target, "agent"):
        return
    _handle_post(target)
