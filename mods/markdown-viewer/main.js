// Markdown viewer: .md files dropped on the "Markdown" view (or its switch segment) open here,
// rendered, with a switch to the raw text. Several files stay open as tabs.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, TextView, Editor, EditorState } from "gpui-base";
import { theme, exec, readTextFile, settings, shared, checking } from "herdr";
import { isMarkdown, baseName, resolveLink } from "./paths.js";

const OPEN_KEY = "markdown.open";
const MAX_CHARS = 400000;
const READING_WIDTH = 860;
const FONT = "Inter";
const MODES = [["preview", "Preview"], ["text", "Text"]];

const openUrl = (url) => exec("open", [url]).catch(() => {});

export default class MarkdownViewer extends View {
  init(_props, cx) {
    this.files = [];
    this.active = 0;
    this.mode = "preview";
    this.seen = 0;
    this.queue = [];
    try {
      const saved = JSON.parse(localStorage.getItem("markdown") ?? "null");
      this.mode = saved?.mode === "text" ? "text" : "preview";
      if (checking()) return;
      for (const path of saved?.paths ?? []) this.open(path, cx, { quiet: true });
    } catch {}
    if (checking()) return;
    // The view switch hands dropped paths over through shared state.
    cx.timer.every(200, (cx) => this.takeDrop(cx));
    this.takeDrop(cx);
  }

  takeDrop(cx) {
    while (this.queue.length) this.open(this.queue.shift(), cx);
    const drop = shared(OPEN_KEY);
    if (!drop || drop.at === this.seen) return;
    this.seen = drop.at;
    for (const path of drop.paths ?? []) this.open(path, cx);
  }

  save() {
    try {
      localStorage.setItem("markdown", JSON.stringify({ mode: this.mode, paths: this.files.map((f) => f.path) }));
    } catch {}
  }

  open(path, cx, { quiet = false } = {}) {
    const known = this.files.findIndex((f) => f.path === path);
    if (known >= 0) {
      if (!quiet) this.active = known;
      this.load(this.files[known], cx);
      this.save();
      cx.notify();
      return;
    }
    const file = { path, name: baseName(path), text: null, error: null, editor: null };
    this.files.push(file);
    if (!quiet) this.active = this.files.length - 1;
    this.save();
    this.load(file, cx);
    cx.notify();
  }

  load(file, cx) {
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(file.path);
        if (text === null) {
          file.error = "This file is no longer available";
        } else if (text.includes("\0")) {
          file.error = "Binary file, nothing to show";
        } else {
          file.error = null;
          file.text = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n(file truncated)` : text;
          file.editor?.release();
          file.editor = this.makeEditor(file.text);
        }
      } catch {
        file.error = "Cannot read this file (too large or unreadable)";
      }
      cx.notify();
    });
  }

  close(index, cx) {
    const [file] = this.files.splice(index, 1);
    file?.editor?.release();
    if (this.active >= this.files.length) this.active = Math.max(0, this.files.length - 1);
    this.save();
    cx.notify();
  }

  setMode(mode, cx) {
    this.mode = mode;
    this.save();
    cx.notify();
  }

  // EditorState can't be created while rendering, so it is built here, when the text arrives.
  makeEditor(text) {
    const t = theme();
    return EditorState.new({
      language: "markdown", readonly: true, value: text,
      font_family: settings().font_family, font_size: 12,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 },
    });
  }

  dropped(event, cx) {
    const paths = (event.paths ?? []).filter(isMarkdown);
    for (const path of paths) this.open(path, cx);
  }

  // Link handlers get no context, so a followed markdown file waits in a queue the timer drains.
  followLink(url, file) {
    if (/^(https?|mailto):/i.test(url)) return openUrl(url);
    const target = resolveLink(file.path, url);
    if (target && isMarkdown(target)) return this.queue.push(target);
    if (target) openUrl(`file://${encodeURI(target)}`);
  }

  tab(file, index, cx) {
    const t = theme();
    const on = index === this.active;
    return h_flex().id(`md-tab-${index}`).h(28).pl(10).pr(4).gap(6).flex_none().items_center().rounded(6).text_size(12.5).cursor_pointer()
      .bg(on ? t.raised : t.background).text_color(on ? t.foreground : t.muted)
      .when(!on, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .tooltip(file.path)
      .on_click((_e, cx) => { cx.stop_propagation(); this.active = index; cx.notify(); })
      .child(svg("mods/markdown-viewer/file-text.svg").size(13).flex_none())
      .child(div().max_w(220).truncate().child(file.name))
      .child(div().id(`md-close-${index}`).size(20).flex_none().flex().items_center().justify_center().rounded(5)
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close")
        .on_click((_e, cx) => { cx.stop_propagation(); this.close(index, cx); })
        .child(svg("mods/pane/close.svg").size(11)));
  }

  modeSwitch() {
    const t = theme();
    return h_flex().h(30).p(2).gap(2).flex_none().items_center().rounded(8).border(1).border_color(t.border).bg(t.background)
      .children(MODES.map(([id, label]) => {
        const on = this.mode === id;
        return div().id(`md-mode-${id}`).h(24).px(11).flex().items_center().rounded(6).text_size(12.5).cursor_pointer()
          .bg(on ? t.raised : t.background).text_color(on ? t.foreground : t.muted)
          .when(!on, (el) => el.hover((s) => s.text_color(t.foreground)))
          .on_click((_e, cx) => { cx.stop_propagation(); if (!on) this.setMode(id, cx); })
          .child(label);
      }));
  }

  empty(message) {
    const t = theme();
    return v_flex().flex_1().items_center().justify_center().gap(8).p(24)
      .child(svg("mods/markdown-viewer/file-text.svg").size(28).text_color(t.dim))
      .child(div().text_size(14).text_color(t.foreground).child(message))
      .child(div().text_size(12.5).text_color(t.dim).child("Drop .md files here or on the Markdown switch"));
  }

  body(file) {
    const t = theme();
    if (file.error) return v_flex().flex_1().p(20).child(div().text_size(13).text_color(t.blocked).child(file.error));
    if (file.text === null) return v_flex().flex_1().p(20).child(div().text_size(13).text_color(t.dim).child("Loading…"));
    if (this.mode === "text") return div().flex_1().min_h(0).p(4).child(Editor.new(file.editor).size_full());
    return div().id(`md-scroll-${file.path}`).flex_1().min_h(0).w_full().overflow_y_scrollbar()
      .child(v_flex().w_full().items_center().px(28).py(24)
        .child(div().w_full().max_w(READING_WIDTH).text_size(14).text_color(t.foreground)
          .child(TextView.markdown(`md-${file.path}`, file.text).selectable(true).on_link_click((url) => this.followLink(url, file)))));
  }

  render() {
    const t = theme();
    const file = this.files[this.active];
    const header = h_flex().h(54).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(h_flex().flex_1().min_w(0).gap(4).items_center().overflow_x_scrollbar()
        .children(this.files.map((f, i) => this.tab(f, i))))
      .when(Boolean(file), (el) => el.child(this.modeSwitch())
        .child(div().id("md-reload").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
          .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Reload from disk")
          .on_click((_e, cx) => { cx.stop_propagation(); this.load(file, cx); })
          .child(svg("mods/shortcut-board/refresh.svg").size(14))));

    return v_flex().id("md-root").size_full().font_family(FONT)
      .border(1).border_color(t.border).rounded(10).overflow_hidden().bg(t.background)
      .on_drop((event, cx) => this.dropped(event, cx))
      .child(header)
      .child(file ? this.body(file) : this.empty("No markdown file open"));
  }
}
