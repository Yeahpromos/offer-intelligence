from __future__ import annotations

from io import BytesIO
import json
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import api.chat.actions as vercel_actions
import chat_agent_http
import server


class FakeTarget:
    @staticmethod
    def create(body, path):
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        target = object.__new__(server.Handler)
        target.path = path
        target.headers = {"Content-Length": str(len(raw))}
        target.rfile = BytesIO(raw)
        target.wfile = BytesIO()
        target.status = None
        target.response_headers = []

        def send_response(status):
            target.status = int(status)

        def send_header(name, value):
            target.response_headers.append((str(name), str(value)))

        target.send_response = send_response
        target.send_header = send_header
        target.end_headers = lambda: None
        return target


def response_json(target):
    return json.loads(target.wfile.getvalue().decode("utf-8"))


def run_with_secret(callback):
    previous = os.environ.get("OI_SESSION_SECRET")
    os.environ["OI_SESSION_SECRET"] = "agent-planning-contract-secret"
    try:
        return callback()
    finally:
        if previous is None:
            os.environ.pop("OI_SESSION_SECRET", None)
        else:
            os.environ["OI_SESSION_SECRET"] = previous


def test_local_and_vercel_routes_share_registry():
    captured = []

    def fake_call(messages, tools, **_kwargs):
        captured.append({"messages": messages, "tools": tools})
        return {
            "content": None,
            "tool_calls": [{"id": "provider-id", "name": "merchant_analysis", "arguments": {"merchant": "Shokz"}}],
        }

    previous_call = chat_agent_http.call_llm_tools
    previous_local_auth = server.require_page_access
    previous_vercel_auth = vercel_actions.require_page_access
    chat_agent_http.call_llm_tools = fake_call
    server.require_page_access = lambda _target, _page: True
    vercel_actions.require_page_access = lambda _target, _page: True
    body = {
        "contractVersion": "v2",
        "question": "Shokz 的表现",
        "language": "zh",
        "enabledTools": ["merchant_analysis"],
    }
    try:
        local = FakeTarget.create(body, "/api/chat/agent")
        server.Handler.do_POST(local)
        vercel = FakeTarget.create(body, "/api/chat/agent")
        vercel_actions.dispatch_request(vercel, "POST", "agent")
    finally:
        chat_agent_http.call_llm_tools = previous_call
        server.require_page_access = previous_local_auth
        vercel_actions.require_page_access = previous_vercel_auth

    assert [target.status for target in (local, vercel)] == [200, 200]
    assert len(captured) == 2
    for target in (local, vercel):
        payload = response_json(target)
        assert payload["registryVersion"] == "agent-tools-v1"
        assert payload["toolCalls"][0]["id"] == "r1c1"
        assert payload["toolCalls"][0]["arguments"] == {"merchant": "Shokz"}
        assert payload["planProof"]
    for request in captured:
        assert request["messages"][0]["role"] == "system"
        assert request["tools"][0]["name"] == "merchant_analysis"
        assert request["tools"][0]["parameters"]["additionalProperties"] is False


def test_old_planning_messages_are_not_accepted():
    body = {"messages": [{"role": "user", "content": "客户端自定义消息"}]}
    previous_local_auth = server.require_page_access
    previous_vercel_auth = vercel_actions.require_page_access
    server.require_page_access = lambda _target, _page: True
    vercel_actions.require_page_access = lambda _target, _page: True
    try:
        local = FakeTarget.create(body, "/api/chat/agent")
        server.Handler.do_POST(local)
        vercel = FakeTarget.create(body, "/api/chat/agent")
        vercel_actions.dispatch_request(vercel, "POST", "agent")
    finally:
        server.require_page_access = previous_local_auth
        vercel_actions.require_page_access = previous_vercel_auth

    for target in (local, vercel):
        payload = response_json(target)
        assert target.status == 400
        assert payload == {
            "ok": False,
            "errorCode": "agent_contract_version_required",
            "field": "contractVersion",
        }


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        run_with_secret(test)
        print(f"PASS {test.__name__}")
    print(f"OK {len(tests)} tests")


if __name__ == "__main__":
    main()
