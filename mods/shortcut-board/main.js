import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { theme, exec, appHome, checking, layout } from "herdr";

const REFRESH_MS = 2 * 60 * 1000;
const DETAIL_FRESH_MS = 60 * 1000;
const TITLE_MAX = 140;
const PAD_X = 18;
const GAP = 4;
// Room right of the cards for the column's scrollbar, so it never draws over them.
const SCROLL_GUTTER = 15;
const DETAIL_GUTTER = 10;
const THUMB_W = 6;
const THUMB_INSET = 3;
const THUMB_MIN = 28;
const THUMB_LINGER_MS = 900;
const COLUMN_MIN = 220;
const COLUMN_MAX = 380;
// With a story open, the board keeps this share of the width and the story gets the rest.
const BOARD_SHARE = 0.6;
// Space between the board card and the story card, as between terminal panes.
const PANE_GAP = 8;
// Shortcut's own UI font, bundled in ./fonts so it needs no install.
const FONT = "Inter";

// Column dot colors, by workflow state name; other states go by their type.
const TYPE_STATE_COLOR = { unstarted: (t) => t.idle, started: (t) => t.working, done: (t) => t.done };
const COLUMN_COLOR = {
  Unstarted: (t) => t.idle,
  "In Progress": (t) => t.working,
  "In Review": (t) => t.ansi4,
  "In QA": (t) => t.ansi5,
  "PO Acceptance": (t) => t.ansi6,
  Accepted: (t) => t.done,
};
const TYPE_COLOR = { feature: (t) => t.ansi3, bug: (t) => t.ansi1, chore: (t) => t.dim };
const TYPE_ICON = { feature: "sparkle", bug: "bug", chore: "wrench" };
// Relationship rows: icon and its color, by how the link reads from this story.
const LINK_STYLE = {
  "Blocked by": { icon: "ban", color: (t) => t.blocked },
  Blocks: { icon: "triangle-alert", color: (t) => t.ansi3 },
  Duplicates: { icon: "copy", color: (t) => t.muted },
  "Duplicated by": { icon: "copy", color: (t) => t.muted },
  "Relates to": { icon: "link", color: (t) => t.muted },
};
const icon = (name) => `mods/shortcut-board/icons/${name}.svg`;
// A selected card is filled with its border color at this alpha.
const SELECTED_ALPHA = "2e";

function age(seconds) {
  if (!seconds) return "";
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60));
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 60 ? `${days}d` : `${Math.round(days / 30)}mo`;
}

