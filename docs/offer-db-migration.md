# Offer Intelligence DB Migration Runbook

## Architecture

Use the hybrid model:

- MySQL is the read-only source of truth for fresh offer, product, and metric data.
- `oi_*` reporting views/tables are the only database objects the app reads.
- Static browser payloads remain the default page input after admin login:
  - `protected_data/chatbot_data.js`
  - `protected_data/sheet_report_data.js`
  - `protected_data/product_keywords.js`
- Small server-side APIs handle status, merchant drilldown, and restricted search.
- Browser code must never connect to MySQL directly.

## Required Environment Variables

Set these only in the server/deployment environment. Do not commit them.

```text
OFFER_DB_HOST
OFFER_DB_PORT
OFFER_DB_NAME
OFFER_DB_USER
OFFER_DB_PASSWORD
OFFER_DB_API_TOKEN
```

The database user should be a dedicated read-only user with `SELECT` only on `oi_*` views/tables. Keep write workflows on their existing server-side tokens, such as `TIER_MOVES_ADMIN_TOKEN`.

## Reporting Contract

The application expects these database objects:

- `oi_offer_base`: one row per merchant. Required aliases include `merchantId`, `merchantName`, `network`, `category`, `commissionRate`, and `paymentCycle`.
- `oi_offer_products`: product rows. Useful aliases include `merchantId`, `asin`, `productName`, `category`, `bsr`, `commissionRate`, and `updatedAt`.
- `oi_offer_monthly_amazon_metrics`: merchant-month metrics. Required aliases include `merchantId`, `month`, `clicks`, `orders`, `revenue` or `salesAmount`, `epc`, `aov`, and `conversionRate`.
- `oi_offer_monthly_aggregate_metrics`: offer-level aggregate metrics only. Do not expose `user_id` or `site_id`.
- `oi_levanta_monthly_metrics`: historical Levanta CPS/CPC metrics. Payment status still comes from the Levanta API path.
- `oi_tier_assignments`: merchant tier state and move provenance.
- `oi_tier_visual_status`: merchant color state with `color`, `reason_code`, `reason_text`, and `source`.

## Server API

All DB API endpoints require `OFFER_DB_API_TOKEN` via either:

```text
Authorization: Bearer <token>
X-Offer-Db-Token: <token>
```

Endpoints:

- `GET /api/db/status`: latest DB dates, static snapshot timestamp, and coverage counts.
- `GET /api/db/merchant?merchantId=362653`: one merchant, product rows, Amazon month metrics, and aggregate month metrics.
- `GET /api/db/search?q=shokz`: restricted merchant search.

These APIs return allowlisted fields only. They must not return raw user, site, bank, login, callback, link tracking, or internal-note columns.

## Static Snapshot Build

Validate production freshness and coverage before publishing:

```bash
python scripts/validate_db_migration.py \
  --min-amazon-order-date 2026-07-01 \
  --min-amazon-click-date 2026-07-01 \
  --min-aggregate-date 2026-07-01 \
  --min-product-date 2026-07-01 \
  --output output/db_migration_status.json
```

Build a DB-backed chatbot payload from the `oi_*` views:

```bash
python scripts/build_db_static_snapshot.py \
  --chatbot-output protected_data/chatbot_data.js
```

To replace tier sheet payloads from DB tier assignments as well:

```bash
python scripts/build_db_static_snapshot.py \
  --chatbot-output protected_data/chatbot_data.js \
  --sheet-output protected_data/sheet_report_data.js
```

If a Google Sheet remains the tier source, keep running `scripts/build_sheet_report_data.py` for `protected_data/sheet_report_data.js`.

## Tier Visual Status

The frontend priority is:

```text
manual override > generated visualStatusColor field > legacy rule > none
```

Allowed colors are `green`, `yellow`, `red`, and `none`. Recommended fields:

```text
visualStatusColor
visualStatusCode
visualStatusReason
visualStatusSource
```

The current legacy baseline is covered by `scripts/test_tier_visual_status.mjs`.

## Security Boundary

Do not migrate or expose these data families:

```text
cnpscy_user*
cnpscy_site*
cnpscy_user_bank
cnpscy_huifu_bank_info
cnpscy_admin_login_logs*
cnpscy_payment_callbacks
cnpscy_awin_clicks
cnpscy_flexoffers_visit
cnpscy_webgains_advert
cnpscy_linkbux_*
cnpscy_kelkoo_*
```

For Vercel-to-MySQL traffic, use fixed egress before allowing production DB access. Prefer Vercel Static IPs or Secure Compute, then allowlist only those egress addresses in the database firewall.

## MySQL Compatibility

Production MySQL is 5.6. Keep DB SQL compatible with that version:

- No CTEs.
- No window functions.
- Use grouped subqueries or Python ETL for advanced ranking.
- Keep reporting views shallow and index-backed.
