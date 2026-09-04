from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import chatbot_answer_feedback_http as feedback_http
from chatbot_answer_feedback import (
    AnswerFeedbackConflictError,
    AnswerFeedbackNotFoundError,
    AnswerFeedbackValidationError,
)


class FakeTarget:
    def __init__(self, *, path="/api/chat/stream?operation=feedback", body=None, content_length=None):
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

    def send_response(self, status):
        self.status = status

    def send_header(self, name, value):
        self.response_headers.append((str(name), str(value)))

    def end_headers(self):
        pass

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
                self.originals[name] = getattr(feedback_http, name)
                setattr(feedback_http, name, value)
            return self

        def __exit__(self, exc_type, exc, tb):
            for name, value in self.originals.items():
                setattr(feedback_http, name, value)
            return False

    return PatchContext()


def allow_auth(_target, _page):
    return True


def payload():
    return {
        "feedbackEventId": "63b496be-1aa8-4ec0-bcc3-28a823aff76d",
        "questionEventId": "fbe8f58d-a61a-4ec9-9882-da09405bdb73",
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "mode": "chat",
        "prompt": "请推荐五个 Beauty offer",
        "answer": "这是回答",
        "language": "zh",
        "reasonCode": "inaccurate",
        "reasonDetail": "第二项不准确",
    }


def main():
    unauthorized = FakeTarget(body=payload())

    def deny_auth(target, _page):
        feedback_http.send_json(target, 401, {"ok": False, "error": "Login is required."})
        return False

    with with_patches(require_page_access=deny_auth):
        feedback_http.handle_chatbot_answer_feedback(unauthorized, "POST")
    assert_equal(unauthorized.status, 401, "unauthorized")

    options = FakeTarget()
    with with_patches(require_page_access=deny_auth):
        feedback_http.handle_chatbot_answer_feedback(options, "OPTIONS")
    assert_equal(options.status, 204, "OPTIONS")

    calls = []

    def fake_create(body):
        calls.append(body)
        return {
            "ok": True,
            "feedbackEventId": body["feedbackEventId"],
            "questionEventId": body["questionEventId"],
        }

    create_target = FakeTarget(body=payload())
    with with_patches(require_page_access=allow_auth, create_answer_feedback=fake_create):
        feedback_http.handle_chatbot_answer_feedback(create_target, "POST")
    assert_equal(create_target.status, 200, "create status")
    assert_equal(create_target.json_body()["ok"], True, "create response")
    assert_equal(calls[0]["answer"], "这是回答", "create dispatch")

    malformed = FakeTarget(body=None, content_length=5)
    malformed.rfile = BytesIO(b"{bad}")
    with with_patches(require_page_access=allow_auth):
        feedback_http.handle_chatbot_answer_feedback(malformed, "POST")
    assert_equal(malformed.status, 400, "malformed JSON")

    invalid_length = FakeTarget(body=payload())
    invalid_length.headers["Content-Length"] = "not-a-number"
    with with_patches(require_page_access=allow_auth):
        feedback_http.handle_chatbot_answer_feedback(invalid_length, "POST")
    assert_equal(invalid_length.status, 400, "invalid Content-Length")

    large_payload = payload()
    large_payload["answer"] = "答" * 30_000
    large_target = FakeTarget(body=large_payload)
    with with_patches(require_page_access=allow_auth, create_answer_feedback=fake_create):
        feedback_http.handle_chatbot_answer_feedback(large_target, "POST")
    assert_equal(large_target.status, 200, "body over auth default 64 KB")

    oversized = FakeTarget(body=None, content_length=1_048_577)
    with with_patches(require_page_access=allow_auth):
        feedback_http.handle_chatbot_answer_feedback(oversized, "POST")
    assert_equal(oversized.status, 400, "oversized request")

    for error, expected in (
        (AnswerFeedbackValidationError("invalid"), 400),
        (AnswerFeedbackNotFoundError("missing"), 404),
        (AnswerFeedbackConflictError("duplicate", code="feedback_already_exists"), 409),
    ):
        target = FakeTarget(body=payload())

        def fail_create(_body, raised=error):
            raise raised

        with with_patches(require_page_access=allow_auth, create_answer_feedback=fail_create):
            feedback_http.handle_chatbot_answer_feedback(target, "POST")
        assert_equal(target.status, expected, f"{type(error).__name__} mapping")
        if expected == 409:
            assert_equal(target.json_body()["code"], "feedback_already_exists", "conflict code")

    rows = [{"feedbackEventId": "row-1"}]

    def fake_fetch():
        return rows

    def fake_render(received_rows, export_format):
        assert_equal(received_rows, rows, "export rows")
        return b"feedback-file", "text/test", f"feedback.{export_format}"

    for export_format in ("csv", "jsonl"):
        export_target = FakeTarget(
            path=f"/api/chat/stream?operation=feedback&format={export_format}"
        )
        with with_patches(
            require_page_access=allow_auth,
            fetch_answer_feedback=fake_fetch,
            render_answer_feedback_export=fake_render,
        ):
            feedback_http.handle_chatbot_answer_feedback(export_target, "GET")
        assert_equal(export_target.status, 200, f"{export_format} status")
        assert_equal(export_target.wfile.getvalue(), b"feedback-file", f"{export_format} body")
        assert_equal(export_target.header("Content-Type"), "text/test", f"{export_format} type")
        assert_equal(export_target.header("Cache-Control"), "no-store", f"{export_format} cache")

    invalid_format = FakeTarget(path="/api/chat/stream?operation=feedback&format=xlsx")
    with with_patches(require_page_access=allow_auth):
        feedback_http.handle_chatbot_answer_feedback(invalid_format, "GET")
    assert_equal(invalid_format.status, 400, "invalid export format")

    method_target = FakeTarget()
    with with_patches(require_page_access=allow_auth):
        feedback_http.handle_chatbot_answer_feedback(method_target, "DELETE")
    assert_equal(method_target.status, 405, "invalid method")

    assert not (ROOT / "api" / "chat" / "feedback.py").exists()
    vercel_handler = (ROOT / "api" / "chat" / "stream.py").read_text(encoding="utf-8")
    assert "handle_chatbot_answer_feedback" in vercel_handler
    assert 'self._operation() == "feedback"' in vercel_handler

    local_server = (ROOT / "server.py").read_text(encoding="utf-8")
    assert 'parsed.path == "/api/chat/feedback"' not in local_server
    assert "handle_chatbot_answer_feedback" in local_server
    assert 'operation == "feedback"' in local_server

    print("PASS: chatbot answer feedback HTTP contract tests")


if __name__ == "__main__":
    main()
