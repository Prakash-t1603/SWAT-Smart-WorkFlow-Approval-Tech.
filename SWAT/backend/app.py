from __future__ import annotations
import json
import os
import random
import sys
import copy
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

try:
    from flask_sock import Sock
except ImportError:
    Sock = None

import auth_store
import config
import db
import mailer
from utils import active_until_iso, make_token, normalize_email, normalize_role, now_iso, parse_iso_dt, strip_mongo_id

PyMongoError = db.PyMongoError
ServerSelectionTimeoutError = db.ServerSelectionTimeoutError

app = Flask(__name__, static_folder=os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend"))
CORS(app)
sock = Sock(app) if Sock else None

DATA_MODE = config.DATA_MODE
SLA_HOURS = config.SLA_HOURS
ROLE_FALLBACK = config.ROLE_FALLBACK
LEGACY_USERS_FILE = config.LEGACY_USERS_FILE
LEGACY_REQUESTS_FILE = config.LEGACY_REQUESTS_FILE
LEGACY_WORKFLOWS_FILE = config.LEGACY_WORKFLOWS_FILE

WS_CLIENTS: list[Any] = []
SEED_ATTEMPTED = False
_SEED_LOCK = threading.Lock()

def users_col():
    return db.users_col()


def requests_col():
    return db.requests_col()


def workflows_col():
    return db.workflows_col()


def otp_col():
    return db.otp_col()


def load_legacy_json(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            return []
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [dict(item) for item in parsed if isinstance(item, dict)]
    except Exception:
        return []
    return []


def sync_collection_from_json(col, path: Path) -> int:
    docs = load_legacy_json(path)
    if not docs:
        return 0
    synced = 0
    for doc in docs:
        doc_id = str(doc.get("id") or "").strip()
        if not doc_id:
            continue
        existing = col.find_one({"id": doc_id})
        if existing:
            col.update_one({"id": doc_id}, {"$set": doc})
        else:
            col.insert_one(doc)
        synced += 1
    return synced


def sync_users_from_json(path: Path) -> int:
    docs = load_legacy_json(path)
    if not docs:
        return 0
    uc = users_col()
    synced = 0
    for raw in docs:
        user_id = str(raw.get("id") or "").strip()
        email = normalize_email(raw.get("email"))
        if not user_id or not email:
            continue

        password = str(raw.get("password") or "").strip()
        user_doc = dict(raw)
        user_doc["email"] = email
        user_doc["orgRole"] = normalize_role(user_doc.get("orgRole"))
        user_doc.pop("password", None)

        existing = uc.find_one({"id": user_id})
        if existing:
            uc.update_one({"id": user_id}, {"$set": user_doc, "$unset": {"password": 1}})
        else:
            uc.insert_one(user_doc)
        if password:
            auth_store.upsert_user_auth(user_id, email, password)
        synced += 1
    return synced


def seed_defaults() -> None:
    migrate_users = str(os.getenv("MIGRATE_LEGACY_USERS") or "").strip().lower() in {"1", "true", "yes"}
    if migrate_users:
        sync_users_from_json(LEGACY_USERS_FILE)

    wc = workflows_col()
    sync_collection_from_json(wc, LEGACY_WORKFLOWS_FILE)

    # Ensure core demo workflows are present (idempotent upsert).
    defaults = [
        {
            "id": "WF-EXP-1",
            "name": "Expense Small",
            "description": "Expense <= 2000",
            "requestType": "expense",
            "minAmount": 0,
            "maxAmount": 2000,
            "levels": ["Operations Manager", "COO"],
            "createdAt": now_iso(),
        },
        {
            "id": "WF-EXP-2",
            "name": "Expense Standard",
            "description": "Expense > 2000",
            "requestType": "expense",
            "minAmount": 2001,
            "maxAmount": None,
            "levels": ["Finance Manager", "CFO", "CEO"],
            "createdAt": now_iso(),
        },
    ]
    for wf in defaults:
        existing = wc.find_one({"id": wf["id"]})
        if existing:
            wc.update_one({"id": wf["id"]}, {"$set": dict(wf)})
        else:
            wc.insert_one(dict(wf))

    rc = requests_col()
    sync_collection_from_json(rc, LEGACY_REQUESTS_FILE)


def _ensure_seeded_once():
    global SEED_ATTEMPTED
    if SEED_ATTEMPTED:
        return True, None, None

    with _SEED_LOCK:
        if SEED_ATTEMPTED:
            return True, None, None
        try:
            seed_defaults()
            SEED_ATTEMPTED = True
           
            return True, None, None
        except (RuntimeError, ServerSelectionTimeoutError, PyMongoError, sqlite3.Error, OSError) as exc:
            return False, exc, 503
        except Exception as exc:
            return False, exc, 500


def user_public(user: dict) -> dict:
    user = ensure_user_availability_current(user) or user
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user.get("role", "user"),
        "orgRole": normalize_role(user.get("orgRole")),
        "reportsTo": user.get("reportsTo"),
        "isAvailable": bool(user.get("isAvailable", True)),
    }


def ensure_user_availability_current(user: dict | None) -> dict | None:
    if not user:
        return None
    # Availability toggles are not used anymore; treat stored user as-is.
    return strip_mongo_id(user)


def sweep_expired_active_users() -> None:
    return


def get_user(identifier: str | None) -> dict | None:
    key = str(identifier or "").strip()
    if not key:
        return None
    uc = users_col()
    user = uc.find_one({"id": key})
    if user:
        return ensure_user_availability_current(user)
    user = uc.find_one({"email": normalize_email(key)})
    return ensure_user_availability_current(user)


def manager_user(user: dict | None) -> dict | None:
    if not user:
        return None
    return get_user(user.get("reportsTo"))


def descendants(root_user_id: str) -> set[str]:
    uc = users_col()
    ids: set[str] = set()
    stack = [root_user_id]
    while stack:
        current = stack.pop()
        if not current or current in ids:
            continue
        ids.add(current)
        for child in uc.find({"reportsTo": current}, {"id": 1}):
            child_id = child.get("id")
            if child_id:
                stack.append(child_id)
    return ids


def viewer_scope_user_ids(viewer: dict) -> set[str]:
    role = normalize_role(viewer.get("orgRole"))
    viewer_id = str(viewer.get("id") or "").strip()
    if not viewer_id:
        return set()

    # Visibility is strictly hierarchical based on the org tree.
    # CEO/admin can view all requests; everyone else can view only
    # their own branch (self + descendants).
    if viewer.get("role") == "admin" or role == "CEO":
        return {u["id"] for u in users_col().find({}, {"id": 1})}

    return descendants(viewer_id)


def can_manage_employees(viewer: dict | None) -> bool:
    if not viewer:
        return False
    return viewer.get("role") == "admin"


def can_view_request(viewer: dict, item: dict) -> bool:
    viewer_id = str(viewer.get("id") or "")
    viewer_role = normalize_role(viewer.get("orgRole"))
    if viewer.get("role") == "admin" or viewer_role == "CEO":
        return True
    if str(item.get("userId") or "") == viewer_id:
        return True
    for step in item.get("steps", []):
        if str(step.get("approverId") or "") == viewer_id:
            return True
    return False


def is_admin_or_ceo(user: dict | None) -> bool:
    if not user:
        return False
    return user.get("role") == "admin" or normalize_role(user.get("orgRole")) == "CEO"


def viewer_is_approver_for_request(viewer: dict, item: dict) -> bool:
    viewer_id = str(viewer.get("id") or "")
    if not viewer_id:
        return False
    for step in item.get("steps", []):
        if str(step.get("approverId") or "") == viewer_id:
            return True
    return False


def should_hide_amount(viewer: dict, item: dict) -> bool:
    # Privacy switch: when enabled, hide request amount from approvers (but never
    # from the requester or admins/CEO).
    hide_enabled = bool(getattr(config, "HIDE_AMOUNT_FROM_APPROVERS", False))
    if not hide_enabled:
        return False
    if is_admin_or_ceo(viewer):
        return False
    viewer_id = str(viewer.get("id") or "")
    if str(item.get("userId") or "") == viewer_id:
        return False
    return viewer_is_approver_for_request(viewer, item)


def request_summary_for_viewer(viewer: dict, item: dict) -> dict:
    summary = request_summary(item)
    if should_hide_amount(viewer, item):
        summary["amount"] = None
    return summary


def sanitize_request_for_viewer(viewer: dict, item: dict) -> dict:
    safe = copy.deepcopy(item)
    if should_hide_amount(viewer, safe):
        safe["amount"] = None
    return safe


def resolve_active_approver(user: dict | None) -> tuple[dict | None, str | None]:
    if not user:
        return None, None
    return user, None


def build_parent_chain(requester: dict) -> list[dict]:
    chain: list[dict] = []
    current = manager_user(requester)
    seen: set[str] = set()
    while current and current.get("id") not in seen:
        seen.add(current["id"])
        chain.append(current)
        current = manager_user(current)
    return chain


def request_summary(item: dict) -> dict:
    pending = next((s for s in item.get("steps", []) if s.get("status") == "pending"), None)
    acted_steps = [s for s in item.get("steps", []) if s.get("status") in {"approved", "rejected", "forwarded"} and s.get("actedAt")]
    acted_steps.sort(key=lambda s: str(s.get("actedAt") or ""))
    latest = acted_steps[-1] if acted_steps else None
    return {
        "id": item["id"],
        "userId": item.get("userId"),
        "requestType": item.get("requestType", "general"),
        "title": item.get("title", "General Request"),
        "amount": item.get("amount", 0),
        "reason": item.get("reason", ""),
        "status": item.get("status", "pending"),
        "createdAt": item.get("createdAt", now_iso()),
        "updatedAt": item.get("updatedAt", item.get("createdAt", now_iso())),
        "workflowName": item.get("workflow", {}).get("name", "Hierarchy Flow"),
        "currentRole": pending.get("role") if pending else None,
        "requesterName": (item.get("requester") or {}).get("name", ""),
        "requesterEmail": (item.get("requester") or {}).get("email", ""),
        "lastAction": latest.get("status") if latest else None,
        "lastActionAt": latest.get("actedAt") if latest else None,
    }


def broadcast_event(event_type: str, payload: dict) -> None:
    if not WS_CLIENTS:
        return
    packet = json.dumps({"type": event_type, "payload": payload, "at": now_iso()})
    stale = []
    for ws in WS_CLIENTS:
        try:
            ws.send(packet)
        except Exception:
            stale.append(ws)
    for ws in stale:
        if ws in WS_CLIENTS:
            WS_CLIENTS.remove(ws)


def queue_mail(request_item: dict, step: dict) -> None:
    approver = get_user(step.get("approverId"))
    to_email = normalize_email((approver or {}).get("email"))
    mail = {
        "id": f"mail-{int(datetime.now(tz=timezone.utc).timestamp() * 1000)}",
        "toUserId": step.get("approverId"),
        "toRole": step.get("role"),
        "subject": f"Approval needed: {request_item['id']}",
        "body": f"Please review {request_item.get('requestType', 'request')}: {request_item.get('title', request_item.get('reason', ''))}",
        "requestId": request_item["id"],
        "createdAt": now_iso(),
    }

    if to_email:
        ok, err = mailer.send_email(
            to_email,
            mail["subject"],
            "\n".join(
                [
                    mail["body"],
                    "",
                    f"Request ID: {request_item['id']}",
                    f"Requester: {(request_item.get('requester') or {}).get('name', '')} <{(request_item.get('requester') or {}).get('email', '')}>",
                    f"Status: {request_item.get('status', 'pending')}",
                ]
            ),
        )
        if ok:
            mail["deliveredAt"] = now_iso()
        else:
            mail["deliveryError"] = err

    rc = requests_col()
    rc.update_one({"id": request_item["id"]}, {"$push": {"mailbox": mail}})


def notify_requester_decision(request_item: dict, action: str, actor: dict | None) -> None:
    requester_email = normalize_email(((request_item.get("requester") or {}).get("email")))
    if not requester_email:
        requester = get_user(request_item.get("userId"))
        requester_email = normalize_email((requester or {}).get("email"))
    if not requester_email:
        return

    status = request_item.get("status", "pending")
    actor_name = (actor or {}).get("name") or normalize_email((actor or {}).get("email")) or "Approver"
    subject = f"Request {request_item.get('id')} {status}"

    lines = [
        f"Your request has been {status}.",
        "",
        f"Request ID: {request_item.get('id')}",
        f"Type: {str(request_item.get('requestType') or 'general').upper()}",
        f"Title: {request_item.get('title') or '-'}",
    ]
    if str(request_item.get("requestType") or "").lower() == "expense":
        try:
            amount = float(request_item.get("amount") or 0)
        except Exception:
            amount = 0
        if amount > 0:
            lines.append(f"Amount: INR {amount:.2f}")
    lines.extend(
        [
            f"Decision: {action} by {actor_name}",
            f"Updated at: {request_item.get('updatedAt') or now_iso()}",
        ]
    )

    mailer.send_email(requester_email, subject, "\n".join(lines))


def evaluate_status(item: dict) -> str:
    steps = item.get("steps", [])
    if any(s.get("status") == "rejected" for s in steps):
        return "rejected"
    if steps and all(s.get("status") == "approved" for s in steps):
        return "approved"
    return "pending"


def maybe_escalate(item: dict) -> dict:
    steps = item.get("steps", [])
    idx = int(item.get("currentStepIndex", 0))
    if idx < 0 or idx >= len(steps):
        return item
    step = steps[idx]
    if step.get("status") != "pending":
        return item

    pending_since = step.get("pendingSince")
    approver = get_user(step.get("approverId"))
    if not approver:
        return item

    # Backward-compatibility repair:
    # older logic could auto-route HR Director steps to CTO.
    escalated_from_id = step.get("escalatedFromUserId")
    original_approver = get_user(escalated_from_id) if escalated_from_id else None
    if (
        original_approver
        and normalize_role(original_approver.get("orgRole")) == "HR Director"
        and normalize_role(approver.get("orgRole")) == "CTO"
    ):
        step["approverId"] = original_approver.get("id")
        step["role"] = "HR Director"
        step["pendingSince"] = now_iso()
        step["escalatedFromUserId"] = None
        item["steps"] = steps
        requests_col().update_one({"id": item["id"]}, {"$set": {"steps": steps}})
        return item

    return item


@app.before_request
def ensure_seeded() -> None:
    path = request.path or ""
    if request.method == "OPTIONS":
        return None
    if not path.startswith("/api"):
        return None

    ok, exc, status = _ensure_seeded_once()
    if not ok:
        payload = {"error": "Database is unavailable. If using Mongo mode, start MongoDB or set MONGO_URI."}
        if status == 500:
            payload = {"error": "Failed to initialize datastore."}
        if app.debug and exc is not None:
            payload["detail"] = f"{type(exc).__name__}: {exc}"
        return jsonify(payload), int(status or 500)
    sweep_expired_active_users()


@app.errorhandler(ServerSelectionTimeoutError)
def handle_mongo_timeout(_error):
    return jsonify({"error": "Database is unavailable. If using Mongo mode, start MongoDB or set MONGO_URI."}), 503


@app.errorhandler(PyMongoError)
def handle_mongo_error(_error):
    return jsonify({"error": "Database error occurred. Please check MongoDB connection."}), 503


if sock:
    @sock.route("/ws/events")
    def ws_events(ws):
        ok, exc, status = _ensure_seeded_once()
        if not ok:
            message = "Database unavailable. Realtime disabled until datastore is ready."
            if app.debug and exc is not None:
                message = f"{message} ({type(exc).__name__}: {exc})"
            ws.send(json.dumps({"type": "error", "payload": {"message": message, "status": int(status or 500)}, "at": now_iso()}))
            return
        WS_CLIENTS.append(ws)
        try:
            ws.send(json.dumps({"type": "connected", "payload": {"message": "Realtime channel ready"}, "at": now_iso()}))
            while True:
                incoming = ws.receive()
                if incoming is None:
                    break
        except Exception:
            pass
        finally:
            if ws in WS_CLIENTS:
                WS_CLIENTS.remove(ws)


@app.get("/api/health")
def health():
    return {"ok": True, "service": "smartflow-backend-sqlite", "dataMode": DATA_MODE}, 200


@app.post("/api/auth/login")
def login():
    payload = request.get_json(silent=True) or {}
    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "")
    selected_role = normalize_role(payload.get("loginRole"))

    user = strip_mongo_id(users_col().find_one({"email": email}))
    if not user or not auth_store.verify_user_password(user, password):
        return jsonify({"error": "Invalid email or password"}), 401

    actual_role = normalize_role(user.get("orgRole"))
    if selected_role and selected_role != actual_role:
        return jsonify({"error": f"Selected role does not match account role ({actual_role})"}), 403

    return jsonify({"user": user_public(user), "token": make_token({"sub": user["id"], "role": user.get("role"), "orgRole": actual_role})}), 200


