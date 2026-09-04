import os
import sys
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import auth


class FakeTarget:
    def __init__(self, headers=None):
        self.headers = {"Host": "127.0.0.1", **(headers or {})}
        self.rfile = BytesIO()
        self.wfile = BytesIO()
        self.status = None
        self.response_headers = []

    def send_response(self, status):
        self.status = int(status)

    def send_header(self, name, value):
        self.response_headers.append((str(name), str(value)))

    def end_headers(self):
        return None


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def session_headers():
    token, _ = auth.create_session("user@example.test")
    return {"Cookie": f"{auth.SESSION_COOKIE}={token}"}


def main():
    tracked = {
        "OI_AUTH_ENABLED": os.environ.get("OI_AUTH_ENABLED"),
        "OI_SESSION_SECRET": os.environ.get("OI_SESSION_SECRET"),
        "VERCEL_ENV": os.environ.get("VERCEL_ENV"),
        "OFFER_DB_HOST": os.environ.get("OFFER_DB_HOST"),
        "OFFER_DB_NAME": os.environ.get("OFFER_DB_NAME"),
        "OFFER_DB_USER": os.environ.get("OFFER_DB_USER"),
        "OFFER_DB_PASSWORD": os.environ.get("OFFER_DB_PASSWORD"),
    }
    try:
        os.environ.update(
            {
                "OI_AUTH_ENABLED": "1",
                "OI_SESSION_SECRET": "page-access-secret",
                "VERCEL_ENV": "preview",
                "OFFER_DB_HOST": "db.example.test",
                "OFFER_DB_NAME": "offer_intelligence",
                "OFFER_DB_USER": "readonly",
                "OFFER_DB_PASSWORD": os.urandom(18).hex(),
            }
        )
        password_hash = auth.make_password_hash(os.urandom(18).hex(), iterations=1_000, salt="page-access-salt")
        original_lookup = auth.user_record_by_username
        try:
            for level in (0, 1, 2):
                user = {
                    "id": level + 1,
                    "username": "user@example.test",
                    "display_name": "Test User",
                    "email": "user@example.test",
                    "password_hash": password_hash,
                    "level": level,
                    "is_active": 1,
                }
                auth.user_record_by_username = lambda _username, row=user: row
                for page in ("dashboard", "google-ads", "agent", "tier"):
                    target = FakeTarget(session_headers())
                    allowed = auth.require_page_access(target, page)
                    expected_allowed = level == 0 or (level == 1 and page != "google-ads") or (level == 2 and page == "google-ads")
                    assert_equal(allowed, expected_allowed, f"level {level} {page} allow result")
                    if expected_allowed:
                        assert_equal(target.status, None, f"allowed level {level} {page} should not write an error")
                    else:
                        assert_equal(target.status, 403, f"level {level} {page} should be forbidden")

            missing = FakeTarget()
            assert_equal(auth.require_page_access(missing, "dashboard"), False, "missing session result")
            assert_equal(missing.status, 401, "missing session status")

            def unavailable(_username):
                raise RuntimeError("database details must stay private")

            auth.user_record_by_username = unavailable
            unavailable_target = FakeTarget(session_headers())
            assert_equal(auth.require_page_access(unavailable_target, "dashboard"), False, "database failure result")
            assert_equal(unavailable_target.status, 503, "database failure status")

            os.environ["PAYMENT_SYNC_TOKEN"] = "payment-only-token"
            auth.user_record_by_username = lambda _username: None
            service_target = FakeTarget({"Authorization": "Bearer payment-only-token"})
            assert_equal(
                auth.require_page_access(service_target, "payments", allow_payment_sync_token=True),
                True,
                "payment sync token should bypass only payment session auth",
            )
            google_service_target = FakeTarget({"Authorization": "Bearer payment-only-token"})
            assert_equal(
                auth.require_page_access(google_service_target, "google-ads", allow_payment_sync_token=True),
                False,
                "payment sync token must not bypass Google Ads access",
            )
            assert_equal(google_service_target.status, 401, "payment token must not authorize Google Ads")

            from api.chat import actions as chat_actions
            original_agent_handler = chat_actions.handle_agent_request
            chat_actions.handle_agent_request = lambda _target: (_ for _ in ()).throw(
                AssertionError("denied Agent request must stop before data processing")
            )
            try:
                agent_target = FakeTarget(session_headers())
                auth.user_record_by_username = lambda _username: {
                    "id": 11,
                    "username": "user@example.test",
                    "display_name": "Test User",
                    "email": "user@example.test",
                    "password_hash": password_hash,
                    "level": 2,
                    "is_active": 1,
                }
                chat_actions.dispatch_request(agent_target, "POST", "agent")
                assert_equal(agent_target.status, 403, "level 2 Agent route should deny before processing")
            finally:
                chat_actions.handle_agent_request = original_agent_handler

            lookup_calls = []

            def options_lookup(_username):
                lookup_calls.append(True)
                return None

            auth.user_record_by_username = options_lookup
            from api.db import index as db_index

            def call_db_route(route, level):
                row = {
                    "id": 11,
                    "username": "user@example.test",
                    "display_name": "Test User",
                    "email": "user@example.test",
                    "password_hash": password_hash,
                    "level": level,
                    "is_active": 1,
                }
                auth.user_record_by_username = lambda _username, row=row: row
                original_offers_handler = db_index.handle_ui_offers
                original_google_handler = db_index.handle_ui_google_ads_workbench
                db_index.handle_ui_offers = lambda target, _query: db_index.send_json(target, 200, {"ok": True})
                db_index.handle_ui_google_ads_workbench = lambda target, _query: db_index.send_json(target, 200, {"ok": True})
                try:
                    environ = {
                        "REQUEST_METHOD": "GET",
                        "PATH_INFO": "/api/ui/db/offers",
                        "QUERY_STRING": "",
                        "HTTP_X_OI_DB_ROUTE": route,
                        "HTTP_COOKIE": session_headers()["Cookie"],
                        "wsgi.input": BytesIO(),
                    }
                    if route == "ui-google-ads-workbench":
                        environ["PATH_INFO"] = "/api/ui/db/google-ads-workbench"
                    return db_index.app(environ, lambda _status, _headers: None)
                finally:
                    db_index.handle_ui_offers = original_offers_handler
                    db_index.handle_ui_google_ads_workbench = original_google_handler

            auth.user_record_by_username = lambda _username: {
                "id": 11,
                "username": "user@example.test",
                "display_name": "Test User",
                "email": "user@example.test",
                "password_hash": password_hash,
                "level": 2,
                "is_active": 1,
            }
            offers_response = call_db_route("ui-offers", 2)
            assert_equal(offers_response[0].startswith(b"{\"ok\":false"), True, "level 2 offers should be blocked")
            google_response = call_db_route("ui-google-ads-workbench", 2)
            assert_equal(google_response[0], b"{\"ok\":true}", "level 2 Google Ads should be allowed")

            options_environ = {
                "REQUEST_METHOD": "OPTIONS",
                "PATH_INFO": "/api/ui/db/google-ads-workbench",
                "QUERY_STRING": "",
                "wsgi.input": BytesIO(),
            }
            db_index.app(options_environ, lambda _status, _headers: None)
            assert_equal(lookup_calls, [], "OPTIONS must not query the user table")

        finally:
            auth.user_record_by_username = original_lookup

        print("page access route checks passed")
    finally:
        for key, value in tracked.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


if __name__ == "__main__":
    main()
