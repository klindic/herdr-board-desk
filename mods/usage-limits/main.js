// System gauges (CPU, RAM, GPU) and Claude / Codex quota at the bottom of the sidebar.
// The look (gauge graphs, quota rows, color scale, time-left format) is adapted from the "system-windows"
// and "quota" mods of github.com/chelebyy/herdr-agent-workspace (Apache License 2.0), themselves based on
// github.com/Lakris2407/herdr-quota (MIT License). Data comes from this mod's own helpers instead.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, settings, exec, appHome, checking, layout, run } from "herdr";

const BLOCK_ID = "usage";
const SYS_MS = 3000;
const QUOTA_MS = 3 * 60 * 1000;
const STALE_MS = 10 * 60 * 1000;
const PROVIDERS = [["claude", "Claude"], ["codex", "Codex"]];
const GAUGES = [["cpu", "CPU"], ["ram", "RAM"], ["gpu", "GPU"]];

// Fixed heights, so the block can be sized to fit what it shows.
const PAD_X = 14;
const PAD_TOP = 12;
const PAD_BOTTOM = 10;
const GAUGE_H = 20;
const SECTION_GAP = 12;
const HEADER_H = 16;
const ROW_H = 27;
const RAIL_ROW_H = 30;

// Gauge graph: columns 2px wide, 1px apart, 12px tall, newest on the right.
const GRAPH_H = 12;
const GAUGE_LABEL_W = 22;
const GAUGE_PCT_W = 28;
const GAUGE_GAP = 4;
const MAX_HISTORY = 16;

// Quota row columns.
const LABEL_W = 84;
const PCT_W = 36;
const LEFT_W = 44;
const BAR_H = 6;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Calm until it matters: green, amber from 60%, orange from 80%, red from 92%.
function level(pct) {
  const dark = settings().dark !== false;
  const scale = dark ? ["#5ed49a", "#f2c14e", "#f59152", "#f2665c"] : ["#1f9d63", "#c98a0b", "#dd6b20", "#d64545"];
  return scale[pct >= 92 ? 3 : pct >= 80 ? 2 : pct >= 60 ? 1 : 0];
}