@app.post("/api/auth/signup")
def signup():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()
    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "")

    if not name or not email or not password:
        return jsonify({"error": "name, email, and password are required"}), 400
    if users_col().find_one({"email": email}):
        return jsonify({"error": "Email already exists"}), 409

    ceo = strip_mongo_id(users_col().find_one({"orgRole": "CEO"}))
    new_user = {
        "id": f"u-{int(datetime.now(tz=timezone.utc).timestamp() * 1000)}",
        "name": name,
        "email": email,
        "role": "user",
        "orgRole": "Employee",
        "reportsTo": ceo.get("id") if ceo else None,
        "isAvailable": True,
    }
    users_col().insert_one(new_user)
    auth_store.set_user_password(new_user, password)
    return jsonify({"user": user_public(new_user), "token": make_token({"sub": new_user["id"], "role": "user", "orgRole": "Employee"})}), 201


@app.post("/api/auth/admin/login")
def admin_login():
    payload = request.get_json(silent=True) or {}
    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "")

    user = strip_mongo_id(users_col().find_one({"email": email}))
    if not user or not auth_store.verify_user_password(user, password) or user.get("role") not in {"admin", "approver"}:
        return jsonify({"error": "Invalid admin credentials"}), 401

    return jsonify({"user": user_public(user), "token": make_token({"sub": user["id"], "role": user.get("role"), "orgRole": normalize_role(user.get("orgRole"))})}), 200


