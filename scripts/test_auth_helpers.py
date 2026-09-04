import json
import os
import sys
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import auth


ENV_KEYS = (
    "OI_AUTH_ENABLED",
    "OI_SESSION_SECRET",
    "OI_SESSION_TTL_SECONDS",
    "VERCEL_ENV",
    "OFFER_DB_HOST",
    "OFFER_DB_NAME",
    "OFFER_DB_USER",
    "OFFER_DB_PASSWORD",
)


def assert_true(value, message):
    if not value:
        raise AssertionError(message)


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def make_user(password, *, level=0, is_active=1):
    return {
        "id": 7,
        "username": " YpAdmin ",
        "display_name": "YeahPromos Admin",
        "email": "admin@example.test",
        "password_hash": auth.make_password_hash(password, iterations=1_000, salt="test-salt"),
        "level": level,
        "is_active": is_active,
    }


def signed_cookie(payload):
    encoded = auth.b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{encoded}.{auth._signature(encoded)}"


class FakeTarget:
    def __init__(self, body=b"", headers=None):
        self.headers = {"Host": "127.0.0.1", **(headers or {})}
        self.rfile = BytesIO(body)
        self.wfile = BytesIO()
        self.status = None
        self.response_headers = []

    def send_response(self, status):
        self.status = int(status)

    def send_header(self, name, value):
        self.response_headers.append((str(name), str(value)))

    def end_headers(self):
        return None


def response_json(target):
    return json.loads(target.wfile.getvalue().decode("utf-8"))


def response_header(target, name):
    for header_name, value in target.response_headers:
        if header_name.lower() == name.lower():
            return value
    return ""


