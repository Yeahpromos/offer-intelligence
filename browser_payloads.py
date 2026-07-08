from __future__ import annotations

import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_BROWSER_PAYLOAD_DIR = ROOT / "protected_data"
BROWSER_PAYLOAD_DIR = Path(os.environ.get("OI_BROWSER_PAYLOAD_DIR", DEFAULT_BROWSER_PAYLOAD_DIR)).resolve()

BROWSER_PAYLOADS = {
    "chatbot_data.js": "application/javascript; charset=utf-8",
    "sheet_report_data.js": "application/javascript; charset=utf-8",
    "product_keywords.js": "application/javascript; charset=utf-8",
}


def browser_payload_path(name: str) -> Path:
    clean_name = str(name or "").strip().split("/")[-1].split("\\")[-1]
    if clean_name not in BROWSER_PAYLOADS:
        raise ValueError("Unknown browser payload")
    path = (BROWSER_PAYLOAD_DIR / clean_name).resolve()
    if not str(path).startswith(str(BROWSER_PAYLOAD_DIR)):
        raise ValueError("Unsafe browser payload path")
    return path


def read_browser_payload(name: str) -> str:
    return browser_payload_path(name).read_text(encoding="utf-8")
