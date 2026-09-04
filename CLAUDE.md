# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Internal YeahPromos Amazon offer intelligence dashboard — a Python-served static frontend with a vanilla JS SPA, chatbot, payment tracking, and tier management. Deployed on Vercel as Python serverless functions.

**Chatbot**: For any chatbot work, start with `docs/chatbot-feature-report.md` — the authoritative reference for intent classification, analysis, LLM pipeline, and all related files.

## Commands

### Run locally
```bash
python server.py
# Opens at http://127.0.0.1:8765
```

**重要：完成任务后，务必关闭本地服务器** —— 关闭 `http://127.0.0.1:8765/`，不要在任务完成后让服务器继续运行。

关闭方法（二选一）：
- **前台运行**：`Ctrl+C` 终止 `server.py` 进程
- **后台运行（或残余进程）**：
  ```bash
  netstat -ano | grep 8765 | grep LISTEN
  taskkill //F //PID <进程ID>
  ```

Required env vars for full functionality: `LEVANTA_API_KEY`, `OI_AUTH_ENABLED`, `OI_SESSION_SECRET`, `OFFER_DB_API_TOKEN`, and the `OFFER_DB_*` connection variables. Production authentication reads users from `cnpscy_oi_user`; `OI_AUTH_ENABLED=0` is only for isolated local development and production must fail closed. The frontend can load from committed `protected_data/db_offers_cache.json` and `protected_data/db_keywords_cache.json` without the Levanta key or DB.

### Generate password hash
```bash
python scripts/hash_auth_password.py
```

### Rebuild cached data payloads
```bash
python scripts/build_publishers_data.py
python scripts/validate_db_migration.py --output output/db_migration_status.json
python scripts/import_product_name_keywords.py --source "/path/to/brand and asins t1-t3.xlsx"
```

### Run tests (same as CI)
```bash
npm ci
npm run test:copilotkit
npm --prefix frontend ci
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run
npm --prefix frontend run build
node --check public/auth.js
node scripts/test_frontend_migration_inventory.mjs
node scripts/test_frontend_build_contract.mjs
node scripts/test_m4_shell_frontend.mjs
node scripts/test_modern_page_cutover.mjs
node scripts/test_m6_chatbot_agent_behavior_parity.mjs
node scripts/test_m6_modern_mount.mjs
node scripts/test_m7_modern_entry.mjs
python scripts/test_agent_agui.py
python scripts/test_payment_placeholders.py
```

## Architecture

### Dual runtime: local server + Vercel serverless

The codebase runs as a single `python server.py` process locally, but on Vercel each file under `api/` is deployed as a separate serverless function. This means:

- **`server.py`** is the monolith that handles all routes locally. It imports from `auth.py`, `offer_db.py`, `api/tier_moves.py`, etc.
- **`api/**/*.py`** files are Vercel Function entrypoints. Consolidated Auth and non-streaming Chat entries export a `handler` class, while the consolidated DB entry exports a WSGI `app`; `vercel.json` preserves public routes with trusted request-header transforms.
- Code shared between local and serverless paths lives in root-level `.py` files (`auth.py`, `offer_db.py`).

### Request flow (local)

```
Browser → server.py Handler.do_GET/POST
  ├── /api/auth/session  → auth.handle_auth_session()
  ├── /api/auth/login    → auth.handle_auth_login()      [POST]
  ├── /api/auth/logout   → auth.handle_auth_logout()     [POST]
  ├── /api/levanta/payments → server.py internal handler
  ├── /api/tier_moves    → api/tier_moves.handle_tier_moves()
  ├── /api/ui/db/*       → server.py internal handler (session auth)
  └── /*                 → static file server from public/
```

### Auth model

Users come from `cnpscy_oi_user`; there is no registration or user-management UI. Session-based auth uses an `HttpOnly` HMAC-signed v2 cookie (`oi_session`) whose payload contains only `v`, `sub`, `exp`, and `iat`. Every protected request re-reads the user's `is_active` and `level`. Level 0 can access all 12 pages, level 1 excludes Google Ads, and level 2 can access only Google Ads. Payment sync can bypass session auth only for `/api/levanta/payments` by presenting `PAYMENT_SYNC_TOKEN` as a Bearer token or `X-Payment-Sync-Token` header.

Unauthenticated, denied, and unavailable requests return 401, 403, and 503 respectively. When `OI_AUTH_ENABLED` is `0`/`false`/`off`, only isolated local development may use the synthetic level 0 user; production fails closed. Old v1 cookies containing `role=admin` are rejected.

