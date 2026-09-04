from http.server import BaseHTTPRequestHandler
import json
import sys
from urllib.parse import parse_qs, urlparse

from auth import _read_json_body, require_page_access
from chatbot_answer_feedback_http import handle_chatbot_answer_feedback
from chatbot_question_log_http import handle_chatbot_question_logs
from agent_trace_http import handle_agent_trace
from agent_debug_http import handle_agent_debug
from agent_contract import (
    AGENT_CONTRACT_VERSION,
    build_synthesis_messages,
    public_agent_error_payload,
    validate_bound_tool_results,
    validate_synthesis_request,
)
from chat_agent_http import AGENT_SYNTHESIS_MAX_REQUEST_BYTES, AGENT_SYNTHESIS_MAX_TOKENS, agent_synthesis_system_prompt
from llm_provider import stream_chat


def _agent_trace_context(value):
    if not isinstance(value, dict):
        return None
    phase = str(value.get("tracePhase") or value.get("phase") or "").strip().lower()
    if phase != "synthesis":
        return None
    return {
        "tracePhase": "synthesis",
        "runId": str(value.get("runId") or "").strip(),
        "questionEventId": str(value.get("questionEventId") or "").strip(),
    }


def _agent_usage_payload(metadata, request_bytes=None):
    metadata = metadata if isinstance(metadata, dict) else {}
    payload = {
        "type": "usage",
        "provider": metadata.get("provider"),
        "model": metadata.get("model"),
        "usageAvailable": bool(metadata.get("usageAvailable")),
        "inputTokens": metadata.get("inputTokens"),
        "outputTokens": metadata.get("outputTokens"),
        "totalTokens": metadata.get("totalTokens"),
    }
    if request_bytes is not None:
        payload["inputBytes"] = int(request_bytes)
    if metadata.get("errorCode"):
        payload["errorCode"] = metadata.get("errorCode")
    if metadata.get("outputChunks") is not None:
        payload["outputChunks"] = metadata.get("outputChunks")
    return payload


