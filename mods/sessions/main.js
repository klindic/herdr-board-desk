// Past Claude Code and Codex sessions for the repo of the focused space; click to resume in a new tab.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, checking, focused, spaces, terminals, run, appHome, openOverlay, shared } from "herdr";

const REFRESH_MS = 30000;
const FOCUS_CHECK_MS = 1000;
const ICONS = { claude: "icons/claude.svg", codex: "icons/codex.svg" };

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d` : `${Math.floor(d / 30)}mo`;
}

function dayLabel(ms) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const diff = Math.floor((start.getTime() - ms) / 86400000);
  if (ms >= start.getTime()) return "Today";
  if (diff < 1) return "Yesterday";
  if (diff < 7) return "This week";
  if (diff < 30) return "This month";
  return "Older";
}

const resumeArgv = (s) => (s.agent === "codex" ? ["codex", "--no-daemon", "resume", s.id] : ["claude", "--resume", s.id]);

export default class Sessions extends View {
  init(_props, cx) {
    this.sessions = [];
    this.root = null;
    this.repo = false;
    this.cwd = undefined;
    this.rootByCwd = new Map();
    this.loading = false;
    this.refreshPending = false;
    this.error = null;
    this.script = `${appHome()}/mods/sessions/list_sessions.py`;
    this.changeSeen = shared("sessions.changed");
    if (checking()) return;
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    cx.timer.every(FOCUS_CHECK_MS, (cx) => {
      this.followFocus(cx);
      const changed = shared("sessions.changed");
      if (changed !== this.changeSeen) {
        this.changeSeen = changed;
        this.refresh(cx);
      }
    });
    this.followFocus(cx);
  }

  focusedSpace() {
    const f = focused();
    return spaces().find((s) => s.id === f?.space) ?? null;
  }

  // The space's repo root (git toplevel of the focused terminal's folder), re-listed only when it changes.
  followFocus(cx) {
    const space = this.focusedSpace();
    const cwd = focused()?.cwd ?? space?.folder ?? null;
    if (cwd === this.cwd) return;
    this.cwd = cwd;
    if (!cwd) return;
    if (this.rootByCwd.has(cwd)) return this.setRoot(this.rootByCwd.get(cwd), cx);
    cx.spawn(async (cx) => {
      let root = { path: cwd, repo: false };
      try {
        const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5000 });
        if (r.code === 0 && r.stdout.trim()) root = { path: r.stdout.trim(), repo: true };
      } catch {}
      this.rootByCwd.set(cwd, root);
      if (this.cwd === cwd) this.setRoot(root, cx);
    });
  }

  setRoot(root, cx) {
    if (root.path === this.root && root.repo === this.repo) return;
    this.root = root.path;
    this.repo = root.repo;
    this.sessions = [];
    this.refresh(cx);
  }

  refresh(cx) {
    if (!this.root) return;
    if (this.loading) {
      this.refreshPending = true;
      return;
    }
    const root = this.root;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", [this.script, root, ...(this.repo ? [] : ["--exact"])], { timeout: 30000 });
        if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || `exit ${r.code}`);
        if (this.root === root) this.sessions = JSON.parse(r.stdout);
        this.error = null;
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.loading = false;
      cx.notify();
      // The root may have changed while this ran.
      if (this.root !== root || this.refreshPending) {
        this.refreshPending = false;
        this.refresh(cx);
      }
    });
  }

  terminalOf(s) {
    if (!s.pid) return null;
    return terminals().find((t) => t.foreground?.pid === s.pid || t.pid === s.pid || (s.ppid && t.pid === s.ppid)) ?? null;
  }

  open(s, cx) {
    const live = this.terminalOf(s);
    if (live) return run("pane.focus", { terminal: live.address });
    if (s.pid) return;
    run("tab.new", { space: this.focusedSpace()?.id, folder: s.cwd, argv: resumeArgv(s), name: s.title.slice(0, 40) });
    this.refresh(cx);
  }

  header(t) {
    const repo = this.root ? this.root.split("/").pop() : "";
    return h_flex()
      .flex_none()
      .h(42)
      .px(12)
      .items_center()
      .justify_between()
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .min_w(0)
          .child(div().flex_none().text_size(12).font_semibold().text_color(t.foreground).child("Sessions"))
          .child(div().text_size(11).text_color(t.dim).truncate().child(repo)),
      )
      .child(
        div()
          .id("sessions-refresh")
          .w(22)
          .h(22)
          .flex()
          .items_center()
          .justify_center()
          .rounded(4)
          .cursor_pointer()
          .text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.refresh(cx))
          .child(this.loading ? svg("mods/workspace-chrome/spinner.svg").size(13).spin(900) : div().text_size(14).child("↻")),
      );
  }

  row(t, s) {
    const live = !!s.pid;
    const where = s.cwd === this.root ? null : s.cwd.slice(this.root.length + 1);
    return h_flex()
      .id(`session-${s.agent}-${s.id}`)
      .mx(6)
      .px(6)
      .py(5)
      .gap(8)
      .items_start()
      .rounded(6)
      .cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => this.open(s, cx))
      .child(image(ICONS[s.agent]).w(14).h(14).mt(1).flex_none())
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(1)
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(div().flex_1().min_w(0).text_size(12).text_color(t.foreground).truncate().child(s.title))
              .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(s.updated))),
          )
          .when(live || !!where, (el) =>
            el.child(
              h_flex()
                .gap(6)
                .text_size(11)
                .text_color(t.dim)
                .when(live, (el) => el.child(div().flex_none().text_color(t.working).child(this.terminalOf(s) ? "running, click to show" : "running")))
                .when(!!where, (el) => el.child(div().truncate().child(where))),
            ),
          ),
      )
      .child(
        div()
          .id(`session-actions-${s.agent}-${s.id}`)
          .w(22)
          .h(22)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .rounded(4)
          .text_size(16)
          .text_color(t.muted)
          .cursor_pointer()
          .tooltip(`Actions for ${s.title}`)
          .hover((st) => st.bg(t.selected).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => {
            cx.stop_propagation();
            openOverlay({ mod: "session-actions", kind: "popup", width: 220, props: { session: s } });
          })
          .child("⋯"),
      );
  }

  render(_cx) {
    const t = theme();
    const groups = [];
    for (const s of this.sessions) {
      const label = dayLabel(s.updated);
      const last = groups[groups.length - 1];
      if (last?.label === label) last.items.push(s);
      else groups.push({ label, items: [s] });
    }
    return v_flex()
      .size_full()
      .bg(t.chrome)
      .child(this.header(t))
      .when(!!this.error, (el) =>
        el.child(div().m(10).p(8).rounded(6).bg(t.raised).text_size(11).text_color(t.blocked).child(`Couldn't list sessions: ${this.error}`)),
      )
      .child(
        div()
          .id("sessions-list")
          .flex_1()
          .overflow_y_scrollbar()
          .pb(10)
          .when(!this.loading && !this.error && this.sessions.length === 0, (el) =>
            el.child(div().px(12).py(10).text_size(12).text_color(t.dim).child("No sessions for this space yet")),
          )
          .children(
            groups.map((g) =>
              v_flex()
                .gap(2)
                .child(div().px(12).pt(10).pb(4).text_size(11).font_semibold().text_color(t.muted).child(g.label.toUpperCase()))
                .children(g.items.map((s) => this.row(t, s))),
            ),
          ),
      );
  }
}
