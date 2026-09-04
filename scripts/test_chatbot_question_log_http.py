from __future__ import annotations

from io import BytesIO
import json
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import chatbot_question_log_http as question_http
from chatbot_question_logs import QuestionLogNotFoundError


class FakeTarget:
    def __init__(self, *, path="/api/chat/stream?operation=questions", body=None, content_length=None):
        body_bytes = b"" if body is None else json.dumps(body).encode("utf-8")
        self.path = path
        self.headers = {}
        if content_length is not None:
            self.headers["Content-Length"] = str(content_length)
        elif body is not None:
            self.headers["Content-Length"] = str(len(body_bytes))
        self.rfile = BytesIO(body_bytes)
        self.wfile = BytesIO()
        self.status = None
        self.response_headers = []
        self.ended = False

    def send_response(self, status):
        self.status = status

    def send_header(self, name, value):
        self.response_headers.append((str(name), str(value)))

    def end_headers(self):
        self.ended = True

    def header(self, name):
        for key, value in self.response_headers:
            if key.lower() == name.lower():
                return value
        return None

    def json_body(self):
        return json.loads(self.wfile.getvalue().decode("utf-8"))


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def with_patches(**patches):
    class PatchContext:
        def __enter__(self):
            self.originals = {}
            for name, value in patches.items():
                self.originals[name] = getattr(question_http, name)
                setattr(question_http, name, value)
            return self

        def __exit__(self, exc_type, exc, tb):
            for name, value in self.originals.items():
                setattr(question_http, name, value)
            return False

    return PatchContext()


def allow_auth(_target, _page):
    return True


