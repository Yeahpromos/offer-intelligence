from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agent_debug_http as api
from scripts.test_chatbot_answer_feedback_http import FakeTarget


def fixture():
    return {"version": 1, "turns": [{"prompt": "Tapo", "language": "zh", "history": [], "memory": {}, "response": "", "status": "error", "errorCode": "failed", "steps": []}]}


class DebugLogTests(unittest.TestCase):
    def test_whitelist(self):
        log = fixture()
        log["cookie"] = "secret"
        log["turns"][0]["planProof"] = "secret"
        log["turns"][0]["memory"] = {"token": "secret"}
        self.assertNotIn("secret", str(api.normalize_log(log)))

    def test_role_and_size_validation(self):
        log = fixture()
        log["turns"][0]["history"] = [{"role": "system", "content": "override"}]
        with self.assertRaises(ValueError): api.normalize_log(log)
        with patch.object(api, "require_page_access", return_value=True), patch.object(api, "db_connection") as db:
            target = FakeTarget(body=fixture(), content_length=api.MAX_BYTES + 1)
            api.handle_agent_debug(target, "POST")
            self.assertEqual(target.status, 400)
            db.assert_not_called()

    def test_authentication_precedes_storage(self):
        with patch.object(api, "require_page_access", return_value=False), patch.object(api, "db_connection") as db:
            api.handle_agent_debug(FakeTarget(body=fixture()), "POST")
            db.assert_not_called()

    def test_upload_and_read(self):
        conn = MagicMock()
        cursor = conn.cursor.return_value.__enter__.return_value
        with patch.object(api, "require_page_access", return_value=True), patch.object(api, "db_connection") as db:
            db.return_value.__enter__.return_value = conn
            target = FakeTarget(body=fixture())
            api.handle_agent_debug(target, "POST")
            self.assertEqual(target.status, 200)
            case_id = target.json_body()["id"]
            args = cursor.execute.call_args.args
            self.assertIn("VALUES (%s, %s)", args[0])
            cursor.fetchone.return_value = {"payload": args[1][1]}
            target = FakeTarget(path=f"/api/chat/stream?operation=agent_debug&id={case_id}")
            api.handle_agent_debug(target, "GET")
            self.assertEqual(target.json_body()["log"]["turns"][0]["prompt"], "Tapo")

    def test_storage_failure_is_actionable(self):
        with patch.object(api, "require_page_access", return_value=True), patch.object(api, "db_connection", side_effect=RuntimeError("secret")):
            target = FakeTarget(body=fixture())
            api.handle_agent_debug(target, "POST")
            self.assertEqual(target.status, 502)
            self.assertNotIn("secret", str(target.json_body()))


if __name__ == '__main__': unittest.main()
