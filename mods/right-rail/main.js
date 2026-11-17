// Icon rail on the far right: each icon shows its view in the right panel; clicking the shown one hides the panel.
// To add a view: add a block under "right-views" in layouts/board-desk.json and an entry to VIEWS.

import { View, div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { layout, run, theme, shared, checking } from "herdr";
import { AutoTile } from "./auto-tile.js";

const PANEL = "right-panel";
const STACK = "right-views";

const VIEWS = [
  { id: "prs", title: "Pull requests", icon: "mods/right-rail/git-pull-request.svg", badge: "prs.badge" },
  { id: "sessions", title: "Sessions", icon: "mods/right-rail/history.svg" },
];

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class RightRail extends View {
  init(_props, cx) {
    if (checking()) return;
    this.autoTile = new AutoTile(cx);
  }

  render(_cx) {
    const t = theme();
    const root = layout();
    const panel = find(root, PANEL);
    const stack = find(root, STACK);
    const open = panel && !panel.hidden;

    const button = (v) => {
      const on = open && stack?.active === v.id;
      const badge = v.badge ? shared(v.badge) : null;
      return div()
        .id(`rail-${v.id}`)
        .relative()
        .w(32)
        .h(32)
        .flex()
        .items_center()
        .justify_center()
        .rounded(6)
        .cursor_pointer()
        .bg(on ? t.selected : t.chrome)
        .text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(v.title)
        .on_click(() => {
          if (on) run("layout.hide", { id: PANEL });
          else {
            run("layout.select", { stack: STACK, child: v.id });
            run("layout.show", { id: PANEL });
          }
        })
        .child(svg(v.icon).size(17))
        .when(!!badge, (el) =>
          el.child(
            div()
              .absolute()
              .top(2)
              .right(2)
              .min_w(14)
              .h(14)
              .px(3)
              .rounded(7)
              .bg(t.accent)
              .text_color(t.accent_foreground)
              .text_size(9)
              .font_semibold()
              .flex()
              .items_center()
              .justify_center()
              .child(String(badge)),
          ),
        );
    };

    return v_flex().size_full().items_center().pt(6).gap(4).border_l(1).border_color(t.border).bg(t.chrome).children(VIEWS.map(button));
  }
}