def main():
    old_env = {key: os.environ.get(key) for key in ENV_KEYS}
    try:
        os.environ.update(
            {
                "OI_AUTH_ENABLED": "1",
                "OI_SESSION_SECRET": "unit-test-session-secret",
                "OI_SESSION_TTL_SECONDS": "3600",
                "VERCEL_ENV": "preview",
                "OFFER_DB_HOST": "db.example.test",
                "OFFER_DB_NAME": "offer_intelligence",
                "OFFER_DB_USER": "readonly",
                "OFFER_DB_PASSWORD": os.urandom(18).hex(),
            }
        )

        assert_equal(auth.normalize_username("  YpAdMiN  "), "ypadmin", "usernames should trim and casefold")
        assert_equal(auth.normalize_username(None), "", "None should normalize to an empty username")
        assert_equal(auth.normalize_username("   "), "", "blank usernames should normalize to empty")

        assert_equal(auth.VALID_ACCESS_LEVELS, {0, 1, 2}, "access levels should be fixed")
        for level in (0, 1, 2):
            for page in auth.PAGE_NAMES:
                if level == 0:
                    expected = True
                elif level == 1:
                    expected = page != "google-ads"
                else:
                    expected = page == "google-ads"
                assert_equal(auth.can_access_page(level, page), expected, "page access matrix mismatch")
        assert_true(not auth.can_access_page(3, "agent"), "unknown access levels must deny access")
        assert_true(not auth.can_access_page(0, "unknown-page"), "unknown pages must deny access")
        assert_equal(auth.default_page_for_level(0), "agent", "level 0 default page")
        assert_equal(auth.default_page_for_level(1), "agent", "level 1 default page")
        assert_equal(auth.default_page_for_level(2), "google-ads", "level 2 default page")

        password = os.urandom(18).hex()
        wrong_password = os.urandom(18).hex()
        encoded_hash = auth.make_password_hash(password, iterations=1_000, salt="test-salt")
        assert_true(auth.verify_password(password, encoded_hash), "matching PBKDF2 hash should verify")
        assert_true(not auth.verify_password(wrong_password, encoded_hash), "wrong password should not verify")
        for invalid_hash in ("", "plain-text", "pbkdf2_sha256$nope", "other$1000$salt$hash"):
            assert_true(not auth.verify_password(password, invalid_hash), "invalid hashes must be rejected")

        token, expires_at = auth.create_session("  YpAdMiN  ")
        headers = {"Cookie": f"{auth.SESSION_COOKIE}={token}"}
        payload = auth.session_payload(headers)
        assert_true(payload is not None, "v2 session should parse")
        assert_equal(set(payload), {"v", "sub", "exp", "iat"}, "session must contain only v2 fields")
        assert_equal(payload["v"], 2, "session version")
        assert_equal(payload["sub"], "ypadmin", "session subject must be normalized")
        assert_equal(payload["exp"], expires_at, "session expiry should be returned")

        user = make_user(password)

        def lookup(_username):
            return user

        current = auth.current_user_from_headers(headers, user_lookup=lookup)
        assert_equal(current["level"], 0, "current user level")
        assert_true("password_hash" not in current, "password hash must not enter user context")
        assert_true("passwordHash" not in current, "password hash must not enter user context")
        assert_true("role" not in current, "role must not enter user context")

        user["level"] = 2
        refreshed = auth.current_user_from_headers(headers, user_lookup=lookup)
        assert_equal(refreshed["level"], 2, "user level must be re-read for every request")

        user["level"] = 9
        invalid_level = auth.current_user_from_headers(headers, user_lookup=lookup)
        assert_true(invalid_level is not None and not invalid_level["_level_valid"], "invalid levels must remain denied")
        user["level"] = 2
        user["is_active"] = 0
        assert_true(auth.current_user_from_headers(headers, user_lookup=lookup) is None, "inactive users must lose sessions")
        user["is_active"] = 1

        old_v1_headers = {
            "Cookie": f"{auth.SESSION_COOKIE}={signed_cookie({'sub': 'ypadmin', 'role': 'admin', 'exp': expires_at})}"
        }
        assert_true(
            auth.current_user_from_headers(old_v1_headers, user_lookup=lookup) is None,
            "v1 role sessions must be rejected",
        )
        tampered_headers = {"Cookie": f"{auth.SESSION_COOKIE}={token[:-2]}xx"}
        assert_true(
            auth.current_user_from_headers(tampered_headers, user_lookup=lookup) is None,
            "tampered sessions must be rejected",
        )

        os.environ["OI_AUTH_ENABLED"] = "0"
        synthetic = auth.current_user_from_headers(
            {}, user_lookup=lambda _username: (_ for _ in ()).throw(AssertionError("DB lookup should not run"))
        )
        assert_equal(synthetic["level"], 0, "disabled auth should use a synthetic level 0 user")
        assert_true(synthetic["authDisabled"], "disabled auth should be marked")

        os.environ["OI_AUTH_ENABLED"] = "0"
        os.environ["VERCEL_ENV"] = "production"
        try:
            auth.current_user_from_headers({}, user_lookup=lookup)
        except auth.AuthConfigurationError:
            pass
        else:
            raise AssertionError("production must fail closed when auth is disabled")

        os.environ["OI_AUTH_ENABLED"] = "1"
        os.environ["VERCEL_ENV"] = "preview"
        user["level"] = 0
        previous_lookup = auth.user_record_by_username
        previous_sleep = auth.time.sleep
        auth.user_record_by_username = lookup
        auth.time.sleep = lambda _seconds: None
        try:
            login_body = json.dumps({"username": " YpAdMiN ", "password": password}).encode("utf-8")
            login = FakeTarget(login_body, {"Content-Length": str(len(login_body))})
            auth.handle_auth_login(login)
            assert_equal(login.status, 200, "valid database user should be able to log in")
            login_response = response_json(login)
            assert_true(login_response["user"]["level"] == 0, "login should return the database access level")
            assert_true("role" not in login_response["user"], "login response must not include role")
            assert_true("password_hash" not in json.dumps(login_response), "login response must not include password hash")
            assert_true("HttpOnly" in response_header(login, "Set-Cookie"), "login cookie must be HttpOnly")
            assert_true("SameSite=Lax" in response_header(login, "Set-Cookie"), "login cookie must use SameSite=Lax")

            cookie_value = response_header(login, "Set-Cookie").split(";", 1)[0]
            session = FakeTarget(headers={"Cookie": cookie_value})
            auth.handle_auth_session(session)
            assert_equal(session.status, 200, "valid session should be readable")
            assert_equal(response_json(session)["user"]["level"], 0, "session should return current level")

            user["level"] = 2
            refreshed_session = FakeTarget(headers={"Cookie": cookie_value})
            auth.handle_auth_session(refreshed_session)
            assert_equal(response_json(refreshed_session)["user"]["level"], 2, "session should re-read level")

            wrong_body = json.dumps({"username": "ypadmin", "password": wrong_password}).encode("utf-8")
            wrong_login = FakeTarget(wrong_body, {"Content-Length": str(len(wrong_body))})
            auth.handle_auth_login(wrong_login)
            assert_equal(wrong_login.status, 401, "wrong password should not log in")

            user["is_active"] = 0
            inactive_login = FakeTarget(login_body, {"Content-Length": str(len(login_body))})
            auth.handle_auth_login(inactive_login)
            assert_equal(inactive_login.status, 401, "inactive users should not log in")
            user["is_active"] = 1

            user["level"] = 9
            invalid_level_login = FakeTarget(login_body, {"Content-Length": str(len(login_body))})
            auth.handle_auth_login(invalid_level_login)
            assert_equal(invalid_level_login.status, 401, "invalid levels should not log in")
        finally:
            auth.user_record_by_username = previous_lookup
            auth.time.sleep = previous_sleep

        print("auth helper checks passed")
    finally:
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


if __name__ == "__main__":
    main()
