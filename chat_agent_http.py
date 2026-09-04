"""Shared HTTP handling for the Chat Mode agent planning endpoint.

Imported by both server.py (local) and api/chat/actions.py (Vercel), following
the chatbot_question_log_http.py pattern. Callers perform the page-aware authentication check.
"""

from __future__ import annotations

from agent_contract import (
    build_planning_messages,
    create_agent_run_id,
    normalize_planning_result,
    public_agent_error_payload,
    validate_planning_request,
    verify_plan_proof,
)
from agent_tool_registry import (
    AGENT_TOOL_NAMES,
    get_agent_tool_definitions,
)
from auth import _read_json_body, send_json
from llm_provider import call_llm_tools

AGENT_MAX_REQUEST_BYTES = 64 * 1024
AGENT_SYNTHESIS_MAX_REQUEST_BYTES = 128 * 1024
AGENT_PLAN_TIMEOUT_SECONDS = 30.0
AGENT_SYNTHESIS_MAX_TOKENS = 4096
AGENT_ALLOWED_TOOL_NAMES = frozenset(AGENT_TOOL_NAMES)

PLANNING_PROMPT_ZH = (
    "你是一个亚马逊联盟营销数据分析助手，可以调用工具获取数据报告。\n"
    "规则：\n"
    "1. 只有当用户问题需要具体数据（商户、品类、Tier、对比、付款或趋势）时才调用工具；闲聊、概念问题直接回答。\n"
    "2. 相互独立的工具调用必须在同一次回复中并行给出。\n"
    "3. 多个商户只要求分别返回同一组字段时，即使一次列出多个商户，也必须为每个商户并行调用 merchant_analysis；只有用户明确要求比较、差异、优劣、排名或谁更好时才使用 merchant_comparison。\n"
    "4. 用户明确要求趋势、走势、逐月变化或趋势图时，必须调用 trend；merchant_analysis 的 monthly 只用于明细，不代替趋势分析。\n"
    "5. 从用户话语中提取工具参数；Tier 商家列表使用 tier_analysis，默认第一页最多100个商户；用户要求下一页时使用 offset/limit。\n"
    "6. 不确定商户名或品类名时仍调用工具，工具会返回\"未找到\"。\n"
    "7. 付款月份未写年份时按当前年份理解，不要根据历史数据猜年份；只有用户明确写出历史年份时才使用历史月份。不要编造数值；工具结果中的数值是最终值，直接引用。"
)

PLANNING_PROMPT_EN = (
    "You are an Amazon affiliate marketing data analysis assistant that can call tools to fetch data reports.\n"
    "Rules:\n"
    "1. Only call tools when the question needs concrete data (merchant, category, tier, comparison, payment, or trend metrics); answer chit-chat and conceptual questions directly.\n"
    "2. Independent tool calls must be issued in parallel in a single reply.\n"
    "3. When the user only asks for the same fields for multiple merchants, issue one merchant_analysis call per merchant in parallel, even when several merchants are listed. Use merchant_comparison only when the user explicitly asks for comparison, differences, ranking, or which merchant is better.\n"
    "4. When the user explicitly asks for a trend, trajectory, month-by-month change, or a trend chart, you must call trend; merchant_analysis monthly rows are detail data and do not replace trend analysis.\n"
    "5. For a Tier merchant list, use tier_analysis; it returns up to 100 merchants per page by default, and offset/limit fetch the next page.\n"
    "6. Extract tool arguments from the user's words; when unsure about a merchant or category name, still call the tool — it will report \"not found\".\n"
    "7. When a payment month has no year, use the current calendar year rather than guessing from historical rows; use a historical year only when the user explicitly says so. Never invent numbers; values in tool results are final, quote them."
)

SYNTHESIS_PROMPT_ZH = (
    "你是一个亚马逊联盟营销数据分析助手。\n"
    "对话中包含了工具（数据分析函数）的执行结果，请基于这些结果回答用户最初的问题。\n"
    "先给出结论，再用 Markdown 表格展示关键数据，表格前后用一两句话补充说明。\n"
    "merchant_analysis 结果中的 metrics 是当前缓存汇总，monthly 是真实数据库月度序列；如果 monthly 非空，必须把其中每一行都按月份展示，不能只回答最新月份。monthly 为空时才说明月度数据不可用。\n"
    "tier_analysis 结果中的 merchants 是按 Report Mode Tier 查询排序的当前商户页；必须展示用户要求的商户列表和关键指标，并结合 merchantList 的 total/offset/returned/hasMore 说明列表是否完整。hasMore 为 true 时不能声称已经列出全部商户。\n"
    "工具结果中的数值是计算好的最终值，直接引用，不要重新计算或外推新排名。\n"
    "某个工具失败时，如实说明该部分数据缺失，不得编造。"
)

