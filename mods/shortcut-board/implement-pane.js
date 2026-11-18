// The Implement pane: pick an agent, model and effort, add an optional prompt, press Start.
// Start brings integration up to date, writes a launch brief and opens the agent in a new tab.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, TextareaState, Textarea, InputState, Input } from "gpui-base";
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
  normalizeBranch,
  sanitize,
  summarizePulls,
} from "./implement.js";

const LAST_KEY = "implement-last";
const BRIEF_DIR = ".cache/herdr-implement";
const GUTTER = 10;
const STEP_TITLE = { agent: "Agent", model: "Model", effort: "Effort" };
const stop = (_e, cx) => cx.stop_propagation();
const icon = (name) => `mods/shortcut-board/icons/${name}.svg`;

export class ImplementPane {
  init() {
    this.storyId = null;
    this.choice = { agent: null, model: null, effort: null };
    this.planOnly = false;
    this.starting = false;
    this.inFlight = new Set();
    this.launched = false;
    this.error = null;
    this.notice = null;
    this.warning = null;
    this.installed = {};
    this.branchInput = InputState.new({ placeholder: "branch-name" });
    this.branchInput.on("submit", (_e, cx) => this.saveBranch(cx));
    this.branchEditing = false;
    this.branchOverride = null;
    this.branchError = null;
    this.prompt = TextareaState.new({ placeholder: "Anything extra for the agent. Leave empty to skip.", rows: 5 });
    this.prompt.on("change", (_e, cx) => {
      if (!this.launched) return;
      this.launched = false;
      cx.notify();
    });
  }

  isOpen(id) {
    return this.storyId !== null && this.storyId === id;
  }

  open(id, cx) {
    if (this.isOpen(id)) return;
    this.storyId = id;
    let last = null;
    try {
      last = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
    } catch {}
    this.choice = sanitize(last);
    this.planOnly = false;
    this.starting = false;
    this.error = null;
    this.notice = null;
    this.warning = null;
    this.prompt.set_value("");
    this.branchEditing = false;
    this.branchOverride = null;
    this.branchError = null;
    this.launched = false;
    cx.spawn(async (cx) => {
      try {
        const list = await knownAgents();
        this.installed = Object.fromEntries(list.map((a) => [a.key, a.installed]));
        if (this.isOpen(id) && this.choice.agent && this.installed[this.choice.agent] === false) {
          this.choice = { agent: null, model: null, effort: null };
        }
      } catch {}
      cx.notify();
    });
    cx.notify();
  }

  close() {
    this.storyId = null;
  }

  // The branch the agent will be told to use: your edit, else Shortcut's suggestion made safe for create-worktree.
  effectiveBranch(story) {
    return this.branchOverride ?? normalizeBranch(story?.branch);
  }

  startBranchEdit(story, cx) {
    this.branchEditing = true;
    this.branchError = null;
    this.branchInput.set_value(this.effectiveBranch(story) ?? "");
    this.branchInput.focus();
    cx.notify();
  }

  cancelBranchEdit(cx) {
    this.branchEditing = false;
    this.branchError = null;
    cx.notify();
  }

  // An empty box goes back to Shortcut's suggestion. Anything else must already be a valid name; it is never rewritten.
  saveBranch(cx) {
    const value = this.branchInput.value().trim();
    if (value && normalizeBranch(value) !== value) {
      this.branchError = "Use letters, digits, - and _ only, starting with a letter.";
      cx.notify();
      return;
    }
    this.branchOverride = value || null;
    this.branchEditing = false;
    this.branchError = null;
    this.launched = false;
    cx.notify();
  }

  pick(step, value, cx) {
    this.choice = choose(this.choice, step, value);
    this.launched = false;
    cx.notify();
  }

  options(step) {
    if (step === "agent") return Object.entries(AGENTS).map(([id, agent]) => ({ id, label: agent.label }));
    if (step === "model") return AGENTS[this.choice.agent].models;
    return AGENTS[this.choice.agent].efforts.map((id) => ({ id, label: id }));
  }

  optionChip(view, step, option) {
    if (step === "agent" && this.installed[option.id] === false) {
      const t = theme();
      return div()
        .id(`impl-${step}-${option.id}`)
        .h(26)
        .px(12)
        .flex()
        .items_center()
        .rounded_full()
        .text_size(12.5)
        .border(1)
        .border_color(t.border)
        .bg(t.background)
        .text_color(t.dim)
        .opacity(0.5)
        .child(`${option.label} (not installed)`);
    }
    return view.chip(`impl-${step}-${option.id}`, option.label, this.choice[step] === option.id, (_e, cx) => {
      cx.stop_propagation();
      this.pick(step, option.id, cx);
    });
  }

