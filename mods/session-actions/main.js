// Actions for one history session. Destructive action requires a second click.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, closeOverlay, exec, props, setShared, theme } from "herdr";

export default class SessionActions extends View {
  init(_props, cx) {
    this.confirming = false;
    this.busy = false;
    this.error = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  trash(cx) {
    if (this.busy) return;
    const s = props()?.session;
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const script = `${appHome()}/mods/session-actions/trash_session.py`;
        const result = await exec("python3", [script, s.agent, s.id, s.path], { timeout: 10000 });
        if (result.code !== 0) throw new Error(result.stderr.trim() || `exit ${result.code}`);
        setShared("sessions.changed", Date.now());
        this.dismiss();
      } catch (e) {
        this.error = String(e?.message ?? e);
        this.busy = false;
        cx.notify();
      }
    });
  }

  render(cx) {
    const t = theme();
    const s = props()?.session;
    if (!s) return div().id("session-actions");
    const item = (id, label, action, color = t.foreground) =>
      h_flex()
        .id(id)
        .h(32)
        .px(9)
        .items_center()
        .rounded(6)
        .text_size(12)
        .text_color(color)
        .cursor_pointer()
        .hover((el) => el.bg(t.hover))
        .on_click(action)
        .child(label);
    return v_flex()
      .id("session-actions")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          this.dismiss();
          cx.stop_propagation();
        }
      })
      .w_full()
      .p(5)
      .gap(2)
      .bg(t.popover)
      .when(!this.confirming, (el) => el
        .child(item("copy-id", "Copy session ID", (_e, cx) => {
          cx.write_to_clipboard(s.id);
          this.dismiss();
        }))
        .child(item("trash", "Move to Trash…", (_e, cx) => {
          if (s.pid) return;
          this.confirming = true;
          cx.notify();
        }, s.pid ? t.dim : t.blocked)))
      .when(this.confirming, (el) => el
        .child(div().px(9).py(7).text_size(12).text_color(t.foreground).child(`Move “${s.title}” to Trash?`))
        .child(item("confirm-trash", this.busy ? "Moving…" : "Move to Trash", (_e, cx) => this.trash(cx), t.blocked))
        .child(item("cancel-trash", "Cancel", () => this.dismiss())))
      .when(!!this.error, (el) => el.child(div().px(9).py(5).text_size(11).text_color(t.blocked).child(this.error)));
  }
}
