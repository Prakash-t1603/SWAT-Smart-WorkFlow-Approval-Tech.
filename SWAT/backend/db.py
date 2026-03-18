from __future__ import annotations

import json
import sqlite3
import threading
from typing import Any

import config

try:
    from pymongo import MongoClient
    from pymongo.errors import PyMongoError, ServerSelectionTimeoutError
except ImportError:  # pragma: no cover
    MongoClient = None
    PyMongoError = Exception
    ServerSelectionTimeoutError = Exception


USING_SQLITE_DB = False
_MONGO_DB_CACHE = None
_SQLITE_CONN: sqlite3.Connection | None = None
_SQLITE_LOCK = threading.Lock()


class _UpdateResult:
    def __init__(self, matched_count: int):
        self.matched_count = matched_count


def _matches(doc: dict, query: dict) -> bool:
    if not query:
        return True
    for key, value in query.items():
        if isinstance(value, dict) and "$in" in value:
            if doc.get(key) not in value["$in"]:
                return False
            continue
        if doc.get(key) != value:
            return False
    return True


def sqlite_conn() -> sqlite3.Connection:
    global _SQLITE_CONN
    if _SQLITE_CONN is not None:
        return _SQLITE_CONN
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.SQLITE_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    _SQLITE_CONN = conn
    return conn


def sqlite_lock() -> threading.Lock:
    return _SQLITE_LOCK


class SqliteCollection:
    def __init__(self, name: str):
        self.name = name
        self._ensure_table()

    def _ensure_table(self) -> None:
        table = self.name
        with _SQLITE_LOCK:
            sqlite_conn().execute(
                f"""
                CREATE TABLE IF NOT EXISTS {table} (
                    pk INTEGER PRIMARY KEY AUTOINCREMENT,
                    id TEXT,
                    email TEXT,
                    doc TEXT NOT NULL
                )
                """
            )
            sqlite_conn().execute(
                f"""
                DELETE FROM {table}
                WHERE id IS NOT NULL AND id != ''
                  AND pk NOT IN (
                    SELECT MIN(pk) FROM {table} WHERE id IS NOT NULL AND id != '' GROUP BY id
                  )
                """
            )
            sqlite_conn().execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_id ON {table}(id)")
            sqlite_conn().execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_email ON {table}(email)")
            sqlite_conn().commit()

    def _all_rows(self):
        with _SQLITE_LOCK:
            return sqlite_conn().execute(f"SELECT pk, doc FROM {self.name}").fetchall()

    def _iter_docs(self):
        rows = self._all_rows()
        bad_pks: list[int] = []
        for row in rows:
            raw = row["doc"]
            if raw is None or not str(raw).strip():
                bad_pks.append(int(row["pk"]))
                continue
            try:
                item = json.loads(raw)
            except json.JSONDecodeError:
                bad_pks.append(int(row["pk"]))
                continue
            if not isinstance(item, dict):
                bad_pks.append(int(row["pk"]))
                continue
            yield int(row["pk"]), item

        if bad_pks:
            with _SQLITE_LOCK:
                sqlite_conn().executemany(
                    f"DELETE FROM {self.name} WHERE pk = ?",
                    [(pk,) for pk in bad_pks],
                )
                sqlite_conn().commit()

    def count_documents(self, query: dict) -> int:
        count = 0
        for _pk, item in self._iter_docs():
            if _matches(item, query):
                count += 1
        return count

    def find(self, query: dict | None = None, projection: dict | None = None):
        query = query or {}
        result = []
        for _pk, item in self._iter_docs():
            if not _matches(item, query):
                continue
            if projection:
                projected = {}
                for key, include in projection.items():
                    if include and key in item:
                        projected[key] = item[key]
                result.append(projected)
            else:
                result.append(dict(item))
        return result

    def find_one(self, query: dict):
        for _pk, item in self._iter_docs():
            if _matches(item, query):
                return dict(item)
        return None

    def insert_many(self, docs: list[dict]):
        for doc in docs:
            self.insert_one(doc)

    def insert_one(self, doc: dict):
        item = dict(doc)
        doc_id = str(item.get("id") or "").strip()
        with _SQLITE_LOCK:
            if doc_id:
                updated = sqlite_conn().execute(
                    f"UPDATE {self.name} SET email = ?, doc = ? WHERE id = ?",
                    (str(item.get("email") or ""), json.dumps(item), doc_id),
                ).rowcount
                if not updated:
                    sqlite_conn().execute(
                        f"INSERT INTO {self.name}(id, email, doc) VALUES (?, ?, ?)",
                        (doc_id, str(item.get("email") or ""), json.dumps(item)),
                    )
            else:
                sqlite_conn().execute(
                    f"INSERT INTO {self.name}(id, email, doc) VALUES (?, ?, ?)",
                    (str(item.get("id") or ""), str(item.get("email") or ""), json.dumps(item)),
                )
            sqlite_conn().commit()

    def update_one(self, query: dict, update: dict):
        for pk, item in self._iter_docs():
            if not _matches(item, query):
                continue
            if "$set" in update:
                for key, value in update["$set"].items():
                    item[key] = value
            if "$push" in update:
                for key, value in update["$push"].items():
                    if key not in item or not isinstance(item[key], list):
                        item[key] = []
                    item[key].append(value)
            if "$unset" in update:
                for key in update["$unset"].keys():
                    item.pop(key, None)
            with _SQLITE_LOCK:
                sqlite_conn().execute(
                    f"UPDATE {self.name} SET id = ?, email = ?, doc = ? WHERE pk = ?",
                    (str(item.get("id") or ""), str(item.get("email") or ""), json.dumps(item), pk),
                )
                sqlite_conn().commit()
            return _UpdateResult(1)
        return _UpdateResult(0)

    def delete_one(self, query: dict):
        for pk, item in self._iter_docs():
            if _matches(item, query):
                with _SQLITE_LOCK:
                    sqlite_conn().execute(f"DELETE FROM {self.name} WHERE pk = ?", (pk,))
                    sqlite_conn().commit()
                return _UpdateResult(1)
        return _UpdateResult(0)


