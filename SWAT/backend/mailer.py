from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage
from typing import Iterable

import config


def smtp_configured() -> bool:
    return bool(config.SMTP_HOST and config.SMTP_FROM)


def _as_recipients(to: str | Iterable[str]) -> list[str]:
    if isinstance(to, str):
        items = [to]
    else:
        items = list(to)
    out: list[str] = []
    for item in items:
        email = str(item or "").strip()
        if email:
            out.append(email)
    return out


def send_email(to: str | Iterable[str], subject: str, body: str) -> tuple[bool, str | None]:
    if not smtp_configured():
        return False, "SMTP is not configured (set SMTP_HOST and SMTP_FROM)"

    recipients = _as_recipients(to)
    if not recipients:
        return False, "No recipient email provided"

    msg = EmailMessage()
    msg["From"] = config.SMTP_FROM
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = str(subject or "").strip() or "SmartFlow Notification"
    msg.set_content(str(body or ""))

    try:
        if config.SMTP_SSL:
            context = ssl.create_default_context()
            server: smtplib.SMTP = smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, context=context, timeout=15)
        else:
            server = smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15)

        with server:
            if not config.SMTP_SSL and config.SMTP_TLS:
                context = ssl.create_default_context()
                server.starttls(context=context)
            if config.SMTP_USER and config.SMTP_PASSWORD:
                server.login(config.SMTP_USER, config.SMTP_PASSWORD)
            server.send_message(msg)
        return True, None
    except Exception as exc:
        return False, str(exc)

