import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, exec, appHome, checking, layout, run } from "herdr";

const BLOCK_ID = "usage";
const REFRESH_MS = 3 * 60 * 1000;
const PROVIDERS = [["claude", "Claude"], ["codex", "Codex"]];

// Fixed row heights, so the block can be sized to fit what it shows.
const PAD_Y = 18;
const TITLE_H = 20;
const WINDOW_H = 45;
const MESSAGE_H = 16;
const SECTION_GAP = 8;
const RAIL_ROW_H = 30;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function ago(seconds) {
  const minutes = Math.round((Date.now() / 1000 - seconds) / 60);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export default class UsageLimits extends View {
  init(_props, cx) {
    this.script = `${appHome()}/mods/usage-limits/fetch_usage.py`;
    this.data = {};
    try {
      this.data = JSON.parse(localStorage.getItem("usage") ?? "{}") ?? {};
    } catch {
      this.data = {};
    }
    if (checking()) return;
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", ["-I", this.script], { timeout: 40000 });
        const fresh = JSON.parse(r.stdout);
        for (const [key] of PROVIDERS) {
          const previous = this.data[key];
          const next = fresh[key] ?? { error: "no data" };
          // Keep the last good numbers when a fetch fails; say why in the tooltip.
          if (next.error && previous?.windows?.length) {
            this.data[key] = { ...previous, stale: next.error };
          } else {
            this.data[key] = { ...next, at: fresh.at };
          }
        }
        try {
          localStorage.setItem("usage", JSON.stringify(this.data));
        } catch {}
      } catch (error) {
        console.log("usage-limits: fetch failed", String(error));
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  height(collapsed) {
    if (collapsed) return PAD_Y + PROVIDERS.length * RAIL_ROW_H;
    const sections = PROVIDERS.map(([key]) => {
      const windows = this.data[key]?.windows?.length ?? 0;
      return TITLE_H + (windows ? windows * WINDOW_H : MESSAGE_H);
    });
    return PAD_Y + sections.reduce((a, b) => a + b, 0) + (sections.length - 1) * SECTION_GAP;
  }

  // The block's height follows its content (two windows each, or a message when one is missing).
  fit(collapsed) {
    const px = this.height(collapsed);
    const block = find(layout(), BLOCK_ID);
    if (block && block.size?.px !== px && this.fitted !== px) {
      this.fitted = px;
      run("layout.resize", { id: BLOCK_ID, px });
    }
  }

  tooltipFor(key, name) {
    const p = this.data[key];
    if (!p) return `${name}: loading`;
    const lines = (p.windows ?? []).map((w) => `${w.label}: ${w.percent}%${w.resets ? `, ${w.resets}` : ""}`);
    if (!lines.length && p.error) lines.push(p.error);
    if (p.stale) lines.push(`Not updated: ${p.stale}`);
    if (p.note) lines.push(p.note);
    if (p.at) lines.push(`Updated ${ago(p.at)}`);
    return `${name}\n${lines.join("\n")}`;
  }

  bar(percent) {
    const t = theme();
    const fill = percent >= 90 ? t.blocked : t.muted;
    return div().w_full().h(4).mt(4).rounded_full().bg(t.border)
      .child(div().h_full().rounded_full().bg(fill).w(`${percent}%`));
  }

  windowRow(key, w) {
    const t = theme();
    return v_flex().id(`${key}-${w.label}`).h(WINDOW_H).w_full()
      .child(h_flex().h(18).justify_between().items_center()
        .child(div().text_color(t.muted).child(w.label))
        .child(div().font_semibold().text_color(t.foreground).child(`${w.percent}%`)))
      .child(this.bar(w.percent))
      .child(div().h(16).mt(3).text_size(11).text_color(t.dim).child(w.resets ?? ""));
  }

  section(key, name) {
    const t = theme();
    const p = this.data[key];
    const windows = p?.windows ?? [];
    const message = !p ? "loading…" : p.error ?? "no limits reported";
    return v_flex().id(`section-${key}`).w_full().cursor_pointer().tooltip(this.tooltipFor(key, name))
      .on_click((_e, cx) => this.refresh(cx))
      .child(h_flex().h(TITLE_H).gap(6).items_center()
        .child(div().font_semibold().text_color(t.foreground).child(name))
        .when(Boolean(p?.stale), (el) => el.child(div().size(5).rounded_full().bg(t.blocked))))
      .when(windows.length > 0, (el) => el.children(windows.map((w) => this.windowRow(key, w))))
      .when(windows.length === 0, (el) => el.child(div().h(MESSAGE_H).text_size(11).text_color(t.dim).truncate().child(message)));
  }

  railRow(key, name) {
    const t = theme();
    const windows = this.data[key]?.windows ?? [];
    const top = windows.length ? Math.max(...windows.map((w) => w.percent)) : null;
    return v_flex().id(`rail-${key}`).h(RAIL_ROW_H).w(36).items_center().justify_center().rounded(6)
      .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(this.tooltipFor(key, name))
      .on_click((_e, cx) => this.refresh(cx))
      .child(div().text_size(9.5).text_color(t.dim).child(name.slice(0, 2)))
      .child(div().text_size(11).font_semibold().text_color(top >= 90 ? t.blocked : t.foreground).child(top === null ? "·" : `${top}%`));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    this.fit(collapsed);
    const root = v_flex().id("root").size_full().bg(t.chrome).border_t(1).border_color(t.border).text_size(12.5).overflow_hidden();
    if (collapsed) {
      return root.items_center().pt(10).pb(8).children(PROVIDERS.map(([key, name]) => this.railRow(key, name)));
    }
    return root.px(16).pt(10).pb(8).gap(SECTION_GAP).children(PROVIDERS.map(([key, name]) => this.section(key, name)));
  }
}
