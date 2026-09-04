# Offer Intelligence

![CI](https://github.com/Yeahpromos/offer-intelligence/actions/workflows/ci.yml/badge.svg)

Internal YeahPromos Amazon offer intelligence dashboard for offer ranking, category analysis, Tier 2 publisher strategy, payment follow-up, and chatbot-based lookup.

## What Is Included

- Standalone Vue 3 dashboard in `frontend/`, built to `public/assets/modern/`; `public/` contains only the authentication/bootstrap shell.
- Cached browser payloads in `protected_data/` (committed DB API cache files):
  - `protected_data/db_offers_cache.json`
  - `protected_data/db_keywords_cache.json`
  - `protected_data/db_publishers_cache.json`
- Google Sheet and Feishu category intelligence for main-category and subcategory search.
- Recommendation chatbot with English and Chinese prompt support.
- Tier and publisher recommendation behavior in the typed Vue feature models and Python Agent tool registry.
- Tier sheet category-wise reporting and multi-sheet XLSX exports.
- Levanta payment API helpers in `server.py` and `api/levanta/payments.py`.
- Read-only Offer DB API helpers in `offer_db.py` and `api/db/`.
- Data rebuild and regression scripts in `scripts/`.
- DB migration runbook and reporting contract in `docs/`.
- GitHub Actions CI in `.github/workflows/ci.yml`.

## Current Behavior

### Database Migration Path

The dashboard uses a hybrid migration path: MySQL is the server-side source of truth, while the browser loads committed payloads only after the current user session is validated. Browser code must not connect to MySQL directly.

- Reporting views/tables are limited to `oi_*` objects.
- Static snapshots can be built with `scripts/build_db_static_snapshot.py`.
- Freshness and coverage checks live in `scripts/validate_db_migration.py`.
- Server-only endpoints are available at `/api/db/status`, `/api/db/merchant`, and `/api/db/search`.
- All DB endpoints require `OFFER_DB_API_TOKEN`.
- Browser-safe wrappers live at `/api/ui/db/status`, `/api/ui/db/merchant`, and `/api/ui/db/search`; the page auto-loads
  DB freshness/daily-delay status, appends live merchant DB details after Merchant ID/brand chat lookups, and adds DB-backed
  public search matches when a chat query is a merchant lookup.
- Local UI preview without DB env can use `http://127.0.0.1:8765/?dbStatusDemo=1`; this demo mode only activates on localhost.
- Full setup details are in `docs/offer-db-migration.md`.

### User Authentication and Page Access

The app authenticates users from `cnpscy_oi_user`, using each row's `username`, `password_hash`, `is_active`, and `level`. There is no registration, user-management page, or role-management page; deployment operators create and maintain users in the database. A successful login receives an `HttpOnly` signed v2 session cookie containing only `v`, `sub`, `exp`, and `iat`. Every protected request re-reads the user row, so changes to `is_active` or `level` take effect on the next request.

Access levels are fixed: level 0 can access all 12 pages; level 1 can access every page except Google Ads; level 2 can access only Google Ads and starts there. Unauthenticated requests return 401, an invalid level or denied page returns 403, and missing or unavailable authentication dependencies return 503.

Required environment variables:

```text
OI_AUTH_ENABLED=1
OI_SESSION_SECRET=<random long secret>
OFFER_DB_HOST=<database host>
OFFER_DB_NAME=<database name>
OFFER_DB_USER=<database user>
OFFER_DB_PASSWORD=<database password>
OFFER_DB_API_TOKEN=<server-only database API token>
```

Generate the password hash locally:

```bash
python -m scripts.hash_auth_password
```

The login protects `/api/levanta/payments`, `/api/tier_moves`, `/api/ui/db/*`, Chat/Agent endpoints, and the CopilotKit/Python AG-UI path. Level 2 is limited to `/api/ui/db/google-ads-workbench`; the generated payload files stay outside `public/` so direct static downloads do not bypass the login screen.

Production cutover order:

1. Create `cnpscy_oi_user` and insert the initial level 0 user with a locally generated PBKDF2 hash.
2. Deploy the application code.
3. Set `OI_AUTH_ENABLED=1`, `OI_SESSION_SECRET`, and the `OFFER_DB_*` connection variables.
4. Remove obsolete authentication configuration and verify login, level 0/1/2 page access, and old-cookie rejection before opening traffic.

Scheduled payment syncs can call the protected `/api/levanta/payments` endpoint without a browser session by setting the same `PAYMENT_SYNC_TOKEN` in Vercel and as a GitHub Actions repository secret. The sync script sends it as a bearer token when `PAYMENT_SYNC_SOURCE_URL` is configured.

### Category Logic

Main category logic is based on the Google Sheet `Category` value when it is present.

- Tier 1 `Category`: column 23
- Tier 2 `Category`: column 22
- Tier 3 `Category`: column 12
- Tier 4 `Category`: column 13

The dashboard and chatbot use this fallback order for the displayed main category:

```text
sheetCategory -> mainCategory -> feishuMainCategory -> non-Feishu category -> remaining category -> levantaCategory -> Uncategorized
```

Feishu main category, subcategory, and category path values remain searchable metadata, so prompts can still match subcategory phrases such as `robot vacuum`, but main-category grouping is driven by the Google Sheet category first.

### Tier Pages and XLSX Exports

Each tier page (`Tier 1`, `Tier 2`, `Tier 3`, `Tier 4`, and `BLACK TIER`) renders a category-wise report above the sheet table. The category report uses the current tier filters and groups rows by displayed category.

- The on-page category report shows merchants, revenue, orders, conversion, EPC, and the top merchant per category.
- Category groups are calculated from the filtered tier rows, so search, network/agency, country, EPC, and revenue filters update the category report.
- Tier XLSX downloads include the selected tier sheet plus a `Category Summary` sheet.
- Tier XLSX downloads also include an `Offer List` sheet with `Merchant ID`, `Merchant Name`, `Category`, and `Avg Commission Rate`.
- `Avg Commission Rate` is rounded up to a whole percentage for export.
- Tier row colors prefer `visualStatusColor` fields when present, then use the typed Vue tier rules.

### Dashboard Category Report

The dashboard renders a standalone category-wise report from the tier sheet rows. It has its own tier checkbox filter and is independent of the main dashboard filters.

- `All Tier 1-4` selects `Tier 1`, `Tier 2`, `Tier 3`, and `Tier 4` only.
- `BLACK TIER` is available as a separate checkbox and is not included in the all-tier shortcut.
- The report groups selected tier merchants by displayed category and shows merchants, revenue, orders, conversion, EPC, AOV, top merchants, and tier mix.
- Click a donut segment or category legend item to focus every report metric, chart, and table on that category; use the compact `All categories` control in the chart's upper-right corner to return to the overview.

Manual test case:

1. Open `http://127.0.0.1:8765` and confirm the dashboard category report defaults to `Tier 1`, `Tier 2`, `Tier 3`, and `Tier 4` with `BLACK TIER` unchecked.
2. Confirm the current exported data shows `6,312` rows, `38` categories, `$2,424,718.79` revenue, and `24,250` orders for the default Tier 1-4 view.
3. Clear the tier selection, check only `Tier 3`, and confirm the report updates to `387` rows, `26` categories, `$488,765.00` revenue, `3,735` orders, and Tier mix values that only use `T3`.
4. Check `BLACK TIER`, then click `All Tier 1-4`; confirm `BLACK TIER` is cleared again and the report returns to the default Tier 1-4 totals.

### Chatbot Intent Flow

The chatbot separates merchant-name lookup from category search:

- `Shokz` or `Shokz offers` searches for that merchant's offers.
- `Electronics`, `Beauty offers`, or known subcategory phrases search by category.
- `Shokz Electronics` is treated as a category-aware query when the category term is known.
- `Find ASIN B0D2HKCMBP` searches offers containing that ASIN.
- Payment prompts such as `April unpaid payments` use the saved or live Levanta payment data.

The chatbot also supports flexible metric filters and ranking phrases:

- `aov above 100`
- `epc lower than 1`
- `conversion above 10%`
- `offers with highest revenue`
- `10 offers with highest commission`

Metric ranking still keeps tier priority first, then sorts within that priority by the requested metric.

### Tier 2 Publisher Strategy

Tier 2 recommendations read publisher counts such as `14/20` as `14 of 20 publishers are producing orders` and use the derived success rate in the recommendation idea.

- Green offers are optimization-only: keep and scale the publishers that already work, and do not bring more publishers to the offer.
- Non-green offers below the 20-30 publisher test-pool target should add qualified publishers to validate sales and orders.
- Mature pools with low success rate should replace or rotate weaker publishers rather than adding more of the same traffic.
- Red or declining offers should add fresh qualified test publishers to recover sales/orders and reduce Tier 3 risk.

### Payment Report Mapping

Payment records come from Levanta invoice data and should be attributed to Levanta merchant IDs when the same brand also has a direct offer in the system.

- Live sync in `server.py`, static data generation in `scripts/build_offer_chatbot_data.rb`, and the Vue payment model prefer exact Levanta-network offer matches for Levanta payment rows.
- If Levanta provides a brand UUID, the dashboard keeps it as `levantaBrandId` while displaying the matched internal Levanta merchant ID.
- Direct offers with the same brand name do not inherit Levanta payment status or sales.
- RENPHO Group payment rows map to Levanta MID `362938`; RENPHO Wellness payment rows map to Levanta MID `363199`.

### Payment Report Display and Export

The payment page focuses on payment follow-up fields only. The payment table and downloadable payment XLSX do not include the old Notes column.

- Payment table columns show merchant ID, merchant name/category, network, tier, month, status, revenue made, commission made, payment cycle, expected payment date, and last checked date.
- Payment rows where both revenue made and commission made are `0` are excluded from the payment page, chatbot responses, live API payload, and payment XLSX exports.
- Payment XLSX columns match the follow-up workflow: merchant, tier, network, category, month/status, revenue/commission, paid/remaining amount, payment cycle days, expected payment date, and last checked.
- Payment amount display uses `$` for US/default rows, `€` for DE/FR or EUR rows, and `£` for UK/GBP rows.
- Notes are still allowed inside source records for internal calculation or status text, but they are not rendered as a payment-section column or exported payment column.

### Dashboard Offer List

The bottom offer list is grouped by main category instead of being a flat preview. Each category section shows its own conversion, AOV, revenue, order, and offer-count summary. Category groups are sorted by revenue, with `Uncategorized` placed last.

Dashboard filters and exports continue to operate on the same filtered offer set.

### Tier AOV Provenance

Tier tables display actual AOV in teal and tentative AOV in amber. Actual AOV
is calculated server-side as `Revenue / Order count` only when both values are
positive. Otherwise, the newest dated five-product estimate from
`cnpscy_oi_merchant_aov_estimates` is used and marked as tentative. The source
snapshot is versioned in `data/merchant_aov_estimates.csv`; the UI only renders
the AOV type and provenance supplied by the database API.

Production operators can apply the schema and sync only this snapshot with the
manual `Sync merchant AOV estimates` GitHub Actions workflow.

### Manual Tier and Color Control

Scheduled synchronization preserves operator-managed tier assignments and row
colors. `scripts/sync_oi_tables.py` skips
`cnpscy_oi_tier_assignments` and `cnpscy_oi_tier_visual_status` unless a manual
operator explicitly passes `--sync-tier-assignments` or
`--sync-visual-status`. The dashboard's manual Tier Move controls remain
available.

Tier 1 also has a database-backed **Add merchant** flow. Confirming a merchant
updates `cnpscy_oi_tier_assignments` and appends an immutable event to
`cnpscy_oi_tier_move_history` in the same transaction. Existing Tier 2, Tier 3,
or Tier 4 assignments are migrated rather than copied, and the Tier 1
**Added merchants** banner reads the recorded source tier, timestamp, and actor
from the database.

### Shared Tier Moves

The tier pages include move controls for changing merchant tier placement. By default, moves are applied immediately in the current browser so the operator can preview the result. To make tier moves visible to everyone, configure the shared write path:

1. Add `scripts/tier_moves_apps_script.gs` to the Google Sheet Apps Script project.
2. In Apps Script project properties, set `TIER_MOVES_WEBHOOK_SECRET` to a random shared secret. If the script is not bound to the sheet, also set `SPREADSHEET_ID`.
3. Deploy the Apps Script as a web app that can receive requests.
4. In Vercel project environment variables, set:
   - `TIER_MOVES_WEBHOOK_URL`: the Apps Script web app URL.
   - `TIER_MOVES_WEBHOOK_SECRET`: the same secret from Apps Script.
   - Optional `TIER_MOVES_ADMIN_TOKEN`: if set, browser requests must send this token in `X-Tier-Move-Token`.

The browser never receives the Apps Script secret. It only calls `/api/tier_moves`; the Vercel function validates the optional admin token and forwards the server-side secret to Google Apps Script.
When `TIER_MOVES_ADMIN_TOKEN` is enabled, the first protected move prompts the operator for the token and stores it in that browser's local storage as `offerTierMoveAdminToken`.

The Apps Script keeps `Tier Overrides` as an audit sheet and also physically reconciles the tier tabs: active moves append the merchant row to the target tier sheet and remove it from the source tier sheet. Clearing a move attempts to roll the row back to its source tier using the stored row snapshot.

If `TIER_MOVES_WEBHOOK_URL` is not configured, move buttons still work locally but the status message says the change is local only.

## Run Locally

macOS/Linux:

```bash
export LEVANTA_API_KEY="your_levanta_api_key"
export TIER_MOVES_WEBHOOK_URL="your_apps_script_web_app_url"
export TIER_MOVES_WEBHOOK_SECRET="your_shared_secret"
export OFFER_DB_API_TOKEN="your_internal_db_api_token"
export OFFER_DB_HOST="your_database_host"
export OFFER_DB_NAME="your_database_name"
export OFFER_DB_USER="your_database_user"
export OFFER_DB_PASSWORD="your_database_password"
export OI_AUTH_ENABLED=1
export OI_SESSION_SECRET="your_random_session_secret"
export PAYMENT_SYNC_TOKEN="your_random_payment_sync_token"
python3 server.py
```

Windows PowerShell:

```powershell
$env:LEVANTA_API_KEY="your_levanta_api_key"
$env:TIER_MOVES_WEBHOOK_URL="your_apps_script_web_app_url"
$env:TIER_MOVES_WEBHOOK_SECRET="your_shared_secret"
$env:OFFER_DB_API_TOKEN="your_internal_db_api_token"
$env:OFFER_DB_HOST="your_database_host"
$env:OFFER_DB_NAME="your_database_name"
$env:OFFER_DB_USER="your_database_user"
$env:OFFER_DB_PASSWORD="your_database_password"
$env:OI_AUTH_ENABLED="1"
$env:OI_SESSION_SECRET="your_random_session_secret"
$env:PAYMENT_SYNC_TOKEN="your_random_payment_sync_token"
python server.py
```

Then open:

```text
http://127.0.0.1:8765
```

The frontend can load from saved protected data without the Levanta key, but live payment sync requires `LEVANTA_API_KEY`.
DB APIs also require the `OFFER_DB_*` connection variables and `OFFER_DB_API_TOKEN`.

## Data Rebuild Scripts

The repository is a Python-served static frontend, not a Node app. Cached data files are committed under `protected_data/`.

```bash
python scripts/validate_db_migration.py --output output/db_migration_status.json
```

Product-name keyword data for Tier 1-3 offers is generated from the brand/ASIN workbook into `data/product_name_keywords_t1_t3.csv` which is then synced to `cnpscy_oi_product_keywords`:

```bash
python scripts/import_product_name_keywords.py --source "/path/to/brand and asins t1-t3.xlsx"
```

## Example Prompts

```text
推荐5个美妆offer
四月未付款有哪些？
Aiper 的付款状态
查找 ASIN B0D2HKCMBP
推荐 Tier 2 里面表现好的 offer
aov above 100
epc lower than 1
conversion above 10%
10 offers with highest commission
offers with highest revenue
```

## Test Suite

Run the same checks used by CI:

```bash
node --check public/auth.js
node --check public/page_access.js
npm run test:copilotkit
node scripts/test_page_access.mjs
node scripts/test_legacy_page_access.mjs
npm ci
npm run test:copilotkit
npm --prefix frontend ci
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run
npm --prefix frontend run build
python scripts/test_auth_helpers.py
python scripts/test_offer_db_user_lookup.py
python scripts/test_page_access_routes.py
python scripts/test_vercel_function_budget.py
python scripts/test_vercel_db_wsgi.py
python scripts/test_vercel_auth_routes.py
python scripts/test_vercel_chat_routes.py
python scripts/test_vercel_payment_packaging.py
python scripts/test_llm_stream_timeout.py
# after `vercel build --prod`
python scripts/test_vercel_build_output.py
node scripts/test_frontend_migration_inventory.mjs
node scripts/test_frontend_build_contract.mjs
node scripts/test_m4_shell_frontend.mjs
node scripts/test_modern_page_cutover.mjs
node scripts/test_m6_chatbot_agent_behavior_parity.mjs
node scripts/test_m6_modern_mount.mjs
node scripts/test_m7_modern_entry.mjs
node scripts/test_sheet_categories.mjs
python -m scripts.test_payment_placeholders
python -m py_compile auth.py server.py offer_db.py levanta_payments.py api/auth/index.py api/chat/actions.py api/chat/stream.py api/db/index.py api/levanta/payments.py api/tier_moves.py scripts/validate_db_migration.py
```

## Security

Do not commit `.env`, API keys, database passwords, logs, or PID files. Server secrets must stay in deployment environment variables only.

Do not commit passwords, password hashes, `OI_SESSION_SECRET`, database credentials, or `PAYMENT_SYNC_TOKEN` outside deployment configuration. Generate a user password hash locally with `python -m scripts.hash_auth_password` and write only the resulting hash to the deployment-managed `cnpscy_oi_user` row.

The production DB user for this app should be read-only and limited to the required `SELECT` permissions on `cnpscy_oi_user` and `oi_*` objects. Do not expose or migrate user, site, bank, login-log, payment-callback, link-tracking, or raw network integration tables into browser payloads or API responses.
