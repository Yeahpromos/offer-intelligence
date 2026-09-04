import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import offer_db


class FakeCursor:
    def __init__(self, row):
        self.row = row
        self.sql = None
        self.params = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params):
        self.sql = sql
        self.params = params

    def fetchone(self):
        return self.row


class FakeConnection:
    def __init__(self, row):
        self.cursor_instance = FakeCursor(row)

    def cursor(self):
        return self.cursor_instance


def assert_true(value, message):
    if not value:
        raise AssertionError(message)


def main():
    row = {
        "id": 7,
        "username": "YpAdmin",
        "display_name": "YeahPromos Admin",
        "email": "admin@example.test",
        "password_hash": "pbkdf2_sha256$1000$salt$digest",
        "level": 0,
        "is_active": 1,
    }
    connection = FakeConnection(row)
    result = offer_db.lookup_user_by_username(" YpAdMiN ", conn=connection)
    executed = connection.cursor_instance

    assert_true(result == row, "user lookup should return the database row")
    assert_true(executed.params == (" YpAdMiN ",), "username must be passed as a bound parameter")
    assert_true(" YpAdMiN " not in executed.sql, "username must not be interpolated into SQL")
    assert_true(
        "SELECT id, username, display_name, email, password_hash, level, is_active" in executed.sql,
        "lookup must select only auth columns",
    )
    assert_true(f"FROM `{offer_db.USER_TABLE}`" in executed.sql, "lookup must use the fixed user table")
    assert_true("LIMIT 1" in executed.sql, "lookup must be bounded to one user")
    assert_true("SELECT *" not in executed.sql.upper(), "lookup must not select arbitrary columns")

    print("user lookup checks passed")


if __name__ == "__main__":
    main()
