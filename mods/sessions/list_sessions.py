"""Print Claude Code and Codex sessions for ROOT, newest first, as JSON.

Usage: list_sessions.py ROOT [--exact]
ROOT is a git repo root: sessions anywhere inside it count, except inside a nested repo or worktree.
--exact (ROOT is not a repo): only sessions started in ROOT itself.

Session files can be tens of MB, so each is read only at its head and tail, and results are cached
by (path, size, mtime) in ~/.cache/herdr-sessions.json.
"""

import json
import os
import re
import sys
from datetime import datetime

HOME = os.path.expanduser("~")
CLAUDE_PROJECTS = os.path.join(HOME, ".claude", "projects")
CLAUDE_LIVE = os.path.join(HOME, ".claude", "sessions")
CODEX_SESSIONS = os.path.join(HOME, ".codex", "sessions")
CODEX_INDEX = os.path.join(HOME, ".codex", "session_index.jsonl")
CACHE = os.path.join(HOME, ".cache", "herdr-sessions.json")
HEAD_BYTES = 2_000_000
TAIL_BYTES = 512_000
LIMIT = 60


def iso_ms(value):
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except (AttributeError, ValueError):
        return None


def json_lines(blob):
    for line in blob.splitlines():
        try:
            yield json.loads(line)
        except ValueError:
            continue


def prompt_text(message):
    content = (message or {}).get("content")
    if isinstance(content, list):
        content = " ".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    if not isinstance(content, str):
        return None
    text = " ".join(content.split())
    # Slash commands, hook output and tool results start with a tag; they aren't something the person typed.
    return text if text and not text.startswith("<") else None


def read_claude(path):
    with open(path, "rb") as fh:
        head = fh.read(HEAD_BYTES).decode("utf-8", "ignore")
        size = os.fstat(fh.fileno()).st_size
        if size > HEAD_BYTES:
            fh.seek(max(size - TAIL_BYTES, 0))
            tail = fh.read().decode("utf-8", "ignore")
        else:
            tail = head

    cwd = started = first_prompt = None
    for d in json_lines(head):
        if d.get("type") == "user" and not d.get("isSidechain"):
            cwd = cwd or d.get("cwd")
            started = started or iso_ms(d.get("timestamp", ""))
            first_prompt = first_prompt or prompt_text(d.get("message"))
            if cwd and started and first_prompt:
                break

    title = custom = last_prompt = None
    for d in json_lines(tail):
        kind = d.get("type")
        if kind == "custom-title" and d.get("customTitle"):
            custom = d["customTitle"]
        elif kind == "ai-title" and d.get("aiTitle"):
            title = d["aiTitle"]
        elif kind == "last-prompt" and d.get("lastPrompt"):
            last_prompt = d["lastPrompt"]

    if not cwd or not (first_prompt or last_prompt):
        return None
    return {
        "agent": "claude",
        "id": os.path.basename(path)[: -len(".jsonl")],
        "cwd": cwd,
        "title": custom or title or first_prompt or last_prompt,
        "started": started,
    }


def read_codex(path):
    with open(path, "rb") as fh:
        first = fh.readline().decode("utf-8", "ignore")
    try:
        meta = json.loads(first)
    except ValueError:
        return None
    if meta.get("type") != "session_meta":
        return None
    payload = meta.get("payload") or {}
    if not payload.get("cwd") or not payload.get("id"):
        return None
    return {
        "agent": "codex",
        "id": payload["id"],
        "cwd": payload["cwd"],
        "title": None,
        "started": iso_ms(payload.get("timestamp", "")),
    }


def belongs(cwd, root, exact):
    if cwd == root:
        return True
    if exact or not cwd.startswith(root.rstrip("/") + "/"):
        return False
    # A folder between root and cwd with its own .git (a nested repo or worktree) is another space.
    path = cwd
    while path != root and len(path) > len(root):
        if os.path.exists(os.path.join(path, ".git")):
            return False
        path = os.path.dirname(path)
    return True


def live_claude():
    """sessionId -> pid for Claude sessions whose process is still running."""
    live = {}
    if not os.path.isdir(CLAUDE_LIVE):
        return live
    for name in os.listdir(CLAUDE_LIVE):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(CLAUDE_LIVE, name)) as fh:
                info = json.load(fh)
            os.kill(int(info["pid"]), 0)
            live[info["sessionId"]] = int(info["pid"])
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return live


def parent_pid(pid):
    try:
        out = os.popen(f"ps -o ppid= -p {int(pid)}").read().strip()
        return int(out) if out else None
    except ValueError:
        return None


def codex_names():
    names = {}
    try:
        with open(CODEX_INDEX) as fh:
            for d in json_lines(fh.read()):
                if d.get("id") and d.get("thread_name"):
                    names[d["id"]] = d["thread_name"]
    except OSError:
        pass
    return names


def main():
    root = os.path.realpath(sys.argv[1])
    exact = "--exact" in sys.argv[2:]
    try:
        with open(CACHE) as fh:
            cache = json.load(fh)
    except (OSError, ValueError):
        cache = {}
    fresh = {}

    def cached(path, reader):
        st = os.stat(path)
        key = f"{st.st_size}:{int(st.st_mtime)}"
        hit = cache.get(path)
        entry = hit["entry"] if hit and hit.get("key") == key else reader(path)
        fresh[path] = {"key": key, "entry": entry}
        if entry:
            entry = dict(entry, path=path, updated=int(st.st_mtime * 1000))
        return entry

    sessions = []
    # Claude names a project folder after its cwd with every non-alphanumeric character as "-".
    prefix = re.sub(r"[^A-Za-z0-9]", "-", root)
    if os.path.isdir(CLAUDE_PROJECTS):
        for project in os.listdir(CLAUDE_PROJECTS):
            if project != prefix if exact else not project.startswith(prefix):
                continue
            folder = os.path.join(CLAUDE_PROJECTS, project)
            for name in os.listdir(folder):
                if name.endswith(".jsonl"):
                    s = cached(os.path.join(folder, name), read_claude)
                    if s and belongs(s["cwd"], root, exact):
                        sessions.append(s)

    names = codex_names()
    for dirpath, _dirs, files in os.walk(CODEX_SESSIONS):
        for name in files:
            if name.startswith("rollout-") and name.endswith(".jsonl"):
                s = cached(os.path.join(dirpath, name), read_codex)
                if s and belongs(s["cwd"], root, exact):
                    sessions.append(dict(s, title=names.get(s["id"]) or "Codex session"))

    live = live_claude()
    for s in sessions:
        s["pid"] = live.get(s["id"]) if s["agent"] == "claude" else None
        s["ppid"] = parent_pid(s["pid"]) if s["pid"] else None

    sessions.sort(key=lambda s: s["updated"], reverse=True)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE + ".tmp", "w") as fh:
        json.dump(fresh, fh)
    os.replace(CACHE + ".tmp", CACHE)
    json.dump(sessions[:LIMIT], sys.stdout)


if __name__ == "__main__":
    main()
