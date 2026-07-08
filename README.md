# Offer Intelligence

![CI](https://github.com/bryansaputra68YP/offer-intelligence/actions/workflows/ci.yml/badge.svg)

Internal YeahPromos Amazon offer intelligence dashboard for offer ranking, category analysis, Tier 2 publisher strategy, payment follow-up, and chatbot-based lookup.

## What Is Included

- Static dashboard UI in `public/`.
- Protected browser payloads in `protected_data/`, served only after admin login:
  - `protected_data/chatbot_data.js`
  - `protected_data/sheet_report_data.js`
  - `protected_data/product_keywords.js`
- Google Sheet and Feishu category intelligence for main-category and subcategory search.
- Recommendation chatbot with English and Chinese prompt support.
- Tier 2 publisher recommendation rules in `public/tier2_recommendation_rules.js`.
- Tier sheet category-wise reporting and multi-sheet XLSX exports.
- Levanta payment API helpers in `server.py` and `api/levanta/payments.py`.
- Read-only Offer DB API helpers in `offer_db.py` and `api/db/`.
- Data rebuild and regression scripts in `scripts/`.
- DB migration runbook and reporting contract in `docs/`.
- GitHub Actions CI in `.github/workflows/ci.yml`.

## Current Behavior

### Database Migration Path

The dashboard uses a hybrid migration path: MySQL is the server-side source of truth, while the browser loads committed payloads only after the admin session is validated. Browser code must not connect to MySQL directly.

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

### Admin Login

The app has a single administrator login. There is no user registration or role table. A successful login receives an `HttpOnly` signed session cookie and has full dashboard permissions.

Required environment variables:

```text
OI_AUTH_ENABLED=1
OI_ADMIN_USERNAME=admin
OI_ADMIN_PASSWORD_HASH=<pbkdf2_sha256 hash>
OI_SESSION_SECRET=<random long secret>
```

Generate the password hash locally:

```bash
python scripts/hash_auth_password.py
```

The login protects `/api/levanta/payments`, `/api/tier_moves`, `/api/ui/db/*`, and the browser payload endpoint `/api/auth/data`. The generated payload files stay outside `public/` so direct static downloads do not bypass the login screen.

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
- Tier row colors prefer `visualStatusColor` fields when present, then fall back to legacy tier rules.

### Dashboard Category Report

The dashboard renders a standalone category-wise report from the tier sheet rows. It has its own tier checkbox filter and is independent of the main dashboard filters.

- `All Tier 1-4` selects `Tier 1`, `Tier 2`, `Tier 3`, and `Tier 4` only.
- `BLACK TIER` is available as a separate checkbox and is not included in the all-tier shortcut.
- The report groups selected tier merchants by displayed category and shows merchants, revenue, orders, conversion, EPC, AOV, top merchants, and tier mix.

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

- Live sync in `server.py`, static data generation in `scripts/build_offer_chatbot_data.rb`, and browser normalization in `public/app.js` prefer exact Levanta-network offer matches for Levanta payment rows.
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
export OI_AUTH_ENABLED=1
export OI_ADMIN_USERNAME="admin"
export OI_ADMIN_PASSWORD_HASH="your_pbkdf2_sha256_hash"
export OI_SESSION_SECRET="your_random_session_secret"
python3 server.py
```

Windows PowerShell:

```powershell
$env:LEVANTA_API_KEY="your_levanta_api_key"
$env:TIER_MOVES_WEBHOOK_URL="your_apps_script_web_app_url"
$env:TIER_MOVES_WEBHOOK_SECRET="your_shared_secret"
$env:OFFER_DB_API_TOKEN="your_internal_db_api_token"
$env:OI_AUTH_ENABLED="1"
$env:OI_ADMIN_USERNAME="admin"
$env:OI_ADMIN_PASSWORD_HASH="your_pbkdf2_sha256_hash"
$env:OI_SESSION_SECRET="your_random_session_secret"
python server.py
```

Then open:

```text
http://127.0.0.1:8765
```

The frontend can load from saved protected data without the Levanta key, but live payment sync requires `LEVANTA_API_KEY`.
DB APIs also require the `OFFER_DB_*` connection variables and `OFFER_DB_API_TOKEN`.

## Data Rebuild Scripts

The repository is a Python-served static frontend, not a Node app. The generated data files are committed browser payloads under `protected_data/`.

```bash
python scripts/build_sheet_report_data.py
ruby scripts/build_offer_chatbot_data.rb
```

DB-backed snapshot and migration validation:

```bash
python scripts/validate_db_migration.py --output output/db_migration_status.json
python scripts/build_db_static_snapshot.py --chatbot-output protected_data/chatbot_data.js
```

Product-name keyword data for Tier 1-3 offers is generated from the brand/ASIN workbook into `data/product_name_keywords_t1_t3.csv` and `protected_data/product_keywords.js`.

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
node --check public/app.js
node --check public/chatbot_i18n.js
node --check public/tier2_recommendation_rules.js
python scripts/test_auth_helpers.py
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_tier2_recommendation_rules.mjs
node scripts/test_sheet_categories.mjs
node scripts/test_tier_visual_status.mjs
node scripts/test_zh_chatbot.mjs
python -m scripts.test_payment_placeholders
python -m py_compile auth.py browser_payloads.py server.py offer_db.py api/protected_data.py api/auth/login.py api/auth/session.py api/auth/logout.py api/auth/data.py api/db/status.py api/db/merchant.py api/db/search.py scripts/validate_db_migration.py scripts/build_db_static_snapshot.py
```

## Security

Do not commit `.env`, API keys, database passwords, logs, or PID files. Server secrets must stay in deployment environment variables only.

Do not commit `OI_ADMIN_PASSWORD`, `OI_ADMIN_PASSWORD_HASH`, or `OI_SESSION_SECRET` outside deployment configuration. Prefer `OI_ADMIN_PASSWORD_HASH` over plaintext `OI_ADMIN_PASSWORD`.

The production DB user for this app should be read-only and limited to `SELECT` on `oi_*` objects. Do not expose or migrate user, site, bank, login-log, payment-callback, link-tracking, or raw network integration tables into browser payloads or API responses.
