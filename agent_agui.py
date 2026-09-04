"""AG-UI wire adapter for the existing Offer Intelligence Agent contracts.

CopilotKit owns transport and continuation.  Python remains authoritative for
planning, the tool registry, plan proofs, result binding, replanning, and final
synthesis.  Browser tools receive only canonical calls already covered by a
proof and return the same bounded v2 projections used by the legacy runner.
"""

from __future__ import annotations

import hmac
import json
import os
import re
import time
from typing import Any, Callable, Iterable

from agent_contract import (
    AGENT_CONTRACT_VERSION,
    AGENT_MAX_TOOL_CALLS,
    build_synthesis_messages,
    public_agent_error_payload,
    validate_bound_tool_results,
    validate_synthesis_request,
)
from agent_tool_registry import AGENT_TOOL_NAMES
from chat_agent_http import (
    AGENT_SYNTHESIS_MAX_TOKENS,
    agent_synthesis_system_prompt,
    plan_agent_request,
)
from llm_provider import stream_chat
from auth import _read_json_body, require_page_access, send_json


AGUI_MAX_REQUEST_BYTES = 128 * 1024
AGUI_BATCH_SIZE = 4
AGUI_STATE_VERSION = 1
INTERNAL_TOKEN_HEADER = "X-OI-Copilot-Token"
_DATA_PATTERN = re.compile(
    r"当前|最新|最近|本月|上月|多少|数值|数据|查询|统计|列出|展示|提供|每个|分别|哪些|名单|列表|排名|"
    r"top\s*\d+|分析|表现|趋势|付款|收入|销售额|订单|点击|佣金|商户|商家|品牌|品类|tier|payment|"
    r"revenue|sales|orders|clicks|trend|epc|aov|cvr|merchant|category",
    re.I,
)
_CONCEPT_PATTERN = re.compile(r"什么是|是什么意思|定义|含义|解释|如何计算|怎么算|怎么计算|what is|meaning|definition|how to calculate", re.I)
_CONCRETE_PATTERN = re.compile(r"多少|数值|数据|查询|统计|列出|展示|提供|每个|分别|哪些|名单|列表|排名|top\s*\d+", re.I)


def _text(value: Any, maximum: int) -> str:
    return str(value or "").strip()[:maximum]


def _event(event_type: str, **payload: Any) -> dict[str, Any]:
    return {"type": event_type, **payload}


def _timeline(step_id: str, phase: str, status: str, label: str, detail: str = "") -> dict[str, Any]:
    return _event(
        "CUSTOM",
        name="oi.timeline",
        value={
            "step": {
                "id": _text(step_id, 128),
                "phase": phase,
                "status": status,
                "label": _text(label, 160),
                "detail": _text(detail, 320),
            }
        },
    )


def _state(body: dict) -> dict:
    raw = body.get("state")
    if not isinstance(raw, dict):
        return {}
    value = raw.get("offerIntelligence")
    return value if isinstance(value, dict) and value.get("version") == AGUI_STATE_VERSION else {}


def _messages(body: dict) -> list[dict]:
    return [item for item in body.get("messages", []) if isinstance(item, dict)][:80]


def _message_content(item: dict, maximum: int = 12000) -> str:
    content = item.get("content")
    if isinstance(content, str):
        return _text(content, maximum)
    if isinstance(content, list):
        parts = []
        for value in content:
            if isinstance(value, dict) and value.get("type") in {"text", "text_message"}:
                parts.append(_text(value.get("text") or value.get("content"), maximum))
        return _text("\n".join(filter(None, parts)), maximum)
    return ""


def _last_user_question(messages: list[dict]) -> str:
    for item in reversed(messages):
        if item.get("role") == "user":
            return _message_content(item, 4000)
    return ""


def _history(messages: list[dict], question: str) -> list[dict]:
    clean = []
    skipped_current = False
    for item in reversed(messages):
        role = item.get("role")
        content = _message_content(item, 1200)
        if role == "user" and not skipped_current and content == question:
            skipped_current = True
            continue
        if role in {"user", "assistant"} and content:
            clean.append({"role": role, "content": content})
        if len(clean) >= 4:
            break
    return list(reversed(clean))