### DB layer (`offer_db.py`)

Read-only MySQL access via PyMySQL. Column discovery is dynamic — the code runs `SHOW COLUMNS FROM` at runtime and fuzzy-matches against expected aliases, making it tolerant of schema variations. The reporting contract is documented in `docs/offer-db-reporting-contract.sql`. Key objects:

- `oi_offer_base` — one row per merchant
- `oi_offer_products` — ASIN-level product rows
- `oi_offer_monthly_amazon_metrics` — merchant-month metrics
- `oi_offer_monthly_aggregate_metrics` — aggregate-only metrics
- `oi_levanta_monthly_metrics` — Levanta historical metrics
- `oi_tier_assignments` — tier placement state
- `oi_tier_visual_status` — green/yellow/red color state
- `oi_category` / `oi_merchant_category` — category classification (added on current branch)

DB endpoints come in two flavors:
- **Server-only** (`/api/db/*`) — require `OFFER_DB_API_TOKEN` via `Authorization: Bearer` or `X-Offer-Db-Token` header
- **Browser-safe** (`/api/ui/db/*`) — require session auth, no DB token exposed to browser

### Frontend (`public/`)

Vanilla JS SPA with no framework or build step. GSAP loaded from CDN for motion. Three phases:

1. **`page_access.js` then `auth.js`** load first — the shared page matrix is registered before session checks; authenticated level 0/1 sessions load protected offer data, while level 2 starts on Google Ads without requesting offers or keywords.
2. **`app.js`** (~420KB) bootstraps the dashboard — tier pages, category reports, chatbot, payment page, targets page, XLSX export

### Chatbot

See `docs/chatbot-feature-report.md` for the full architecture — LLM intent classifier (DeepSeek/Claude via `llm_classify.py` + `skills/`), 7-intent routing in `answerPrompt()`, analysis engine, i18n, and all 34 involved files.

### Category system

Categories are DB-backed via `oi_category` (category definitions) and `oi_merchant_category` (merchant–category mapping) tables. Main category resolution priority chain: DB `sheetCategory` field → `mainCategory` field → Feishu main category → non-Feishu category → remaining category → `levantaCategory` → "Uncategorized". Feishu subcategory and category path data is searchable metadata but doesn't drive main-category grouping.

### Tier system

Five tiers: Tier 1, Tier 2, Tier 3, Tier 4, BLACK TIER. Tier moves are persisted via Google Apps Script webhook (`scripts/tier_moves_apps_script.gs`). The browser calls `/api/tier_moves`, which proxies to the Apps Script URL with the server-side secret. When `TIER_MOVES_WEBHOOK_URL` is unset, moves work locally only.

### Payment data

Levanta invoice data is fetched from the Levanta API, normalized into payment records, enriched with offer metadata (tier, category, payment cycle), and augmented with pending placeholder records for months without invoice data. Payment statuses: Paid, Pending, Unpaid, Overdue, Partial. Zero-revenue+zero-commission records are excluded from all payment views and exports.

A GitHub Actions workflow (`.github/workflows/sync-levanta-payments.yml`) runs daily at 02:00 UTC to sync payment data directly to the `cnpscy_oi_payment_records` table.

### Modern frontend navigation

- frontend/src/runtime/modernApp.ts owns the standalone application lifecycle, page mounting, navigation, and language.
- frontend/src/runtime/contracts.ts owns bootstrap and application API types.
- frontend/src/shell/AppShell.vue owns desktop/mobile navigation, theme, page title, and the single page host.
- frontend/src/entry.ts registers the 12 Vue page factories and shared export/session services.
- frontend/src/features/ contains page-owned models, composables, components, styles, and behavior tests.
- public/auth.js owns authentication, protected bootstrap loading, the explicit startup error state, and loading the modern bundle.
- The removed public/app.js and frontend/src/legacy/ runtime must not be restored; rollback uses a prior deploy.

### Data files

- `protected_data/db_offers_cache.json` — DB-driven offers + sheets + payment records cache (committed, TTL 24h)
- `protected_data/db_keywords_cache.json` — DB-driven product keywords cache
- `protected_data/db_publishers_cache.json` — Publishers cache
- `data/feishu_merchant_categories.csv` — Feishu category mappings
- `data/product_name_keywords_t1_t3.csv` — product name keywords for Tier 1-3
- `api/static_merchant_ids.json` — known merchant ID list for DB search
