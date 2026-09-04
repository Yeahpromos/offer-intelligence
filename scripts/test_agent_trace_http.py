from __future__ import annotations

from io import BytesIO
import json
import os
from pathlib import Path
import sys
import uuid


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import agent_trace_http as trace_http


RUN_ID = str(uuid.uuid4())
QUESTION_ID = str(uuid.uuid4())
SESSION_ID = "session-agent-trace-http-2026"


class FakeTarget:
    def __init__(self, body=None, *, path="/api/chat/stream?operation=agent_trace", content_length=None):
        raw = b"" if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.path = path
        self.headers = {}
        self.headers["Content-Length"] = str(len(raw) if content_length is None else content_length)
        self.rfile = BytesIO(raw)
        self.wfile = BytesIO()
        self.status = None
        self.response_headers = []

    def send_response(self, status):
        self.status = int(status)

    def send_header(self, name, value):
        self.response_headers.append((str(name), str(value)))

    def end_headers(self):
        return None

    def json_body(self):
        return json.loads(self.wfile.getvalue().decode("utf-8"))


class PatchContext:
    def __init__(self, **patches):
        self.patches = patches

    def __enter__(self):
        self.originals = {}
        for name, value in self.patches.items():
            self.originals[name] = getattr(trace_http, name)
            setattr(trace_http, name, value)
        return self

    def __exit__(self, exc_type, exc, tb):
        for name, value in self.originals.items():
            setattr(trace_http, name, value)
        return False


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def allow_auth(_target, _page):
    return True


def test_trace_http_contract():
    calls = []

    def fake_start(payload):
        calls.append(("start", payload))
        return {"ok": True, "runId": RUN_ID, "status": "running"}

    def fake_append(payload):
        calls.append(("append", payload))
        return {"ok": True, "runId": RUN_ID, "inserted": len(payload["steps"]), "duplicates": 0}

    def fake_complete(payload):
        calls.append(("complete", payload))
        return {"ok": True, "runId": RUN_ID, "status": payload["status"]}

    common = {"sessionId": SESSION_ID, "questionEventId": QUESTION_ID}
    with PatchContext(
        require_page_access=allow_auth,
        start_agent_run=fake_start,
        append_agent_steps=fake_append,
        complete_agent_run=fake_complete,
    ):
        start = FakeTarget({**common, "action": "start", "runId": RUN_ID, "mode": "agent", "language": "zh"})
        trace_http.handle_agent_trace(start, "POST")
        assert_equal(start.status, 200, "start status")
        assert_equal(start.json_body()["runId"], RUN_ID, "start runId")

        steps = [
            {"runId": RUN_ID, "questionEventId": QUESTION_ID, "sequence": i, "phase": "tool", "status": "success"}
            for i in range(1, 65)
        ]
        append = FakeTarget({"action": "append", "runId": RUN_ID, "sessionId": SESSION_ID, "steps": steps[:64]})
        trace_http.handle_agent_trace(append, "POST")
        assert_equal(append.status, 200, "append status")
        assert_equal(calls[-1][1]["steps"].__len__(), 64, "append max steps")

        complete = FakeTarget({"action": "complete", "runId": RUN_ID, "sessionId": SESSION_ID, "status": "success"})
        trace_http.handle_agent_trace(complete, "POST")
        assert_equal(complete.status, 200, "complete status")
        assert_equal(complete.json_body()["status"], "success", "complete state")


def test_trace_http_rejects_bad_requests():
    with PatchContext(require_page_access=allow_auth):
        for payload in (
            {"action": "append", "sessionId": SESSION_ID, "steps": []},
            {"action": "complete", "sessionId": SESSION_ID, "status": "success"},
            {"action": "append", "runId": RUN_ID, "sessionId": SESSION_ID, "steps": [{"phase": "bad", "status": "success", "sequence": 1, "questionEventId": QUESTION_ID}]},
        ):
            target = FakeTarget(payload)
            trace_http.handle_agent_trace(target, "POST")
            assert_equal(target.status, 400, "invalid trace status")

        too_many = FakeTarget({"action": "append", "runId": RUN_ID, "sessionId": SESSION_ID, "steps": [{"runId": RUN_ID, "questionEventId": QUESTION_ID, "sequence": i, "phase": "tool", "status": "success"} for i in range(65)]})
        trace_http.handle_agent_trace(too_many, "POST")
        assert_equal(too_many.status, 400, "step limit status")

        oversized = FakeTarget(None, content_length=trace_http.MAX_REQUEST_BODY_BYTES + 1)
        trace_http.handle_agent_trace(oversized, "POST")
        assert_equal(oversized.status, 400, "body limit status")


def test_trace_http_auth_and_disabled_mode():
    denied = FakeTarget({"action": "start"})

    def deny_auth(target, _page):
        trace_http.send_json(target, 401, {"ok": False, "error": "Login is required."})
        return False

    with PatchContext(require_page_access=deny_auth):
        trace_http.handle_agent_trace(denied, "POST")
    assert_equal(denied.status, 401, "auth status")

    previous = os.environ.get("OI_AGENT_TRACE_ENABLED")
    try:
        os.environ["OI_AGENT_TRACE_ENABLED"] = "0"
        disabled = FakeTarget({"action": "start"})

        def unexpected(_payload):
            raise AssertionError("disabled trace must not touch the database")

        with PatchContext(require_page_access=allow_auth, start_agent_run=unexpected):
            trace_http.handle_agent_trace(disabled, "POST")
        assert_equal(disabled.status, 200, "disabled status")
        assert_equal(disabled.json_body(), {"ok": True, "disabled": True}, "disabled response")
    finally:
        if previous is None:
            os.environ.pop("OI_AGENT_TRACE_ENABLED", None)
        else:
            os.environ["OI_AGENT_TRACE_ENABLED"] = previous


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")
    print(f"OK {len(tests)} tests")


if __name__ == "__main__":
    main()