def _planning_fallback(body: dict, planning: dict) -> Iterable[dict]:
    # The shared browser policy chooses missing-data, direct text, or the
    # existing /api/chat/stream fallback using its original history/context.
    yield _event("CUSTOM", name="oi.planning_fallback", value={
        "content": _text(planning.get("content"), 8000),
    })
    yield _run_finished(body, {"status": "direct", "authority": "python-registry"})


def _requires_verifiable_data(question: str) -> bool:
    if not question:
        return False
    if _CONCEPT_PATTERN.search(question) and not _CONCRETE_PATTERN.search(question):
        return False
    return bool(_DATA_PATTERN.search(question))


def _missing_data_text(language: str) -> str:
    if language == "en":
        return "I do not have a verifiable data source for this specific question yet. Please add a merchant, time range, and metric, or retry the lookup."
    return "当前没有可验证的数据来源，无法直接给出具体数据结论。请补充商户、时间范围和指标，或重试以执行数据查询。"


def _run_started(body: dict) -> dict:
    return _event(
        "RUN_STARTED",
        threadId=_text(body.get("threadId"), 128) or "oi-thread",
        runId=_text(body.get("runId"), 128) or "oi-run",
    )


def _run_finished(body: dict, result: Any = None) -> dict:
    return _event(
        "RUN_FINISHED",
        threadId=_text(body.get("threadId"), 128) or "oi-thread",
        runId=_text(body.get("runId"), 128) or "oi-run",
        result=result,
        outcome={"type": "success"},
    )


def _text_events(message_id: str, text: str) -> list[dict]:
    if not text:
        return []
    return [
        _event("TEXT_MESSAGE_START", messageId=message_id, role="assistant"),
        _event("TEXT_MESSAGE_CONTENT", messageId=message_id, delta=text),
        _event("TEXT_MESSAGE_END", messageId=message_id),
    ]


def _snapshot(value: dict) -> dict:
    return _event("STATE_SNAPSHOT", snapshot={"offerIntelligence": value})


def _public_state(
    *,
    question: str,
    language: str,
    memory: str,
    history: list[dict],
    planning: dict,
    proofs: list[str] | None = None,
    calls: list[dict] | None = None,
    round_number: int = 1,
    status: str = "tools",
    legacy_parity: bool = False,
) -> dict:
    return {
        "version": AGUI_STATE_VERSION,
        "status": status,
        "question": _text(question, 4000),
        "language": language,
        "memory": _text(memory, 8000),
        "history": history[-4:],
        "agentRunId": _text(planning.get("agentRunId"), 128),
        "planProofs": list(proofs or ([planning.get("planProof")] if planning.get("planProof") else []))[:2],
        "calls": list(calls or planning.get("toolCalls") or [])[:AGENT_MAX_TOOL_CALLS],
        "round": round_number,
        "legacyParity": legacy_parity,
    }


def _tool_result_messages(messages: list[dict], calls: list[dict]) -> tuple[list[dict], list[dict]]:
    canonical = {str(call.get("id")): call for call in calls if isinstance(call, dict)}
    results: dict[str, dict] = {}
    ui_events: list[dict] = []
    for message in messages:
        if message.get("role") != "tool":
            continue
        call_id = _text(message.get("toolCallId") or message.get("tool_call_id"), 128)
        call = canonical.get(call_id)
        if not call or call_id in results:
            continue
        try:
            parsed = json.loads(_message_content(message, 80000))
        except (TypeError, ValueError, json.JSONDecodeError):
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}
        projection = parsed.get("toolResult") if isinstance(parsed.get("toolResult"), dict) else parsed
        raw_result = projection.get("result") if isinstance(projection, dict) else None
        if not isinstance(raw_result, dict):
            raw_result = {
                "ok": False,
                "source": {"dataSource": "unavailable", "dataAsOf": None, "estimated": False},
                "errorCode": "tool_error",
            }
        results[call_id] = {
            "callId": call_id,
            "toolName": call.get("name"),
            "arguments": call.get("arguments"),
            "result": raw_result,
        }
        for name, key in (("oi.memory", "memoryEvent"), ("oi.result_view", "resultView")):
            if parsed.get(key) is not None:
                ui_events.append(_event("CUSTOM", name=name, value=parsed[key]))
    ordered = [results[str(call.get("id"))] for call in calls if str(call.get("id")) in results]
    return ordered, ui_events


