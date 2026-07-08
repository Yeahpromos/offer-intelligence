#!/usr/bin/env python3

from __future__ import annotations

import getpass

from auth import make_password_hash


def main() -> int:
    password = getpass.getpass("Admin password: ")
    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        raise SystemExit("Passwords do not match")
    if len(password) < 12:
        raise SystemExit("Use at least 12 characters for the admin password")
    print(make_password_hash(password))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