  // One step at a time: a step shows once the one before it is chosen. Every option stays visible, the chosen one is highlighted.
  stepper(view) {
    const t = theme();
    const rows = [];
    for (const step of STEPS) {
      const before = STEPS[STEPS.indexOf(step) - 1];
      if (before && !this.choice[before]) break;
      const chips = this.options(step).map((option) => this.optionChip(view, step, option));
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
          .id("impl-plan")
          .h(32)
          .gap(12)
          .items_center()
          .cursor_pointer()
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.planOnly = !this.planOnly;
            this.launched = false;
            cx.notify();
          })
          .child(div().flex_1().min_w(0).text_size(13).text_color(t.foreground).child("Plan only, stop before coding"))
          .child(this.switchTrack(this.planOnly)),
      );
  }

  // A small on/off switch; the row around it handles the click.
  switchTrack(on) {
    const t = theme();
    return h_flex()
      .w(36)
      .h(20)
      .flex_none()
      .px(3)
      .items_center()
      .when(on, (el) => el.justify_end())
      .rounded_full()
      .border(1)
      .border_color(on ? t.accent : t.border)
      .bg(on ? t.accent : t.raised)
      .child(div().size(12).rounded_full().bg(on ? t.background : t.muted));
  }

  iconButton(id, name, tooltip, action) {
    const t = theme();
    return div()
      .id(id)
      .size(26)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .cursor_pointer()
      .text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tooltip)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action(cx);
      })
      .child(svg(name).size(14));
  }

  branchRow(view, story, branch) {
    const t = theme();
    const label = div().text_size(12).text_color(t.dim).child("Branch");
    if (this.branchEditing) {
      return v_flex()
        .gap(6)
        .child(label)
        .child(
          h_flex()
            .gap(6)
            .items_center()
            .child(
              Input.new(this.branchInput)
                .flex_1()
                .min_w(0)
                .h(32)
                .px(10)
                .rounded(8)
                .border_1()
                .border_color(t.accent)
                .bg(t.background)
                .text_size(12.5)
                .text_color(t.foreground),
            )
            .child(this.iconButton("impl-branch-save", icon("check"), "Use this branch", (cx) => this.saveBranch(cx)))
            .child(this.iconButton("impl-branch-cancel", "mods/pane/close.svg", "Cancel", (cx) => this.cancelBranchEdit(cx))),
        )
        .when(Boolean(this.branchError), (el) =>
          el.child(div().text_size(12).text_color(t.blocked).whitespace_normal().child(this.branchError)),
        );
    }
    return v_flex()
      .gap(6)
      .child(label)
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(
            div()
              .flex_1()
              .min_w(0)
              .text_size(12.5)
              .text_color(branch ? t.foreground : t.dim)
              .whitespace_normal()
              .child(branch ?? "No suggested branch"),
          )
          .child(this.iconButton("impl-branch-edit", icon("pencil"), "Edit the branch name", (cx) => this.startBranchEdit(story, cx))),
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
      .child(div().text_size(12).text_color(t.dim).child("Added to the launch brief the agent reads first. Leave it empty to skip."))
      .child(
        Textarea.new(this.prompt)
          .h(128)
          .px(10)
          .py(8)
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
    const ready = isReady(this.choice) && Boolean(story) && !this.starting && !this.launched &&
      !(story && this.inFlight.has(story.id));
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
  // Everything the async work needs is snapshotted first, so opening another story meanwhile cannot change this run.
  start(story, root, cx) {
    if (this.starting || this.inFlight.has(story.id)) return;
    const choice = { ...this.choice };
    const planOnly = this.planOnly;
    const prompt = this.prompt.value();
    const branch = this.effectiveBranch(story);
    const storyId = story.id;
    const same = () => this.storyId === storyId;
    const set = (fields) => {
      if (same()) Object.assign(this, fields);
    };
    this.inFlight.add(storyId);
    set({ starting: true, error: null, notice: null, warning: null });
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const agents = await knownAgents();
        const entry = agents.find((a) => a.key === choice.agent);
        if (!entry || !entry.installed) throw new Error(`${AGENTS[choice.agent].label} is not installed`);
        const pulls = await Promise.all(
          BASE_REPOS.map(async (repo) => {
            const cwd = `${root}/${repo}`;
            try {
              const head = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: 30000 });
              const current = String(head.stdout ?? "").trim();
              if (current !== "integration") {
                return { repo, ok: false, stderr: `fatal: checkout is on ${current}, not integration` };
              }
              const r = await exec("git", ["pull", "--ff-only"], { cwd, timeout: 120000 });
              return { repo, ok: r.code === 0, stderr: String(r.stderr ?? "") };
            } catch (error) {
              return { repo, ok: false, stderr: `error: ${String(error?.message ?? error)}` };
            }
          }),
        );
        const pullWarning = summarizePulls(pulls);
        const dir = `${home()}/${BRIEF_DIR}`;
        await exec("mkdir", ["-p", dir]);
        const briefPath = `${dir}/sc-${storyId}-${Date.now()}.md`;
        const brief = buildBrief({
          storyId,
          url: story.url,
          branch,
          interactive: true,
          planOnly,
          prompt,
          pullFailed: pullWarning !== null,
          agent: choice.agent,
          title: story.name,
          description: story.description,
        });
        await writeTextFile(briefPath, brief, null);
        run("tab.new", {
          name: `sc-${storyId}`,
          space: focused()?.space,
          folder: root,
          argv: buildArgv({ run: entry.run, ...choice, addDir: dir }),
          task: buildTask({ agent: choice.agent, storyId, url: story.url, briefPath }),
          focus: true,
        });
        try {
          localStorage.setItem(LAST_KEY, JSON.stringify(choice));
        } catch {}
        set({
          launched: true,
          notice: `Started sc-${storyId} in a new tab.`,
          warning: pullWarning ? `${pullWarning}; the agent was told to pull it first.` : null,
        });
      } catch (error) {
        console.log("shortcut-board: implement", storyId, String(error));
        set({ error: String(error?.message ?? error) });
      } finally {
        this.inFlight.delete(storyId);
        set({ starting: false });
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
    const branch = this.effectiveBranch(story);

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
      .child(this.branchRow(view, story, branch))
      .child(this.toggles(view))
      .child(this.promptBox());

    const footer = v_flex()
      .flex_none()
      .p(16)
      .gap(8)
      .border_t(1)
      .border_color(t.border)
      .when(Boolean(entry.error && !story), (el) =>
        el.child(div().text_size(12.5).text_color(t.blocked).whitespace_normal().child(String(entry.error))),
      )
      .when(Boolean(this.warning), (el) =>
        el.child(div().text_size(12.5).text_color(t.ansi3).whitespace_normal().child(this.warning)),
      )
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
