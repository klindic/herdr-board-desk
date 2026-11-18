// Asks: every agent that is waiting on you (approval, question, reply) in one right-panel view.
// Answer from here, jump to the terminal, or dismiss. A macOS notification fires when a new ask appears.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, hc, exec, theme, checking, window, run, setShared, shared, setBadge, focused } from "herdr";
import { parseAsk, askKey, notificationScript, waiting } from "./parse.js";

const POLL_MS = 2000;
const HOLD_MS = 4000;
const BADGE = "asks.badge";
const ANSWERED_KEY = "asks-answered";
const FILTER_KEY = "asks-filter";
const KIND_LABEL = { approval: "APPROVAL", question: "QUESTION", input: "REPLY" };

const today = () => new Date().toDateString();

export default class Asks extends View {
  init(_props, cx) {
    this.asks = new Map();
    this.dismissed = new Set();
    this.notified = new Set();
    this.picked = new Map();
    this.hold = new Map();
    this.busy = new Set();
    this.inputs = new Map();
    this.screens = new Map();
    this.polling = false;
    this.filter = "all";
    this.answered = 0;
    this.lastBadge = undefined;
    try {
      this.filter = localStorage.getItem(FILTER_KEY) === "here" ? "here" : "all";
      const saved = JSON.parse(localStorage.getItem(ANSWERED_KEY) ?? "null");
      if (saved?.day === today()) this.answered = Number(saved.n) || 0;
    } catch {}
    if (checking()) return;
    cx.timer.every(POLL_MS, (cx) => this.poll(cx));
    this.poll(cx);
  }

  countAnswered() {
    this.answered += 1;
    try {
      localStorage.setItem(ANSWERED_KEY, JSON.stringify({ day: today(), n: this.answered }));
    } catch {}
  }

  visible() {
    const here = focused()?.space;
    return [...this.asks.values()]
      .filter((e) => !this.dismissed.has(e.key))
      .filter((e) => this.filter === "all" || e.agent.space === here)
      .sort((a, b) => a.since - b.since);
  }

  syncBadge() {
    const n = [...this.asks.values()].filter((e) => !this.dismissed.has(e.key)).length;
    if (n === this.lastBadge) return;
    this.lastBadge = n;
    setShared(BADGE, n ? String(n) : null);
    setBadge(n ? String(n) : null);
  }

