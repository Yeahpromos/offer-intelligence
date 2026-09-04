import os
import json
import time
import unittest
from unittest.mock import patch
from io import BytesIO
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import agent_agui
import auth
from agent_contract import issue_plan_proof


class FakeTarget:
    def __init__(self, headers=None, body=b""):
        self.headers = {"Host": "127.0.0.1", **(headers or {})}
        self.rfile = BytesIO(body)
        self.wfile = BytesIO()
        self.status = None
        self.response_headers = []

    def send_response(self, status):
        self.status = int(status)

    def send_header(self, name, value):
        self.response_headers.append((name, value))

    def end_headers(self):
        return None


class AgentAguiTests(unittest.TestCase):
    def test_local_server_exposes_the_same_agui_route_as_vercel(self):
        source = (ROOT / "server.py").read_text(encoding="utf-8")
        self.assertIn("from agent_agui import handle_agui_request", source)
        for method in ("GET", "OPTIONS", "POST"):
            self.assertIn(
                f'if parsed.path == "/api/chat/agui":\n            handle_agui_request(self, "{method}")',
                source,
            )

    @patch("agent_agui.plan_agent_request")
    def test_parity_delegates_no_tool_outcome_to_shared_source_policy(self, planning):
        planning.return_value = (200, {"ok": True, "content": "Unverified revenue 999", "toolCalls": []})
        body = self.body()
        body["state"]["offerIntelligence"]["legacyParity"] = True
        events = list(agent_agui.generate_agui_events(body))
        self.assertFalse(any(event["type"] == "TEXT_MESSAGE_CONTENT" for event in events))
        fallback = next(event for event in events if event.get("name") == "oi.planning_fallback")
        self.assertEqual(fallback["value"]["content"], "Unverified revenue 999")
        self.assertEqual(events[-1]["type"], "RUN_FINISHED")

    @patch("agent_agui.plan_agent_request")
    def test_parity_preserves_unavailable_planner_fallback(self, planning):
        planning.return_value = (200, {"ok": False, "errorCode": "agent_planning_unavailable"})
        body = self.body()
        body["state"]["offerIntelligence"]["legacyParity"] = True
        events = list(agent_agui.generate_agui_events(body))
        self.assertTrue(any(event.get("name") == "oi.planning_fallback" for event in events))
        self.assertEqual(events[-1]["type"], "RUN_FINISHED")

    @patch("agent_agui.plan_agent_request")
    def test_parity_preserves_prepared_history_in_continuation_state(self, planning):
        planning.return_value = (200, {"ok": True, "agentRunId": "fixture", "planProof": "proof", "toolCalls": [
            {"id": "r1c1", "name": "merchant_analysis", "arguments": {"merchant": "Tapo"}}
        ]})
        body = self.body()
        history = [{"role": "assistant", "content": "EPC: 1.2"}]
        body["state"]["offerIntelligence"].update({"legacyParity": True, "history": history, "memory": "Tier 2"})
        events = list(agent_agui.generate_agui_events(body))
        state = next(event["snapshot"]["offerIntelligence"] for event in events if event["type"] == "STATE_SNAPSHOT")
        self.assertEqual(state["history"], history)
        self.assertEqual(state["memory"], "Tier 2")

    def body(self):
        return {
            "threadId": "thread-1",
            "runId": "run-1",
            "messages": [{"id": "user-1", "role": "user", "content": "查询商户数据"}],
            "state": {"offerIntelligence": {"version": 1, "status": "planning", "language": "zh", "memory": ""}},
        }

    @patch("agent_agui.plan_agent_request")
    def test_direct_answer_has_one_terminal_event(self, planning):
        planning.return_value = (200, {
            "ok": True,
            "agentRunId": "ar_test",
            "content": "可以先明确指标。",
            "toolCalls": [],
        })
        events = list(agent_agui.generate_agui_events(self.body(), 100))
        self.assertEqual(events[0]["type"], "RUN_STARTED")
        self.assertEqual(events[-1]["type"], "RUN_FINISHED")
        self.assertEqual(sum(event["type"] in {"RUN_FINISHED", "RUN_ERROR"} for event in events), 1)
        self.assertIn("可验证", next(event["delta"] for event in events if event["type"] == "TEXT_MESSAGE_CONTENT"))

    @patch("agent_agui.plan_agent_request")
    def test_tools_are_emitted_in_bounded_batches(self, planning):
        calls = [
            {"id": f"r1c{index}", "name": "merchant_analysis", "arguments": {"merchant": f"M{index}"}}
            for index in range(1, 7)
        ]
        planning.return_value = (200, {
            "ok": True,
            "agentRunId": "ar_test",
            "planProof": "signed-proof",
            "toolCalls": calls,
        })
        events = list(agent_agui.generate_agui_events(self.body(), 100))
        self.assertEqual(sum(event["type"] == "TOOL_CALL_START" for event in events), 4)
        snapshot = next(event["snapshot"] for event in events if event["type"] == "STATE_SNAPSHOT")
        self.assertEqual(len(snapshot["offerIntelligence"]["calls"]), 6)
        self.assertEqual(events[-1]["result"]["status"], "tools")

    def test_internal_adapter_reuses_existing_session_secret(self):
        with patch.dict(os.environ, {"OI_SESSION_SECRET": "shared-secret"}, clear=True):
            self.assertTrue(agent_agui.is_internal_request({"X-OI-Copilot-Token": "shared-secret"}))
            self.assertFalse(agent_agui.is_internal_request({"X-OI-Copilot-Token": "wrong"}))

    def test_internal_token_alone_cannot_bypass_user_session(self):
        with patch.dict(os.environ, {
            "OI_AUTH_ENABLED": "1",
            "OI_SESSION_SECRET": "shared-secret",
            "VERCEL_ENV": "preview",
            "OFFER_DB_HOST": "db.example.test",
            "OFFER_DB_NAME": "offer_intelligence",
            "OFFER_DB_USER": "readonly",
            "OFFER_DB_PASSWORD": os.urandom(12).hex(),
        }, clear=True):
            target = FakeTarget({
                "X-OI-Copilot-Token": "shared-secret",
                "Content-Length": "0",
            })
            agent_agui.handle_agui_request(target, "POST")
            self.assertEqual(target.status, 401)

    def test_python_agui_denies_level_two_before_reading_request_body(self):
        with patch.dict(os.environ, {
            "OI_AUTH_ENABLED": "1",
            "OI_SESSION_SECRET": "shared-secret",
            "VERCEL_ENV": "preview",
            "OFFER_DB_HOST": "db.example.test",
            "OFFER_DB_NAME": "offer_intelligence",
            "OFFER_DB_USER": "readonly",
            "OFFER_DB_PASSWORD": os.urandom(12).hex(),
        }, clear=True):
            cookie, _ = auth.create_session("limited")
            row = {
                "id": 2,
                "username": "limited",
                "display_name": "Limited",
                "email": "limited@example.test",
                "password_hash": auth.make_password_hash(os.urandom(12).hex(), iterations=1_000, salt="agui-salt"),
                "level": 2,
                "is_active": 1,
            }
            with patch("auth.user_record_by_username", return_value=row):
                target = FakeTarget({
                    "X-OI-Copilot-Token": "shared-secret",
                    "Cookie": f"oi_session={cookie}",
                    "Content-Length": "999",
                }, body=b"not-read")
                agent_agui.handle_agui_request(target, "POST")
            self.assertEqual(target.status, 403)

    def test_continuation_synthesizes_only_a_proof_bound_result(self):
        call = {"id": "r1c1", "name": "merchant_analysis", "arguments": {"merchant": "Tapo"}}
        agent_run_id = "ar_1234567890123456"
        question = "查询 Tapo 数据"
        with patch.dict(os.environ, {"OI_SESSION_SECRET": "shared-secret"}, clear=True):
            proof = issue_plan_proof(agent_run_id, question, [call], int(time.time()) + 60)
            body = {
                "threadId": "thread-1",
                "runId": "run-2",
                "messages": [
                    {"id": "user-1", "role": "user", "content": question},
                    {
                        "id": "tool-1",
                        "role": "tool",
                        "toolCallId": "r1c1",
                        "content": json.dumps({
                            "toolResult": {
                                "callId": "client-value-is-ignored",
                                "toolName": "merchant_analysis",
                                "arguments": {"merchant": "Tapo"},
                                "result": {
                                    "ok": True,
                                    "source": {"dataSource": "cache", "dataAsOf": None, "estimated": False},
                                    "data": {"merchant": "Tapo"},
                                },
                            }
                        }),
                    },
                ],
                "state": {"offerIntelligence": {
                    "version": 1,
                    "status": "tools",
                    "question": question,
                    "language": "zh",
                    "memory": "",
                    "history": [],
                    "agentRunId": agent_run_id,
                    "planProofs": [proof],
                    "calls": [call],
                    "round": 1,
                }},
            }

            def fake_stream(_prompt, _system, **kwargs):
                self.assertIn("Tapo", kwargs["messages"][-1]["content"])
                kwargs["on_complete"]({"provider": "test", "model": "test-model"})
                yield "Tapo result"

            events = list(agent_agui.generate_agui_events(body, 100, fake_stream))
        self.assertEqual(events[-1]["type"], "RUN_FINISHED")
        self.assertIn("Tapo result", "".join(event.get("delta", "") for event in events))
        self.assertEqual(sum(event["type"] in {"RUN_FINISHED", "RUN_ERROR"} for event in events), 1)

    def test_synthesis_provider_failure_is_a_run_error(self):
        call = {"id": "r1c1", "name": "merchant_analysis", "arguments": {"merchant": "Tapo"}}
        agent_run_id = "ar_1234567890123456"
        question = "查询 Tapo 数据"
        with patch.dict(os.environ, {"OI_SESSION_SECRET": "shared-secret"}, clear=True):
            proof = issue_plan_proof(agent_run_id, question, [call], int(time.time()) + 60)
            body = {
                "threadId": "thread-1",
                "runId": "run-2",
                "messages": [
                    {"id": "user-1", "role": "user", "content": question},
                    {"id": "tool-1", "role": "tool", "toolCallId": "r1c1", "content": json.dumps({
                        "toolResult": {
                            "result": {
                                "ok": True,
                                "source": {"dataSource": "cache", "dataAsOf": None, "estimated": False},
                                "data": {"merchant": "Tapo"},
                            }
                        }
                    })},
                ],
                "state": {"offerIntelligence": {
                    "version": 1,
                    "status": "tools",
                    "question": question,
                    "language": "zh",
                    "memory": "",
                    "history": [],
                    "agentRunId": agent_run_id,
                    "planProofs": [proof],
                    "calls": [call],
                    "round": 1,
                }},
            }

            def unavailable_stream(_prompt, _system, **kwargs):
                kwargs["on_complete"]({"ok": False, "errorCode": "llm_unavailable"})
                yield from ()

            events = list(agent_agui.generate_agui_events(body, 100, unavailable_stream))
        self.assertEqual(events[-1]["type"], "RUN_ERROR")
        self.assertEqual(events[-1]["code"], "llm_unavailable")
        self.assertEqual(sum(event["type"] in {"RUN_FINISHED", "RUN_ERROR"} for event in events), 1)


if __name__ == "__main__":
    unittest.main()
