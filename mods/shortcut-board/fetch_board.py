"""Print a Shortcut team's board as JSON, one entry per column.

`fetch_board.py story <id>` prints one story instead: title, description,
relationships and comments.

Settings live in config.json next to this file (see config.example.json):
  team        the team's name, mention name or id (required)
  columns     workflow state names to show, in order (default: every state that isn't backlog)
  token_file  a file holding the API token, either bare or as SHORTCUT_API_TOKEN=... (optional)
  demo        true to show made-up stories without calling Shortcut
The token comes from $SHORTCUT_API_TOKEN first, then token_file.
Team, workflow, member and epic names are cached for a day.
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

API = "https://api.app.shortcut.com/api/v3"
HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "config.json")
CACHE = os.path.expanduser("~/.cache/herdr-shortcut-board.json")
CACHE_TTL = 24 * 3600
PR_URL = re.compile(r"github\.com/([^/]+)/([^/]+)/pull/(\d+)")
STORY_REF = re.compile(r"(?<![\w/\[#-])sc-(\d+)\b(?!\]|\()")
WORKSPACE = re.compile(r"app\.shortcut\.com/([^/]+)/")


class BoardError(Exception):
    pass


def load_config():
    try:
        with open(CONFIG) as handle:
            return json.load(handle)
    except FileNotFoundError:
        raise BoardError("Copy config.example.json to config.json in mods/shortcut-board")
    except ValueError:
        raise BoardError("mods/shortcut-board/config.json is not valid JSON")


def token(config):
    value = os.environ.get("SHORTCUT_API_TOKEN")
    if value:
        return value.strip()
    path = config.get("token_file")
    if not path:
        return None
    try:
        with open(os.path.expanduser(path)) as handle:
            text = handle.read()
    except OSError:
        return None
    match = re.search(r"^\s*(?:export\s+)?SHORTCUT_API_TOKEN\s*=\s*(.+)$", text, re.M)
    if match:
        return match.group(1).strip().strip("'\"")
    text = text.strip()
    return text if text and "\n" not in text and "=" not in text else None


class Shortcut:
    def __init__(self, key):
        self.key = key

    def call(self, path, body=None):
        request = urllib.request.Request(
            API + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Shortcut-Token": self.key, "Content-Type": "application/json"},
            method="POST" if body is not None else "GET",
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read())


def load_cache(config):
    key = json.dumps([config.get("team"), config.get("columns")])
    try:
        with open(CACHE) as handle:
            cache = json.load(handle)
        if time.time() - cache.get("at", 0) < CACHE_TTL and cache.get("key") == key:
            return cache
    except (OSError, ValueError):
        pass
    return {"at": time.time(), "key": key, "members": {}, "epics": {}}


def save_cache(cache):
    try:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        temporary = CACHE + ".tmp"
        with open(temporary, "w") as handle:
            json.dump(cache, handle)
        os.replace(temporary, CACHE)
    except OSError:
        pass


def epoch(value):
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()) if value else None


def short_name(name):
    parts = (name or "").split()
    if len(parts) < 2:
        return name or ""
    return f"{parts[0]} {parts[-1][0]}."


def resolve_board(api, config, cache):
    """The team and the columns to show, from the config's names."""
    if cache.get("team"):
        return cache["team"], cache["columns"], cache["states"]
    wanted = str(config.get("team") or "").strip()
    if not wanted:
        raise BoardError("Set \"team\" in mods/shortcut-board/config.json")
    groups = api.call("/groups")
    team = next((g for g in groups if wanted.lower() in (g["id"].lower(), (g.get("mention_name") or "").lower(), g["name"].lower())), None)
    if not team:
        raise BoardError(f"No Shortcut team named \"{wanted}\"")
    states = []
    for workflow in api.call("/workflows"):
        if workflow["id"] in team.get("workflow_ids", []):
            states.extend(sorted(workflow["states"], key=lambda s: s.get("position", 0)))
    names = config.get("columns")
    if names:
        by_name = {s["name"].lower(): s for s in states}
        missing = [n for n in names if n.lower() not in by_name]
        if missing:
            raise BoardError(f"No state named {', '.join(missing)}; the team has {', '.join(s['name'] for s in states)}")
        chosen = [by_name[n.lower()] for n in names]
    else:
        chosen = [s for s in states if s.get("type") != "backlog"]
    columns = [{"id": s["id"], "name": s["name"], "type": s.get("type")} for s in chosen]
    cache["team"] = {"id": team["id"], "name": team["name"]}
    cache["columns"] = columns
    cache["states"] = {str(s["id"]): s["name"] for s in states}
    return cache["team"], columns, cache["states"]


def members(api, cache):
    if not cache["members"]:
        cache["members"] = {m["id"]: m["profile"].get("name") or m["profile"].get("mention_name") for m in api.call("/members")}
    return cache["members"]


