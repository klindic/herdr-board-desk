"""Print Claude and Codex plan usage (5-hour and weekly windows) as JSON.

Claude: the OAuth usage endpoint, with the token Claude Code keeps in the macOS keychain.
Codex: the ChatGPT usage endpoint, with the token in ~/.codex/auth.json; if that fails,
the rate limits recorded in the newest Codex session file.

Tokens are only read, never refreshed: Claude Code and Codex refresh their own on next use.
"""

import glob
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

HOME = os.path.expanduser("~")
TIMEOUT = 12


def window_label(seconds):
    if not seconds:
        return "Limit"
    if abs(seconds - 5 * 3600) < 60:
        return "5-hour"
    if abs(seconds - 7 * 86400) < 3600:
        return "Weekly"
    if seconds % 86400 == 0:
        return f"{seconds // 86400}-day"
    return f"{round(seconds / 3600)}-hour"


def reset_label(epoch):
    if not epoch:
        return None
    return "resets on " + datetime.fromtimestamp(epoch).strftime("%a %H:%M")


def window(label, percent, resets_at):
    now = time.time()
    if resets_at and resets_at < now:
        # The window rolled over since this was recorded: nothing used in the new one yet.
        return {"label": label, "percent": 0, "resets": None}
    return {"label": label, "percent": max(0, min(100, round(percent or 0))), "resets": reset_label(resets_at)}


def get_json(url, headers):
    request = urllib.request.Request(url, headers={"Accept": "application/json", **headers})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read())


def http_error(error):
    if isinstance(error, urllib.error.HTTPError):
        if error.code in (401, 403):
            return "signed out or token expired"
        if error.code == 429:
            return "rate limited, retrying later"
        return f"HTTP {error.code}"
    return "offline or unreachable"


def iso_epoch(value):
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def claude():
    try:
        raw = subprocess.run(
            ["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
            capture_output=True, text=True, timeout=TIMEOUT,
        ).stdout
        oauth = json.loads(raw)["claudeAiOauth"]
    except Exception:
        return {"error": "not signed in to Claude Code"}
    if oauth.get("expiresAt") and oauth["expiresAt"] / 1000 < time.time():
        return {"error": "token expired, open Claude Code to refresh"}
    try:
        data = get_json("https://api.anthropic.com/api/oauth/usage", {
            "Authorization": "Bearer " + oauth["accessToken"],
            "anthropic-beta": "oauth-2025-04-20",
        })
    except Exception as error:
        return {"error": http_error(error)}
    windows = []
    for key, label in (("five_hour", "5-hour"), ("seven_day", "Weekly")):
        entry = data.get(key)
        if entry:
            windows.append(window(label, entry.get("utilization"), iso_epoch(entry.get("resets_at"))))
    return {"windows": windows}


def codex_from_api():
    with open(os.path.join(HOME, ".codex", "auth.json")) as handle:
        tokens = json.load(handle)["tokens"]
    data = get_json("https://chatgpt.com/backend-api/wham/usage", {
        "Authorization": "Bearer " + tokens["access_token"],
        "ChatGPT-Account-Id": tokens.get("account_id") or "",
        "User-Agent": "codex-cli",
    })
    limits = data.get("rate_limit") or {}
    windows = []
    for key in ("primary_window", "secondary_window"):
        entry = limits.get(key)
        if entry:
            windows.append(window(window_label(entry.get("limit_window_seconds")), entry.get("used_percent"), entry.get("reset_at")))
    return windows


def codex_from_sessions():
    files = sorted(glob.glob(os.path.join(HOME, ".codex", "sessions", "*", "*", "*", "rollout-*.jsonl")), key=os.path.getmtime, reverse=True)
    for path in files[:5]:
        with open(path, errors="replace") as handle:
            lines = handle.readlines()
        for line in reversed(lines):
            if '"rate_limits"' not in line:
                continue
            try:
                limits = json.loads(line).get("payload", {}).get("rate_limits")
            except ValueError:
                continue
            if not limits:
                continue
            windows = []
            for key in ("primary", "secondary"):
                entry = limits.get(key)
                if entry:
                    minutes = entry.get("window_minutes") or 0
                    windows.append(window(window_label(minutes * 60), entry.get("used_percent"), entry.get("resets_at")))
            if windows:
                return windows
    return []


def codex():
    try:
        return {"windows": codex_from_api()}
    except Exception as error:
        message = http_error(error) if isinstance(error, (urllib.error.URLError, OSError)) else "not signed in to Codex"
    try:
        windows = codex_from_sessions()
    except Exception:
        windows = []
    if windows:
        return {"windows": windows, "note": "from last Codex session"}
    return {"error": message}


def main():
    json.dump({"claude": claude(), "codex": codex(), "at": int(time.time())}, sys.stdout)


if __name__ == "__main__":
    main()