def mongo_db():
    global _MONGO_DB_CACHE
    if MongoClient is None:
        raise RuntimeError("pymongo is not installed. Run pip install -r backend/requirements.txt")
    if _MONGO_DB_CACHE is not None:
        return _MONGO_DB_CACHE
    client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=2000)
    client.admin.command("ping")
    _MONGO_DB_CACHE = client[config.MONGO_DB]
    return _MONGO_DB_CACHE


def users_col():
    global USING_SQLITE_DB
    if config.DATA_MODE in {"sqlite", "local"} or USING_SQLITE_DB:
        USING_SQLITE_DB = True
        return SqliteCollection("users")
    try:
        return mongo_db()["users"]
    except Exception:
        USING_SQLITE_DB = True
        return SqliteCollection("users")


def requests_col():
    global USING_SQLITE_DB
    if config.DATA_MODE in {"sqlite", "local"} or USING_SQLITE_DB:
        USING_SQLITE_DB = True
        return SqliteCollection("requests")
    try:
        return mongo_db()["requests"]
    except Exception:
        USING_SQLITE_DB = True
        return SqliteCollection("requests")


def workflows_col():
    global USING_SQLITE_DB
    if config.DATA_MODE in {"sqlite", "local"} or USING_SQLITE_DB:
        USING_SQLITE_DB = True
        return SqliteCollection("workflows")
    try:
        return mongo_db()["workflows"]
    except Exception:
        USING_SQLITE_DB = True
        return SqliteCollection("workflows")


def otp_col():
    global USING_SQLITE_DB
    if config.DATA_MODE in {"sqlite", "local"} or USING_SQLITE_DB:
        USING_SQLITE_DB = True
        return SqliteCollection("otps")
    try:
        return mongo_db()["otps"]
    except Exception:
        USING_SQLITE_DB = True
        return SqliteCollection("otps")


def delete_all_documents(col) -> int:
    if col is None:
        return 0
    if isinstance(col, SqliteCollection):
        with _SQLITE_LOCK:
            sqlite_conn().execute(f"DELETE FROM {col.name}")
            sqlite_conn().commit()
        return 1
    delete_many = getattr(col, "delete_many", None)
    if callable(delete_many):
        res = delete_many({})
        return int(getattr(res, "deleted_count", 1) or 0)
    count = 0
    for item in (col.find({}) if hasattr(col, "find") else []):
        doc_id = (item or {}).get("id")
        if doc_id:
            col.delete_one({"id": doc_id})
            count += 1
    return count


__all__ = [
    "PyMongoError",
    "ServerSelectionTimeoutError",
    "SqliteCollection",
    "USING_SQLITE_DB",
    "delete_all_documents",
    "mongo_db",
    "otp_col",
    "requests_col",
    "sqlite_conn",
    "sqlite_lock",
    "users_col",
    "workflows_col",
]
