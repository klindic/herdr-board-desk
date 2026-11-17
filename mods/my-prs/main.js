// Open PRs you wrote and PRs waiting on your review, from GitHub via `gh`.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, notify, checking, shared, setShared, focused, spaces, appHome, readTextFile } from "herdr";

const REFRESH_MS = 120000;
const FOCUS_CHECK_MS = 1000;

const PR_FIELDS = `
  ... on PullRequest {
    number title url isDraft reviewDecision updatedAt
    repository { name nameWithOwner }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }`;

// config.json next to this file may set "org" to search one GitHub organization only.
const query = (org) => {
  const scope = org ? ` org:${org}` : "";
  return `query {
  mine: search(query: "is:pr is:open${scope} author:@me archived:false sort:updated-desc", type: ISSUE, first: 40) { nodes { ${PR_FIELDS} } }
  review: search(query: "is:pr is:open${scope} review-requested:@me archived:false sort:updated-desc", type: ISSUE, first: 40) { nodes { ${PR_FIELDS} } }
}`;
};

const toPr = (n) => ({
  key: `${n.repository.name}#${n.number}`,
  repo: n.repository.name,
  fullRepo: n.repository.nameWithOwner.toLowerCase(),
  number: n.number,
  title: n.title,
  url: n.url,
  draft: n.isDraft,
  review: n.reviewDecision,
  ci: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
  updated: Date.parse(n.updatedAt),
});

const REVIEW_LABEL = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", REVIEW_REQUIRED: "needs review" };

function ciColor(t, state) {
  if (state === "SUCCESS") return t.done;
  if (state === "FAILURE" || state === "ERROR") return t.blocked;
  if (state === "PENDING" || state === "EXPECTED") return t.working;
  return t.dim;
}

function reviewColor(t, review) {
  if (review === "APPROVED") return t.done;
  if (review === "CHANGES_REQUESTED") return t.blocked;
  return t.muted;
}