def _emit_tool_batch(calls: list[dict]) -> list[dict]:
    events = []
    for call in calls[:AGUI_BATCH_SIZE]:
        call_id = _text(call.get("id"), 128)
        name = _text(call.get("name"), 64)
        events.extend([
            _timeline(call_id, "tool", "running", name, "Python registry approved this call"),
            _event("TOOL_CALL_START", toolCallId=call_id, toolCallName=name),
            _event("TOOL_CALL_ARGS", toolCallId=call_id, delta=json.dumps(call.get("arguments") or {}, ensure_ascii=False, separators=(",", ":"))),
            _event("TOOL_CALL_END", toolCallId=call_id),
        ])
    return events


def _planning_events(body: dict, request_bytes: int, state_seed: dict) -> Iterable[dict]:
    question = _last_user_question(_messages(body))
    language = "en" if state_seed.get("language") == "en" else "zh"
    memory = _text(state_seed.get("memory"), 8000)
    history = state_seed.get("history")
    if not isinstance(history, list):
        history = _history(_messages(body), question)
    history = [
        {"role": item["role"], "content": _text(item.get("content"), 1200)}
        for item in history if isinstance(item, dict) and item.get("role") in {"user", "assistant"}
    ][-4:]
    yield _timeline("planning", "planning", "running", "Planning", "Python registry is selecting read-only tools")
    status, planning = plan_agent_request({
        "contractVersion": AGENT_CONTRACT_VERSION,
        "question": question,
        "language": language,
        "enabledTools": list(AGENT_TOOL_NAMES),
    }, request_bytes)
    if status != 200 or planning.get("ok") is not True:
        code = _text(planning.get("errorCode"), 80) or "agent_planning_unavailable"
        yield _timeline("planning", "planning", "error", "Planning failed", code)
        if state_seed.get("legacyParity") and code == "agent_planning_unavailable":
            yield from _planning_fallback(body, planning)
            return
        yield _event("RUN_ERROR", message="Agent planning is unavailable.", code=code)
        return
    yield _timeline("planning", "planning", "done", "Plan ready")
    calls = planning.get("toolCalls") if isinstance(planning.get("toolCalls"), list) else []
    if not calls:
        if state_seed.get("legacyParity"):
            yield from _planning_fallback(body, planning)
            return
        answer = _text(planning.get("content"), 8000)
        if _requires_verifiable_data(question):
            answer = _missing_data_text(language)
        message_id = "oi-direct-" + _text(body.get("runId"), 80)
        yield from _text_events(message_id, answer)
        yield _run_finished(body, {"status": "done", "authority": "python-registry"})
        return
    state = _public_state(
        question=question,
        language=language,
        memory=memory,
        history=history,
        planning=planning,
        legacy_parity=state_seed.get("legacyParity") is True,
    )
    yield _snapshot(state)
    yield from _emit_tool_batch(calls)
    yield _run_finished(body, {"status": "tools", "authority": "python-registry"})


