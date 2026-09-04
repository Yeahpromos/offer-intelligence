"""Authenticated, explicit conversation case uploads for Agent regression replay."""
from __future__ import annotations

import json
import uuid
from urllib.parse import parse_qs, urlparse

from auth import _read_json_body, require_page_access, send_json
from offer_db import db_connection

MAX_BYTES = 512 * 1024
TABLE = "cnpscy_oi_agent_debug_cases"
TABLE_DDL = """CREATE TABLE IF NOT EXISTS cnpscy_oi_agent_debug_cases (
  caseId CHAR(36) NOT NULL PRIMARY KEY,
  payload MEDIUMTEXT NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"""


def _text(value, limit):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError("Invalid log text")
    return value


def _memory(value):
    value = value if isinstance(value, dict) else {}
    focus = value.get("focus") if isinstance(value.get("focus"), dict) else {}
    query = value.get("query") if isinstance(value.get("query"), dict) else {}
    tool = value.get("lastTool") if isinstance(value.get("lastTool"), dict) else {}
    def strings(values):
        return [str(v)[:160] for v in values[:20] if isinstance(v, str)] if isinstance(values, list) else []
    def entities(values):
        return [{k: str(v[k])[:160] for k in ("id", "name") if isinstance(v.get(k), (str, int))} for v in values[:20] if isinstance(v, dict)] if isinstance(values, list) else []
    candidates = value.get("candidates") if isinstance(value.get("candidates"), dict) else {}
    return {"version": 1, "updatedAt": str(value.get("updatedAt") or "")[:40],
            "focus": {"merchants": entities(focus.get("merchants")), "categories": strings(focus.get("categories")), "tiers": strings(focus.get("tiers"))},
            "query": {"startMonth": query.get("startMonth")[:7] if isinstance(query.get("startMonth"), str) else None,
                      "endMonth": query.get("endMonth")[:7] if isinstance(query.get("endMonth"), str) else None,
                      "months": query.get("months") if type(query.get("months")) is int and 2 <= query["months"] <= 24 else None,
                      "metrics": strings(query.get("metrics"))},
            "lastTool": {k: (v[:320] if isinstance(v, str) else v) for k, v in tool.items() if k in {"toolName", "headline", "dataSource", "dataAsOf", "estimated", "partial"} and isinstance(v, (str, bool, type(None)))} or None,
            "candidates": {key: [{**entity, "type": item.get("type")} for item in candidates.get(key, [])[:20] if isinstance(item, dict) and item.get("type") in {"merchant", "category", "tier"} for entity in entities([item])] if isinstance(candidates.get(key), list) else [] for key in ("pending", "confirmed", "rejected")}}


def normalize_log(body):
    if not isinstance(body, dict) or body.get("version") != 1:
        raise ValueError("Unsupported log version")
    turns = body.get("turns")
    if not isinstance(turns, list) or not 1 <= len(turns) <= 10:
        raise ValueError("A log needs 1 to 10 turns")
    cleaned = []
    for turn in turns:
        if not isinstance(turn, dict) or turn.get("language") not in {"zh", "en"} or turn.get("status") not in {"done", "error", "stopped"}:
            raise ValueError("Invalid turn")
        history, steps = turn.get("history"), turn.get("steps")
        if not isinstance(history, list) or len(history) > 40 or not isinstance(steps, list) or len(steps) > 64:
            raise ValueError("Invalid history or steps")
        messages = []
        for item in history:
            if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}:
                raise ValueError("Invalid history role")
            messages.append({"role": item["role"], "content": _text(item.get("content"), 24000)})
        timeline = []
        for step in steps:
            if not isinstance(step, dict):
                raise ValueError("Invalid step")
            timeline.append({key: _text(step[key], limit) for key, limit in {"id": 128, "phase": 20, "status": 20, "label": 160, "detail": 320, "dataSource": 32, "dataAsOf": 80}.items() if step.get(key) is not None})
        cleaned.append({"prompt": _text(turn.get("prompt"), 16000), "language": turn["language"], "history": messages,
                        "memory": _memory(turn.get("memory")), "response": _text(turn.get("response"), 64000),
                        "status": turn["status"], "errorCode": _text(turn.get("errorCode", ""), 80), "steps": timeline})
    result = {"version": 1, "turns": cleaned}
    if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > MAX_BYTES:
        raise ValueError("Log is too large")
    return result


def handle_agent_debug(target, method):
    if method not in {"GET", "POST"}:
        send_json(target, 405, {"ok": False, "error": "Method not allowed"})
        return
    if not require_page_access(target, "agent"):
        return
    try:
        if method == "POST":
            size = int(target.headers.get("Content-Length") or 0)
            if not 0 < size <= MAX_BYTES:
                raise ValueError("Log is too large")
            log = normalize_log(_read_json_body(target, max_size=MAX_BYTES))
            case_id = str(uuid.uuid4())
        else:
            case_id = str(uuid.UUID((parse_qs(urlparse(target.path).query).get("id") or [""])[0]))
    except (ValueError, TypeError, KeyError, AttributeError):
        send_json(target, 400, {"ok": False, "error": "Invalid conversation log"})
        return
    try:
        with db_connection() as conn:
            with conn.cursor() as cursor:
                if method == "POST":
                    cursor.execute(TABLE_DDL)
                    cursor.execute(f"INSERT INTO {TABLE} (caseId, payload) VALUES (%s, %s)", (case_id, json.dumps(log, ensure_ascii=False)))
                    conn.commit()
                else:
                    cursor.execute(f"SELECT payload FROM {TABLE} WHERE caseId = %s", (case_id,))
                    row = cursor.fetchone()
                    if row is None:
                        send_json(target, 404, {"ok": False, "error": "Case not found"})
                        return
                    log = json.loads(row["payload"] if isinstance(row, dict) else row[0])
    except Exception:
        send_json(target, 502, {"ok": False, "error": "Conversation log storage is unavailable"})
        return
    send_json(target, 200, {"ok": True, "id": case_id, **({"log": log} if method == "GET" else {})})