// Panels that open beside the board, with the divider or gap that comes with each.
const SIDE_PANELS = [["right-panel", 1], ["panel", 8]];

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const clip = (text) => (text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1).trimEnd()}…` : text);
const openUrl = (url) => exec("open", [url]).catch(() => {});
const stop = (_e, cx) => cx.stop_propagation();

export default class ShortcutBoard extends View {
  init(_props, cx) {
    this.script = `${appHome()}/mods/shortcut-board/fetch_board.py`;
    this.filter = "all";
    this.selected = null;
    this.details = {};
    // Scroll state per scroll area: each board column by its state id, and "detail".
    this.scrollY = {};
    this.viewH = {};
    this.contentH = {};
    this.thumbShown = {};
    this.hideAt = {};
    this.hidePending = {};
    try {
      const saved = JSON.parse(localStorage.getItem("board") ?? "null");
      if (saved?.columns) this.board = saved;
      this.filter = localStorage.getItem("filter") ?? "all";
    } catch {}
    if (checking()) return;
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", ["-I", this.script], { timeout: 60000 });
        const data = JSON.parse(r.stdout);
        if (data.error) {
          this.error = data.error;
        } else {
          this.error = null;
          this.board = data;
          try {
            localStorage.setItem("board", JSON.stringify(data));
          } catch {}
        }
      } catch (error) {
        this.error = "Could not load the board";
        console.log("shortcut-board:", String(error));
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  select(id, cx) {
    this.selected = id;
    this.scrollY.detail = 0;
    this.loadDetail(id, cx);
    cx.notify();
  }

  loadDetail(id, cx) {
    const known = this.details[id];
    if (known?.loading || (known?.data && Date.now() - known.fetched < DETAIL_FRESH_MS)) return;
    this.details[id] = { ...known, loading: true };
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", ["-I", this.script, "story", String(id)], { timeout: 30000 });
        const data = JSON.parse(r.stdout);
        this.details[id] = data.error
          ? { ...this.details[id], loading: false, error: data.error }
          : { data, fetched: Date.now(), loading: false };
      } catch (error) {
        this.details[id] = { ...this.details[id], loading: false, error: "Could not load the story" };
        console.log("shortcut-board: story", id, String(error));
      }
      cx.notify();
    });
  }

  setFilter(filter, cx) {
    this.filter = filter;
    try {
      localStorage.setItem("filter", filter);
    } catch {}
    cx.notify();
  }

  stateColor(name, type) {
    const t = theme();
    const known = COLUMN_COLOR[name];
    if (known) return known(t);
    const kind = type ?? this.board?.columns?.find((c) => c.name === name)?.type;
    return (TYPE_STATE_COLOR[kind] ?? TYPE_STATE_COLOR.unstarted)(t);
  }

  findCard(id) {
    for (const col of this.board?.columns ?? []) {
      const card = col.cards.find((c) => c.id === id);
      if (card) return { card, column: col.name };
    }
    return null;
  }

  chip(id, label, on, action) {
    const t = theme();
    return div().id(id).h(26).px(12).flex().items_center().rounded_full().text_size(12.5).cursor_pointer()
      .border(1).border_color(on ? t.input : t.border).bg(on ? t.raised : t.background)
      .text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(action).child(label);
  }

  linkButton(id, label, url) {
    const t = theme();
    return div().id(id).h(26).px(10).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .border(1).border_color(t.border).bg(t.raised).text_color(t.foreground).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); openUrl(url); })
      .child(label);
  }

  card(c) {
    const t = theme();
    const selected = this.selected === c.id;
    // The story's own color: red when blocked, else by type. Selecting fills the card with it.
    const tone = c.blocked ? t.blocked : (TYPE_COLOR[c.type] ?? TYPE_COLOR.chore)(t);
    return v_flex().id(`card-${c.id}`).w_full().flex_none().p(12).gap(8).rounded(8).border(1)
      .border_color(tone).bg(selected ? tone + SELECTED_ALPHA : t.surface).cursor_pointer()
      .on_click((_e, cx) => { cx.stop_propagation(); if (!selected) this.select(c.id, cx); })
      .child(h_flex().gap(6).items_center().text_size(12)
        .child(div().flex_none().text_color(t.ansi4).child(`sc-${c.id}`))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(c.epic ?? ""))
        .child(div().flex_none().text_color(t.dim).child(age(c.moved))))
      .child(div().text_size(13.5).text_color(t.foreground).whitespace_normal().child(clip(c.name)))
      .child(div().text_size(12).truncate().text_color(t.muted).child(c.owners.join(", ") || "No owner"))
      .when(c.blocked || c.blocker, (el) => el.child(h_flex().gap(7).items_center().text_size(12).text_color(t.blocked)
        .child(div().size(7).flex_none().rounded_full().bg(t.blocked))
        .child(c.blocked ? "Blocked" : "Blocking another story")))
      .child(h_flex().gap(6).flex_wrap()
        .child(this.linkButton(`sc-${c.id}-open`, "Shortcut", c.url))
        .children(c.prs.map((p) => this.linkButton(`sc-${c.id}-pr-${p.repo}-${p.number}`, `PR #${p.number}`, p.url))));
  }

  sidePanelsWidth() {
    const root = layout();
    let extra = 0;
    for (const [id, spacing] of SIDE_PANELS) {
      const node = find(root, id);
      if (node && !node.hidden && node.size?.px) extra += node.size.px + spacing;
    }
    return extra;
  }

  columnWidth(count) {
    // Sized as if the story, the right panel and the Files panel were all closed,
    // so opening any of them only adds sideways scroll and never narrows the cards.
    const width = this.baseWidth ?? 0;
    if (!width || !count) return 280;
    const fit = (width - 2 * PAD_X + SCROLL_GUTTER - (count - 1) * GAP) / count;
    return Math.floor(Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, fit)));
  }

  // Scroll areas move their content themselves so they can draw a rounded thumb, shown while scrolling.
  wheel(key, event, cx) {
    const max = Math.max(0, (this.contentH[key] ?? 0) - (this.viewH[key] ?? 0));
    const current = Math.min(this.scrollY[key] ?? 0, max);
    const next = Math.max(0, Math.min(max, current - (event.delta?.y ?? 0)));
    if (next === current) return;
    cx.stop_propagation();
    this.scrollY[key] = next;
    this.thumbShown[key] = true;
    this.hideAt[key] = Date.now() + THUMB_LINGER_MS;
    if (!this.hidePending[key]) this.scheduleHide(key, THUMB_LINGER_MS, cx);
    cx.notify();
  }

  scheduleHide(key, ms, cx) {
    this.hidePending[key] = true;
    cx.timer.after(ms, (cx) => {
      const left = this.hideAt[key] - Date.now();
      if (left > 20) return this.scheduleHide(key, left, cx);
      this.hidePending[key] = false;
      this.thumbShown[key] = false;
      cx.notify();
    });
  }

  // `content` is an unpositioned element with its own id; this places and scrolls it.
  scrollArea(key, content, gutter) {
    const t = theme();
    const view = this.viewH[key] ?? 0;
    const total = this.contentH[key] ?? 0;
    const max = Math.max(0, total - view);
    const offset = Math.min(this.scrollY[key] ?? 0, max);
    const thumbH = max > 0 ? Math.max(THUMB_MIN, (view * view) / total) : 0;
    const thumbTop = max > 0 ? (offset / max) * (view - thumbH) : 0;
    return div().id(`${key}-view`).relative().flex_1().min_h(0).w_full().overflow_hidden()
      .on_size_change((size, cx) => { if (this.viewH[key] !== size.height) { this.viewH[key] = size.height; cx.notify(); } })
      .on_scroll_wheel((event, cx) => this.wheel(key, event, cx))
      .child(content.absolute().left(0).right(gutter).top(-offset)
        .on_size_change((size, cx) => { if (this.contentH[key] !== size.height) { this.contentH[key] = size.height; cx.notify(); } }))
      .when(max > 0, (el) => el.child(div().absolute().right(THUMB_INSET).top(thumbTop).w(THUMB_W).h(thumbH).rounded_full()
        .bg(t.muted).opacity(this.thumbShown[key] ? 0.45 : 0).transition("opacity", 180)));
  }

  column(col, width) {
    const t = theme();
    const cards = this.filter === "mine" ? col.cards.filter((c) => c.mine) : col.cards;
    const color = this.stateColor(col.name, col.type);
    return v_flex().id(`col-${col.id}`).w(width).flex_none().h_full().gap(10)
      .child(h_flex().h(24).px(2).gap(8).items_center().flex_none()
        .child(div().size(8).rounded_full().bg(color))
        .child(div().text_size(13.5).font_semibold().text_color(t.foreground).child(col.name))
        .child(div().text_size(12.5).text_color(t.dim).child(String(cards.length))))
      .child(this.scrollArea(col.id, v_flex().id(`col-${col.id}-cards`).gap(10).pb(12).children(cards.map((c) => this.card(c))), SCROLL_GUTTER));
  }

  markdown(id, text) {
    const t = theme();
    return div().w_full().text_size(13.5).text_color(t.foreground)
      .child(TextView.markdown(id, text).selectable(true).on_link_click((url) => openUrl(url)));
  }

  comment(c) {
    const t = theme();
    // No w_full: the column stretches it, so a reply's indent narrows it instead of pushing it out.
    return v_flex().id(`comment-${c.id}`).gap(6).p(12).rounded(8).border(1).border_color(t.border).bg(t.surface)
      .when(c.reply, (el) => el.ml(16))
      .child(h_flex().gap(8).items_center().text_size(12)
        .child(div().font_semibold().text_color(t.foreground).child(c.author))
        .child(div().text_color(t.dim).child(age(c.created))))
      .child(this.markdown(`comment-text-${c.id}`, c.text));
  }

  relationship(r) {
    const t = theme();
    const style = LINK_STYLE[r.label] ?? LINK_STYLE["Relates to"];
    const typeColor = (TYPE_COLOR[r.type] ?? TYPE_COLOR.chore)(t);
    return h_flex().id(`rel-${r.label}-${r.id}`).h(32).px(6).gap(9).items_center().rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover)).tooltip(`Open sc-${r.id}`)
      // Opens the linked story here, in place of this one.
      .on_click((_e, cx) => { cx.stop_propagation(); this.select(r.id, cx); })
      .child(svg(icon(style.icon)).size(15).flex_none().text_color(style.color(t)))
      .child(h_flex().flex_1().min_w(0).gap(5).text_size(13)
        .child(div().flex_none().text_color(t.foreground).child(r.label))
        .child(div().flex_1().min_w(0).truncate().text_color(r.done ? t.dim : t.muted).child(r.name)))
      .child(h_flex().flex_none().h(22).px(7).gap(5).items_center().rounded(6).bg(t.raised).text_size(12).text_color(t.foreground)
        .child(svg(icon(TYPE_ICON[r.type] ?? "wrench")).size(12).text_color(typeColor))
        .child(String(r.id)));
  }

  relationships(list) {
    const t = theme();
    return v_flex().gap(4).pt(16).border_t(1).border_color(t.border)
      .child(h_flex().gap(8).items_center().pb(4)
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child("Story Relationships"))
        .child(div().text_size(12.5).text_color(t.dim).child(String(list.length))))
      .when(list.length === 0, (el) => el.child(div().text_size(12.5).text_color(t.dim).child("No relationships")))
      .children(list.map((r) => this.relationship(r)));
  }

  detailPanel() {
    const t = theme();
    const id = this.selected;
    const entry = this.details[id] ?? {};
    const story = entry.data;
    const found = this.findCard(id);
    const name = story?.name ?? found?.card.name ?? `sc-${id}`;
    const state = story?.state ?? found?.column;
    const owners = story?.owners?.length ? story.owners.join(", ") : found?.card.owners.join(", ");
    const epic = story?.epic ?? found?.card.epic;
    const url = story?.url ?? found?.card.url;
    const comments = story?.comments ?? [];

    const header = h_flex().h(54).flex_none().px(18).gap(10).items_center().border_b(1).border_color(t.border).text_size(12.5)
      .child(div().flex_none().text_color(t.ansi4).child(`sc-${id}`))
      .when(Boolean(state), (el) => el.child(h_flex().gap(6).items_center().text_color(t.muted)
        .child(div().size(7).rounded_full().bg(this.stateColor(state)))
        .child(state)))
      .child(div().flex_1())
      .when(Boolean(entry.loading), (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.dim).spin(900)))
      .when(Boolean(url), (el) => el.child(this.linkButton(`detail-open-${id}`, "Open in Shortcut", url)))
      .child(div().id("detail-close").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
        .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close")
        .on_click((_e, cx) => { cx.stop_propagation(); this.selected = null; cx.notify(); })
        .child(svg("mods/pane/close.svg").size(14)));

    const body = v_flex().id(`detail-content-${id}`).pl(22).pr(22 - DETAIL_GUTTER).pt(20).pb(28).gap(16)
      .child(div().text_size(20).font_semibold().text_color(t.foreground).whitespace_normal().child(name))
      .when(Boolean(owners || epic), (el) => el.child(div().text_size(12.5).text_color(t.muted).whitespace_normal()
        .child([owners || "No owner", epic].filter(Boolean).join(" · "))))
      .when(Boolean(entry.error) && !story, (el) => el.child(div().text_size(13).text_color(t.blocked).child(entry.error)))
      .when(!story && !entry.error, (el) => el.child(div().text_size(13).text_color(t.dim).child("Loading story…")))
      .when(Boolean(story), (el) => el
        .child(story.description?.trim()
          ? this.markdown(`desc-${id}`, story.description)
          : div().text_size(13).text_color(t.dim).child("No description"))
        .child(this.relationships(story.relationships ?? []))
        .child(v_flex().gap(10).pt(16).border_t(1).border_color(t.border)
          .child(h_flex().gap(8).items_center()
            .child(div().text_size(14).font_semibold().text_color(t.foreground).child("Comments"))
            .child(div().text_size(12.5).text_color(t.dim).child(String(comments.length))))
          .when(comments.length === 0, (el) => el.child(div().text_size(12.5).text_color(t.dim).child("No comments")))
          .children(comments.map((c) => this.comment(c)))));

    return v_flex().id("detail").flex_1().min_w(0).h_full()
      .border(1).border_color(t.border).rounded(10).overflow_hidden().bg(t.background)
      // Clicks inside the story keep it open.
      .on_click(stop)
      .child(header)
      .child(this.scrollArea("detail", body, DETAIL_GUTTER));
  }

  render() {
    const t = theme();
    const open = this.selected !== null;
    const columns = this.board?.columns ?? [];
    const visible = columns.reduce((n, col) => n + (this.filter === "mine" ? col.cards.filter((c) => c.mine).length : col.cards.length), 0);
    const status = this.error
      ? this.error
      : this.board
        ? `${visible} cards · ${this.board.team ?? "Shortcut"} · updated ${age(this.board.at)} ago`
        : "Loading board…";

    const header = h_flex().h(54).flex_none().px(18).gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Board"))
      .child(this.chip("filter-all", "All", this.filter === "all", (_e, cx) => this.setFilter("all", cx)))
      .child(this.chip("filter-mine", "Mine", this.filter === "mine", (_e, cx) => this.setFilter("mine", cx)))
      .child(div().flex_1())
      .child(div().text_size(12).truncate().text_color(this.error ? t.blocked : t.dim).child(status))
      .child(div().id("refresh").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
        .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Refresh from Shortcut")
        .on_click((_e, cx) => this.refresh(cx))
        .child(this.loading
          ? svg("mods/workspace-chrome/spinner.svg").size(14).spin(900)
          : svg("mods/shortcut-board/refresh.svg").size(14)));

    const width = this.columnWidth(columns.length);
    const body = h_flex().id("columns").flex_1().min_h(0).w_full().pl(PAD_X).pr(PAD_X - SCROLL_GUTTER).pt(14).gap(GAP).overflow_x_scrollbar()
      .children(columns.map((col) => this.column(col, width)));

    const board = v_flex().id("board-pane").h_full().min_w(0).border(1).border_color(t.border).rounded(10).overflow_hidden().bg(t.background)
      .when(open, (el) => el.w(`${Math.round(BOARD_SHARE * 100)}%`).flex_none())
      .when(!open, (el) => el.flex_1())
      .child(header).child(body);

    return h_flex().id("root").size_full()
      // Measured only here, when the board's size has really changed: a panel shows in layout()
      // a frame before the board shrinks, and mixing the two for that frame made the cards flash.
      .on_size_change((size, cx) => {
        this.size = size;
        const base = size.width + this.sidePanelsWidth();
        if (base !== this.baseWidth) { this.baseWidth = base; cx.notify(); }
      })
      // A click anywhere but a card or the open story clears the selection.
      .on_click((_e, cx) => { if (this.selected !== null) { this.selected = null; cx.notify(); } })
      .font_family(FONT).gap(PANE_GAP)
      .child(board)
      .when(open, (el) => el.child(this.detailPanel()));
  }
}