def _continuation_events(
    body: dict,
    request_bytes: int,
    state: dict,
    stream_factory: Callable[..., Iterable[str]],
) -> Iterable[dict]:
    calls = [item for item in state.get("calls", []) if isinstance(item, dict)][:AGENT_MAX_TOOL_CALLS]
    results, ui_events = _tool_result_messages(_messages(body), calls)
    for item in results:
        result = item.get("result") or {}
        ok = result.get("ok") is True
        source = result.get("source") if isinstance(result.get("source"), dict) else {}
        step = _timeline(
            item["callId"],
            "tool",
            "done" if ok else "error",
            item["toolName"],
            "Bound tool result received" if ok else _text(result.get("errorCode"), 80),
        )
        step["value"]["step"].update({
            "dataSource": source.get("dataSource", "unknown"),
            "dataAsOf": source.get("dataAsOf"),
            "estimated": source.get("estimated") is True,
        })
        yield step
    for event in ui_events:
        yield event
    completed = {item["callId"] for item in results}
    unresolved = [call for call in calls if str(call.get("id")) not in completed]
    if unresolved:
        yield _snapshot(state)
        yield from _emit_tool_batch(unresolved)
        yield _run_finished(body, {"status": "tools", "authority": "python-registry"})
        return

    failed = [item for item in results if item.get("result", {}).get("ok") is not True]
    round_number = int(state.get("round") or 1)
    proofs = [item for item in state.get("planProofs", []) if isinstance(item, str)][:2]
    omitted_targets = list(state.get("omittedTargets") or [])[:20]
    if failed and round_number < 2 and proofs and len(calls) < AGENT_MAX_TOOL_CALLS:
        yield _timeline("replan", "planning", "running", "Replanning", "Retrying failed calls with canonical error codes")
        status, planning = plan_agent_request({
            "contractVersion": AGENT_CONTRACT_VERSION,
            "question": state.get("question"),
            "language": state.get("language"),
            "enabledTools": list(AGENT_TOOL_NAMES),
            "retry": {
                "agentRunId": state.get("agentRunId"),
                "previousPlanProof": proofs[-1],
                "failedCalls": [
                    {"callId": item["callId"], "errorCode": item["result"].get("errorCode") or "tool_error"}
                    for item in failed
                ],
            },
        }, request_bytes)
        if status == 200 and planning.get("ok") is True and planning.get("toolCalls"):
            remaining = max(0, AGENT_MAX_TOOL_CALLS - len(calls))
            retry_calls = list(planning.get("toolCalls") or [])[:remaining]
            omitted_targets.extend(
                _text((call.get("arguments") or {}).get("merchant") or (call.get("arguments") or {}).get("tier") or call.get("name"), 120)
                for call in list(planning.get("toolCalls") or [])[remaining:]
            )
            next_calls = calls + retry_calls
            next_proofs = (proofs + [planning.get("planProof")])[:2]
            next_state = _public_state(
                question=state.get("question"),
                language=state.get("language"),
                memory=state.get("memory"),
                history=state.get("history") or [],
                planning={**planning, "agentRunId": state.get("agentRunId")},
                proofs=next_proofs,
                calls=next_calls,
                round_number=2,
                legacy_parity=state.get("legacyParity") is True,
            )
            next_state["omittedTargets"] = omitted_targets[:20]
            yield _timeline("replan", "planning", "done", "Replan ready")
            yield _snapshot(next_state)
            yield from _emit_tool_batch(retry_calls)
            yield _run_finished(body, {"status": "tools", "authority": "python-registry"})
            return
        yield _timeline("replan", "planning", "error", "Replan unavailable")
        if state.get("legacyParity"):
            yield from _planning_fallback(body, planning)
            return

    yield _event("CUSTOM", name="oi.execution", value={
        "partial": bool(omitted_targets), "omittedTargets": omitted_targets,
    })

    synthesis_body = {
        "contractVersion": AGENT_CONTRACT_VERSION,
        "agentRunId": state.get("agentRunId"),
        "planProofs": proofs,
        "question": state.get("question"),
        "language": state.get("language"),
        "context": {"memory": state.get("memory") or "", "history": state.get("history") or []},
        "toolResults": results,
    }
    validated, error = validate_synthesis_request(synthesis_body)
    if error:
        payload = public_agent_error_payload(error)
        yield _event("RUN_ERROR", message="Tool result binding failed.", code=payload.get("errorCode"))
        return
    bound, error = validate_bound_tool_results(validated)
    if error:
        payload = public_agent_error_payload(error)
        yield _event("RUN_ERROR", message="Tool result binding failed.", code=payload.get("errorCode"))
        return

    yield _timeline("synthesis", "synthesis", "running", "Synthesizing", "Answering only from proof-bound results")
    message_id = "oi-synthesis-" + _text(body.get("runId"), 80)
    yield _event("TEXT_MESSAGE_START", messageId=message_id, role="assistant")
    usage: dict[str, Any] = {}

    def on_complete(metadata: dict | None) -> None:
        usage.update(metadata or {})

    for token in stream_factory(
        "",
        agent_synthesis_system_prompt(validated["language"]),
        max_tokens=AGENT_SYNTHESIS_MAX_TOKENS,
        temperature=0.1,
        messages=build_synthesis_messages(validated, bound),
        on_complete=on_complete,
    ):
        if token:
            yield _event("TEXT_MESSAGE_CONTENT", messageId=message_id, delta=str(token))
    yield _event("TEXT_MESSAGE_END", messageId=message_id)
    if usage.get("ok") is False or usage.get("errorCode"):
        code = _text(usage.get("errorCode"), 80) or "agent_synthesis_unavailable"
        yield _timeline("synthesis", "synthesis", "error", "Synthesis unavailable", code)
        yield _event("RUN_ERROR", message="Agent synthesis is unavailable.", code=code)
        return
    yield _timeline("synthesis", "synthesis", "done", "Answer ready")
    yield _run_finished(body, {
        "status": "done",
        "authority": "python-registry",
        "provider": usage.get("provider"),
        "model": usage.get("model"),
    })


