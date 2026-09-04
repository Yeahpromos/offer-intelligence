import importlib.util
from io import BytesIO
import json
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "api" / "chat" / "actions.py"
sys.path.insert(0, str(ROOT))

from auth import send_json


class FakeTarget:
    def __init__(self, payload=None):
        body = json.dumps(payload or {}).encode("utf-8")
        self.headers = {"Content-Length": str(len(body))}
        self.rfile = BytesIO(body)
        self.wfile = BytesIO()
        self.status = None
        self.response_headers = []

    def send_response(self, status):
        self.status = int(status)

    def send_header(self, name, value):
        self.response_headers.append((str(name), str(value)))

    def end_headers(self):
        return None


def load_module():
    if not APP_PATH.is_file():
        raise AssertionError("missing consolidated chat entrypoint api/chat/actions.py")
    spec = importlib.util.spec_from_file_location("vercel_chat_routes", APP_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def response_json(target):
    return json.loads(target.wfile.getvalue().decode("utf-8"))


def main():
    module = load_module()
    old_auth = os.environ.get("OI_AUTH_ENABLED")
    os.environ["OI_AUTH_ENABLED"] = "0"
    try:
        module.classify_intent = lambda prompt, categories: {
            "intent": "merchant",
            "params": {"prompt": prompt, "categoryCount": len(categories)},
        }
        classify = FakeTarget({"prompt": "Shokz", "categories": ["Audio"]})
        module.dispatch_request(classify, "POST", "classify")
        if classify.status != 200 or response_json(classify).get("intent") != "merchant":
            raise AssertionError("classify route did not preserve its JSON contract")

        module.generate_analysis_text = lambda summary, language: (
            f"{language}:{summary.get('merchant')}"
        )
        analyze = FakeTarget({"summary": {"merchant": "Shokz"}, "language": "zh"})
        module.dispatch_request(analyze, "POST", "analyze")
        if analyze.status != 200 or response_json(analyze).get("text") != "zh:Shokz":
            raise AssertionError("analyze route did not preserve its JSON contract")

        options = FakeTarget()
        module.dispatch_request(options, "OPTIONS", "classify")
        if options.status != 204:
            raise AssertionError(f"chat OPTIONS should return 204, got {options.status}")

        wrong_method = FakeTarget()
        module.dispatch_request(wrong_method, "GET", "classify")
        if wrong_method.status != 405:
            raise AssertionError(f"wrong chat method should return 405, got {wrong_method.status}")

        class NullTarget:
            def send_response(self, status): self.status = status
            def send_header(self, *a): pass
            def end_headers(self): pass

        def target_writer(target, route):
            send_json(target, 200, {"ok": True, "route": route})

        module.handle_agent_request = lambda target: target_writer(target, "agent")
        agent = FakeTarget({
            "messages": [{"role": "user", "content": "Shokz"}],
            "tools": [{"name": "merchant_analysis", "description": "d", "parameters": {"type": "object"}}],
        })
        module.dispatch_request(agent, "POST", "agent")
        if agent.status != 200 or response_json(agent).get("route") != "agent":
            raise AssertionError("agent route did not dispatch to handle_agent_request")

        stream_path = ROOT / "api" / "chat" / "stream.py"
        stream_spec = importlib.util.spec_from_file_location("vercel_chat_stream_route", stream_path)
        stream_module = importlib.util.module_from_spec(stream_spec)
        stream_spec.loader.exec_module(stream_module)
        trace_target = FakeTarget()
        trace_target.path = "/api/chat/stream?operation=agent_trace"
        trace_target._operation = lambda: "agent_trace"

        def trace_writer(target, method):
            send_json(target, 200, {"ok": True, "route": "agent_trace", "method": method})

        stream_module.handle_agent_trace = trace_writer
        stream_module.require_page_access = lambda target, _page: True
        stream_module.handler.do_POST(trace_target)
        if trace_target.status != 200 or response_json(trace_target).get("route") != "agent_trace":
            raise AssertionError("Vercel stream operation=agent_trace did not dispatch")

        stream_source = stream_path.read_text(encoding="utf-8")
        if 'self._operation() == "agent_trace"' not in stream_source:
            raise AssertionError("Vercel stream route must expose the agent_trace operation")

        unknown_route = FakeTarget()
        module.dispatch_request(unknown_route, "POST", "unknown")
        if unknown_route.status != 404:
            raise AssertionError(f"unknown chat route should return 404, got {unknown_route.status}")

        print("Vercel consolidated chat route checks passed")
    finally:
        if old_auth is None:
            os.environ.pop("OI_AUTH_ENABLED", None)
        else:
            os.environ["OI_AUTH_ENABLED"] = old_auth


if __name__ == "__main__":
    main()