class handler(BaseHTTPRequestHandler):
    def _operation(self):
        return str((parse_qs(urlparse(self.path).query).get("operation") or [""])[0]).strip().lower()

    def do_OPTIONS(self):
        if self._operation() == "agent_trace":
            handle_agent_trace(self, "OPTIONS")
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self._operation() == "agent_debug":
            handle_agent_debug(self, "GET")
            return
        if self._operation() == "feedback":
            handle_chatbot_answer_feedback(self, "GET")
            return
        if self._operation() == "questions":
            handle_chatbot_question_logs(self, "GET")
            return
        if self._operation() == "agent_trace":
            handle_agent_trace(self, "GET")
            return
        self._send_json(405, {"ok": False, "error": "Method not allowed"})

    def do_POST(self):
        """SSE streaming endpoint for Chat Mode LLM conversation."""
        if self._operation() == "agent_debug":
            handle_agent_debug(self, "POST")
            return
        if self._operation() == "feedback":
            handle_chatbot_answer_feedback(self, "POST")
            return
        if self._operation() == "questions":
            handle_chatbot_question_logs(self, "POST")
            return
        if self._operation() == "agent_trace":
            handle_agent_trace(self, "POST")
            return
        if not require_page_access(self, "dashboard"):
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > AGENT_SYNTHESIS_MAX_REQUEST_BYTES:
            self._send_json(400, {"ok": False, "error": "Request body is too large"})
            return

        try:
            body = _read_json_body(self, max_size=AGENT_SYNTHESIS_MAX_REQUEST_BYTES)
        except (ValueError, Exception):
            self._send_json(400, {"ok": False, "error": "Invalid JSON body"})
            return
        if not isinstance(body, dict):
            self._send_json(400, {"ok": False, "error": "JSON body must be an object"})
            return

        if body.get("contractVersion") == AGENT_CONTRACT_VERSION:
            request, error = validate_synthesis_request(body)
            if error:
                self._send_json(int(error.get("status") or 400), public_agent_error_payload(error))
                return
            validated_results, error = validate_bound_tool_results(request)
            if error:
                self._send_json(int(error.get("status") or 400), public_agent_error_payload(error))
                return
            trace_context = _agent_trace_context(request.get("trace"))
            messages = build_synthesis_messages(request, validated_results)
            self._chat_stream_messages(
                messages,
                request["language"],
                request_bytes=length,
                trace_context=trace_context,
                agent_synthesis=True,
            )
            return

        if "messages" in body or "contractVersion" in body:
            self._send_json(
                400,
                public_agent_error_payload({
                    "errorCode": "agent_contract_version_required",
                    "field": "contractVersion",
                }),
            )
            return

        trace_context = _agent_trace_context(body.get("trace"))
        if trace_context is None:
            trace_context = _agent_trace_context(body.get("traceContext"))
        if trace_context is None:
            trace_context = _agent_trace_context(body)

        memory = str(body.get("memory") or "").strip() or None
        language = str(body.get("language") or "zh").strip()
        if language not in ("en", "zh"):
            language = "zh"
        prompt = str(body.get("prompt") or "").strip()
        if not prompt:
            self._send_json(400, {"ok": False, "error": "prompt is required"})
            return
        history = body.get("history") or None

        # Build system prompt
        system_parts = [
            "你是一个亚马逊联盟营销数据分析助手，帮助用户分析广告活动、商家表现和付款数据。",
            "请根据用户提供的信息和已有的数据分析结果，回答用户的问题。",
            "回答要简洁、准确、有数据支撑。如果问题涉及具体数据但上下文中没有提供，",
            "请说明缺少哪些数据并给出一般性分析建议。",
            "回答时尽量使用 Markdown 表格展示结构化数据（如多商户/多月份指标对比、Top N 排行、品类或 Tier 统计）。",
            "能用表格表达清楚的数据就不要用长段落罗列；表格前后用一两句话给出结论和补充说明。",
        ]
        if language == "en":
            system_parts = [
                "You are an Amazon affiliate marketing data analysis assistant.",
                "Answer user questions based on their input and any provided context.",
                "Be concise, accurate, and data-driven. If specific data is not available,"
                " explain what's missing and give general analysis advice.",
                "Prefer Markdown tables for structured data (metric comparisons across merchants or months,"
                " Top-N rankings, category or tier breakdowns). Use a table whenever it presents the data"
                " more clearly than prose; keep one or two sentences of conclusions and caveats before or after the table.",
            ]
        if memory:
            system_parts.append(
                f"\n\n用户已有的分析上下文（来自拖入的面板）：\n{memory}\n"
                "请优先参考以上上下文来回答问题。如果问题与上下文无关，可以忽略。"
            )

        system_prompt = "\n".join(system_parts)

        # SSE streaming
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            usage_metadata = {}

            def on_complete(metadata):
                usage_metadata.update(metadata or {})

            token_count = 0
            for token in stream_chat(
                prompt,
                system_prompt,
                max_tokens=2048,
                temperature=0.2,
                history=history,
                on_complete=on_complete,
            ):
                if token:
                    self.wfile.write(f"data: {json.dumps({'token': token}, ensure_ascii=False)}\n\n".encode("utf-8"))
                    self.wfile.flush()
                    token_count += 1

            if trace_context:
                self.wfile.write(
                    f"data: {json.dumps(_agent_usage_payload(usage_metadata, length), ensure_ascii=False)}\n\n".encode("utf-8")
                )
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            print(f"[chat_stream] sent {token_count} tokens for prompt={prompt[:60]!r}", file=sys.stderr)

        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            print(f"[chat_stream] client disconnected: {prompt[:60]!r}", file=sys.stderr)
        except Exception as exc:
            print(f"[chat_stream] error: {exc}", file=sys.stderr)
            try:
                self.wfile.write(f"data: {json.dumps({'error': str(exc)}, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass

    def _chat_stream_messages(
        self,
        messages,
        language,
        request_bytes=None,
        trace_context=None,
        agent_synthesis=False,
    ):
        """SSE streaming for agent synthesis: full message list passthrough."""
        system_prompt = agent_synthesis_system_prompt(language)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            usage_metadata = {}

            def on_complete(metadata):
                usage_metadata.update(metadata or {})

            token_count = 0
            for token in stream_chat(
                "",
                system_prompt,
                max_tokens=AGENT_SYNTHESIS_MAX_TOKENS,
                temperature=0.2,
                messages=messages,
                on_complete=on_complete,
            ):
                if token:
                    self.wfile.write(f"data: {json.dumps({'token': token}, ensure_ascii=False)}\n\n".encode("utf-8"))
                    self.wfile.flush()
                    token_count += 1

            if trace_context:
                self.wfile.write(
                    f"data: {json.dumps(_agent_usage_payload(usage_metadata, request_bytes), ensure_ascii=False)}\n\n".encode("utf-8")
                )
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            print(f"[chat_stream_messages] sent {token_count} tokens", file=sys.stderr)

        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            print("[chat_stream_messages] client disconnected", file=sys.stderr)
        except Exception as exc:
            if agent_synthesis:
                print("[chat_stream_messages] agent_synthesis_unavailable", file=sys.stderr)
            else:
                print(f"[chat_stream_messages] error: {exc}", file=sys.stderr)
            try:
                error_payload = {"errorCode": "agent_synthesis_unavailable"} if agent_synthesis else {"error": str(exc)}
                self.wfile.write(f"data: {json.dumps(error_payload, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