def generate_agui_events(
    body: dict,
    request_bytes: int = 0,
    stream_factory: Callable[..., Iterable[str]] = stream_chat,
) -> Iterable[dict]:
    """Generate one valid AG-UI run; each path has exactly one terminal event."""
    yield _run_started(body)
    state = _state(body)
    if not state or state.get("status") not in {"tools", "replan"}:
        yield from _planning_events(body, request_bytes, state)
        return
    yield from _continuation_events(body, request_bytes, state, stream_factory)


def internal_token() -> str:
    return _text(os.environ.get("OI_COPILOT_INTERNAL_TOKEN") or os.environ.get("OI_SESSION_SECRET"), 4096)


def is_internal_request(headers: Any) -> bool:
    expected = internal_token()
    supplied = _text(headers.get(INTERNAL_TOKEN_HEADER) or headers.get(INTERNAL_TOKEN_HEADER.lower()), 4096)
    return bool(expected and supplied and hmac.compare_digest(expected, supplied))


def write_sse(target: Any, events: Iterable[dict]) -> None:
    target.send_response(200)
    target.send_header("Content-Type", "text/event-stream; charset=utf-8")
    target.send_header("Cache-Control", "no-cache, no-store")
    target.send_header("Connection", "keep-alive")
    target.send_header("X-Accel-Buffering", "no")
    target.send_header("X-OI-Agent-Authority", "python-registry")
    target.end_headers()
    for event in events:
        payload = json.dumps(event, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        target.wfile.write(("data: " + payload + "\n\n").encode("utf-8"))
        target.wfile.flush()


def handle_agui_request(target: Any, method: str) -> None:
    """Serve AG-UI from the consolidated Vercel chat function."""
    if method == "OPTIONS":
        target.send_response(204)
        target.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        target.send_header("Access-Control-Allow-Headers", "Content-Type, X-OI-Copilot-Token, X-OI-Agent-Authority")
        target.send_header("Content-Length", "0")
        target.end_headers()
        return
    if method != "POST":
        send_json(target, 405, {"ok": False, "error": "Method not allowed"})
        return
    if not is_internal_request(target.headers):
        send_json(target, 401, {"ok": False, "error": "Internal Agent authentication is required"})
        return
    if not require_page_access(target, "agent"):
        return
    length = int(target.headers.get("Content-Length") or 0)
    if length <= 0 or length > AGUI_MAX_REQUEST_BYTES:
        send_json(target, 400, {"ok": False, "error": "Request body is too large"})
        return
    try:
        body = _read_json_body(target, max_size=AGUI_MAX_REQUEST_BYTES)
    except Exception:
        send_json(target, 400, {"ok": False, "error": "Invalid JSON body"})
        return
    if not isinstance(body, dict) or not isinstance(body.get("messages"), list):
        send_json(target, 400, {"ok": False, "error": "Invalid AG-UI run input"})
        return
    try:
        write_sse(target, generate_agui_events(body, length))
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
        return
