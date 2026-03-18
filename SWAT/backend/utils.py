from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone

import config


def now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def parse_iso_dt(value: str | None) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def active_until_iso(hours: int = config.ACTIVE_WINDOW_HOURS) -> str:
    return (datetime.now(tz=timezone.utc) + timedelta(hours=hours)).isoformat()


def make_token(payload: dict) -> str:
    return base64.b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8")


def normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def normalize_role(value: str | None) -> str:
    raw = (value or "").strip()
    return config.ROLE_ALIASES.get(raw.lower(), raw)


def strip_mongo_id(doc: dict | None) -> dict | None:
    if not doc:
        return doc
    data = dict(doc)
    data.pop("_id", None)
    return data