def board(config):
    if config.get("demo"):
        return demo_board()
    key = token(config)
    if not key:
        raise BoardError("No Shortcut token: set SHORTCUT_API_TOKEN or token_file")
    api = Shortcut(key)
    cache = load_cache(config)
    team, columns, _ = resolve_board(api, config, cache)
    me = cache.get("me") or api.call("/member")["id"]
    cache["me"] = me
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(
            lambda column: api.call("/stories/search", {"group_id": team["id"], "workflow_state_id": column["id"], "archived": False}),
            columns,
        ))
    names = members(api, cache)
    epic_ids = {str(s["epic_id"]) for stories in results for s in stories if s.get("epic_id")}
    missing = [e for e in epic_ids if e not in cache["epics"]]
    with ThreadPoolExecutor(max_workers=6) as pool:
        for epic_id, epic in zip(missing, pool.map(lambda e: api.call(f"/epics/{e}"), missing)):
            cache["epics"][epic_id] = epic.get("name")
    save_cache(cache)

    out = []
    for column, stories in zip(columns, results):
        stories.sort(key=lambda s: s.get("position", 0))
        cards = []
        for s in stories:
            prs = []
            for link in s.get("external_links") or []:
                match = PR_URL.search(link)
                if match:
                    prs.append({"repo": match.group(2), "number": int(match.group(3)), "url": link})
            owners = [names.get(o) for o in s.get("owner_ids") or []]
            cards.append({
                "id": s["id"],
                "name": s["name"],
                "url": s["app_url"],
                "type": s.get("story_type"),
                "epic": cache["epics"].get(str(s.get("epic_id"))) if s.get("epic_id") else None,
                "owners": [short_name(o) for o in owners if o],
                "mine": me in (s.get("owner_ids") or []),
                "blocked": bool(s.get("blocked")),
                "blocker": bool(s.get("blocker")),
                "moved": epoch(s.get("moved_at") or s.get("updated_at")),
                "prs": prs,
            })
        out.append({**column, "cards": cards})
    return {"team": team["name"], "columns": out, "at": int(time.time())}


def link_story_refs(text, workspace):
    if not workspace:
        return text or ""
    url = f"https://app.shortcut.com/{workspace}/story/"
    return STORY_REF.sub(lambda m: f"[sc-{m.group(1)}]({url}{m.group(1)})", text or "")


# How a link reads from this story's side: (verb, this story is the subject) -> label.
LINK_LABELS = {
    ("blocks", True): "Blocks",
    ("blocks", False): "Blocked by",
    ("duplicates", True): "Duplicates",
    ("duplicates", False): "Duplicated by",
    ("relates to", True): "Relates to",
    ("relates to", False): "Relates to",
}
LINK_ORDER = {"Blocked by": 0, "Blocks": 1, "Duplicates": 2, "Duplicated by": 3, "Relates to": 4}


def story_links(api, s):
    links = []
    for link in s.get("story_links") or []:
        mine = link.get("subject_id") == s["id"]
        other = link.get("object_id") if mine else link.get("subject_id")
        if other:
            links.append((link.get("verb"), mine, other))
    if not links:
        return []

    def fetch(story_id):
        try:
            return api.call(f"/stories/{story_id}")
        except (urllib.error.URLError, OSError):
            return None

    ids = [other for _, _, other in links]
    with ThreadPoolExecutor(max_workers=6) as pool:
        others = dict(zip(ids, pool.map(fetch, ids)))
    result = []
    for verb, mine, other_id in links:
        other = others.get(other_id) or {}
        result.append({
            "label": LINK_LABELS.get((verb, mine), verb.capitalize() if verb else "Related"),
            "id": other_id,
            "name": other.get("name") or f"sc-{other_id}",
            "type": other.get("story_type"),
            "done": bool(other.get("completed")),
        })
    return sorted(result, key=lambda r: LINK_ORDER.get(r["label"], 9))


def story(config, story_id):
    if config.get("demo"):
        return demo_story(int(story_id))
    key = token(config)
    if not key:
        raise BoardError("No Shortcut token: set SHORTCUT_API_TOKEN or token_file")
    api = Shortcut(key)
    cache = load_cache(config)
    try:
        _, _, states = resolve_board(api, config, cache)
    except BoardError:
        states = {}
    try:
        s = api.call(f"/stories/{int(story_id)}")
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise BoardError("Story not found")
        raise
    names = members(api, cache)
    epic = None
    if s.get("epic_id"):
        epic = cache["epics"].get(str(s["epic_id"])) or api.call(f"/epics/{s['epic_id']}").get("name")
        cache["epics"][str(s["epic_id"])] = epic
    relationships = story_links(api, s)
    save_cache(cache)
    match = WORKSPACE.search(s.get("app_url") or "")
    workspace = match.group(1) if match else None
    comments = [
        {
            "id": c["id"],
            "author": names.get(c.get("author_id")) or "Someone",
            "created": epoch(c.get("created_at")),
            "text": link_story_refs(c.get("text"), workspace),
            "reply": bool(c.get("parent_id")),
        }
        for c in sorted(s.get("comments") or [], key=lambda c: c.get("created_at") or "")
        if not c.get("deleted") and (c.get("text") or "").strip()
    ]
    return {
        "id": s["id"],
        "name": s["name"],
        "url": s["app_url"],
        "state": states.get(str(s.get("workflow_state_id"))),
        "type": s.get("story_type"),
        "epic": epic,
        "owners": [names.get(o) for o in s.get("owner_ids") or [] if names.get(o)],
        "description": link_story_refs(s.get("description"), workspace),
        "comments": comments,
        "relationships": relationships,
        "at": int(time.time()),
    }


