// Gives every new sub-terminal (one with a parent, e.g. from `hc run --bg`) its own pane instead of a peek:
// the first child of a parent goes right of the parent, later siblings stack below the previous one.

import { terminals, panes, focused, run } from "herdr";

const TICK_MS = 1000;

export class AutoTile {
  constructor(cx) {
    // Only terminals that appear from now on; leaves existing (and deliberately parked) ones alone.
    this.handled = new Set(terminals().map((t) => t.address));
    this.pending = null;
    cx.timer.every(TICK_MS, () => this.tick());
  }

  tick() {
    const all = terminals();
    const paneOf = new Map(panes().filter((p) => p.terminal).map((p) => [p.terminal, p.pane]));
    // terminal.keep creates the pane asynchronously and focuses it, so hand focus back once it exists.
    if (this.pending) {
      if (!paneOf.has(this.pending.address) && ++this.pending.waited < 10) return;
      if (this.pending.back) run("pane.focus", { pane: this.pending.back });
      this.pending = null;
    }
    for (const t of all) {
      if (this.handled.has(t.address)) continue;
      if (t.state !== "live" || !t.parent) {
        this.handled.add(t.address);
        continue;
      }
      if (paneOf.has(t.address)) {
        this.handled.add(t.address);
        continue;
      }
      const sibling = all
        .filter((s) => s.parent === t.parent && s.address !== t.address && paneOf.has(s.address))
        .pop();
      const anchor = sibling ? paneOf.get(sibling.address) : paneOf.get(t.parent);
      // Parent not on screen yet (e.g. a grandchild whose parent is still being tiled): try next tick.
      if (!anchor) continue;
      this.handled.add(t.address);
      const back = focused()?.pane;
      run("pane.focus", { pane: anchor });
      run("terminal.keep", { terminal: t.address, place: sibling ? "down" : "right" });
      this.pending = { address: t.address, back, waited: 0 };
      return;
    }
  }
}