def main():
    unauthorized = FakeTarget(body={"action": "create"})

    def deny_auth(target, _page):
        question_http.send_json(target, 401, {"ok": False, "error": "Login is required."})
        return False

    with with_patches(require_page_access=deny_auth):
        question_http.handle_chatbot_question_logs(unauthorized, "POST")
    assert_equal(unauthorized.status, 401, "unauthorized status")

    options = FakeTarget()
    with with_patches(require_page_access=deny_auth):
        question_http.handle_chatbot_question_logs(options, "OPTIONS")
    assert_equal(options.status, 204, "OPTIONS status")

    calls = []

    def fake_create(payload):
        calls.append(("create", payload))
        return {"ok": True, "recordId": "record-1", "status": "submitted"}

    create_target = FakeTarget(body={
        "action": "create",
        "prompt": "Tier 2",
        "mode": "report",
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "language": "en",
        "intent": "tier",
    })
    with with_patches(require_page_access=allow_auth, create_question_log=fake_create):
        question_http.handle_chatbot_question_logs(create_target, "POST")
    assert_equal(create_target.status, 200, "create HTTP status")
    assert_equal(create_target.json_body()["recordId"], "record-1", "create response")
    assert_equal(calls[0][0], "create", "create dispatch")

    def fake_complete(payload):
        calls.append(("complete", payload))
        return {"ok": True, "recordId": payload["recordId"], "status": payload["status"]}

    complete_target = FakeTarget(body={
        "action": "complete",
        "recordId": "fbe8f58d-a61a-4ec9-9882-da09405bdb73",
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "status": "success",
    })
    with with_patches(require_page_access=allow_auth, complete_question_log=fake_complete):
        question_http.handle_chatbot_question_logs(complete_target, "POST")
    assert_equal(complete_target.status, 200, "complete HTTP status")
    assert_equal(calls[-1][0], "complete", "complete dispatch")

    def unexpected_write(_payload):
        raise AssertionError("question log writes must be skipped when disabled")

    previous_logging_flag = os.environ.get("OI_CHATBOT_QUESTION_LOGGING")
    try:
        for disabled_value in ("0", "false", "off", "no"):
            os.environ["OI_CHATBOT_QUESTION_LOGGING"] = disabled_value
            disabled_create = FakeTarget(body={"action": "create"})
            with with_patches(require_page_access=allow_auth, create_question_log=unexpected_write):
                question_http.handle_chatbot_question_logs(disabled_create, "POST")
            assert_equal(disabled_create.status, 200, f"disabled create status ({disabled_value})")
            assert_equal(disabled_create.json_body(), {"ok": True, "disabled": True}, f"disabled create response ({disabled_value})")

            disabled_complete = FakeTarget(body={"action": "complete", "recordId": "record-1"})
            with with_patches(require_page_access=allow_auth, complete_question_log=unexpected_write):
                question_http.handle_chatbot_question_logs(disabled_complete, "POST")
            assert_equal(disabled_complete.status, 200, f"disabled complete status ({disabled_value})")
            assert_equal(disabled_complete.json_body(), {"ok": True, "disabled": True}, f"disabled complete response ({disabled_value})")
    finally:
        if previous_logging_flag is None:
            os.environ.pop("OI_CHATBOT_QUESTION_LOGGING", None)
        else:
            os.environ["OI_CHATBOT_QUESTION_LOGGING"] = previous_logging_flag

    malformed = FakeTarget(body=None, content_length=5)
    malformed.rfile = BytesIO(b"{bad}")
    with with_patches(require_page_access=allow_auth):
        question_http.handle_chatbot_question_logs(malformed, "POST")
    assert_equal(malformed.status, 400, "malformed JSON status")

    empty = FakeTarget()
    with with_patches(require_page_access=allow_auth):
        question_http.handle_chatbot_question_logs(empty, "POST")
    assert_equal(empty.status, 400, "empty body status")

    oversized = FakeTarget(body=None, content_length=20_481)
    with with_patches(require_page_access=allow_auth):
        question_http.handle_chatbot_question_logs(oversized, "POST")
    assert_equal(oversized.status, 400, "oversized body status")

    invalid_action = FakeTarget(body={"action": "delete"})
    with with_patches(require_page_access=allow_auth):
        question_http.handle_chatbot_question_logs(invalid_action, "POST")
    assert_equal(invalid_action.status, 400, "invalid action status")

    def missing_complete(_payload):
        raise QuestionLogNotFoundError("missing")

    missing = FakeTarget(body={"action": "complete"})
    with with_patches(require_page_access=allow_auth, complete_question_log=missing_complete):
        question_http.handle_chatbot_question_logs(missing, "POST")
    assert_equal(missing.status, 404, "missing record status")

    rows = [{"eventId": "row-1"}]
    export_calls = []

    def fake_fetch():
        export_calls.append("fetch")
        return rows

    def fake_render(received_rows, export_format):
        export_calls.append((received_rows, export_format))
        return b"file-body", "text/test", f"questions.{export_format}"

    for export_format in ("csv", "jsonl"):
        export_target = FakeTarget(path=f"/api/chat/stream?operation=questions&format={export_format}")
        with with_patches(
            require_page_access=allow_auth,
            fetch_question_logs=fake_fetch,
            render_question_log_export=fake_render,
        ):
            question_http.handle_chatbot_question_logs(export_target, "GET")
        assert_equal(export_target.status, 200, f"{export_format} status")
        assert_equal(export_target.wfile.getvalue(), b"file-body", f"{export_format} bytes")
        assert_equal(export_target.header("Content-Type"), "text/test", f"{export_format} type")
        assert_equal(export_target.header("Content-Disposition"), f'attachment; filename="questions.{export_format}"', f"{export_format} disposition")
        assert_equal(export_target.header("Cache-Control"), "no-store", f"{export_format} cache")
        assert_equal(export_target.header("Content-Length"), str(len(b"file-body")), f"{export_format} length")

    invalid_format = FakeTarget(path="/api/chat/stream?operation=questions&format=xlsx")
    with with_patches(require_page_access=allow_auth):
        question_http.handle_chatbot_question_logs(invalid_format, "GET")
    assert_equal(invalid_format.status, 400, "invalid export format")

    assert not (ROOT / "api" / "chat" / "questions.py").exists()
    vercel_handler = (ROOT / "api" / "chat" / "stream.py").read_text(encoding="utf-8")
    assert "handle_chatbot_question_logs" in vercel_handler
    assert "def do_GET" in vercel_handler
    assert 'self._operation() == "questions"' in vercel_handler

    local_server = (ROOT / "server.py").read_text(encoding="utf-8")
    assert 'parsed.path == "/api/chat/questions"' not in local_server
    assert 'parsed.path == "/api/chat/stream"' in local_server
    assert 'operation == "questions"' in local_server

    print("PASS: chatbot question log HTTP contract tests")


if __name__ == "__main__":
    main()