# Demo mode: a made-up team, so the board can be tried (and screenshotted) without a Shortcut account.
DEMO_URL = "https://app.shortcut.com/example/story/"
DEMO_COLUMNS = [
    (1, "Unstarted", "unstarted", [
        (1201, "Export the audit log as CSV", "feature", "Audit log", ["Alex M."], False, 2),
        (1202, "Flaky test: checkout total with coupons", "bug", "Checkout", ["Priya S."], False, 5),
        (1203, "Upgrade the date library to the latest major", "chore", None, ["Sam R."], False, 9),
    ]),
    (2, "In Progress", "started", [
        (1188, "Retry webhook deliveries with backoff", "feature", "Webhooks", ["You"], True, 1),
        (1190, "Rate-limit the public API", "feature", "Platform", ["Jordan K."], False, 3),
        (1191, "Move image uploads to the new bucket", "chore", "Storage", ["Alex M."], False, 6),
    ]),
    (3, "In Review", "started", [
        (1174, "Notification settings tab", "feature", "Settings", ["Priya S."], False, 1),
    ]),
    (4, "In QA", "started", [
        (1166, "Resumable backfill for the events table", "feature", "Data pipeline", ["Sam R.", "You"], True, 2),
    ]),
    (5, "PO Acceptance", "started", []),
    (6, "Accepted", "done", [
        (1150, "Show the plan name on invoices", "feature", "Billing", ["Jordan K."], False, 1),
    ]),
]


def demo_board():
    now = int(time.time())
    columns = []
    for state_id, name, kind, rows in DEMO_COLUMNS:
        cards = [{
            "id": sid, "name": title, "url": f"{DEMO_URL}{sid}", "type": kind_, "epic": epic,
            "owners": owners, "mine": mine, "blocked": sid == 1191, "blocker": False,
            "moved": now - days * 86400, "prs": [{"repo": "web", "number": sid - 1100, "url": "https://github.com"}] if state_id in (3, 4) else [],
        } for sid, title, kind_, epic, owners, mine, days in rows]
        columns.append({"id": state_id, "name": name, "type": kind, "cards": cards})
    return {"team": "Demo team", "columns": columns, "at": now}


def demo_story(story_id):
    for state_id, state, _, rows in DEMO_COLUMNS:
        for sid, title, kind, epic, owners, _, _ in rows:
            if sid == story_id:
                break
        else:
            continue
        break
    else:
        raise BoardError("Story not found")
    description = (
        "## Why\nDeliveries to customer endpoints fail now and then, and today a failed delivery is simply lost. "
        "Retrying with backoff recovers most of them without anyone noticing.\n\n"
        "## What we'll do\n- Retry failed deliveries up to 8 times with exponential backoff and jitter\n"
        "- Record each attempt so support can see what happened\n- Stop retrying when the endpoint returns a 4xx\n\n"
        "## Done when\n- [ ] A delivery that fails twice and then succeeds arrives exactly once\n"
        "- [ ] Attempts show in the delivery log\n- [ ] Retries back off as designed under load\n"
    )
    now = int(time.time())
    return {
        "id": sid, "name": title, "url": f"{DEMO_URL}{sid}", "state": state, "type": kind, "epic": epic,
        "owners": owners, "description": description,
        "relationships": [
            {"label": "Blocked by", "id": 1190, "name": "Rate-limit the public API", "type": "feature", "done": False},
            {"label": "Blocks", "id": 1201, "name": "Export the audit log as CSV", "type": "feature", "done": False},
        ],
        "comments": [
            {"id": 1, "author": "Jordan K.", "created": now - 3 * 3600, "text": "Should the backoff cap at an hour? Some endpoints are down overnight.", "reply": False},
            {"id": 2, "author": "Alex M.", "created": now - 2 * 3600, "text": "An hour sounds right. After 8 attempts we park it and alert.", "reply": True},
        ],
        "at": now,
    }


def main():
    try:
        config = load_config()
        if len(sys.argv) == 3 and sys.argv[1] == "story":
            result = story(config, sys.argv[2])
        else:
            result = board(config)
    except BoardError as error:
        result = {"error": str(error)}
    except urllib.error.HTTPError as error:
        result = {"error": "Shortcut token rejected" if error.code in (401, 403) else f"Shortcut HTTP {error.code}"}
    except (urllib.error.URLError, OSError):
        result = {"error": "Shortcut unreachable"}
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
