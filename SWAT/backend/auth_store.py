from __future__ import annotations

import config
import db
from utils import normalize_email, now_iso


def ensure_auth_table() -> None:
    if not (config.DATA_MODE in {"sqlite", "local"} or db.USING_SQLITE_DB):
        return
    with db.sqlite_lock():
        db.sqlite_conn().execute(
            """
            CREATE TABLE IF NOT EXISTS user_auth (
                user_id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        db.sqlite_conn().execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_auth_email ON user_auth(email)")
        db.sqlite_conn().commit()


def upsert_user_auth(user_id: str, email: str, password: str) -> None:
    if config.DATA_MODE in {"sqlite", "local"} or db.USING_SQLITE_DB:
        ensure_auth_table()
        with db.sqlite_lock():
            db.sqlite_conn().execute(
                """
                INSERT INTO user_auth(user_id, email, password, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                  email=excluded.email,
                  password=excluded.password,
                  updated_at=excluded.updated_at
                """,
                (str(user_id), normalize_email(email), str(password), now_iso()),
            )
            db.sqlite_conn().commit()
        return
    db.users_col().update_one({"id": user_id}, {"$set": {"password": password}})


def password_for_user(user: dict | None) -> str | None:
    if not user:
        return None
    if config.DATA_MODE in {"sqlite", "local"} or db.USING_SQLITE_DB:
        ensure_auth_table()
        with db.sqlite_lock():
            row = db.sqlite_conn().execute(
                "SELECT password FROM user_auth WHERE user_id = ? OR email = ? LIMIT 1",
                (str(user.get("id") or ""), normalize_email(user.get("email"))),
            ).fetchone()
        return str(row["password"]) if row and row["password"] is not None else None
    return str(user.get("password") or "")


def verify_user_password(user: dict | None, password: str) -> bool:
    stored = password_for_user(user)
    return bool(stored is not None and stored == str(password or ""))


def set_user_password(user: dict | None, new_password: str) -> None:
    if not user:
        return
    upsert_user_auth(str(user.get("id") or ""), str(user.get("email") or ""), str(new_password or ""))
