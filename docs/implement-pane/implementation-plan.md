# Implement Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use axialpower:subagent-driven-development (recommended) or axialpower:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Implement button on board tickets assigned to you opens a 40% pane (agent, model, effort, toggles, optional prompt) whose Start button launches Claude or Codex in a new tab, running `axialpower:implement-ticket` against the Shortcut story from the latest `integration`.

**Architecture:** Pure logic (choices, argv, launch brief, start folder) lives in `mods/shortcut-board/implement.js` with no Herdr imports, so `node --test` covers it. The pane view and the launch flow live in `mods/shortcut-board/implement-pane.js`. `main.js` only gets the button, the open/close wiring and the render switch. `fetch_board.py` adds the story's suggested branch name and an optional start folder.

**Tech Stack:** Herdr mod API (`gpui-kit`, `gpui-base`, `herdr`), plain ES modules, Python 3 (fetch script), `node --test` (Node 22) and `unittest`.

**Spec:** `docs/implement-pane/design.md`. Work in `~/source/herdr-board-desk` (the repo). Live mods are in `~/.config/herdr-app/mods`; Task 7 deploys there.

**One deviation from the design doc, decided here:** the first message does not carry the multi-line text inline. A newline typed into an agent's input can submit early, so Start writes the full text to a launch brief file (`~/.cache/herdr-implement/sc-<id>-<timestamp>.md`) and the first message is one line: the skill invocation plus "read and follow the launch brief at <path>". The brief holds the branch, the integration rule, the toggles and the optional prompt verbatim. Side benefit: every launch leaves an auditable record. Task 7 updates `design.md` to say so.

## File structure

- Create `package.json` (repo root): marks the repo as ES modules and gives `npm test`.
- Create `mods/shortcut-board/implement.js`: pure logic.
- Create `tests/implement.test.js`: node tests for `implement.js`.
- Create `tests/test_fetch_board.py`: unittest for the demo story branch.
- Create `mods/shortcut-board/implement-pane.js`: the pane view and `start()` flow.
- Modify `mods/shortcut-board/main.js`: button, wiring, render switch.
- Modify `mods/shortcut-board/fetch_board.py`: `branch` on the story, `implement_root` on the board.
- Modify `mods/shortcut-board/config.example.json`: document `implement_root`.
- Modify `docs/implement-pane/design.md`, `README.md`.

---

### Task 1: Pure logic and tests

**Files:**
- Create: `package.json`
- Create: `mods/shortcut-board/implement.js`
- Test: `tests/implement.test.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "herdr-board-desk",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/ && python3 -m unittest discover -s tests -p 'test_*.py'"
  }
}
```

- [ ] **Step 2: Write the failing tests** in `tests/implement.test.js`

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENTS,
  buildArgv,
  buildBrief,
  buildTask,
  choose,
  isReady,
  nextStep,
  sanitize,
  startFolder,
} from "../mods/shortcut-board/implement.js";

const EMPTY = { agent: null, model: null, effort: null };

test("sanitize keeps a valid remembered choice", () => {
  assert.deepEqual(sanitize({ agent: "claude", model: "opus", effort: "high" }), {
    agent: "claude",
    model: "opus",
    effort: "high",
  });
});

test("sanitize drops values the agent does not offer", () => {
  assert.deepEqual(sanitize({ agent: "codex", model: "opus", effort: "max" }), {
    agent: "codex",
    model: null,
    effort: null,
  });
  assert.deepEqual(sanitize({ agent: "nope", model: "opus", effort: "high" }), EMPTY);
  assert.deepEqual(sanitize(null), EMPTY);
});

test("choose resets model and effort when the agent changes", () => {
  const start = { agent: "claude", model: "opus", effort: "high" };
  assert.deepEqual(choose(start, "agent", "codex"), { agent: "codex", model: null, effort: null });
  assert.deepEqual(choose(start, "agent", "claude"), start);
  assert.deepEqual(choose(start, "model", "sonnet"), { agent: "claude", model: "sonnet", effort: "high" });
});

test("nextStep and isReady walk the stepper", () => {
  assert.equal(nextStep(EMPTY), "agent");
  assert.equal(nextStep({ agent: "claude", model: null, effort: null }), "model");
  assert.equal(nextStep({ agent: "claude", model: "opus", effort: null }), "effort");
  assert.equal(nextStep({ agent: "claude", model: "opus", effort: "high" }), null);
  assert.equal(isReady({ agent: "claude", model: "opus", effort: "high" }), true);
  assert.equal(isReady({ agent: "claude", model: "opus", effort: null }), false);
});

