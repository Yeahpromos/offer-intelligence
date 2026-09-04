import importlib.util
from io import BytesIO
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "api" / "db" / "index.py"
sys.path.insert(0, str(ROOT))

import auth


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def load_app_module():
    if not APP_PATH.is_file():
        raise AssertionError("missing consolidated WSGI entrypoint api/db/index.py")
    spec = importlib.util.spec_from_file_location("vercel_db_wsgi", APP_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def request(app, route, query="", method="GET", token="unit-test-token", cookie="", body=None):
    encoded_body = json.dumps(body or {}).encode("utf-8") if body is not None else b""
    environ = {
        "REQUEST_METHOD": method,
        "PATH_INFO": "/api/db/index",
        "QUERY_STRING": query,
        "SERVER_NAME": "localhost",
        "SERVER_PORT": "80",
        "wsgi.url_scheme": "http",
        "HTTP_X_OI_DB_ROUTE": route,
        "CONTENT_LENGTH": str(len(encoded_body)),
        "CONTENT_TYPE": "application/json",
        "wsgi.input": BytesIO(encoded_body),
    }
    if token:
        environ["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    if cookie:
        environ["HTTP_COOKIE"] = cookie
    response = {}

    def start_response(status, headers):
        response["status"] = int(status.split(" ", 1)[0])
        response["headers"] = dict(headers)

    response["body"] = b"".join(app(environ, start_response))
    return response


def main():
    module = load_app_module()
    env_keys = (
        "OFFER_DB_API_TOKEN",
        "OI_AUTH_ENABLED",
        "OI_SESSION_SECRET",
        "VERCEL_ENV",
        "OFFER_DB_HOST",
        "OFFER_DB_NAME",
        "OFFER_DB_USER",
        "OFFER_DB_PASSWORD",
    )
    old_env = {key: os.environ.get(key) for key in env_keys}
    old_user_lookup = auth.user_record_by_username
    os.environ["OFFER_DB_API_TOKEN"] = "unit-test-token"
    os.environ["OI_AUTH_ENABLED"] = "0"
    try:
        module.status_payload = lambda month=None, include_coverage=False: {
            "route": "status",
            "month": month,
            "includeCoverage": include_coverage,
        }
        module.merchant_payload = lambda merchant_id, product_limit, months, minimal=False: {
            "route": "merchant",
            "merchantId": merchant_id,
            "limit": product_limit,
            "months": months,
            "minimal": minimal,
        }
        module.search_payload = lambda text, limit: {
            "route": "search",
            "q": text,
            "limit": limit,
            "results": [
                {"merchantId": "42", "merchantName": "Public Merchant"},
                {"merchantId": "99", "merchantName": "Private Merchant"},
            ],
        }
        module.read_static_merchant_ids = lambda: ["42"]
        module.product_keywords_payload = lambda: {"route": "ui-keywords"}
        module.publishers_payload = lambda force_refresh=False: {
            "route": "ui-publishers",
            "forceRefresh": force_refresh,
        }
        module.publisher_portfolio_payload = lambda user_id, start_date=None, end_date=None: {
            "route": "ui-publisher-portfolio",
            "userId": int(user_id),
            "startDate": start_date,
            "endDate": end_date,
        }
        module.brand_media_sankey_payload = lambda merchant_id, start_date=None, end_date=None: {
            "route": "ui-brand-media-sankey",
            "merchantId": int(str(merchant_id).split(",")[0]),
            "merchantIds": [int(value) for value in str(merchant_id).split(",")],
            "startDate": start_date,
            "endDate": end_date,
        }
        module.brand_media_trend_payload = lambda merchant_id, start_date=None, end_date=None: {
            "route": "ui-brand-media-trend",
            "merchantId": int(merchant_id),
            "startDate": start_date,
            "endDate": end_date,
        }
        module.google_ads_workbench_payload = lambda user_id, start_date=None, end_date=None, force_refresh=False: {
            "route": "ui-google-ads-workbench",
            "userId": int(user_id),
            "startDate": start_date,
            "endDate": end_date,
            "forceRefresh": force_refresh,
        }
        module.offers_payload = lambda month=None, start_date=None, end_date=None: {
            "route": "ui-offers",
            "month": month,
            "startDate": start_date,
            "endDate": end_date,
        }
        module.tier_sheet_payload = lambda tier, month=None, start_date=None, end_date=None, compact=False: {
            "route": "ui-tier-sheet",
            "tier": tier,
            "month": month,
            "startDate": start_date,
            "endDate": end_date,
            "compact": compact,
        }
        module.tier1_merchant_search_payload = lambda text, limit: {
            "route": "ui-tier1-merchant-search",
            "q": text,
            "limit": limit,
        }
        module.tier1_additions_payload = lambda limit: {
            "route": "ui-tier1-additions",
            "additions": [{"merchantId": "42"}],
            "limit": limit,
        }
        module.add_merchant_to_tier1 = lambda merchant_id, updated_by, expected_tier: {
            "ok": True,
            "route": "ui-tier1-add",
            "merchantId": merchant_id,
            "updatedBy": updated_by,
            "expectedTier": expected_tier,
        }
        module.monthly_new_merchants_payload = lambda month=None: {
            "ok": True,
            "route": "ui-monthly-new-merchants",
            "month": month,
            "records": [],
        }
        module.upsert_monthly_new_merchant = lambda body, updated_by: {
            "ok": True,
            "route": "ui-monthly-new-merchant-upsert",
            "merchantId": body.get("merchantId"),
            "merchantName": body.get("merchantName"),
            "businessManager": body.get("businessManager"),
            "isPriority": body.get("isPriority"),
            "gmvMonthlyTarget": body.get("gmvMonthlyTarget"),
            "updatedBy": updated_by,
        }
        module.delete_monthly_new_merchant = lambda record_id, deleted_by: {
            "ok": True,
            "route": "ui-monthly-new-merchant-delete",
            "recordId": record_id,
            "deletedBy": deleted_by,
        }

        status = request(module.app, "status", "action=search&month=202607")
        assert_equal(status["status"], 200, "status response code")
        assert b'"route":"status"' in status["body"], status["body"]

        diagnostic_status = request(module.app, "status", "month=202607&coverage=1")
        assert_equal(diagnostic_status["status"], 200, "diagnostic status response code")
        assert b'"includeCoverage":true' in diagnostic_status["body"], diagnostic_status["body"]

        merchant = request(
            module.app,
            "merchant",
            "action=search&merchantId=42&limit=7&months=3",
        )
        assert_equal(merchant["status"], 200, "merchant response code")
        assert b'"route":"merchant"' in merchant["body"], merchant["body"]

        search = request(module.app, "search", "action=status&q=coffee&limit=5")
        assert_equal(search["status"], 200, "search response code")
        assert b'"route":"search"' in search["body"], search["body"]

        ui_status = request(module.app, "ui-status", "month=202607", token="")
        assert_equal(ui_status["status"], 200, "UI status response code")
        assert b'"month":"202607"' in ui_status["body"], ui_status["body"]

        ui_merchant = request(
            module.app,
            "ui-merchant",
            "merchantId=42&limit=7&months=3&minimal=1",
            token="",
        )
        assert_equal(ui_merchant["status"], 200, "UI merchant response code")
        assert b'"merchantId":"42"' in ui_merchant["body"], ui_merchant["body"]
        assert b'"minimal":true' in ui_merchant["body"], ui_merchant["body"]

        hidden_ui_merchant = request(module.app, "ui-merchant", "merchantId=99", token="")
        assert_equal(hidden_ui_merchant["status"], 404, "hidden UI merchant response code")

        invalid_ui_merchant = request(module.app, "ui-merchant", "merchantId=abc", token="")
        assert_equal(invalid_ui_merchant["status"], 400, "invalid UI merchant response code")

        ui_search = request(module.app, "ui-search", "q=coffee&limit=5", token="")
        assert_equal(ui_search["status"], 200, "UI search response code")
        assert b'"merchantId":"42"' in ui_search["body"], ui_search["body"]
        assert b'"merchantId":"99"' not in ui_search["body"], ui_search["body"]

        short_ui_search = request(module.app, "ui-search", "q=c", token="")
        assert_equal(short_ui_search["status"], 200, "short UI search response code")
        assert b'"results":[]' in short_ui_search["body"], short_ui_search["body"]

        keywords = request(module.app, "ui-keywords", token="")
        assert_equal(keywords["status"], 200, "UI keywords response code")
        assert b'"route":"ui-keywords"' in keywords["body"], keywords["body"]

        offers = request(module.app, "ui-offers", "month=2026-07", token="")
        assert_equal(offers["status"], 200, "UI offers response code")
        assert b'"month":"2026-07"' in offers["body"], offers["body"]

        offers_range = request(
            module.app,
            "ui-offers",
            "start_date=2026-07-01&end_date=2026-07-28",
            token="",
        )
        assert_equal(offers_range["status"], 200, "UI offers date-range response code")
        assert b'"startDate":"2026-07-01"' in offers_range["body"], offers_range["body"]
        assert b'"endDate":"2026-07-28"' in offers_range["body"], offers_range["body"]

        publishers = request(module.app, "ui-publishers", "refresh=1", token="")
        assert_equal(publishers["status"], 200, "UI publishers response code")
        assert b'"forceRefresh":true' in publishers["body"], publishers["body"]

        publisher_portfolio = request(
            module.app,
            "ui-publishers",
            "userId=7&startDate=2026-07-01&endDate=2026-07-28",
            token="",
        )
        assert_equal(publisher_portfolio["status"], 200, "publisher portfolio response code")
        assert b'"route":"ui-publisher-portfolio"' in publisher_portfolio["body"], publisher_portfolio["body"]
        assert b'"startDate":"2026-07-01"' in publisher_portfolio["body"], publisher_portfolio["body"]


        brand_media_sankey = request(
            module.app,
            "ui-brand-media-sankey",
            "merchantId=42&startDate=2026-07-01&endDate=2026-07-28",
            token="",
        )
        assert_equal(brand_media_sankey["status"], 200, "brand media Sankey response code")
        assert b'"route":"ui-brand-media-sankey"' in brand_media_sankey["body"], brand_media_sankey["body"]
        assert b'"merchantId":42' in brand_media_sankey["body"], brand_media_sankey["body"]
        assert b'"endDate":"2026-07-28"' in brand_media_sankey["body"], brand_media_sankey["body"]

        multi_brand_media_sankey = request(
            module.app,
            "ui-brand-media-sankey",
            "merchantIds=42%2C99&startDate=2026-07-01&endDate=2026-07-28",
            token="",
        )
        assert_equal(multi_brand_media_sankey["status"], 200, "multi-brand Sankey response code")
        assert b'"merchantIds":[42,99]' in multi_brand_media_sankey["body"], multi_brand_media_sankey["body"]

        missing_brand_media_sankey_merchant = request(module.app, "ui-brand-media-sankey", token="")
        assert_equal(missing_brand_media_sankey_merchant["status"], 400, "missing brand media Sankey merchant response code")

        brand_media_trend = request(
            module.app,
            "ui-brand-media-trend",
            "merchantId=42&startDate=2026-07-01&endDate=2026-07-28",
            token="",
        )
        assert_equal(brand_media_trend["status"], 200, "brand media trend response code")
        assert b'"route":"ui-brand-media-trend"' in brand_media_trend["body"], brand_media_trend["body"]
        assert b'"merchantId":42' in brand_media_trend["body"], brand_media_trend["body"]
        assert b'"endDate":"2026-07-28"' in brand_media_trend["body"], brand_media_trend["body"]

        missing_brand_media_merchant = request(module.app, "ui-brand-media-trend", token="")
        assert_equal(missing_brand_media_merchant["status"], 400, "missing brand media merchant response code")

        google_ads = request(
            module.app,
            "ui-google-ads-workbench",
            "userId=19&startDate=2026-07-01&endDate=2026-08-26&refresh=1",
            token="",
        )
        assert_equal(google_ads["status"], 200, "Google Ads workbench response code")
        assert b'"route":"ui-google-ads-workbench"' in google_ads["body"], google_ads["body"]
        assert b'"userId":19' in google_ads["body"], google_ads["body"]
        assert b'"forceRefresh":true' in google_ads["body"], google_ads["body"]

        invalid_publisher = request(
            module.app,
            "ui-publishers",
            "userId=invalid",
            token="",
        )
        assert_equal(invalid_publisher["status"], 400, "invalid publisher response code")

        tier_sheet = request(
            module.app,
            "ui-tier-sheet",
            "tier=Tier+2&start_date=2026-07-21&end_date=2026-07-22&compact=1",
            token="",
        )
        assert_equal(tier_sheet["status"], 200, "UI tier sheet response code")
        assert b'"tier":"Tier 2"' in tier_sheet["body"], tier_sheet["body"]
        assert b'"startDate":"2026-07-21"' in tier_sheet["body"], tier_sheet["body"]
        assert b'"endDate":"2026-07-22"' in tier_sheet["body"], tier_sheet["body"]
        assert b'"compact":true' in tier_sheet["body"], tier_sheet["body"]

        missing_tier = request(module.app, "ui-tier-sheet", token="")
        assert_equal(missing_tier["status"], 400, "missing tier response code")

        tier1_search = request(
            module.app,
            "ui-tier1-merchants",
            "action=search&q=coffee&limit=8",
            token="",
        )
        assert_equal(tier1_search["status"], 200, "Tier 1 merchant search response code")
        assert b'"route":"ui-tier1-merchant-search"' in tier1_search["body"], tier1_search["body"]

        tier1_additions = request(
            module.app,
            "ui-tier1-merchants",
            "action=additions",
            token="",
        )
        assert_equal(tier1_additions["status"], 200, "Tier 1 additions response code")
        assert b'"route":"ui-tier1-additions"' in tier1_additions["body"], tier1_additions["body"]

        tier1_add = request(
            module.app,
            "ui-tier1-merchants",
            method="POST",
            token="",
            body={"merchantId": "42", "expectedTier": "Tier 2"},
        )
        assert_equal(tier1_add["status"], 200, "Tier 1 merchant add response code")
        assert b'"route":"ui-tier1-add"' in tier1_add["body"], tier1_add["body"]
        assert b'"expectedTier":"Tier 2"' in tier1_add["body"], tier1_add["body"]

        tier1_options = request(
            module.app,
            "ui-tier1-merchants",
            method="OPTIONS",
            token="",
        )
        assert_equal(tier1_options["status"], 204, "Tier 1 merchant OPTIONS response code")
        assert_equal(
            dict(tier1_options["headers"]).get("Access-Control-Allow-Methods"),
            "GET, POST, OPTIONS",
            "Tier 1 merchant allowed methods",
        )

        monthly_new_list = request(
            module.app,
            "ui-monthly-new-merchants",
            "month=2026-07",
            token="",
        )
        assert_equal(monthly_new_list["status"], 200, "monthly new merchants response code")
        assert b'"route":"ui-monthly-new-merchants"' in monthly_new_list["body"], monthly_new_list["body"]
        assert b'"month":"2026-07"' in monthly_new_list["body"], monthly_new_list["body"]

        monthly_new_upsert = request(
            module.app,
            "ui-monthly-new-merchants",
            method="POST",
            token="",
            body={
                "action": "upsert",
                "reportMonth": "2026-07",
                "merchantId": "398751",
                "merchantName": "July Merchant",
                "businessManager": "Fiona",
                "isPriority": True,
                "gmvMonthlyTarget": 50000,
            },
        )
        assert_equal(monthly_new_upsert["status"], 200, "monthly new merchant upsert response code")
        assert b'"route":"ui-monthly-new-merchant-upsert"' in monthly_new_upsert["body"], monthly_new_upsert["body"]
        assert b'"merchantId":"398751"' in monthly_new_upsert["body"], monthly_new_upsert["body"]
        assert b'"merchantName":"July Merchant"' in monthly_new_upsert["body"], monthly_new_upsert["body"]
        assert b'"businessManager":"Fiona"' in monthly_new_upsert["body"], monthly_new_upsert["body"]
        assert b'"isPriority":true' in monthly_new_upsert["body"], monthly_new_upsert["body"]
        assert b'"gmvMonthlyTarget":50000' in monthly_new_upsert["body"], monthly_new_upsert["body"]

        monthly_new_delete = request(
            module.app,
            "ui-monthly-new-merchants",
            method="POST",
            token="",
            body={"action": "delete", "recordId": 41},
        )
        assert_equal(monthly_new_delete["status"], 200, "monthly new merchant delete response code")
        assert b'"route":"ui-monthly-new-merchant-delete"' in monthly_new_delete["body"], monthly_new_delete["body"]

        monthly_new_options = request(
            module.app,
            "ui-monthly-new-merchants",
            method="OPTIONS",
            token="",
        )
        assert_equal(monthly_new_options["status"], 204, "monthly new merchant OPTIONS response code")
        assert_equal(
            dict(monthly_new_options["headers"]).get("Access-Control-Allow-Methods"),
            "GET, POST, OPTIONS",
            "monthly new merchant allowed methods",
        )

        os.environ["OI_AUTH_ENABLED"] = "1"
        os.environ["OI_SESSION_SECRET"] = "unit-test-session-secret"
        os.environ["VERCEL_ENV"] = "preview"
        os.environ["OFFER_DB_HOST"] = "db.example.test"
        os.environ["OFFER_DB_NAME"] = "offer_intelligence"
        os.environ["OFFER_DB_USER"] = "readonly"
        os.environ["OFFER_DB_PASSWORD"] = os.urandom(18).hex()
        auth.user_record_by_username = lambda _username: {
            "id": 1,
            "username": "admin",
            "display_name": "Test User",
            "email": "admin@example.test",
            "password_hash": auth.make_password_hash(os.urandom(18).hex(), iterations=1_000, salt="vercel-db-salt"),
            "level": 0,
            "is_active": 1,
        }

        ui_unauthorized = request(module.app, "ui-keywords", token="")
        assert_equal(ui_unauthorized["status"], 401, "missing UI session response code")

        ui_status_unauthorized = request(module.app, "ui-status", token="")
        assert_equal(ui_status_unauthorized["status"], 401, "missing UI status session response code")

        session, _ = auth.create_session("admin")
        ui_authenticated = request(
            module.app,
            "ui-keywords",
            token="",
            cookie=f"{auth.SESSION_COOKIE}={session}",
        )
        assert_equal(ui_authenticated["status"], 200, "authenticated UI response code")

        unauthorized = request(module.app, "status", token="")
        assert_equal(unauthorized["status"], 401, "missing token response code")

        options = request(module.app, "status", method="OPTIONS", token="")
        assert_equal(options["status"], 204, "OPTIONS response code")

        print("Vercel DB WSGI route checks passed")
    finally:
        auth.user_record_by_username = old_user_lookup
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


if __name__ == "__main__":
    main()
