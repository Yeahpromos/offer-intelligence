#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter, OrderedDict
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path("/Users/bryansaputra/Downloads/brand and asins t1-t3 (1).xlsx")
DEFAULT_CSV = ROOT / "data" / "product_name_keywords_t1_t3.csv"
DEFAULT_JS = ROOT / "protected_data" / "product_keywords.js"

REQUIRED_COLUMNS = ["商家ID", "商家", "产品ASIN", "产品名称"]
WORD_RE = re.compile(r"[a-z0-9]+")

STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "your",
    "you",
    "our",
    "their",
    "his",
    "her",
    "its",
    "are",
    "was",
    "were",
    "has",
    "have",
    "had",
    "into",
    "onto",
    "plus",
    "pack",
    "packs",
    "set",
    "sets",
    "piece",
    "pieces",
    "pcs",
    "count",
    "counts",
    "size",
    "sizes",
    "small",
    "medium",
    "large",
    "black",
    "white",
    "grey",
    "gray",
    "blue",
    "red",
    "green",
    "pink",
    "brown",
    "beige",
    "silver",
    "gold",
    "clear",
    "new",
    "men",
    "women",
    "mens",
    "womens",
    "adult",
    "adults",
    "kid",
    "kids",
    "boy",
    "boys",
    "girl",
    "girls",
    "amazon",
}


def clean_text(value: object) -> str:
    text = "" if value is None else str(value)
    if text.lower() == "nan":
        return ""
    return re.sub(r"\s+", " ", text).strip()


def merchant_key(value: object) -> str:
    return clean_text(value).removesuffix(".0")


def normalize_brand(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", clean_text(value).lower().replace("&", "and"))


def unique_preserve(values: list[str], limit: int | None = None) -> list[str]:
    seen: OrderedDict[str, str] = OrderedDict()
    for value in values:
        text = clean_text(value)
        if not text:
            continue
        key = text.lower()
        if key not in seen:
            seen[key] = text
    output = list(seen.values())
    return output[:limit] if limit else output


def singular_token(token: str) -> str:
    return token.lower()


def title_tokens(title: str, brand_tokens: set[str]) -> list[str]:
    tokens = []
    for raw in WORD_RE.findall(title.lower().replace("&", "and")):
        token = singular_token(raw)
        if token in brand_tokens or token in STOPWORDS:
            continue
        if token.isdigit():
            continue
        if len(token) < 3 and not any(ch.isdigit() for ch in token):
            continue
        tokens.append(token)
    return tokens


def keyword_list(product_names: list[str], merchant_name: str, max_keywords: int) -> list[str]:
    brand_tokens = set(title_tokens(merchant_name, set()))
    unigram_counts: Counter[str] = Counter()
    phrase_counts: Counter[str] = Counter()
    for name in product_names:
        tokens = title_tokens(name, brand_tokens)
        unigram_counts.update(tokens)
        for size in (2, 3):
            for index in range(0, max(0, len(tokens) - size + 1)):
                phrase = " ".join(tokens[index : index + size])
                if phrase:
                    phrase_counts[phrase] += 1

    phrase_threshold = 2 if len(product_names) > 10 else 1
    phrases = [
        phrase
        for phrase, count in sorted(phrase_counts.items(), key=lambda item: (-item[1], -len(item[0]), item[0]))
        if count >= phrase_threshold
    ]
    unigrams = [
        token
        for token, count in sorted(unigram_counts.items(), key=lambda item: (-item[1], item[0]))
        if count >= 1
    ]
    return unique_preserve(phrases + unigrams, max_keywords)


def load_rows(source: Path, max_keywords: int, max_titles: int, max_asins: int) -> list[dict]:
    frame = pd.read_excel(source, sheet_name=0, dtype=str)
    missing = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")

    rows = []
    grouped = frame.groupby(["商家ID", "商家"], dropna=False, sort=False)
    for (merchant_id, merchant_name), group in grouped:
        product_names = unique_preserve(group["产品名称"].map(clean_text).tolist())
        product_asins = unique_preserve(group["产品ASIN"].map(clean_text).tolist())
        merchant_id = merchant_key(merchant_id)
        merchant_name = clean_text(merchant_name)
        if not merchant_id and not merchant_name:
            continue
        if not product_names:
            continue
        rows.append(
            {
                "merchantId": merchant_id,
                "merchantName": merchant_name,
                "brandKey": normalize_brand(merchant_name),
                "productNameCount": len(product_names),
                "productAsinCount": len(product_asins),
                "productAsins": product_asins[:max_asins],
                "productTitles": product_names[:max_titles],
                "productKeywords": keyword_list(product_names, merchant_name, max_keywords),
            }
        )
    return rows


def write_csv(rows: list[dict], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "merchantId",
                "merchantName",
                "brandKey",
                "productNameCount",
                "productAsinCount",
                "productAsins",
                "productTitles",
                "productKeywords",
            ],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    **row,
                    "productAsins": " | ".join(row["productAsins"]),
                    "productTitles": " | ".join(row["productTitles"]),
                    "productKeywords": " | ".join(row["productKeywords"]),
                }
            )


def write_js(rows: list[dict], output: Path, source: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "summary": {
            "source": source.name,
            "merchantCount": len(rows),
            "productNameCount": sum(row["productNameCount"] for row in rows),
            "productAsinCount": sum(row["productAsinCount"] for row in rows),
        },
        "merchants": rows,
    }
    output.write_text(
        f"window.PRODUCT_KEYWORDS={json.dumps(payload, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract product-name keywords from the brand/ASIN workbook.")
    parser.add_argument("--source", default=str(DEFAULT_SOURCE), help="Input .xlsx path containing 商家ID/商家/产品ASIN/产品名称.")
    parser.add_argument("--csv-output", default=str(DEFAULT_CSV), help="Aggregated CSV output path.")
    parser.add_argument("--js-output", default=str(DEFAULT_JS), help="Browser payload output path.")
    parser.add_argument("--max-keywords", type=int, default=220, help="Maximum product keywords per merchant.")
    parser.add_argument("--max-titles", type=int, default=12, help="Maximum representative product titles per merchant.")
    parser.add_argument("--max-asins", type=int, default=30, help="Maximum product ASINs per merchant.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = Path(args.source).expanduser()
    rows = load_rows(source, args.max_keywords, args.max_titles, args.max_asins)
    write_csv(rows, Path(args.csv_output))
    write_js(rows, Path(args.js_output), source)
    print(
        json.dumps(
            {
                "merchantCount": len(rows),
                "productNameCount": sum(row["productNameCount"] for row in rows),
                "productAsinCount": sum(row["productAsinCount"] for row in rows),
                "csvOutput": str(Path(args.csv_output)),
                "jsOutput": str(Path(args.js_output)),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