test("buildArgv appends the agent's own flags to its run command", () => {
  assert.deepEqual(buildArgv({ run: ["claude"], agent: "claude", model: "opus", effort: "high" }), [
    "claude",
    "--model",
    "opus",
    "--effort",
    "high",
  ]);
  assert.deepEqual(
    buildArgv({ run: ["codex", "--no-daemon"], agent: "codex", model: "gpt-6.1-sol", effort: "medium" }),
    ["codex", "--no-daemon", "-m", "gpt-6.1-sol", "-c", 'model_reasoning_effort="medium"'],
  );
});

const BRIEF = {
  storyId: 1188,
  url: "https://app.shortcut.com/x/story/1188",
  branch: "sc-1188-retry-webhooks",
  interactive: true,
  planOnly: false,
  prompt: "",
  pullFailed: false,
};

test("buildBrief states the story, the branch and the integration rule", () => {
  const brief = buildBrief(BRIEF);
  assert.match(brief, /sc-1188 \(https:\/\/app\.shortcut\.com\/x\/story\/1188\)/);
  assert.match(brief, /Use the branch name sc-1188-retry-webhooks\./);
  assert.match(brief, /latest integration branch/);
  assert.match(brief, /bin\/create-worktree/);
  assert.doesNotMatch(brief, /Plan only/);
  assert.doesNotMatch(brief, /## Prompt/);
  assert.doesNotMatch(brief, /could not update integration/);
});

test("buildBrief omits the branch line when Shortcut gave none", () => {
  assert.doesNotMatch(buildBrief({ ...BRIEF, branch: null }), /branch name/);
});

test("buildBrief adds the plan-only, run-to-completion and pull-failed lines", () => {
  const brief = buildBrief({ ...BRIEF, planOnly: true, interactive: false, pullFailed: true });
  assert.match(brief, /Plan only: stop after the implementation plan/);
  assert.match(brief, /Run to completion: do not ask questions/);
  assert.match(brief, /could not update integration/);
  assert.match(brief, /origin\/integration/);
});

test("buildBrief appends the optional prompt verbatim after a blank line", () => {
  const brief = buildBrief({ ...BRIEF, prompt: "  Line one\nLine two  \n" });
  assert.match(brief, /\n\n## Prompt\nLine one\nLine two\n$/);
});

test("buildBrief ignores a whitespace-only prompt", () => {
  assert.doesNotMatch(buildBrief({ ...BRIEF, prompt: "  \n " }), /## Prompt/);
});

test("buildTask is one line and points at the brief", () => {
  const claude = buildTask({ agent: "claude", storyId: 1188, url: BRIEF.url, briefPath: "/tmp/b.md" });
  assert.equal(
    claude,
    "/axialpower:implement-ticket sc-1188 First read the launch brief at /tmp/b.md and follow it.",
  );
  const codex = buildTask({ agent: "codex", storyId: 1188, url: BRIEF.url, briefPath: "/tmp/b.md" });
  assert.equal(
    codex,
    "Implement Shortcut story sc-1188 (https://app.shortcut.com/x/story/1188). First read the launch brief at /tmp/b.md and follow it.",
  );
  assert.ok(!claude.includes("\n") && !codex.includes("\n"));
});

test("startFolder defaults to the axial-main root and expands ~", () => {
  assert.equal(startFolder(undefined, "/Users/me"), "/Users/me/source/axial-main");
  assert.equal(startFolder("~/work/axial-main", "/Users/me"), "/Users/me/work/axial-main");
  assert.equal(startFolder("/opt/axial-main", "/Users/me"), "/opt/axial-main");
});

test("every agent offers at least one model and one effort", () => {
  for (const agent of Object.values(AGENTS)) {
    assert.ok(agent.models.length > 0 && agent.efforts.length > 0);
  }
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `cd ~/source/herdr-board-desk && node --test tests/`
Expected: FAIL (cannot find module `implement.js`).

- [ ] **Step 4: Implement `mods/shortcut-board/implement.js`**

```js
// Pure logic for the Implement pane: the choices, the agent's argv, the launch brief and the start folder.
// No Herdr imports, so `node --test tests/` can run it.

// Models and efforts each agent offers. Edit here to add one. Claude takes the latest-model aliases.
export const AGENTS = {
  claude: {
    label: "Claude",
    models: [
      { id: "fable", label: "Fable" },
      { id: "opus", label: "Opus" },
      { id: "sonnet", label: "Sonnet" },
      { id: "haiku", label: "Haiku" },
    ],
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  codex: {
    label: "Codex",
    models: [{ id: "gpt-6.1-sol", label: "gpt-6.1-sol" }],
    efforts: ["low", "medium", "high"],
  },
};

export const STEPS = ["agent", "model", "effort"];

// The integration checkouts under the axial-main root. Both are updated before every launch,
// because the agent has not chosen a repo yet.
export const BASE_REPOS = ["axial-api.git", "fe-app.git"];

const DEFAULT_ROOT = "~/source/axial-main";

export function startFolder(configured, homeDir) {
  const path = configured || DEFAULT_ROOT;
  return path.startsWith("~/") ? `${homeDir}${path.slice(1)}` : path;
}

// A remembered choice, with anything the agent no longer offers dropped.
export function sanitize(last) {
  const agent = AGENTS[last?.agent] ? last.agent : null;
  if (!agent) return { agent: null, model: null, effort: null };
  const model = AGENTS[agent].models.some((m) => m.id === last.model) ? last.model : null;
  const effort = AGENTS[agent].efforts.includes(last.effort) ? last.effort : null;
  return { agent, model, effort };
}

export function choose(choice, step, value) {
  if (step === "agent") {
    return value === choice.agent ? choice : { agent: value, model: null, effort: null };
  }
  return { ...choice, [step]: value };
}

export const nextStep = (choice) => STEPS.find((step) => !choice[step]) ?? null;
export const isReady = (choice) => nextStep(choice) === null;

// `run` is the agent's own command from Herdr's program table (knownAgents()).
export function buildArgv({ run, agent, model, effort }) {
  if (agent === "claude") return [...run, "--model", model, "--effort", effort];
  return [...run, "-m", model, "-c", `model_reasoning_effort="${effort}"`];
}

// The full instructions, saved to a file so multi-line text never has to be typed into the agent.
export function buildBrief({ storyId, url, branch, interactive, planOnly, prompt, pullFailed }) {
  const lines = [`Shortcut story: sc-${storyId}${url ? ` (${url})` : ""}. The story is the source of truth.`];
  if (branch) lines.push(`Use the branch name ${branch}.`);
  lines.push(
    "Base the work on the latest integration branch: create the worktree from integration with " +
      "bin/create-worktree <branch>, run from axial-api.git or fe-app.git (whichever repo you choose). " +
      "Only branch from something else if the Prompt section below says so.",
  );
  if (pullFailed) {
    lines.push(
      "Herdr could not update integration automatically. Run git fetch and base the worktree on origin/integration.",
    );
  }
  if (planOnly) {
    lines.push("Plan only: stop after the implementation plan is written and wait for me. Do not write code.");
  }
  if (!interactive) {
    lines.push("Run to completion: do not ask questions. Decide, and log your assumptions in the PR description.");
  }
  let text = lines.join("\n");
  const extra = (prompt ?? "").trim();
  if (extra) text += `\n\n## Prompt\n${extra}`;
  return `${text}\n`;
}

// The one-line first message. Codex has no Axial skills, so it gets a plain request.
export function buildTask({ agent, storyId, url, briefPath }) {
  const read = `First read the launch brief at ${briefPath} and follow it.`;
  if (agent === "claude") return `/axialpower:implement-ticket sc-${storyId} ${read}`;
  return `Implement Shortcut story sc-${storyId} (${url}). ${read}`;
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `cd ~/source/herdr-board-desk && node --test tests/`
Expected: PASS (all tests in `implement.test.js`).

- [ ] **Step 6: Commit**

```bash
cd ~/source/herdr-board-desk
git add package.json mods/shortcut-board/implement.js tests/implement.test.js
git commit -m "Add pure Implement logic: choices, argv, launch brief, start folder"
```

---

### Task 2: Story branch name and start folder in the fetch script

**Files:**
- Modify: `mods/shortcut-board/fetch_board.py` (story return near line 305, `demo_story` return near line 366, `main()` near line 380)
- Modify: `mods/shortcut-board/config.example.json`
- Test: `tests/test_fetch_board.py`

- [ ] **Step 1: Write the failing test** in `tests/test_fetch_board.py`

```python
import importlib.util
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "mods", "shortcut-board", "fetch_board.py")

spec = importlib.util.spec_from_file_location("fetch_board", SCRIPT)
fetch_board = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch_board)


class DemoStoryTest(unittest.TestCase):
    def test_story_carries_the_suggested_branch_name(self):
        story = fetch_board.demo_story(1188)
        self.assertEqual(story["branch"], "sc-1188-retry-webhook-deliveries-with-backoff")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd ~/source/herdr-board-desk && python3 -m unittest discover -s tests -p 'test_*.py'`
Expected: FAIL with `KeyError: 'branch'`.

- [ ] **Step 3: Add `branch` to the demo story.** In `demo_story`, change

```python
        "id": sid, "name": title, "url": f"{DEMO_URL}{sid}", "state": state, "type": kind, "epic": epic,
```

to

```python
        "id": sid, "name": title, "url": f"{DEMO_URL}{sid}", "state": state, "type": kind, "epic": epic,
        "branch": "sc-%d-%s" % (sid, re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")),
```

- [ ] **Step 4: Add `branch` to the real story payload.** In `story()`, change

```python
        "url": s["app_url"],
        "state": states.get(str(s.get("workflow_state_id"))),
```

to

```python
        "url": s["app_url"],
        "branch": s.get("formatted_vcs_branch_name"),
        "state": states.get(str(s.get("workflow_state_id"))),
```

- [ ] **Step 5: Pass the optional start folder with the board.** In `main()`, change

```python
        else:
            result = board(config)
```

to

```python
        else:
            result = board(config)
            result["implement_root"] = config.get("implement_root")
```

- [ ] **Step 6: Document the setting.** Replace `mods/shortcut-board/config.example.json` with

```json
{
  "team": "Your team name",
  "columns": ["Unstarted", "In Progress", "In Review", "Done"],
  "token_file": "~/.config/shortcut-token",
  "implement_root": "~/source/axial-main",
  "demo": false
}
```

Also add this line to the settings list in the docstring at the top of `fetch_board.py`, after the `token_file` line:

```
  implement_root  the axial-main folder where Implement starts its agent (default ~/source/axial-main)
```

- [ ] **Step 7: Run the test to confirm it passes**

Run: `cd ~/source/herdr-board-desk && python3 -m unittest discover -s tests -p 'test_*.py'`
Expected: PASS.

- [ ] **Step 8: Check the real API returns a branch**

Run: `cd ~/source/herdr-board-desk/mods/shortcut-board && python3 fetch_board.py story <any story id on your board> | python3 -c "import json,sys; print(json.load(sys.stdin).get('branch'))"`
Expected: a branch such as `kristijan/sc-12345/some-title` or `sc-12345-some-title`. `None` means Shortcut returned no suggestion; the pane then omits the branch line (covered in Task 1).

- [ ] **Step 9: Commit**

```bash
cd ~/source/herdr-board-desk
git add mods/shortcut-board/fetch_board.py mods/shortcut-board/config.example.json tests/test_fetch_board.py
git commit -m "Fetch the story's suggested branch name and an optional Implement start folder"
```

---

### Task 3: The Implement pane view

**Files:**
- Create: `mods/shortcut-board/implement-pane.js`

- [ ] **Step 1: Create `mods/shortcut-board/implement-pane.js`**

```js
// The Implement pane: pick an agent, model and effort, add an optional prompt, press Start.
// Start brings integration up to date, writes a launch brief and opens the agent in a new tab.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, TextareaState, Textarea } from "gpui-base";
import { theme, exec, home, run, focused, knownAgents, writeTextFile } from "herdr";
import {
  AGENTS,
  BASE_REPOS,
  STEPS,
  buildArgv,
  buildBrief,
  buildTask,
  choose,
  isReady,
  nextStep,
  sanitize,
} from "./implement.js";

const LAST_KEY = "implement-last";
const BRIEF_DIR = ".cache/herdr-implement";
const GUTTER = 10;
const STEP_TITLE = { agent: "Agent", model: "Model", effort: "Effort" };
const stop = (_e, cx) => cx.stop_propagation();

export class ImplementPane {
  init() {
    this.storyId = null;
    this.choice = { agent: null, model: null, effort: null };
    this.openStep = "agent";
    this.planOnly = false;
    this.starting = false;
    this.error = null;
    this.notice = null;
    this.installed = {};
    this.prompt = TextareaState.new({ placeholder: "Anything extra for the agent. Leave empty to skip.", rows: 5 });
  }

  isOpen(id) {
    return this.storyId !== null && this.storyId === id;
  }

  open(id, cx) {
    this.storyId = id;
    let last = null;
    try {
      last = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
    } catch {}
    this.choice = sanitize(last);
    this.openStep = nextStep(this.choice);
    this.planOnly = false;
    this.starting = false;
    this.error = null;
    this.notice = null;
    this.prompt.set_value("");
    cx.spawn(async (cx) => {
      try {
        const list = await knownAgents();
        this.installed = Object.fromEntries(list.map((a) => [a.key, a.installed]));
      } catch {}
      cx.notify();
    });
    cx.notify();
  }

  close() {
    this.storyId = null;
  }

  pick(step, value, cx) {
    this.choice = choose(this.choice, step, value);
    this.openStep = nextStep(this.choice);
    cx.notify();
  }

  options(step) {
    if (step === "agent") return Object.entries(AGENTS).map(([id, agent]) => ({ id, label: agent.label }));
    if (step === "model") return AGENTS[this.choice.agent].models;
    return AGENTS[this.choice.agent].efforts.map((id) => ({ id, label: id }));
  }

  labelOf(step) {
    return this.options(step).find((o) => o.id === this.choice[step])?.label ?? this.choice[step];
  }

  optionChip(view, step, option) {
    const disabled = step === "agent" && this.installed[option.id] === false;
    const label = disabled ? `${option.label} (not installed)` : option.label;
    return view.chip(`impl-${step}-${option.id}`, label, this.choice[step] === option.id, (_e, cx) => {
      cx.stop_propagation();
      if (!disabled) this.pick(step, option.id, cx);
    });
  }

  // One step at a time: a step shows once the one before it is chosen, and collapses to a chip when chosen.
  stepper(view) {
    const t = theme();
    const rows = [];
    for (const step of STEPS) {
      const before = STEPS[STEPS.indexOf(step) - 1];
      if (before && !this.choice[before]) break;
      const value = this.choice[step];
      const expanded = this.openStep === step || !value;
      const chips = expanded
        ? this.options(step).map((option) => this.optionChip(view, step, option))
        : [
            view.chip(`impl-${step}-chosen`, this.labelOf(step), true, (_e, cx) => {
              cx.stop_propagation();
              this.openStep = step;
              cx.notify();
            }),
          ];
      rows.push(
        v_flex()
          .id(`impl-step-${step}`)
          .gap(8)
          .child(div().text_size(12).text_color(t.dim).child(STEP_TITLE[step]))
          .child(h_flex().gap(6).flex_wrap().children(chips)),
      );
    }
    return v_flex().gap(16).children(rows);
  }

  toggles(view) {
    const t = theme();
    return v_flex()
      .gap(10)
      .child(div().text_size(12).text_color(t.dim).child("Mode"))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .flex_wrap()
          .child(view.chip("impl-interactive", "Interactive", true, stop))
          .child(
            h_flex()
              .id("impl-run")
              .h(26)
              .px(12)
              .gap(8)
              .items_center()
              .rounded_full()
              .border(1)
              .border_color(t.border)
              .text_size(12.5)
              .text_color(t.dim)
              .child("Run to completion")
              .child(
                div().px(6).h(18).flex().items_center().rounded_full().bg(t.raised).text_size(11).child("coming soon"),
              ),
          ),
      )
      .child(
        h_flex()
          .gap(6)
          .child(
            view.chip("impl-plan", "Plan only, stop before coding", this.planOnly, (_e, cx) => {
              cx.stop_propagation();
              this.planOnly = !this.planOnly;
              cx.notify();
            }),
          ),
      );
  }

  promptBox() {
    const t = theme();
    return v_flex()
      .gap(6)
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Prompt"))
          .child(div().text_size(12).text_color(t.dim).child("optional")),
      )
      .child(div().text_size(12).text_color(t.dim).child("Added to the end of the first message. Leave it empty to skip."))
      .child(
        Textarea.new(this.prompt)
          .h(128)
          .rounded(9)
          .border_1()
          .border_color(t.input)
          .bg(t.background)
          .text_size(12.8)
          .text_color(t.foreground),
      );
  }

  startButton(view, story) {
    const t = theme();
    const ready = isReady(this.choice) && Boolean(story) && !this.starting;
    return div()
      .id("impl-start")
      .h(36)
      .flex()
      .items_center()
      .justify_center()
      .rounded(8)
      .text_size(13.5)
      .font_semibold()
      .bg(ready ? t.accent : t.raised)
      .text_color(ready ? t.background : t.dim)
      .when(ready, (el) => el.cursor_pointer())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (ready) this.start(story, view.root(), cx);
      })
      .child(this.starting ? "Starting…" : "Start");
  }

  // Brings both integration checkouts up to date, writes the launch brief, then opens the agent in a new tab.
  start(story, root, cx) {
    this.starting = true;
    this.error = null;
    this.notice = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const failed = [];
        await Promise.all(
          BASE_REPOS.map(async (repo) => {
            try {
              const r = await exec("git", ["pull", "--ff-only"], { cwd: `${root}/${repo}`, timeout: 120000 });
              if (r.code !== 0) failed.push(repo);
            } catch {
              failed.push(repo);
            }
          }),
        );
        const agents = await knownAgents();
        const entry = agents.find((a) => a.key === this.choice.agent);
        if (!entry || !entry.installed) throw new Error(`${AGENTS[this.choice.agent].label} is not installed`);
        const dir = `${home()}/${BRIEF_DIR}`;
        await exec("mkdir", ["-p", dir]);
        const briefPath = `${dir}/sc-${story.id}-${Date.now()}.md`;
        const brief = buildBrief({
          storyId: story.id,
          url: story.url,
          branch: story.branch,
          interactive: true,
          planOnly: this.planOnly,
          prompt: this.prompt.value(),
          pullFailed: failed.length > 0,
        });
        await writeTextFile(briefPath, brief, null);
        run("tab.new", {
          name: `sc-${story.id}`,
          space: focused()?.space,
          folder: root,
          argv: buildArgv({ run: entry.run, ...this.choice }),
          task: buildTask({ agent: this.choice.agent, storyId: story.id, url: story.url, briefPath }),
          focus: true,
        });
        try {
          localStorage.setItem(LAST_KEY, JSON.stringify(this.choice));
        } catch {}
        this.notice = failed.length
          ? `Started. Could not update ${failed.join(" and ")}; the agent was told to fetch.`
          : `Started sc-${story.id} in a new tab.`;
      } catch (error) {
        this.error = String(error?.message ?? error);
      } finally {
        this.starting = false;
        cx.notify();
      }
    });
  }

  render(view) {
    const t = theme();
    const id = this.storyId;
    const entry = view.details[id] ?? {};
    const story = entry.data;
    const found = view.findCard(id);
    const name = story?.name ?? found?.card.name ?? `sc-${id}`;
    const state = story?.state ?? found?.column;
    const branch = story?.branch;

    const header = h_flex()
      .h(54)
      .flex_none()
      .px(18)
      .gap(10)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .text_size(12.5)
      .child(div().flex_none().text_color(t.ansi4).child(`sc-${id}`))
      .when(Boolean(state), (el) =>
        el.child(
          h_flex()
            .gap(6)
            .items_center()
            .text_color(t.muted)
            .child(div().size(7).rounded_full().bg(view.stateColor(state)))
            .child(state),
        ),
      )
      .child(div().flex_1())
      .when(Boolean(entry.loading), (el) =>
        el.child(svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.dim).spin(900)),
      )
      .child(
        div()
          .id("impl-close")
          .size(26)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .rounded(6)
          .cursor_pointer()
          .text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Back to the story")
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.close();
            cx.notify();
          })
          .child(svg("mods/pane/close.svg").size(14)),
      );

    const body = v_flex()
      .id(`impl-content-${id}`)
      .pl(22)
      .pr(22 - GUTTER)
      .pt(20)
      .pb(28)
      .gap(22)
      .child(
        v_flex()
          .gap(6)
          .child(div().text_size(12).text_color(t.dim).child("Implement"))
          .child(div().text_size(18).font_semibold().text_color(t.foreground).whitespace_normal().child(name)),
      )
      .child(this.stepper(view))
      .when(this.choice.agent === "codex", (el) =>
        el.child(
          div()
            .text_size(12)
            .text_color(t.dim)
            .whitespace_normal()
            .child(
              "Codex does not have the Axial skills yet, so it will not use implement-ticket. " +
                "It works from the ticket and your prompt.",
            ),
        ),
      )
      .when(Boolean(branch), (el) =>
        el.child(
          v_flex()
            .gap(6)
            .child(div().text_size(12).text_color(t.dim).child("Branch"))
            .child(div().text_size(12.5).text_color(t.foreground).whitespace_normal().child(branch)),
        ),
      )
      .child(this.toggles(view))
      .child(this.promptBox());

    const footer = v_flex()
      .flex_none()
      .p(16)
      .gap(8)
      .border_t(1)
      .border_color(t.border)
      .when(Boolean(this.error), (el) => el.child(div().text_size(12.5).text_color(t.blocked).whitespace_normal().child(this.error)))
      .when(Boolean(this.notice), (el) => el.child(div().text_size(12.5).text_color(t.muted).whitespace_normal().child(this.notice)))
      .child(this.startButton(view, story));

    return v_flex()
      .id("implement")
      .flex_1()
      .min_w(0)
      .h_full()
      .border(1)
      .border_color(t.border)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .on_click(stop)
      .child(header)
      .child(view.scrollArea("implement", body, GUTTER))
      .child(footer);
  }
}
```

- [ ] **Step 2: Syntax check**

Run: `cd ~/source/herdr-board-desk && node --check mods/shortcut-board/implement-pane.js`
Expected: no output (a syntax-only check; the Herdr imports are not resolved by `--check`).

- [ ] **Step 3: Commit**

```bash
git add mods/shortcut-board/implement-pane.js
git commit -m "Add the Implement pane view and launch flow"
```

---

### Task 4: Wire the pane into the board

**Files:**
- Modify: `mods/shortcut-board/main.js`

Apply these edits in order. Each `old` string occurs exactly once.

- [ ] **Step 1: Imports.** Change

```js
import { theme, exec, appHome, checking, layout } from "herdr";
```

to

```js
import { theme, exec, appHome, checking, layout, home } from "herdr";
import { ImplementPane } from "./implement-pane.js";
import { startFolder } from "./implement.js";
```

- [ ] **Step 2: Create the pane in `init`.** Change

```js
    this.script = `${appHome()}/mods/shortcut-board/fetch_board.py`;
    this.filter = "all";
```

to

```js
    this.script = `${appHome()}/mods/shortcut-board/fetch_board.py`;
    this.implement = new ImplementPane();
    this.implement.init();
    this.filter = "all";
```

- [ ] **Step 3: Close the pane when another story is selected, and add `root`, `deselect`, `openImplement`.** Change

```js
  select(id, cx) {
    this.selected = id;
```

to

```js
  root() {
    return startFolder(this.board?.implement_root, home());
  }

  deselect(cx) {
    this.selected = null;
    this.implement.close();
    cx.notify();
  }

  openImplement(id, cx) {
    if (this.selected !== id) this.select(id, cx);
    this.implement.open(id, cx);
  }

  select(id, cx) {
    if (!this.implement.isOpen(id)) this.implement.close();
    this.selected = id;
```

- [ ] **Step 4: Add the button method** before `card(c) {`. Change

```js
  card(c) {
    const t = theme();
    const selected = this.selected === c.id;
```

to

```js
  implementButton(key, id) {
    const t = theme();
    return div().id(key).h(26).px(10).flex().items_center().rounded(6).text_size(12).font_semibold().cursor_pointer()
      .bg(t.accent).text_color(t.background)
      .on_click((_e, cx) => { cx.stop_propagation(); this.openImplement(id, cx); })
      .child("Implement");
  }

  card(c) {
    const t = theme();
    const selected = this.selected === c.id;
```

- [ ] **Step 5: Button on assigned cards.** Change

```js
      .child(h_flex().gap(6).flex_wrap()
        .child(this.linkButton(`sc-${c.id}-open`, "Shortcut", c.url))
```

to

```js
      .child(h_flex().gap(6).flex_wrap()
        .when(c.mine, (el) => el.child(this.implementButton(`sc-${c.id}-implement`, c.id)))
        .child(this.linkButton(`sc-${c.id}-open`, "Shortcut", c.url))
```

- [ ] **Step 6: Button in the story header, and use `deselect` for its close.** Change

```js
      .when(Boolean(url), (el) => el.child(this.linkButton(`detail-open-${id}`, "Open in Shortcut", url)))
```

to

```js
      .when(Boolean(found?.card.mine), (el) => el.child(this.implementButton(`detail-implement-${id}`, id)))
      .when(Boolean(url), (el) => el.child(this.linkButton(`detail-open-${id}`, "Open in Shortcut", url)))
```

and change

```js
        .on_click((_e, cx) => { cx.stop_propagation(); this.selected = null; cx.notify(); })
```

to

```js
        .on_click((_e, cx) => { cx.stop_propagation(); this.deselect(cx); })
```

- [ ] **Step 7: Background click uses `deselect`.** Change

```js
      .on_click((_e, cx) => { if (this.selected !== null) { this.selected = null; cx.notify(); } })
```

to

```js
      .on_click((_e, cx) => { if (this.selected !== null) this.deselect(cx); })
```

- [ ] **Step 8: Render the pane in place of the story when open.** Change

```js
      .when(open, (el) => el.child(this.detailPanel()));
```

to

```js
      .when(open, (el) => el.child(this.implement.isOpen(this.selected) ? this.implement.render(this) : this.detailPanel()));
```

- [ ] **Step 9: Syntax check and commit**

Run: `cd ~/source/herdr-board-desk && node --check mods/shortcut-board/main.js`
Expected: no output.

```bash
git add mods/shortcut-board/main.js
git commit -m "Wire the Implement button and pane into the Shortcut board"
```

---

### Task 5: Load check in Herdr

**Files:** none (deploy and verify)

- [ ] **Step 1: Copy the changed mod files into the live Herdr folder**

```bash
cd ~/source/herdr-board-desk/mods/shortcut-board
LIVE=~/.config/herdr-app/mods/shortcut-board
cp main.js implement.js implement-pane.js fetch_board.py config.example.json "$LIVE/"
```

Leave the live `config.json` untouched. Optionally add `"implement_root": "~/source/axial-main"` to it (the default is the same).

- [ ] **Step 2: Run Herdr's own mod check**

Run: `herdr-app check ~/.config/herdr-app/mods/shortcut-board`
Expected: reports no errors. If it names an unknown method (for example on `Textarea` or `TextareaState`), compare against `~/.config/herdr-app/gpui-kit.d.ts` and fix `implement-pane.js` in the repo, then repeat Step 1.

- [ ] **Step 3: Restart or reload Herdr and look at the board**

Run: `herdr-app status`
Expected: no mod errors listed. Open the board view: assigned cards (filter "Mine") show an accent-colored Implement button next to "Shortcut"; other people's cards do not.

---

### Task 6: Manual end-to-end check

**Files:** none

- [ ] **Step 1: Open the pane.** Click Implement on one of your cards. Expected: the pane opens in the story slot (board 60%, pane 40%), header shows the story id and state, and only the Agent step shows (or all three as chips if a previous choice was remembered).
- [ ] **Step 2: Walk the stepper.** Pick Claude, then a model, then an effort. Expected: each step collapses to a chip as the next appears; clicking a chip reopens that step; switching agent clears model and effort. Start is disabled until all three are set and the story has loaded.
- [ ] **Step 3: Check the extras.** Branch row shows Shortcut's suggested branch; Run to completion shows "coming soon" and cannot be clicked; Plan only toggles on and off; the Prompt box says "optional", accepts several lines and keeps them while you toggle things.
- [ ] **Step 4: Start with Claude.** Type a two-line prompt, press Start. Expected: a new tab named `sc-<id>` opens in the axial-main root with Claude on the chosen model and effort; its first message is the one-line `/axialpower:implement-ticket ...` invocation; `~/.cache/herdr-implement/sc-<id>-*.md` exists and contains the branch, the integration rule and your prompt after `## Prompt`; the agent starts brainstorming and asks questions in the tile.
- [ ] **Step 5: Check the integration pull.** Run `git -C ~/source/axial-main/axial-api.git log -1 --format=%cd` and `git -C ~/source/axial-main/fe-app.git log -1 --format=%cd`. Expected: both show recent commits (pulled at Start). Make `fe-app.git` dirty on purpose with a throwaway untracked-file conflict or switch it off `integration`, press Start again, and confirm the pane notice says it could not update `fe-app.git` and the new brief contains the "could not update integration" line. Restore the checkout afterwards.
- [ ] **Step 6: Start with Codex.** Expected: the inline note about missing Axial skills shows; the new tab runs Codex with `-m` and the effort setting; the first message is "Implement Shortcut story sc-<id> ...".
- [ ] **Step 7: Check the worktree setup from the axial-main root.** In the Claude tile, let implement-ticket reach its worktree step. Expected: it creates the worktree from `integration` using `bin/create-worktree`. If it refuses to run from the axial-main root, record exactly what it says in `docs/implement-pane/investigation.md` under Open questions and tell the user; do not work around it in code.

---

### Task 7: Docs and wrap-up

**Files:**
- Modify: `docs/implement-pane/design.md`
- Modify: `docs/implement-pane/investigation.md`
- Modify: `README.md`

- [ ] **Step 1: Update `design.md`.** In "What Start does", replace the sentence beginning "First message for Claude:" and its code block with:

```
Start writes the full instructions to a launch brief file, `~/.cache/herdr-implement/sc-<id>-<timestamp>.md`
(story, branch, the integration rule, plan-only and run-to-completion lines, and the optional prompt verbatim
after a blank line), because a multi-line message typed into an agent can submit early. The first message is one
line: for Claude, `/axialpower:implement-ticket sc-<id> First read the launch brief at <path> and follow it.`; for
Codex, `Implement Shortcut story sc-<id> (<url>). First read the launch brief at <path> and follow it.`
```

- [ ] **Step 2: Update `investigation.md`.** Under "Open questions", mark the `task` question resolved with the same reason (newline risk, brief file chosen), and note the answer to the worktree-from-axial-main question found in Task 6 Step 7.

- [ ] **Step 3: Add a short Implement section to `README.md`** (3 to 5 lines): what the button does, that it needs the `axialpower` plugin for Claude, the `implement_root` setting, and where launch briefs are saved.

- [ ] **Step 4: Run all tests and check for em dashes**

Run: `cd ~/source/herdr-board-desk && npm test && grep -rn $'\xe2\x80\x94' docs README.md mods tests package.json; echo "grep exit: $?"`
Expected: all tests pass; grep prints nothing and `grep exit: 1`.

- [ ] **Step 5: Commit and push**

```bash
git add docs README.md
git commit -m "Document the Implement pane launch brief and setup"
git push origin HEAD
```
