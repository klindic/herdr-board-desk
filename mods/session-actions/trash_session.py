"""Move one inactive Herdr history session file into the user's Trash."""

import json
import os
import shutil
import sys
import uuid
from pathlib import Path


def fail(message):
    raise SystemExit(message)


def main():
    if len(sys.argv) != 4:
        fail("Expected agent, session ID, and file path")
    agent, session_id, raw_path = sys.argv[1:]
    try:
        uuid.UUID(session_id)
    except ValueError:
        fail("Invalid session ID")

    home = Path.home()
    path = Path(raw_path).resolve(strict=True)
    if not path.is_file() or path.suffix != ".jsonl":
        fail("Session file not found")
    if agent == "claude":
        root = (home / ".claude" / "projects").resolve()
        if path.stem != session_id:
            fail("Session ID does not match file")
        live = home / ".claude" / "sessions" / f"{session_id}.json"
        if live.exists():
            try:
                pid = int(json.loads(live.read_text())["pid"])
                os.kill(pid, 0)
            except (OSError, ValueError, KeyError, TypeError):
                pass
            else:
                fail("Cannot remove a running session")
    elif agent == "codex":
        root = (home / ".codex" / "sessions").resolve()
        if not path.name.endswith(f"-{session_id}.jsonl"):
            fail("Session ID does not match file")
        with path.open("rb") as fh:
            try:
                header = json.loads(fh.readline())
            except ValueError:
                fail("Invalid session file")
        if header.get("type") != "session_meta" or (header.get("payload") or {}).get("id") != session_id:
            fail("Session ID does not match file contents")
    else:
        fail("Unknown agent")

    if root not in path.parents:
        fail("Session file is outside the expected folder")
    destination = home / ".Trash" / "Herdr Sessions"
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / path.name
    if target.exists():
        target = destination / f"{path.stem}-{uuid.uuid4().hex[:8]}{path.suffix}"
    shutil.move(str(path), str(target))
    print(target)


if __name__ == "__main__":
    main()