// "owner/name" from an origin like git@github.com:owner/name.git or https://github.com/owner/name
function githubRepo(remote) {
  const m = remote.trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  return m ? m[1].toLowerCase() : null;
}

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 60) return `${Math.max(m, 1)}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export default class MyPrs extends View {
  init(_props, cx) {
    this.mine = [];
    this.review = [];
    this.error = null;
    this.loading = false;
    this.loadedAt = null;
    this.seen = null;
    this.cwd = undefined;
    this.repo = null;
    this.repoByCwd = new Map();
    if (checking()) return;
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    cx.timer.every(FOCUS_CHECK_MS, (cx) => this.followFocus(cx));
    this.refresh(cx);
    this.followFocus(cx);
  }

  // Tracks which GitHub repo the focused terminal is in; redraws only when that changes.
  followFocus(cx) {
    const f = focused();
    const space = spaces().find((s) => s.id === f?.space);
    const cwd = f?.cwd ?? space?.folder ?? null;
    if (cwd === this.cwd) return;
    this.cwd = cwd;
    if (!cwd) return this.setRepo(null, cx);
    const key = `${space?.machine ?? ""}:${cwd}`;
    if (this.repoByCwd.has(key)) return this.setRepo(this.repoByCwd.get(key), cx);
    cx.spawn(async (cx) => {
      let repo = null;
      try {
        const r = await exec("git", ["remote", "get-url", "origin"], { cwd, on: space?.machine ?? null, timeout: 5000 });
        if (r.code === 0) repo = githubRepo(r.stdout);
      } catch {}
      this.repoByCwd.set(key, repo);
      if (this.cwd === cwd) this.setRepo(repo, cx);
    });
  }

  setRepo(repo, cx) {
    if (repo === this.repo) return;
    this.repo = repo;
    cx.notify();
  }

  inRepo(prs) {
    return this.repo ? prs.filter((p) => p.fullRepo === this.repo) : [];
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        let org = null;
        try {
          org = JSON.parse((await readTextFile(`${appHome()}/mods/my-prs/config.json`)) ?? "{}").org || null;
        } catch {}
        const r = await exec("gh", ["api", "graphql", "-f", `query=${query(org)}`], { timeout: 60000 });
        if (r.code !== 0) throw new Error(r.stderr.trim() || `gh exited ${r.code}`);
        const data = JSON.parse(r.stdout).data;
        const mine = data.mine.nodes.filter((n) => n.number).map(toPr);
        this.announceChanges(mine);
        this.mine = mine;
        this.review = data.review.nodes.filter((n) => n.number).map(toPr);
        if (shared("prs.badge") !== (this.review.length || null)) setShared("prs.badge", this.review.length || null);
        this.error = null;
        this.loadedAt = Date.now();
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.loading = false;
      cx.notify();
    });
  }

  // Toasts when one of your PRs gets approved, gets changes requested, or its CI turns red.
  announceChanges(prs) {
    const next = new Map(prs.map((p) => [p.key, p]));
    if (this.seen) {
      for (const p of prs) {
        const before = this.seen.get(p.key);
        if (!before) continue;
        if (p.review !== before.review && (p.review === "APPROVED" || p.review === "CHANGES_REQUESTED")) {
          notify({ title: `${p.key} ${REVIEW_LABEL[p.review]}`, body: p.title, level: p.review === "APPROVED" ? "success" : "warning" });
        }
        if (p.ci !== before.ci && (p.ci === "FAILURE" || p.ci === "ERROR")) {
          notify({ title: `${p.key} checks failed`, body: p.title, level: "error" });
        }
      }
    }
    this.seen = next;
  }

  open(url) {
    exec("open", [url]).catch(() => {});
  }

  header(t, cx) {
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
          .child(div().flex_none().text_size(12).font_semibold().text_color(t.foreground).child("Pull requests"))
          .child(div().text_size(11).text_color(t.dim).truncate().child(this.repo ? this.repo.split("/")[1] : "")),
      )
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(div().text_size(11).text_color(t.dim).child(this.loadedAt ? `updated ${ago(this.loadedAt)} ago` : ""))
          .child(
            div()
              .id("prs-refresh")
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
          ),
      );
  }

  section(t, label, prs, showReview) {
    return v_flex()
      .gap(2)
      .child(
        h_flex()
          .px(12)
          .pt(10)
          .pb(4)
          .gap(6)
          .items_center()
          .text_size(11)
          .font_semibold()
          .text_color(t.muted)
          .child(label.toUpperCase())
          .child(div().text_color(t.dim).child(String(prs.length))),
      )
      .when(prs.length === 0, (el) => el.child(div().px(12).py(4).text_size(12).text_color(t.dim).child("Nothing here")))
      .children(prs.map((p) => this.row(t, p, showReview)));
  }

  row(t, p, showReview) {
    const meta = [p.draft ? "draft" : null, showReview && !p.draft ? REVIEW_LABEL[p.review] : null].filter(Boolean);
    return h_flex()
      .id(`pr-${p.key}`)
      .mx(6)
      .px(6)
      .py(5)
      .gap(8)
      .items_start()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.open(p.url))
      .child(div().mt(5).w(7).h(7).flex_none().rounded(4).bg(ciColor(t, p.ci)))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(1)
          .child(div().text_size(12).text_color(p.draft ? t.muted : t.foreground).truncate().child(p.title))
          .child(
            h_flex()
              .gap(6)
              .text_size(11)
              .text_color(t.dim)
              .child(`${p.repo} #${p.number}`)
              .children(meta.map((m) => div().text_color(m === "draft" ? t.dim : reviewColor(t, p.review)).child(m)))
              .child(div().flex_1())
              .child(ago(p.updated)),
          ),
      );
  }

  render(cx) {
    const t = theme();
    return v_flex()
      .size_full()
      .bg(t.chrome)
      .child(this.header(t, cx))
      .when(!!this.error, (el) =>
        el.child(div().m(10).p(8).rounded(6).bg(t.raised).text_size(11).text_color(t.blocked).child(`Couldn't load PRs: ${this.error}`)),
      )
      .child(
        div()
          .id("prs-list")
          .flex_1()
          .overflow_y_scrollbar()
          .pb(10)
          .when(!this.repo, (el) =>
            el.child(div().px(12).py(10).text_size(12).text_color(t.dim).child("This folder isn't a GitHub repo, so there are no PRs to show.")),
          )
          .when(!!this.repo, (el) =>
            el
              .child(this.section(t, "Mine", this.inRepo(this.mine), true))
              .child(this.section(t, "Review requested", this.inRepo(this.review), false)),
          ),
      );
  }
}
