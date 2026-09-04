#!/usr/bin/env python3

from __future__ import annotations

import datetime as dt
import gzip
import json
import mimetypes
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse

# ---------- .env loader ----------
def _load_dotenv(path: str = ".env") -> None:
    env_path = Path(path)
    if not env_path.is_file():
        return
    with env_path.open("r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("\"'")  # strip optional quotes
            if key and key not in os.environ:   # never override an already-set env var
                os.environ[key] = value

_load_dotenv()
# ------------------------------------

from api.tier_moves import handle_tier_moves
from auth import (
    current_user_for_target,
    handle_auth_login,
    handle_auth_logout,
    handle_auth_options,
    handle_auth_session,
    require_page_access,
    _read_json_body,
)
from chatbot_answer_feedback_http import handle_chatbot_answer_feedback
from chatbot_question_log_http import handle_chatbot_question_logs
from agent_trace_http import handle_agent_trace
from agent_debug_http import handle_agent_debug
from agent_agui import handle_agui_request
from agent_contract import (
    AGENT_CONTRACT_VERSION,
    build_synthesis_messages,
    public_agent_error_payload,
    validate_bound_tool_results,
    validate_synthesis_request,
)
from offer_db import (
    add_merchant_to_tier1,
    chatbot_offers_payload,
    delete_monthly_new_merchant,
    DIGITS_RE,
    OfferDbConfigError,
    OfferDbError,
    first_query_value,
    int_query_value,
    merchant_payload,
    monthly_new_merchants_payload,
    offers_payload,
    product_keywords_payload,
    brand_media_sankey_payload,
    brand_media_trend_payload,
    publisher_portfolio_payload,
    publishers_payload,
    public_error_payload,
    read_static_merchant_ids,
    search_payload,
    status_payload,
    tier1_additions_payload,
    tier1_merchant_search_payload,
    tier_sheet_payload,
    tier_summary_payload,
    upsert_monthly_new_merchant,
)
from google_ads_workbench import (
    DEFAULT_WORKBENCH_USER_ID,
    GoogleAdsApiError,
    GoogleAdsConfigError,
    google_ads_workbench_payload,
)
import skills  # noqa: F401 — trigger skill auto-registration before llm_classify uses registry
from llm_classify import classify_intent, generate_analysis_text
from llm_provider import stream_chat
from chat_agent_http import AGENT_SYNTHESIS_MAX_REQUEST_BYTES, AGENT_SYNTHESIS_MAX_TOKENS, agent_synthesis_system_prompt, handle_agent_request


from levanta_payments import (
    DEFAULT_MARKETPLACES,
    DEFAULT_MONTHS,
    LEVANTA_BRAND_TO_MERCHANT,
    OFFERS_BY_ID,
    fetch_invoice_items_for_marketplaces,
    has_payable_payment_amount,
    is_trackable_payment_record,
    marketplaces_from_query,
    months_from_query,
    normalize,
    normalize_invoice_item,
    normalize_region,
    number,
    offer_for_payment_source,
    payment_summary,
    with_pending_placeholders,
)

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "public"

UI_DB_PAGE_BY_PATH = {
    "/api/ui/db/status": "dashboard",
    "/api/ui/db/merchant": "dashboard",
    "/api/ui/db/search": "dashboard",
    "/api/ui/db/offers": "dashboard",
    "/api/ui/db/chatbot-offers": "dashboard",
    "/api/ui/db/keywords": "dashboard",
    "/api/ui/db/tier-sheet": "tier",
    "/api/ui/db/tier_sheet": "tier",
    "/api/ui/db/tier-summary": "tier",
    "/api/ui/db/tier1-merchants": "tier",
    "/api/ui/db/monthly-new-merchants": "monthly-new-merchants",
    "/api/ui/db/publishers": "publishers",
    "/api/ui/db/brand-media-sankey": "brand-media",
    "/api/ui/db/brand-media-trend": "brand-media",
    "/api/ui/db/google-ads-workbench": "google-ads",
}


def page_access_for_ui_path(path):
    return UI_DB_PAGE_BY_PATH.get(path)


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