  poll(cx) {
    if (this.polling) return;
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        const blocked = agents().filter((a) => a.status === "blocked");
        const seen = new Set();
        let changed = false;
        for (const agent of blocked) {
          const address = agent.address;
          seen.add(address);
          let screen;
          try {
            screen = (await hc(["read", address])).stdout;
          } catch (error) {
            console.log("asks: read", address, String(error));
            continue;
          }
          const prev = this.asks.get(address);
          if (prev && this.screens.get(address) === screen) {
            prev.agent = agent;
            continue;
          }
          this.screens.set(address, screen);
          const ask = parseAsk(screen);
          if (!ask) {
            if (this.asks.delete(address)) changed = true;
            continue;
          }
          const key = askKey(address, ask);
          const holdUntil = this.hold.get(address);
          if (holdUntil && holdUntil.key === key && Date.now() < holdUntil.until) continue;
          if (prev && prev.key === key) {
            prev.agent = agent;
            continue;
          }
          this.asks.set(address, { agent, ask, key, since: prev?.key === key ? prev.since : Date.now() });
          this.picked.delete(address);
          changed = true;
          this.announce(agent, ask, key);
        }
        for (const [address, entry] of [...this.asks]) {
          if (seen.has(address)) continue;
          this.asks.delete(address);
          this.screens.delete(address);
          this.hold.delete(address);
          this.picked.delete(address);
          if (!this.dismissed.has(entry.key)) this.countAnswered();
          changed = true;
        }
        this.syncBadge();
        if (changed) cx.notify();
      } catch (error) {
        console.log("asks: poll", String(error));
      } finally {
        this.polling = false;
      }
    });
  }

  announce(agent, ask, key) {
    if (this.notified.has(key)) return;
    this.notified.add(key);
    const watching = agent.focused && window()?.active;
    if (watching) return;
    const label = this.label(agent);
    exec("osascript", ["-e", notificationScript(`${label} needs you`, ask.question)]).catch((error) =>
      console.log("asks: notification", String(error)),
    );
  }

  label(agent) {
    const tab = agent.tab_name && !/^\d+$/.test(agent.tab_name) ? agent.tab_name : null;
    return tab ? `${agent.space_name} / ${tab}` : agent.space_name || agent.program?.name || agent.address;
  }

  send(entry, args, cx) {
    const address = entry.agent.address;
    if (this.busy.has(address)) return;
    this.busy.add(address);
    this.hold.set(address, { key: entry.key, until: Date.now() + HOLD_MS });
    this.asks.delete(address);
    this.countAnswered();
    this.syncBadge();
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await hc(args);
        if (r.code !== 0) throw new Error(r.stderr || `hc exited ${r.code}`);
      } catch (error) {
        console.log("asks: answer", address, String(error));
        this.hold.delete(address);
        this.screens.delete(address);
      } finally {
        this.busy.delete(address);
        this.poll(cx);
        cx.notify();
      }
    });
  }

  choose(entry, n, cx) {
    this.send(entry, ["keys", entry.agent.address, String(n)], cx);
  }

  reply(entry, cx) {
    const input = this.inputs.get(entry.agent.address);
    const text = input?.value().trim();
    if (!text) return;
    input.set_value("");
    this.send(entry, ["send", entry.agent.address, text], cx);
  }

  dismiss(entry, cx) {
    this.dismissed.add(entry.key);
    this.syncBadge();
    cx.notify();
  }

  open(entry) {
    run("pane.focus", { pane: entry.agent.pane });
  }

  button(t, id, label, iconPath, onClick, primary = false) {
    return h_flex()
      .id(id)
      .flex_1()
      .min_w(0)
      .h(32)
      .px(10)
      .gap(6)
      .items_center()
      .justify_center()
      .rounded(7)
      .border_1()
      .border_color(primary ? t.accent : t.border)
      .text_color(primary ? t.foreground : t.muted)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        onClick(cx);
      })
      .child(svg(iconPath).size(13).flex_none())
      .child(div().text_size(12.5).truncate().child(label));
  }

  option(t, entry, o, picked, immediate) {
    const on = picked === o.n;
    return h_flex()
      .id(`ask-${entry.agent.address}-${o.n}`)
      .w_full()
      .min_h(34)
      .px(8)
      .py(5)
      .gap(10)
      .items_center()
      .rounded(8)
      .border_1()
      .border_color(on ? t.accent : t.border)
      .bg(on ? t.raised : t.background)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (immediate) this.choose(entry, o.n, cx);
        else {
          this.picked.set(entry.agent.address, o.n);
          cx.notify();
        }
      })
      .child(
        div()
          .flex_none()
          .size(22)
          .flex()
          .items_center()
          .justify_center()
          .rounded(5)
          .bg(t.raised)
          .text_size(11.5)
          .text_color(t.muted)
          .child(String(o.n)),
      )
      .child(div().flex_1().min_w(0).whitespace_normal().text_size(12.5).text_color(t.foreground).child(o.label));
  }

  card(t, entry) {
    const { agent, ask } = entry;
    const address = agent.address;
    const color = ask.kind === "approval" ? t.blocked : ask.kind === "question" ? t.ansi3 : t.ansi4;
    const picked = this.picked.get(address) ?? ask.initial;
    const immediate = ask.kind === "approval";
    const icon = agent.program?.icon;
    if (ask.kind === "input" && !this.inputs.has(address)) {
      const input = InputState.new({ placeholder: "Type a reply" });
      input.on("submit", (_e, cx) => {
        const current = this.asks.get(address);
        if (current) this.reply(current, cx);
      });
      this.inputs.set(address, input);
    }
    const input = this.inputs.get(address);

    const actions = h_flex().gap(8);
    if (ask.kind === "question" && ask.options.length) {
      actions.child(this.button(t, `ask-answer-${address}`, "Answer", "mods/asks/send.svg", (cx) => this.choose(entry, picked, cx), true));
    }
    if (ask.kind === "input") {
      actions.child(this.button(t, `ask-send-${address}`, "Send", "mods/asks/send.svg", (cx) => this.reply(entry, cx), true));
    }
    actions
      .child(this.button(t, `ask-open-${address}`, "Open terminal", "mods/workspace-chrome/terminal.svg", () => this.open(entry)))
      .child(this.button(t, `ask-dismiss-${address}`, "Dismiss", "mods/workspace-chrome/x.svg", (cx) => this.dismiss(entry, cx)));

    return v_flex()
      .id(`ask-card-${address}`)
      .mx(12)
      .p(12)
      .gap(10)
      .rounded(10)
      .border_1()
      .border_color(t.border)
      .bg(t.background)
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(icon ? (agent.program.tint ? svg(icon).size(16).flex_none().text_color(t.ansi9 ?? t.accent) : image(icon).size(16).flex_none()) : div().size(16))
          .child(div().flex_1().min_w(0).truncate().text_size(14).font_semibold().text_color(t.foreground).child(this.label(agent)))
          .child(div().flex_none().text_size(11.5).text_color(t.dim).child(waiting(Date.now() - entry.since))),
      )
      .child(
        h_flex()
          .gap(8)
          .items_start()
          .child(
            div()
              .flex_none()
              .px(7)
              .py(2)
              .rounded(5)
              .bg(color)
              .text_color(t.background)
              .text_size(10.5)
              .font_semibold()
              .child(KIND_LABEL[ask.kind]),
          )
          .child(div().flex_1().min_w(0).whitespace_normal().text_size(13.5).text_color(t.foreground).child(ask.question)),
      )
      .when(Boolean(ask.detail), (el) =>
        el.child(
          div()
            .px(8)
            .py(6)
            .rounded(6)
            .bg(t.raised)
            .whitespace_normal()
            .text_size(11.5)
            .text_color(t.muted)
            .child(ask.detail),
        ),
      )
      .children(ask.options.map((o) => this.option(t, entry, o, picked, immediate)))
      .when(ask.more, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("More options in the terminal")))
      .when(ask.kind === "input", (el) =>
        el.child(
          Input.new(input).w_full().h(32).px(10).rounded(8).border_1().border_color(t.border).bg(t.background).text_size(12.5).text_color(t.foreground),
        ),
      )
      .child(actions);
  }

  chip(t, id, label, value) {
    const on = this.filter === value;
    return div()
      .id(id)
      .px(8)
      .py(3)
      .rounded(6)
      .cursor_pointer()
      .text_size(12.5)
      .text_color(on ? t.foreground : t.muted)
      .bg(on ? t.selected : t.chrome)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.filter = value;
        try {
          localStorage.setItem(FILTER_KEY, value);
        } catch {}
        cx.notify();
      })
      .child(label);
  }

  render(_cx) {
    const t = theme();
    const list = this.visible();
    const total = [...this.asks.values()].filter((e) => !this.dismissed.has(e.key)).length;
    return v_flex()
      .size_full()
      .bg(t.chrome)
      .child(
        v_flex()
          .flex_none()
          .px(14)
          .pt(14)
          .pb(10)
          .gap(4)
          .child(
            h_flex()
              .items_center()
              .child(div().flex_1().text_size(16).font_semibold().text_color(t.foreground).child("Asks"))
              .child(h_flex().gap(4).child(this.chip(t, "asks-here", "Here", "here")).child(this.chip(t, "asks-all", "All", "all"))),
          )
          .child(div().text_size(12).text_color(t.dim).child(`${total} waiting · ${this.answered} answered today`)),
      )
      .child(div().h(1).mx(14).bg(t.border).flex_none())
      .child(
        v_flex()
          .id("asks-list")
          .flex_1()
          .overflow_y_scrollbar()
          .gap(10)
          .py(12)
          .when(list.length === 0, (el) =>
            el.child(
              v_flex()
                .px(20)
                .py(24)
                .gap(8)
                .items_center()
                .child(svg("mods/asks/bell.svg").size(22).text_color(t.dim))
                .child(div().text_size(12.5).text_color(t.dim).child(total ? "Nothing waiting in this space" : "No agent is waiting on you")),
            ),
          )
          .children(list.map((entry) => this.card(t, entry))),
      );
  }
}