// Time until a reset: "42m", "2h 4m", "1d 19h".
function until(epoch) {
  const min = Math.max(0, Math.round((epoch * 1000 - Date.now()) / 60000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h ${min % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

function ago(seconds) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - seconds));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function windowName(w) {
  if (w.seconds === 5 * 3600) return "5 h";
  if (w.seconds === 7 * 86400) return "7 days";
  return w.label;
}

export default class UsageLimits extends View {
  init(_props, cx) {
    this.usageScript = `${appHome()}/mods/usage-limits/fetch_usage.py`;
    this.sysScript = `${appHome()}/mods/usage-limits/sysstats.py`;
    this.data = {};
    this.history = { cpu: [], ram: [], gpu: [] };
    this.sys = null;
    try {
      this.data = JSON.parse(localStorage.getItem("usage") ?? "{}") ?? {};
    } catch {
      this.data = {};
    }
    if (checking()) return;
    cx.timer.every(QUOTA_MS, (cx) => this.refresh(cx));
    cx.timer.every(SYS_MS, (cx) => this.sample(cx));
    this.refresh(cx);
    this.sample(cx);
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", ["-I", this.usageScript], { timeout: 40000 });
        const fresh = JSON.parse(r.stdout);
        for (const [key] of PROVIDERS) {
          const previous = this.data[key];
          const next = fresh[key] ?? { error: "no data" };
          // Keep the last good numbers when a fetch fails; say why in the tooltip.
          this.data[key] = next.error && previous?.windows?.length ? { ...previous, stale: next.error } : { ...next, at: fresh.at };
        }
        this.data.at = fresh.at;
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

  sample(cx) {
    if (this.sampling || narrow()) return;
    this.sampling = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", ["-I", this.sysScript], { timeout: 10000 });
        this.sys = JSON.parse(r.stdout);
        for (const [key] of GAUGES) {
          const list = this.history[key];
          list.push(this.sys[key]);
          if (list.length > MAX_HISTORY) list.shift();
        }
      } catch (error) {
        this.sys = null;
      } finally {
        this.sampling = false;
        cx.notify();
      }
    });
  }

  rows(key) {
    const p = this.data[key];
    return p?.windows?.length ? p.windows.length : 1;
  }

  height(collapsed) {
    if (collapsed) return PAD_TOP + PAD_BOTTOM + PROVIDERS.length * RAIL_ROW_H;
    const rows = PROVIDERS.reduce((n, [key]) => n + this.rows(key), 0);
    return PAD_TOP + GAUGE_H + SECTION_GAP + HEADER_H + rows * ROW_H + PAD_BOTTOM;
  }

  // The block's height follows its content.
  fit(collapsed) {
    const px = this.height(collapsed);
    const block = find(layout(), BLOCK_ID);
    if (block && block.size?.px !== px && this.fitted !== px) {
      this.fitted = px;
      run("layout.resize", { id: BLOCK_ID, px });
    }
  }

  // As many graph columns as fit in a third of the panel.
  graphColumns() {
    const inner = (this.width ?? 240) - 2 * PAD_X;
    const each = (inner - 2 * 8) / 3 - GAUGE_LABEL_W - GAUGE_PCT_W - 2 * GAUGE_GAP;
    return Math.max(5, Math.min(MAX_HISTORY, Math.floor((each + 1) / 3)));
  }

  gauge(key, label, columns) {
    const t = theme();
    const pct = this.sys?.[key];
    const history = this.history[key];
    const cols = Array.from({ length: columns }, (_, i) => history[history.length - columns + i]);
    return h_flex().id(`gauge-${key}`).gap(GAUGE_GAP).items_center().flex_none()
      .tooltip(pct == null ? `${label}: not available` : `${label} ${pct}%`)
      .child(div().w(GAUGE_LABEL_W).text_size(10).text_color(t.dim).child(label))
      .child(h_flex().h(GRAPH_H).gap(1).items_end().flex_none()
        .children(cols.map((v) => div().w(2).rounded(1)
          .h(v == null ? 1 : Math.max(1, Math.round((v / 100) * GRAPH_H)))
          .bg(v == null ? t.border : level(v)).opacity(v == null ? 1 : 0.85))))
      .child(div().w(GAUGE_PCT_W).text_size(11).text_color(pct != null && pct >= 60 ? level(pct) : t.muted).child(pct == null ? "·" : `${pct}%`));
  }

  bar(pct) {
    const t = theme();
    return div().flex_1().min_w(30).h(BAR_H).rounded_full().bg(t.border)
      .child(div().h_full().rounded_full().bg(level(pct)).min_w(pct > 0 ? BAR_H : 0).w(`${pct}%`));
  }

  quotaRows(key, name) {
    const t = theme();
    const p = this.data[key];
    if (!p?.windows?.length) {
      return [h_flex().id(`row-${key}`).h(ROW_H).gap(8).items_center()
        .child(div().w(LABEL_W).flex_none().text_color(t.foreground).child(name))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(p ? p.error ?? "no limits reported" : "loading…"))];
    }
    return p.windows.map((w) => h_flex().id(`row-${key}-${w.label}`).h(ROW_H).gap(8).items_center()
      .tooltip(`${name} ${w.label}: ${w.percent}% used${w.resets ? `, ${w.resets}` : ""}${p.stale ? `\nNot updated: ${p.stale}` : ""}`)
      .child(h_flex().w(LABEL_W).flex_none().gap(5).items_center()
        .child(div().truncate().text_color(t.foreground).child(`${name} ${windowName(w)}`))
        .when(Boolean(p.stale), (el) => el.child(div().size(5).flex_none().rounded_full().bg(level(95)))))
      .child(this.bar(w.percent))
      .child(div().w(PCT_W).flex_none().text_right().text_color(level(w.percent)).child(`${w.percent}%`))
      .child(div().w(LEFT_W).flex_none().text_right().text_size(10.5).text_color(t.dim).child(w.resets_at ? until(w.resets_at) : "")));
  }

  railRow(key, name) {
    const t = theme();
    const windows = this.data[key]?.windows ?? [];
    const top = windows.length ? Math.max(...windows.map((w) => w.percent)) : null;
    const tip = windows.map((w) => `${name} ${windowName(w)}: ${w.percent}%`).join("\n") || `${name}: ${this.data[key]?.error ?? "loading"}`;
    return v_flex().id(`rail-${key}`).h(RAIL_ROW_H).w(36).items_center().justify_center().rounded(6)
      .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(tip)
      .on_click((_e, cx) => this.refresh(cx))
      .child(div().text_size(9.5).text_color(t.dim).child(name.slice(0, 2)))
      .child(div().text_size(11).font_semibold().text_color(top === null ? t.dim : level(top)).child(top === null ? "·" : `${top}%`));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    this.fit(collapsed);
    const root = v_flex().id("root").size_full().bg(t.chrome).border_t(1).border_color(t.border).text_size(12.5).overflow_hidden()
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } });
    if (collapsed) {
      return root.items_center().pt(PAD_TOP).pb(PAD_BOTTOM).children(PROVIDERS.map(([key, name]) => this.railRow(key, name)));
    }
    const columns = this.graphColumns();
    const stale = !this.data.at || Date.now() / 1000 - this.data.at > STALE_MS / 1000;
    return root.px(PAD_X).pt(PAD_TOP).pb(PAD_BOTTOM)
      .child(h_flex().id("gauges").h(GAUGE_H).flex_none().justify_between().items_center().cursor_pointer()
        .on_click(() => exec("open", ["-a", "Activity Monitor"]).catch(() => {}))
        .children(GAUGES.map(([key, label]) => this.gauge(key, label, columns))))
      .child(v_flex().id("quota").mt(SECTION_GAP).cursor_pointer().when(stale && Boolean(this.data.at), (el) => el.opacity(0.6))
        .on_click((_e, cx) => this.refresh(cx))
        .child(h_flex().h(HEADER_H).justify_between().items_center().tooltip("Refreshes every 3 minutes. Click to refresh now.")
          .child(div().text_size(10).text_color(t.dim).child("QUOTA USAGE"))
          .child(div().text_size(10).text_color(t.dim).child(this.loading ? "updating…" : this.data.at ? `updated ${ago(this.data.at)}` : "")))
        .children(PROVIDERS.flatMap(([key, name]) => this.quotaRows(key, name))));
  }
}