class Handler(BaseHTTPRequestHandler):
    server_version = "OfferChatbot/1.0"

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        accepts_gzip = "gzip" in self.headers.get("Accept-Encoding", "")
        if accepts_gzip:
            body = gzip.compress(body, compresslevel=6)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if accepts_gzip:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, OSError):
            pass  # client disconnected — harmless

    def do_GET(self):
        parsed = urlparse(self.path)
        operation = str((parse_qs(parsed.query).get("operation") or [""])[0]).strip().lower()
        if parsed.path == "/api/chat/agui":
            handle_agui_request(self, "GET")
            return
        if parsed.path == "/api/chat/stream" and operation == "feedback":
            handle_chatbot_answer_feedback(self, "GET")
            return
        if parsed.path == "/api/chat/stream" and operation == "questions":
            handle_chatbot_question_logs(self, "GET")
            return
        if parsed.path == "/api/chat/stream" and operation == "agent_debug":
            handle_agent_debug(self, "GET")
            return
        if parsed.path == "/api/chat/stream" and operation == "agent_trace":
            handle_agent_trace(self, "GET")
            return
        if parsed.path == "/api/auth/session":
            handle_auth_session(self)
            return
        if parsed.path == "/api/levanta/payments":
            if not require_page_access(self, "payments", allow_payment_sync_token=True):
                return
            self.handle_payments_api(parsed)
            return
        if parsed.path.startswith("/api/ui/db/"):
            if not require_page_access(self, page_access_for_ui_path(parsed.path) or "dashboard"):
                return
            self.handle_db_ui_api(parsed)
            return
        if parsed.path == "/api/tier_moves":
            handle_tier_moves(self, "GET")
            return
        self.handle_static(parsed.path)

    def do_OPTIONS(self):
        parsed = urlparse(self.path)
        operation = str((parse_qs(parsed.query).get("operation") or [""])[0]).strip().lower()
        if parsed.path == "/api/chat/agui":
            handle_agui_request(self, "OPTIONS")
            return
        if parsed.path.startswith("/api/auth/"):
            handle_auth_options(self)
            return
        if parsed.path.startswith("/api/ui/db/"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if parsed.path == "/api/tier_moves":
            handle_tier_moves(self, "OPTIONS")
            return
        if parsed.path == "/api/chat/stream" and operation == "agent_trace":
            handle_agent_trace(self, "OPTIONS")
            return
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        operation = str((parse_qs(parsed.query).get("operation") or [""])[0]).strip().lower()
        if parsed.path == "/api/chat/agui":
            handle_agui_request(self, "POST")
            return
        if parsed.path == "/api/auth/login":
            handle_auth_login(self)
            return
        if parsed.path == "/api/auth/logout":
            handle_auth_logout(self)
            return
        if parsed.path == "/api/tier_moves":
            handle_tier_moves(self, "POST")
            return
        if parsed.path == "/api/ui/db/tier1-merchants":
            if not require_page_access(self, "tier"):
                return
            self.handle_tier1_merchant_add()
            return
        if parsed.path == "/api/ui/db/monthly-new-merchants":
            if not require_page_access(self, "monthly-new-merchants"):
                return
            self.handle_monthly_new_merchants_write()
            return
        if parsed.path == "/api/chat/classify":
            if not require_page_access(self, "dashboard"):
                return
            self.handle_llm_classify()
            return
        if parsed.path == "/api/chat/analyze":
            if not require_page_access(self, "dashboard"):
                return
            self.handle_llm_analyze()
            return
        if parsed.path == "/api/chat/agent":
            if not require_page_access(self, "agent"):
                return
            handle_agent_request(self)
            return
        if parsed.path == "/api/chat/stream":
            if operation == "feedback":
                handle_chatbot_answer_feedback(self, "POST")
                return
            if operation == "questions":
                handle_chatbot_question_logs(self, "POST")
                return
            if operation == "agent_debug":
                handle_agent_debug(self, "POST")
                return
            if operation == "agent_trace":
                handle_agent_trace(self, "POST")
                return
            if not require_page_access(self, "dashboard"):
                return
            self.handle_chat_stream()
            return
        self.send_error(404)

    def handle_llm_classify(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 2048:
            self.send_json(400, {"ok": False, "error": "Request body is too large"})
            return
        try:
            body = _read_json_body(self)
        except (ValueError, Exception):
            self.send_json(400, {"ok": False, "error": "Invalid JSON body"})
            return
        prompt = str(body.get("prompt") or "").strip()
        if not prompt:
            self.send_json(400, {"ok": False, "error": "prompt is required"})
            return
        categories = body.get("categories") or []
        if not isinstance(categories, list):
            categories = []
        result = classify_intent(prompt, categories)
        if result is None:
            self.send_json(200, {"intent": None, "params": None})
        else:
            self.send_json(200, result)

    def handle_llm_analyze(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 16384:
            self.send_json(400, {"ok": False, "error": "Request body is too large"})
            return
        try:
            body = _read_json_body(self)
        except (ValueError, Exception):
            self.send_json(400, {"ok": False, "error": "Invalid JSON body"})
            return

        summary = body.get("summary")
        if not isinstance(summary, dict):
            self.send_json(400, {"ok": False, "error": "summary must be a JSON object"})
            return
        language = str(body.get("language") or "en").strip()
        if language not in ("en", "zh"):
            language = "en"
        text = generate_analysis_text(summary, language)
        if text is None:
            self.send_json(200, {"ok": False, "error": "LLM analysis unavailable"})
        else:
            self.send_json(200, {"ok": True, "text": text})

    def handle_chat_stream(self):
        """SSE streaming endpoint for Chat Mode LLM conversation."""
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > AGENT_SYNTHESIS_MAX_REQUEST_BYTES:
            self.send_json(400, {"ok": False, "error": "Request body is too large"})
            return
        try:
            body = _read_json_body(self, max_size=AGENT_SYNTHESIS_MAX_REQUEST_BYTES)
        except (ValueError, Exception):
            self.send_json(400, {"ok": False, "error": "Invalid JSON body"})
            return
        if not isinstance(body, dict):
            self.send_json(400, {"ok": False, "error": "JSON body must be an object"})
            return

        if body.get("contractVersion") == AGENT_CONTRACT_VERSION:
            request, error = validate_synthesis_request(body)
            if error:
                self.send_json(int(error.get("status") or 400), public_agent_error_payload(error))
                return
            validated_results, error = validate_bound_tool_results(request)
            if error:
                self.send_json(int(error.get("status") or 400), public_agent_error_payload(error))
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
            self.send_json(
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

        language = str(body.get("language") or "zh").strip()
        if language not in ("en", "zh"):
            language = "zh"

        prompt = str(body.get("prompt") or "").strip()
        if not prompt:
            self.send_json(400, {"ok": False, "error": "prompt is required"})
            return
        memory = str(body.get("memory") or "").strip() or None
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
            self.send_header("X-Accel-Buffering", "no")  # disable nginx buffering
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

    def send_db_error(self, error):
        payload = public_error_payload(error)
        status = int(payload.pop("status", 502))
        self.send_json(status, payload)

    def handle_db_ui_api(self, parsed):
        query = parse_qs(parsed.query)
        try:
            if parsed.path == "/api/ui/db/status":
                self.send_json(200, status_payload(month=first_query_value(query, "month")))
                return

            if parsed.path == "/api/ui/db/merchant":
                merchant_id = first_query_value(query, "merchantId")
                if not merchant_id:
                    self.send_json(400, {"ok": False, "error": "merchantId is required"})
                    return
                if not DIGITS_RE.match(merchant_id):
                    self.send_json(400, {"ok": False, "error": "merchantId must be numeric"})
                    return
                if merchant_id not in set(read_static_merchant_ids()):
                    self.send_json(404, {"ok": False, "error": "merchantId is not in the public snapshot"})
                    return
                limit = int_query_value(query, "limit", 20, 1, 50)
                months = int_query_value(query, "months", 12, 1, 24)
                minimal = first_query_value(query, "minimal", "").lower() in {"1", "true", "yes"}
                try:
                    payload = merchant_payload(merchant_id, product_limit=limit, months=months, minimal=minimal)
                except (OfferDbConfigError, OfferDbError) as e:
                    self.send_json(200, {
                        "ok": False,
                        "error": str(e),
                        "merchantId": merchant_id,
                        "merchant": None,
                        "products": [],
                        "monthlyAmazonMetrics": [],
                        "monthlyAggregateMetrics": [],
                    })
                    return
                self.send_json(200, payload)
                return

            if parsed.path == "/api/ui/db/search":
                text = first_query_value(query, "q")
                limit = int_query_value(query, "limit", 15, 1, 25)
                if len(text) < 2:
                    self.send_json(200, {"ok": True, "query": text, "results": []})
                    return
                public_ids = set(read_static_merchant_ids())
                payload = search_payload(text, limit=max(50, limit * 4))
                payload["results"] = [
                    row for row in payload.get("results", [])
                    if str(row.get("merchantId") or "") in public_ids
                ][:limit]
                self.send_json(200, payload)
                return

            if parsed.path == "/api/ui/db/offers":
                force = first_query_value(query, "refresh") == "1"
                self.send_json(200, offers_payload(
                    month=first_query_value(query, "month") or None,
                    start_date=first_query_value(query, "start_date") or None,
                    end_date=first_query_value(query, "end_date") or None,
                    force_refresh=force,
                ))
                return

            if parsed.path == "/api/ui/db/chatbot-offers":
                self.send_json(200, chatbot_offers_payload())
                return

            if parsed.path in {"/api/ui/db/tier-sheet", "/api/ui/db/tier_sheet"}:
                tier = first_query_value(query, "tier")
                if not tier:
                    self.send_json(400, {"ok": False, "error": "tier is required (e.g. Tier+1, Tier+2, ...)"})
                    return
                self.send_json(200, tier_sheet_payload(
                    tier,
                    month=first_query_value(query, "month") or None,
                    start_date=first_query_value(query, "start_date") or None,
                    end_date=first_query_value(query, "end_date") or None,
                    compact=first_query_value(query, "compact").lower() in {"1", "true", "yes"},
                ))
                return

            if parsed.path == "/api/ui/db/keywords":
                force = first_query_value(query, "refresh") == "1"
                self.send_json(200, product_keywords_payload(force_refresh=force))
                return

            if parsed.path == "/api/ui/db/tier-summary":
                self.send_json(200, tier_summary_payload(
                    month=first_query_value(query, "month") or None,
                ))
                return

            if parsed.path == "/api/ui/db/tier1-merchants":
                action = first_query_value(query, "action", "additions").lower()
                if action == "search":
                    self.send_json(200, tier1_merchant_search_payload(
                        first_query_value(query, "q"),
                        limit=int_query_value(query, "limit", 10, 1, 25),
                    ))
                    return
                if action == "additions":
                    self.send_json(200, tier1_additions_payload(
                        limit=int_query_value(query, "limit", 100, 1, 250),
                    ))
                    return
                self.send_json(400, {"ok": False, "error": "Unsupported Tier 1 merchant action"})
                return

            if parsed.path == "/api/ui/db/monthly-new-merchants":
                self.send_json(200, monthly_new_merchants_payload(
                    first_query_value(query, "month") or None,
                ))
                return

            if parsed.path == "/api/ui/db/publishers":
                user_id = first_query_value(query, "userId")
                if user_id:
                    self.send_json(200, publisher_portfolio_payload(
                        user_id,
                        start_date=first_query_value(query, "startDate") or None,
                        end_date=first_query_value(query, "endDate") or None,
                    ))
                else:
                    force = first_query_value(query, "refresh") == "1"
                    self.send_json(200, publishers_payload(force_refresh=force))
                return

            if parsed.path == "/api/ui/db/brand-media-sankey":
                merchant_ids = first_query_value(query, "merchantIds") or first_query_value(query, "merchantId")
                if not merchant_ids:
                    self.send_json(400, {"ok": False, "error": "merchantIds is required"})
                    return
                self.send_json(200, brand_media_sankey_payload(
                    merchant_ids,
                    start_date=first_query_value(query, "startDate") or None,
                    end_date=first_query_value(query, "endDate") or None,
                ))
                return

            if parsed.path == "/api/ui/db/brand-media-trend":
                merchant_id = first_query_value(query, "merchantId")
                if not merchant_id:
                    self.send_json(400, {"ok": False, "error": "merchantId is required"})
                    return
                self.send_json(200, brand_media_trend_payload(
                    merchant_id,
                    start_date=first_query_value(query, "startDate") or None,
                    end_date=first_query_value(query, "endDate") or None,
                ))
                return

            if parsed.path == "/api/ui/db/google-ads-workbench":
                user_id = int_query_value(
                    query,
                    "userId",
                    DEFAULT_WORKBENCH_USER_ID,
                    1,
                    2_147_483_647,
                )
                try:
                    self.send_json(200, google_ads_workbench_payload(
                        user_id,
                        start_date=first_query_value(query, "startDate") or None,
                        end_date=first_query_value(query, "endDate") or None,
                        force_refresh=first_query_value(query, "refresh").lower()
                        in {"1", "true", "yes"},
                    ))
                except GoogleAdsConfigError:
                    self.send_json(503, {
                        "ok": False,
                        "error": "Google Ads connection is not configured",
                    })
                except GoogleAdsApiError:
                    self.send_json(502, {
                        "ok": False,
                        "error": "Google Ads metrics are temporarily unavailable",
                    })
                return
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": str(error)})
            return
        except Exception as error:
            self.send_db_error(error)
            return

        self.send_json(404, {"ok": False, "error": "Unknown DB UI endpoint"})

    def handle_tier1_merchant_add(self):
        try:
            body = _read_json_body(self)
            user = current_user_for_target(self) or {}
            result = add_merchant_to_tier1(
                str(body.get("merchantId") or ""),
                updated_by=str(user.get("username") or "offer-intelligence-ui"),
                expected_tier=str(body.get("expectedTier") or ""),
            )
            if result.get("ok"):
                result["additions"] = tier1_additions_payload(limit=250).get("additions", [])
                self.send_json(200, result)
                return
            status = 404 if result.get("code") == "merchant_not_found" else 409
            self.send_json(status, result)
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"ok": False, "error": "Invalid Tier 1 merchant request"})
        except Exception as error:
            self.send_db_error(error)

    def handle_monthly_new_merchants_write(self):
        try:
            body = _read_json_body(self)
            user = current_user_for_target(self) or {}
            actor = str(user.get("username") or "offer-intelligence-ui")
            action = str(body.get("action") or "upsert").strip().lower()
            if action == "upsert":
                result = upsert_monthly_new_merchant(body, updated_by=actor)
            elif action == "delete":
                result = delete_monthly_new_merchant(
                    body.get("recordId"),
                    deleted_by=actor,
                )
            else:
                self.send_json(400, {
                    "ok": False,
                    "error": "Unsupported monthly new merchant action",
                })
                return

            if result.get("ok"):
                self.send_json(200, result)
                return
            status = 404 if result.get("code") == "record_not_found" else 409
            self.send_json(status, result)
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {
                "ok": False,
                "error": str(error) or "Invalid monthly new merchant request",
            })
        except Exception as error:
            self.send_db_error(error)

    def handle_payments_api(self, parsed):
        api_key = os.environ.get("LEVANTA_API_KEY", "").strip()
        if not api_key:
            self.send_json(503, {"ok": False, "source": "fallback", "error": "LEVANTA_API_KEY is not configured"})
            return
        query = parse_qs(parsed.query)
        months = months_from_query(query)
        marketplaces = marketplaces_from_query(query)
        records = []
        try:
            for month_name, zero_based_month, year in months:
                for item, marketplace in fetch_invoice_items_for_marketplaces(zero_based_month, year, api_key, marketplaces):
                    records.append(normalize_invoice_item(item, month_name, zero_based_month, year, marketplace))
        except HTTPError as error:
            body = error.read().decode("utf-8", "replace")[:500]
            self.send_json(error.code, {"ok": False, "source": "levanta-api", "error": body})
            return
        except (URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            self.send_json(502, {"ok": False, "source": "levanta-api", "error": str(error)})
            return

        records = [record for record in with_pending_placeholders(records, months) if is_trackable_payment_record(record)]

        self.send_json(
            200,
            {
                "ok": True,
                "source": "levanta-api",
                "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                "marketplaces": marketplaces,
                "records": records,
                "summary": payment_summary(records),
            },
        )

    def handle_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        target = (STATIC_DIR / path.lstrip("/")).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve())) or not target.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        body = target.read_bytes()
        accepts_gzip = "gzip" in self.headers.get("Accept-Encoding", "")
        should_compress = accepts_gzip and (
            content_type.startswith("text/")
            or content_type in {
                "application/javascript",
                "application/json",
                "application/x-javascript",
            }
            or target.suffix in {".js", ".css", ".html", ".json"}
        )
        if should_compress:
            body = gzip.compress(body, compresslevel=6)
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        if content_type == "text/html":
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        if should_compress:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, OSError):
            pass  # client disconnected — harmless

    def log_message(self, fmt, *args):
        return


def _warm_cache():
    """Pre-warm the offers + keywords cache in background on startup."""
    try:
        print("Pre-warming offer cache from DB ...", flush=True)
        offers_payload()
        print("Offers cache ready.", flush=True)
        product_keywords_payload()
        print("Keywords cache ready.", flush=True)
    except Exception as exc:
        print(f"Cache warm skipped (DB not available): {exc}", flush=True)


def main():
    port = int(os.environ.get("PORT", "8765"))
    import threading
    threading.Thread(target=_warm_cache, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Offer chatbot server listening on http://127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
