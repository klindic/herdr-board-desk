// Segmented switch left of the tab bar: picks what the main view's stack shows.
// To add a view: add a child under "main-view" in layouts/my-main.json and an entry to VIEWS.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, layout, window, settings } from "herdr";

const STACK = "main-view";
const BLOCK_ID = "view-switch";
const WIDTH = 190;

const VIEWS = [
  { id: "main", label: "Terminals", icon: "mods/view-switch/terminal.svg" },
  { id: "board", label: "Board", icon: "mods/view-switch/board.svg" },
];

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class ViewSwitch extends View {
  // With the sidebar folded to its rail on macOS, the traffic lights sit over this block.
  leftPadding(root) {
    const w = window();
    const sidebar = find(root, "sidebar");
    if (w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights) {
      return Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0));
    }
    return 10;
  }

  fit(px) {
    const block = find(layout(), BLOCK_ID);
    if (block && block.size?.px !== px && this.fitted !== px) {
      this.fitted = px;
      run("layout.resize", { id: BLOCK_ID, px });
    }
  }

  render() {
    const t = theme();
    const root = layout();
    const active = find(root, STACK)?.active ?? VIEWS[0].id;
    const pad = this.leftPadding(root);
    this.fit(Math.round(WIDTH + pad - 10));
    const stop = (_e, cx) => cx.stop_propagation();

    const segment = (v) => {
      const on = active === v.id;
      return h_flex().id(`view-${v.id}`).h(25).px(10).gap(6).items_center().rounded(6).text_size(12.8).cursor_pointer()
        .bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted)
        .when(!on, (el) => el.hover((s) => s.text_color(t.foreground)))
        .on_mouse_down("left", stop)
        .on_click(() => { if (!on) run("layout.select", { stack: STACK, child: v.id }); })
        .child(svg(v.icon).size(14))
        .child(v.label);
    };

    return h_flex().size_full().bg(t.chrome).border_b(1).border_color(t.border).pl(pad).gap(10).items_center()
      .child(h_flex().h(31).p(2).gap(2).items_center().rounded(8).border(1).border_color(t.border).bg(t.chrome)
        .children(VIEWS.map(segment)))
      .child(div().w(1).h(18).bg(t.border));
  }
}
