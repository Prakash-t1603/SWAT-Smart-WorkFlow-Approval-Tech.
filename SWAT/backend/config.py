from __future__ import annotations

import os
from pathlib import Path

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "smartflow")
DATA_MODE = os.getenv("DATA_MODE", "sqlite").strip().lower()

DATA_DIR = Path(__file__).resolve().parent / "data"
SQLITE_PATH = os.getenv("SQLITE_PATH", str(DATA_DIR / "smartflow.db"))

SLA_HOURS = 48
ACTIVE_WINDOW_HOURS = 8

LEGACY_USERS_FILE = DATA_DIR / "users.json"
LEGACY_REQUESTS_FILE = DATA_DIR / "requests.local.json"
LEGACY_WORKFLOWS_FILE = DATA_DIR / "workflows.local.json"

# SMTP (optional). When configured, the backend sends email notifications for
# request created + approval outcomes.
SMTP_HOST = str(os.getenv("SMTP_HOST", "")).strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = str(os.getenv("SMTP_USER", "")).strip()
SMTP_PASSWORD = str(os.getenv("SMTP_PASSWORD", "")).strip()
SMTP_FROM = str(os.getenv("SMTP_FROM", "")).strip()
SMTP_TLS = str(os.getenv("SMTP_TLS", "true")).strip().lower() in {"1", "true", "yes", "on"}
SMTP_SSL = str(os.getenv("SMTP_SSL", "false")).strip().lower() in {"1", "true", "yes", "on"}

# Privacy: optionally hide amount from approvers in API responses.
HIDE_AMOUNT_FROM_APPROVERS = str(os.getenv("HIDE_AMOUNT_FROM_APPROVERS", "false")).strip().lower() in {"1", "true", "yes", "on"}

ROLE_ALIASES = {
    "ceo": "CEO",
    "coo": "COO",
    "cfo": "CFO",
    "cto": "CTO",
    "hr dir": "HR Director",
    "hr mgr": "HR Manager",
    "ops mgr": "Operations Manager",
    "fin mgr": "Finance Manager",
    "dev mgr": "Development Manager",
    "it sup": "IT Support Manager",
    "it support": "IT Support Manager",
    "tl": "Team Leader",
    "teamleader": "Team Leader",
    "teamlead": "Team Lead",
    "sr emp": "Senior Employee",
    "sr dev": "Senior Developer",
    "acct": "Accountant",
    "analyst": "Financial Analyst",
    "hr director": "HR Director",
    "operations manager": "Operations Manager",
    "team leader": "Team Leader",
    "senior employee": "Senior Employee",
    "employee": "Employee",
    "finance manager": "Finance Manager",
    "accountant": "Accountant",
    "financial analyst": "Financial Analyst",
    "audit manager": "Audit Manager",
    "auditor": "Auditor",
    "development manager": "Development Manager",
    "team lead": "Team Lead",
    "senior developer": "Senior Developer",
    "developer": "Developer",
    "it support manager": "IT Support Manager",
    "support engineer": "Support Engineer",
    "hr manager": "HR Manager",
    "recruiter": "Recruiter",
    "hr executive": "HR Executive",
    "training manager": "Training Manager",
    "trainer": "Trainer",
}

# Fallback when a direct approver is unavailable.
ROLE_FALLBACK = {
    "Team Leader": "Operations Manager",
    "Team Lead": "Development Manager",
    "Senior Employee": "Team Leader",
    "Employee": "Senior Employee",
    "Accountant": "Finance Manager",
    "Financial Analyst": "Finance Manager",
    "Auditor": "Audit Manager",
    "Developer": "Team Lead",
    "Support Engineer": "IT Support Manager",
    "Recruiter": "HR Manager",
    "HR Executive": "HR Manager",
    "Trainer": "Training Manager",
}