@app.post("/api/auth/password/otp/request")
def request_password_otp():
    payload = request.get_json(silent=True) or {}
    email = normalize_email(payload.get("email"))
    if not email:
        return jsonify({"error": "email is required"}), 400

    user = strip_mongo_id(users_col().find_one({"email": email}))
    if not user:
        return jsonify({"error": "User not found"}), 404

    code = f"{random.randint(0, 999999):06d}"
    expires_at = (datetime.now(tz=timezone.utc) + timedelta(minutes=10)).isoformat()
    record = {
        "id": f"otp-{email}",
        "email": email,
        "code": code,
        "expiresAt": expires_at,
        "createdAt": now_iso(),
    }

    oc = otp_col()
    if oc.find_one({"id": record["id"]}):
        oc.update_one({"id": record["id"]}, {"$set": record})
    else:
        oc.insert_one(record)

    # Demo mode: surface OTP in API response when SMTP is not configured.
    return jsonify({"ok": True, "message": "OTP generated", "otp": code, "expiresAt": expires_at}), 200


@app.post("/api/auth/password/otp/verify")
def verify_password_otp():
    payload = request.get_json(silent=True) or {}
    email = normalize_email(payload.get("email"))
    code = str(payload.get("otp") or "").strip()
    new_password = str(payload.get("newPassword") or "").strip()

    if not email or not code or not new_password:
        return jsonify({"error": "email, otp and newPassword are required"}), 400
    if len(new_password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    user = strip_mongo_id(users_col().find_one({"email": email}))
    if not user:
        return jsonify({"error": "User not found"}), 404

    record = strip_mongo_id(otp_col().find_one({"id": f"otp-{email}"}))
    if not record:
        return jsonify({"error": "OTP not found. Request a new OTP"}), 404
    if str(record.get("code") or "") != code:
        return jsonify({"error": "Invalid OTP"}), 400

    expires_at_raw = str(record.get("expiresAt") or "")
    try:
        expires_at = datetime.fromisoformat(expires_at_raw)
    except ValueError:
        expires_at = datetime.now(tz=timezone.utc) - timedelta(seconds=1)
    if datetime.now(tz=timezone.utc) > expires_at:
        otp_col().delete_one({"id": f"otp-{email}"})
        return jsonify({"error": "OTP expired. Request a new OTP"}), 400

    auth_store.set_user_password(user, new_password)
    otp_col().delete_one({"id": f"otp-{email}"})
    return jsonify({"ok": True, "message": "Password updated successfully"}), 200


@app.post("/api/auth/password/change")
def change_password_with_old():
    payload = request.get_json(silent=True) or {}
    email = normalize_email(payload.get("email"))
    old_password = str(payload.get("oldPassword") or "")
    new_password = str(payload.get("newPassword") or "")

    if not email or not old_password or not new_password:
        return jsonify({"error": "email, oldPassword and newPassword are required"}), 400
    if len(new_password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    user = strip_mongo_id(users_col().find_one({"email": email}))
    if not user:
        return jsonify({"error": "User not found"}), 404
    if not auth_store.verify_user_password(user, old_password):
        return jsonify({"error": "Old password is incorrect"}), 400

    auth_store.set_user_password(user, new_password)
    return jsonify({"ok": True, "message": "Password changed successfully"}), 200


@app.get("/api/org-chart")
def org_chart():
    viewer = get_user(request.args.get("viewerId"))
    if not viewer:
        return jsonify({"nodes": []}), 200

    scope = viewer_scope_user_ids(viewer)
    raw_users = [strip_mongo_id(u) for u in users_col().find({"id": {"$in": list(scope)}})]
    # Guard against duplicate rows in storage so the chart renders one card per user.
    by_id: dict[str, dict] = {}
    for user in raw_users:
        uid = str((user or {}).get("id") or "").strip()
        if not uid:
            continue
        by_id[uid] = user
    all_users = list(by_id.values())
    nodes = []
    for user in all_users:
        user = ensure_user_availability_current(user) or user
        uid = user.get("id")
        direct = sum(1 for c in all_users if c.get("reportsTo") == uid)
        reports_to = user.get("reportsTo")
        nodes.append(
            {
                "id": uid,
                "name": user.get("name"),
                "email": user.get("email"),
                "role": normalize_role(user.get("orgRole")),
                "reportsTo": reports_to if reports_to in scope else None,
                "isAvailable": bool(user.get("isAvailable", True)),
                "directReportCount": direct,
            }
        )
    return jsonify({"nodes": nodes}), 200


@app.get("/api/profile")
def get_profile():
    viewer = get_user(request.args.get("viewerId"))
    if not viewer:
        return jsonify({"error": "viewerId is required"}), 400

    item = strip_mongo_id(viewer) or {}
    profile = dict(item.get("profile") or {})
    profile.setdefault("email", item.get("email"))
    profile.setdefault("name", item.get("name"))
    return jsonify({"profile": profile}), 200


@app.put("/api/profile")
def put_profile():
    viewer = get_user(request.args.get("viewerId"))
    if not viewer:
        return jsonify({"error": "viewerId is required"}), 400

    payload = request.get_json(silent=True) or {}
    profile = {
        "email": normalize_email(viewer.get("email")),
        "name": str(payload.get("name") or viewer.get("name") or "").strip(),
        "department": str(payload.get("department") or "").strip(),
        "employeeId": str(payload.get("employeeId") or "").strip(),
        "phone": str(payload.get("phone") or "").strip(),
    }

    users_col().update_one({"id": viewer.get("id")}, {"$set": {"profile": profile, "name": profile["name"]}})
    updated = get_user(viewer.get("id")) or viewer
    out = dict((strip_mongo_id(updated) or {}).get("profile") or profile)
    out.setdefault("email", normalize_email(updated.get("email")))
    out.setdefault("name", updated.get("name"))
    return jsonify({"profile": out}), 200


@app.get("/api/approvers")
def list_approvers():
    viewer = get_user(request.args.get("viewerId"))
    if not viewer:
        return jsonify({"error": "viewerId is required"}), 400

    chain = build_parent_chain(viewer)
    approvers = [user_public(u) for u in chain]
    return jsonify({"approvers": approvers}), 200


@app.patch("/api/users/<user_id>/availability")
def update_availability(user_id: str):
    payload = request.get_json(silent=True) or {}
    is_available = payload.get("isAvailable")
    if not isinstance(is_available, bool):
        return jsonify({"error": "isAvailable must be true or false"}), 400

    if is_available:
        res = users_col().update_one(
            {"id": user_id},
            {
                "$set": {
                    "isAvailable": True,
                    "activeSince": now_iso(),
                    "availableUntil": active_until_iso(),
                }
            },
        )
    else:
        res = users_col().update_one(
            {"id": user_id},
            {"$set": {"isAvailable": False}, "$unset": {"activeSince": "", "availableUntil": ""}},
        )
    if res.matched_count == 0:
        return jsonify({"error": "User not found"}), 404

    user = get_user(user_id)
    broadcast_event("org_updated", {"userId": user_id, "isAvailable": is_available, "role": normalize_role(user.get("orgRole")) if user else None})
    return jsonify({"user": user_public(user) if user else None}), 200


@app.get("/api/admin/users")
def admin_list_users():
    viewer = get_user(request.args.get("viewerId"))
    if not can_manage_employees(viewer):
        return jsonify({"error": "Only CEO/admin can manage employees"}), 403

    users = [user_public(strip_mongo_id(user)) for user in users_col().find({})]
    return jsonify({"users": users}), 200


@app.post("/api/admin/users")
def admin_create_user():
    payload = request.get_json(silent=True) or {}
    viewer = get_user(payload.get("viewerId"))
    if not can_manage_employees(viewer):
        return jsonify({"error": "Only CEO/admin can manage employees"}), 403

    name = str(payload.get("name") or "").strip()
    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "").strip()
    org_role = normalize_role(payload.get("orgRole"))
    reports_to = str(payload.get("reportsTo") or "").strip() or None
    role = "approver" if org_role in {
        "COO",
        "CFO",
        "CTO",
        "HR Director",
        "Operations Manager",
        "Finance Manager",
        "Audit Manager",
        "Development Manager",
        "IT Support Manager",
        "HR Manager",
        "Training Manager",
        "Team Leader",
        "Team Lead",
        "Senior Employee",
        "Senior Developer",
    } else "user"

    if not name or not email or not password or not org_role:
        return jsonify({"error": "name, email, password and orgRole are required"}), 400
    if users_col().find_one({"email": email}):
        return jsonify({"error": "Email already exists"}), 409
    if reports_to and not users_col().find_one({"id": reports_to}):
        return jsonify({"error": "reportsTo user not found"}), 400

    new_user = {
        "id": f"u-{int(datetime.now(tz=timezone.utc).timestamp() * 1000)}",
        "name": name,
        "email": email,
        "role": role,
        "orgRole": org_role,
        "reportsTo": reports_to,
        "isAvailable": True,
    }
    users_col().insert_one(new_user)
    auth_store.set_user_password(new_user, password)
    broadcast_event("org_updated", {"userId": new_user["id"], "action": "created"})
    return jsonify({"user": user_public(new_user)}), 201


@app.delete("/api/admin/users/<user_id>")
def admin_delete_user(user_id: str):
    viewer = get_user(request.args.get("viewerId"))
    if not can_manage_employees(viewer):
        return jsonify({"error": "Only CEO/admin can manage employees"}), 403

    if user_id == "u-ceo":
        return jsonify({"error": "CEO cannot be removed"}), 400

    col = users_col()
    target = strip_mongo_id(col.find_one({"id": user_id}))
    if not target:
        return jsonify({"error": "User not found"}), 404

    # Re-parent children to target's manager to avoid orphans.
    children = col.find({"reportsTo": user_id})
    for child in children:
        child_id = child.get("id")
        if child_id:
            col.update_one({"id": child_id}, {"$set": {"reportsTo": target.get("reportsTo")}})
    col.delete_one({"id": user_id})
    if DATA_MODE in {"sqlite", "local"} or db.USING_SQLITE_DB:
        auth_store.ensure_auth_table()
        with db.sqlite_lock():
            db.sqlite_conn().execute("DELETE FROM user_auth WHERE user_id = ?", (user_id,))
            db.sqlite_conn().commit()

    broadcast_event("org_updated", {"userId": user_id, "action": "deleted"})
    return jsonify({"ok": True}), 200


@app.delete("/api/admin/requests")
def admin_clear_requests():
    viewer = get_user(request.args.get("viewerId"))
    if not can_manage_employees(viewer):
        return jsonify({"error": "Only admin can clear requests"}), 403

    deleted = db.delete_all_documents(requests_col())
    try:
        LEGACY_REQUESTS_FILE.write_text("[]\n", encoding="utf-8")
    except Exception:
        pass

    broadcast_event("requests_cleared", {"by": viewer.get("id") if viewer else None})
    return jsonify({"ok": True, "deleted": deleted}), 200


@app.get("/api/requests")
def list_requests():
    viewer = get_user(request.args.get("viewerId"))
    scope = str(request.args.get("scope") or "").strip().lower()
    if not viewer:
        return jsonify({"error": "viewerId is required"}), 400

    viewer_id = str(viewer.get("id") or "")
    all_items = [strip_mongo_id(r) for r in requests_col().find({})]
    if scope == "mine":
        items = [item for item in all_items if str(item.get("userId") or "") == viewer_id]
    elif scope == "children":
        if not is_admin_or_ceo(viewer):
            return jsonify({"error": "Only CEO/admin can view team requests"}), 403
        child_ids = viewer_scope_user_ids(viewer) - {viewer_id}
        items = [item for item in all_items if str(item.get("userId") or "") in child_ids]
    else:
        items = [item for item in all_items if can_view_request(viewer, item)]

    out = []
    for item in items:
        maybe_escalate(item)
        out.append(request_summary_for_viewer(viewer, item))
    return jsonify({"requests": out}), 200


def internal_create_request(requester, payload):
    request_type = str(payload.get("requestType") or "general").strip().lower()
    title = str(payload.get("title") or "").strip() or "General Request"
    reason = str(payload.get("reason") or "").strip()
    if not reason:
        return None, "reason is required"

    amount = 0.0
    try:
        amount = float(payload.get("amount") or 0)
    except (TypeError, ValueError):
        return None, "amount must be numeric"

    chain = build_parent_chain(requester)
    if not chain:
        return None, "No approver chain found for requester"

    to_email = normalize_email(payload.get("toEmail"))
    selected_approver_id = str(payload.get("approverId") or "").strip()
    selected_approver_email = normalize_email(payload.get("approverEmail"))
    approver = chain[0]
    
    # Visual Workflow Role Targeting
    target_role = payload.get("targetRole")
    if target_role:
        found = next((u for u in chain if normalize_role(u.get("orgRole")) == normalize_role(target_role)), None)
        if found:
            approver = found

    if to_email:
        selected = get_user(to_email)
        if selected and selected.get("role") in {"admin", "approver"}:
            approver = selected
    elif selected_approver_id:
        selected = next((u for u in chain if str(u.get("id") or "") == selected_approver_id), None)
        if selected:
            approver = selected

    steps = [
        {
            "level": 1,
            "role": normalize_role(approver.get("orgRole")),
            "approverId": approver.get("id"),
            "status": "pending",
            "pendingSince": now_iso(),
            "actedBy": None,
            "actedAt": None,
            "comment": "",
            "escalatedFromUserId": None,
        }
    ]

    req_id = f"REQ-{int(datetime.now(tz=timezone.utc).timestamp() * 1000)}"
    requester_profile = dict((requester or {}).get("profile") or {})
    item = {
        "id": req_id,
        "requestType": request_type,
        "title": title,
        "reason": reason,
        "amount": amount,
        "status": "pending",
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
        "userId": requester["id"],
        "from": {"userId": requester.get("id"), "email": normalize_email(requester.get("email"))},
        "to": {"userId": approver.get("id"), "email": normalize_email(approver.get("email"))},
        "requester": {
            "name": requester_profile.get("name") or requester.get("name"),
            "email": normalize_email(requester_profile.get("email") or requester.get("email")),
            "department": requester_profile.get("department") or "General",
            "employeeId": requester_profile.get("employeeId") or "N/A",
        },
        "workflow": {
            "id": "WF-VISUAL",
            "name": "Visual Workflow Automation",
            "levels": [steps[0]["role"]],
        },
        "steps": steps,
        "currentStepIndex": 0,
        "mailbox": [],
    }
    requests_col().insert_one(item)
    queue_mail(item, steps[0])
    broadcast_event("request_created", {"requestId": req_id, "status": "pending", "currentRole": steps[0]["role"]})
    return item, None


@app.post("/api/requests")
def create_request():
    payload = request.get_json(silent=True) or {}
    requester = get_user(payload.get("userId"))
    if not requester:
        return jsonify({"error": "Requester not found"}), 404
        
    item, err = internal_create_request(requester, payload)
    if err:
        return jsonify({"error": err}), 400
        
    return jsonify({"request": item}), 201


@app.get("/api/requests/<request_id>")
def get_request(request_id: str):
    viewer = get_user(request.args.get("viewerId"))
    if not viewer:
        return jsonify({"error": "viewerId is required"}), 400

    item = strip_mongo_id(requests_col().find_one({"id": request_id}))
    if not item:
        return jsonify({"error": "Request not found"}), 404
    if not can_view_request(viewer, item):
        return jsonify({"error": "You do not have access to this request"}), 403
    maybe_escalate(item)
    return jsonify({"request": sanitize_request_for_viewer(viewer, item)}), 200


@app.delete("/api/requests/<request_id>")
def delete_request(request_id: str):
    payload = request.get_json(silent=True) or {}
    viewer = get_user(request.args.get("viewerId") or payload.get("viewerId"))
    if not viewer:
        return jsonify({"error": "viewerId is required"}), 400

    item = strip_mongo_id(requests_col().find_one({"id": request_id}))
    if not item:
        return jsonify({"error": "Request not found"}), 404

    viewer_id = str(viewer.get("id") or "")
    if not (is_admin_or_ceo(viewer) or str(item.get("userId") or "") == viewer_id or viewer_is_approver_for_request(viewer, item)):
        return jsonify({"error": "You do not have permission to delete this request"}), 403

    requests_col().delete_one({"id": request_id})
    broadcast_event("request_deleted", {"requestId": request_id, "by": viewer_id})
    return jsonify({"ok": True, "deleted": request_id}), 200


@app.get("/api/approvals/pending")
def pending_for_role():
    viewer = get_user(request.args.get("viewerId"))
    if not viewer:
        return jsonify({"error": "viewerId is required"}), 400

    viewer_id = viewer.get("id")
    viewer_role = normalize_role(viewer.get("orgRole"))
    show_all_pending = viewer_role == "CEO" or viewer.get("role") == "admin"

    items = [strip_mongo_id(r) for r in requests_col().find({})]
    out = []
    for item in items:
        item = maybe_escalate(item)
        pending = next((s for s in item.get("steps", []) if s.get("status") == "pending"), None)
        if not pending:
            continue
        if not show_all_pending and pending.get("approverId") != viewer_id:
            continue
        amount_value = item.get("amount", 0)
        if should_hide_amount(viewer, item):
            amount_value = None
        out.append(
            {
                "id": item["id"],
                "amount": amount_value,
                "requestType": item.get("requestType", "general"),
                "title": item.get("title", "General Request"),
                "reason": item.get("reason", ""),
                "requesterName": item.get("requester", {}).get("name", ""),
                "requesterEmail": item.get("requester", {}).get("email", ""),
                "status": item.get("status", "pending"),
                "currentRole": pending.get("role"),
                "createdAt": item.get("createdAt", now_iso()),
            }
        )
    return jsonify({"approvals": out}), 200


@app.get("/api/mailbox")
def mailbox():
    viewer = get_user(request.args.get("viewerId"))
    if not viewer:
        return jsonify({"error": "viewerId is required"}), 400

    viewer_id = viewer.get("id")
    items = [strip_mongo_id(r) for r in requests_col().find({})]

    mails = []
    for item in items:
        for mail in item.get("mailbox", []):
            if mail.get("toUserId") == viewer_id:
                mails.append(mail)
    return jsonify({"mails": mails}), 200


@app.patch("/api/requests/<request_id>/decision")
def take_decision(request_id: str):
    payload = request.get_json(silent=True) or {}
    action = str(payload.get("action") or "").strip().lower()
    actor_id = str(payload.get("actorId") or "").strip()
    comment = str(payload.get("comment") or "").strip()
    forward_to_email = normalize_email(payload.get("forwardToEmail")) if isinstance(payload.get("forwardToEmail"), str) else ""

    if action not in {"approve", "reject", "forward"}:
        return jsonify({"error": "action must be 'approve', 'reject' or 'forward'"}), 400
    if not actor_id:
        return jsonify({"error": "actorId is required"}), 400

    actor = get_user(actor_id)
    if not actor:
        return jsonify({"error": "actorId is invalid"}), 400

    item = strip_mongo_id(requests_col().find_one({"id": request_id}))
    if not item:
        return jsonify({"error": "Request not found"}), 404

    item = maybe_escalate(item)
    idx = int(item.get("currentStepIndex", 0))
    steps = item.get("steps", [])
    if idx < 0 or idx >= len(steps):
        return jsonify({"error": "Invalid workflow state"}), 409

    step = steps[idx]
    if step.get("status") != "pending":
        return jsonify({"error": "No pending step found"}), 409
    if actor_id != step.get("approverId"):
        return jsonify({"error": "This request is not assigned to you"}), 403

    if action == "forward":
        step["status"] = "forwarded"
    else:
        step["status"] = "approved" if action == "approve" else "rejected"
    step["actedBy"] = actor_id or step.get("approverId")
    step["actedAt"] = now_iso()
    step["comment"] = comment

    if action == "forward":
        current_approver = get_user(step.get("approverId"))
        if not current_approver:
            return jsonify({"error": "Current approver not found"}), 404

        manager = None
        if forward_to_email:
            selected = get_user(forward_to_email)
            if not selected:
                return jsonify({"error": "forwardToEmail not found in database"}), 404
            if selected.get("role") not in {"admin", "approver"}:
                return jsonify({"error": "forwardToEmail must belong to an approver/admin account"}), 400

            # Only allow forwarding to a superior in the current approver's chain.
            allowed = is_admin_or_ceo(selected) or any(
                normalize_email(u.get("email")) == forward_to_email for u in build_parent_chain(current_approver)
            )
            if not allowed:
                return jsonify({"error": "forwardToEmail must be a superior in your reporting chain"}), 400
            manager = selected
        else:
            manager = manager_user(current_approver)

        if not manager:
            return jsonify({"error": "No superior found to forward"}), 400

        active_manager, escalated_from = resolve_active_approver(manager)
        next_user = active_manager or manager
        next_step = {
            "level": len(steps) + 1,
            "role": normalize_role(next_user.get("orgRole")),
            "approverId": next_user.get("id"),
            "status": "pending",
            "pendingSince": now_iso(),
            "actedBy": None,
            "actedAt": None,
            "comment": "",
            "escalatedFromUserId": escalated_from,
        }
        steps.append(next_step)
        item["currentStepIndex"] = len(steps) - 1
        item["status"] = "pending"
        queue_mail(item, next_step)
    elif action == "approve":
        # Forward-only mode: any active approver approval grants the request.
        item["status"] = "approved"
    else:
        item["status"] = "rejected"

    item["steps"] = steps
    if action == "forward":
        item["status"] = "pending"
    elif action == "approve":
        item["status"] = "approved"

    requests_col().update_one(
        {"id": request_id},
        {
            "$set": {
                "steps": steps,
                "status": item["status"],
                "currentStepIndex": item.get("currentStepIndex", idx),
                "updatedAt": now_iso(),
            }
        },
    )

    if action in {"approve", "reject"}:
        notify_requester_decision(item, action, actor)

    pending = next((s for s in steps if s.get("status") == "pending"), None)
    broadcast_event(
        "request_updated",
        {
            "requestId": request_id,
            "status": item["status"],
            "action": action,
            "nextRole": pending.get("role") if pending else None,
        },
    )
    return jsonify({"request": sanitize_request_for_viewer(actor, item)}), 200


@app.get("/api/workflows")
def get_workflows():
    flows = [strip_mongo_id(w) for w in workflows_col().find({})]
    return jsonify({"workflows": flows}), 200


@app.get("/api/workflows/<workflow_id>")
def get_single_workflow(workflow_id: str):
    wf = strip_mongo_id(workflows_col().find_one({"id": workflow_id}))
    if not wf:
        return jsonify({"error": "Workflow not found"}), 404
    return jsonify({"workflow": wf}), 200


@app.post("/api/workflows")
def create_workflow():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()
    nodes = payload.get("nodes", [])
    connections = payload.get("connections", [])
    
    if not name:
        return jsonify({"error": "Workflow name is required"}), 400

    wf = {
        "id": f"WF-{int(datetime.now(tz=timezone.utc).timestamp() * 1000)}",
        "name": name,
        "description": str(payload.get("description") or "").strip(),
        "requestType": str(payload.get("requestType") or "general").strip().lower(),
        "minAmount": float(payload.get("minAmount", 0) or 0),
        "maxAmount": float(payload["maxAmount"]) if payload.get("maxAmount") not in (None, "") else None,
        "levels": [n.get("config", {}).get("role") for n in nodes if n.get("type") == "approval"],
        "nodes": nodes,
        "connections": connections,
        "createdAt": now_iso(),
    }
    workflows_col().insert_one(wf)
    broadcast_event("workflow_created", {"workflowId": wf["id"], "name": wf["name"]})
    return jsonify({"workflow": wf}), 201


@app.put("/api/workflows/<workflow_id>")
def update_workflow(workflow_id: str):
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()
    nodes = payload.get("nodes", [])
    connections = payload.get("connections", [])

    update_data = {
        "name": name,
        "description": str(payload.get("description") or "").strip(),
        "nodes": nodes,
        "connections": connections,
        "levels": [n.get("config", {}).get("role") for n in nodes if n.get("type") == "approval"],
        "updatedAt": now_iso(),
    }
    
    workflows_col().update_one({"id": workflow_id}, {"$set": update_data})
    broadcast_event("workflow_updated", {"workflowId": workflow_id, "name": name})
    return jsonify({"ok": True, "workflowId": workflow_id}), 200


@app.delete("/api/workflows/<workflow_id>")
def delete_workflow(workflow_id: str):
    workflows_col().delete_one({"id": workflow_id})
    broadcast_event("workflow_deleted", {"workflowId": workflow_id})
    return jsonify({"ok": True, "deleted": workflow_id}), 200


@app.post("/api/workflows/execute")
def execute_workflow():
    payload = request.get_json(silent=True) or {}
    workflow_id = payload.get("workflowId", "demo-id")
    nodes = payload.get("nodes", [])
    viewer_id = payload.get("viewerId")
    
    def run_simulation():
        for node in nodes:
            # Simulate processing time
            import time
            time.sleep(1.5)
            
            node_type = node.get("type")
            node_config = node.get("config", {})
            
            # Send real email if it's an email node
            if node_type == "email" and node_config.get("recipient"):
                recipient = normalize_email(node_config.get("recipient"))
                subject = node_config.get("subject") or "Workflow Notification"
                body = f"Workflow: {workflow_id}\nNode: {node.get('name')}\nDescription: {node.get('description', 'No description')}"
                
                mailer.send_email(recipient, subject, body)
                msg = f"Email sent to {recipient}"
            elif node_type == "approval":
                # Create a real request in the database if we hit an approval node
                if viewer_id:
                    requester = get_user(viewer_id)
                    if requester:
                        req_item, err = internal_create_request(requester, {
                            "requestType": "workflow-automated",
                            "title": f"Visual Flow: {node.get('name')}",
                            "reason": node.get("description", "Triggered by visual workflow"),
                            "targetRole": node_config.get("role")
                        })
                        if req_item:
                            msg = f"Request {req_item['id']} created for {node_config.get('role', 'Manager')}"
                        else:
                            msg = f"Failed to create request: {err}"
                    else:
                        msg = f"Viewer {viewer_id} not found"
                else:
                    msg = f"Approval step reached for role: {node_config.get('role', 'Manager')}"
            else:
                msg = f"Node {node.get('name')} executed successfully"

            broadcast_event("node_executed", {
                "workflowId": workflow_id,
                "nodeId": node.get("id"),
                "status": "success",
                "message": msg
            })
        
        broadcast_event("workflow_finished", {
            "workflowId": workflow_id,
            "status": "completed"
        })

    thread = threading.Thread(target=run_simulation)
    thread.start()
    
    return jsonify({"ok": True, "message": "Workflow execution started"}), 202


@app.get("/")
def serve_index():
    return _send_frontend_file("index.html")


@app.get("/<path:path>")
def serve_static(path: str):
    return _send_frontend_file(path)


def _send_frontend_file(path: str):
    # Some non-browser clients mishandle 304 responses for static assets. Force a
    # 200 with an explicit no-cache policy.
    try:
        resp = send_from_directory(
            app.static_folder,
            path,
            conditional=False,
            etag=False,
            max_age=0,
        )
    except TypeError:
        # Older Flask/Werkzeug may not accept these kwargs.
        resp = send_from_directory(app.static_folder, path)
    resp.headers["Cache-Control"] = "no-store, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


if __name__ == "__main__":
    is_windows = sys.platform.startswith("win")
    if is_windows:
        print("Note: Windows detected; Flask auto-reload is disabled. Restart the backend after code changes.", file=sys.stderr)
    app.run(
        host="0.0.0.0",
        port=4000,
        debug=True,
        use_reloader=not is_windows,
    )
