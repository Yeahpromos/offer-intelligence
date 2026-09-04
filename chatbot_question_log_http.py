from __future__ import annotations

import os
from urllib.parse import parse_qs, urlparse

from auth import _read_json_body, require_page_access, send_json
from chatbot_question_logs import (
    QuestionLogConflictError,
    QuestionLogNotFoundError,
    QuestionLogValidationError,
    complete_question_log,
    create_question_log,
    fetch_question_logs,
    render_question_log_export,
)
from offer_db import public_error_payload


MAX_REQUEST_BODY_BYTES = 20_480
QUESTION_LOGGING_DISABLED_VALUES = {"0", "false", "no", "off"}


def question_logging_enabled() -> bool:
    value = os.environ.get("OI_CHATBOT_QUESTION_LOGGING", "1").strip().lower()
    return value not in QUESTION_LOGGING_DISABLED_VALUES


def _send_attachment(target, body: bytes, content_type: str, filename: str) -> None:
    target.send_response(200)
    target.send_header("Content-Type", content_type)
    target.send_header("Content-Disposition", f'attachment; filename="{filename}"')
    target.send_header("Cache-Control", "no-store")
    target.send_header("Content-Length", str(len(body)))
    target.end_headers()
    if body:
        target.wfile.write(body)


def _send_public_db_error(target, error: Exception) -> None:
    payload = public_error_payload(error)
    status = int(payload.pop("status", 502))
    send_json(target, status, payload)


def _handle_post(target) -> None:
    length = int(target.headers.get("Content-Length") or 0)
    if length <= 0 or length > MAX_REQUEST_BODY_BYTES:
        send_json(target, 400, {"ok": False, "error": "Request body is too large"})
        return

    try:
        body = _read_json_body(target)
    except Exception:
        send_json(target, 400, {"ok": False, "error": "Invalid JSON body"})
        return

    if not isinstance(body, dict):
        send_json(target, 400, {"ok": False, "error": "JSON body must be an object"})
        return

    action = str(body.get("action") or "").strip().lower()
    if action not in {"create", "complete"}:
        send_json(target, 400, {"ok": False, "error": "action must be create or complete"})
        return
    if not question_logging_enabled():
        send_json(target, 200, {"ok": True, "disabled": True})
        return

    try:
        if action == "create":
            result = create_question_log(body)
        elif action == "complete":
            result = complete_question_log(body)
    except QuestionLogValidationError as error:
        send_json(target, 400, {"ok": False, "error": str(error)})
        return
    except QuestionLogNotFoundError as error:
        send_json(target, 404, {"ok": False, "error": str(error)})
        return
    except QuestionLogConflictError as error:
        send_json(target, 409, {"ok": False, "error": str(error)})
        return
    except Exception as error:
        _send_public_db_error(target, error)
        return

    send_json(target, 200, result)


def _handle_get(target) -> None:
    query = parse_qs(urlparse(target.path).query)
    export_format = str((query.get("format") or [""])[0]).strip().lower()
    if export_format not in {"csv", "jsonl"}:
        send_json(target, 400, {"ok": False, "error": "format must be csv or jsonl"})
        return
    try:
        rows = fetch_question_logs()
        body, content_type, filename = render_question_log_export(rows, export_format)
    except QuestionLogValidationError as error:
        send_json(target, 400, {"ok": False, "error": str(error)})
        return
    except Exception as error:
        _send_public_db_error(target, error)
        return
    _send_attachment(target, body, content_type, filename)


def handle_chatbot_question_logs(target, method: str) -> None:
    method = str(method or "").strip().upper()
    if method == "OPTIONS":
        send_json(target, 204, {})
        return
    if method not in {"GET", "POST"}:
        send_json(target, 405, {"ok": False, "error": "Method not allowed"})
        return
    if not require_page_access(target, "dashboard"):
        return
    if method == "POST":
        _handle_post(target)
    else:
        _handle_get(target)
