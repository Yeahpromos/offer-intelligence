import importlib.util
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


def request(app, route, query="", method="GET", token="unit-test-token", cookie=""):
    environ = {
        "REQUEST_METHOD": method,
        "PATH_INFO": "/api/db/index",
        "QUERY_STRING": query,
        "SERVER_NAME": "localhost",
        "SERVER_PORT": "80",
        "wsgi.url_scheme": "http",
        "HTTP_X_OI_DB_ROUTE": route,
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
        "OI_ADMIN_PASSWORD",
        "OI_ADMIN_PASSWORD_HASH",
        "OI_SESSION_SECRET",
    )
    old_env = {key: os.environ.get(key) for key in env_keys}
    os.environ["OFFER_DB_API_TOKEN"] = "unit-test-token"
    os.environ["OI_AUTH_ENABLED"] = "0"
    try:
        module.status_payload = lambda month=None, include_coverage=False: {
            "route": "status",
            "month": month,
            "includeCoverage": include_coverage,
        }
        module.merchant_payload = lambda merchant_id, product_limit, months: {
            "route": "merchant",
            "merchantId": merchant_id,
            "limit": product_limit,
            "months": months,
        }
        module.search_payload = lambda text, limit: {
            "route": "search",
            "q": text,
            "limit": limit,
        }
        module.product_keywords_payload = lambda: {"route": "ui-keywords"}
        module.offers_payload = lambda month=None: {
            "route": "ui-offers",
            "month": month,
        }
        module.tier_sheet_payload = lambda tier, month=None, start_date=None, end_date=None, compact=False: {
            "route": "ui-tier-sheet",
            "tier": tier,
            "month": month,
            "startDate": start_date,
            "endDate": end_date,
            "compact": compact,
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

        keywords = request(module.app, "ui-keywords", token="")
        assert_equal(keywords["status"], 200, "UI keywords response code")
        assert b'"route":"ui-keywords"' in keywords["body"], keywords["body"]

        offers = request(module.app, "ui-offers", "month=2026-07", token="")
        assert_equal(offers["status"], 200, "UI offers response code")
        assert b'"month":"2026-07"' in offers["body"], offers["body"]

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

        os.environ["OI_AUTH_ENABLED"] = "1"
        os.environ["OI_ADMIN_PASSWORD"] = "unit-test-password"
        os.environ.pop("OI_ADMIN_PASSWORD_HASH", None)
        os.environ["OI_SESSION_SECRET"] = "unit-test-session-secret"

        ui_unauthorized = request(module.app, "ui-keywords", token="")
        assert_equal(ui_unauthorized["status"], 401, "missing UI session response code")

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
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


if __name__ == "__main__":
    main()