SYNTHESIS_PROMPT_EN = (
    "You are an Amazon affiliate marketing data analysis assistant.\n"
    "The conversation contains tool (data analysis function) results; answer the user's original question based on them.\n"
    "Lead with the conclusion, then present key numbers in Markdown tables with one or two sentences of context.\n"
    "In merchant_analysis results, metrics is the current cached summary and monthly is the real database monthly sequence; when monthly is non-empty, display every row by month and do not answer with only the latest month. An empty monthly array is the only indication that monthly data is unavailable.\n"
    "In tier_analysis results, merchants is the current merchant page ordered like the Report Mode Tier query; show the requested merchant list and key metrics, and use merchantList total/offset/returned/hasMore to state whether the page is complete. Never claim the full Tier list when hasMore is true.\n"
    "Values in tool results are final computed values; quote them and do not recompute or extrapolate new rankings.\n"
    "When a tool failed, state plainly that this part of the data is missing; do not fabricate."
)


def agent_planning_system_prompt(language: str) -> str:
    return PLANNING_PROMPT_EN if language == "en" else PLANNING_PROMPT_ZH


def agent_synthesis_system_prompt(language: str) -> str:
    return SYNTHESIS_PROMPT_EN if language == "en" else SYNTHESIS_PROMPT_ZH


def plan_agent_request(body: object, request_bytes: int = 0) -> tuple[int, dict]:
    """Run the canonical planning contract without coupling it to an HTTP writer."""
    validated, error = validate_planning_request(body)
    if error:
        return int(error.get("status") or 400), public_agent_error_payload(error)

    language = validated["language"]
    retry = validated.get("retry")
    if retry:
        agent_run_id = retry["agentRunId"]
        previous_proof = verify_plan_proof(retry["previousPlanProof"], agent_run_id, validated["question"])
        if previous_proof is None:
            return 409, public_agent_error_payload({
                "errorCode": "run_binding_failed",
                "field": "retry.previousPlanProof",
            })
        round_number = int(previous_proof.get("round") or 1) + 1
        if round_number > 2:
            return 409, public_agent_error_payload({
                "errorCode": "run_binding_failed",
                "field": "retry",
            })
    else:
        agent_run_id = create_agent_run_id()
        round_number = 1

    request_messages = [{"role": "system", "content": agent_planning_system_prompt(language)}]
    request_messages.extend(build_planning_messages(validated, retry))
    try:
        canonical_tools = get_agent_tool_definitions(language, validated["enabledTools"])
    except ValueError:
        return 400, public_agent_error_payload({
            "errorCode": "unsupported_tool",
            "field": "enabledTools",
        })

    result = call_llm_tools(
        request_messages,
        canonical_tools,
        max_tokens=400,
        timeout=AGENT_PLAN_TIMEOUT_SECONDS,
        temperature=0.1,
        return_metadata=True,
    )
    if result is None:
        return 200, {
            "ok": False,
            "errorCode": "agent_planning_unavailable",
            "telemetry": {"inputBytes": request_bytes},
        }
    telemetry = {
        "provider": result.get("provider"),
        "model": result.get("model"),
        "usageAvailable": bool(result.get("usageAvailable")),
        "inputTokens": result.get("inputTokens"),
        "outputTokens": result.get("outputTokens"),
        "totalTokens": result.get("totalTokens"),
        "inputBytes": request_bytes,
        "errorCode": result.get("errorCode"),
    }
    if result.get("ok") is False:
        return 200, {
            "ok": False,
            "errorCode": "agent_planning_unavailable",
            "telemetry": telemetry,
        }
    normalized, normalize_error = normalize_planning_result(result, validated, agent_run_id, round_number)
    if normalize_error:
        return int(normalize_error.get("status") or 400), public_agent_error_payload(normalize_error)
    normalized["telemetry"] = telemetry
    return 200, normalized


def handle_agent_request(target) -> None:
    length = int(target.headers.get("Content-Length") or 0)
    if length <= 0 or length > AGENT_MAX_REQUEST_BYTES:
        send_json(target, 400, {"ok": False, "error": "Request body is too large"})
        return
    try:
        body = _read_json_body(target)
    except Exception:
        send_json(target, 400, {"ok": False, "error": "Invalid JSON body"})
        return
    if not isinstance(body, dict):
        send_json(target, 400, {"ok": False, "error": "JSON body must be an object"})
        return
    status, payload = plan_agent_request(body, length)
    send_json(target, status, payload)
