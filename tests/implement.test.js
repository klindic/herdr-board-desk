import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENTS,
  buildArgv,
  buildBrief,
  buildTask,
  choose,
  isReady,
  nextStep,
  sanitize,
  startFolder,
} from "../mods/shortcut-board/implement.js";

const EMPTY = { agent: null, model: null, effort: null };

test("sanitize keeps a valid remembered choice", () => {
  assert.deepEqual(sanitize({ agent: "claude", model: "opus", effort: "high" }), {
    agent: "claude",
    model: "opus",
    effort: "high",
  });
});

test("sanitize drops values the agent does not offer", () => {
  assert.deepEqual(sanitize({ agent: "codex", model: "opus", effort: "max" }), {
    agent: "codex",
    model: null,
    effort: null,
  });
  assert.deepEqual(sanitize({ agent: "nope", model: "opus", effort: "high" }), EMPTY);
  assert.deepEqual(sanitize(null), EMPTY);
});

test("choose resets model and effort when the agent changes", () => {
  const start = { agent: "claude", model: "opus", effort: "high" };
  assert.deepEqual(choose(start, "agent", "codex"), { agent: "codex", model: null, effort: null });
  assert.deepEqual(choose(start, "agent", "claude"), start);
  assert.deepEqual(choose(start, "model", "sonnet"), { agent: "claude", model: "sonnet", effort: "high" });
});

test("nextStep and isReady walk the stepper", () => {
  assert.equal(nextStep(EMPTY), "agent");
  assert.equal(nextStep({ agent: "claude", model: null, effort: null }), "model");
  assert.equal(nextStep({ agent: "claude", model: "opus", effort: null }), "effort");
  assert.equal(nextStep({ agent: "claude", model: "opus", effort: "high" }), null);
  assert.equal(isReady({ agent: "claude", model: "opus", effort: "high" }), true);
  assert.equal(isReady({ agent: "claude", model: "opus", effort: null }), false);
});

test("buildArgv appends the agent's own flags to its run command", () => {
  assert.deepEqual(buildArgv({ run: ["claude"], agent: "claude", model: "opus", effort: "high" }), [
    "claude",
    "--model",
    "opus",
    "--effort",
    "high",
  ]);
  assert.deepEqual(
    buildArgv({ run: ["codex", "--no-daemon"], agent: "codex", model: "gpt-6.1-sol", effort: "medium" }),
    ["codex", "--no-daemon", "-m", "gpt-6.1-sol", "-c", 'model_reasoning_effort="medium"'],
  );
});

const BRIEF = {
  storyId: 1188,
  url: "https://app.shortcut.com/x/story/1188",
  branch: "sc-1188-retry-webhooks",
  interactive: true,
  planOnly: false,
  prompt: "",
  pullFailed: false,
};

test("buildBrief states the story, the branch and the integration rule", () => {
  const brief = buildBrief(BRIEF);
  assert.match(brief, /sc-1188 \(https:\/\/app\.shortcut\.com\/x\/story\/1188\)/);
  assert.match(brief, /Use the branch name sc-1188-retry-webhooks\./);
  assert.match(brief, /latest integration branch/);
  assert.match(brief, /bin\/create-worktree/);
  assert.doesNotMatch(brief, /Plan only/);
  assert.doesNotMatch(brief, /## Prompt/);
  assert.doesNotMatch(brief, /could not update integration/);
});

test("buildBrief omits the branch line when Shortcut gave none", () => {
  assert.doesNotMatch(buildBrief({ ...BRIEF, branch: null }), /branch name/);
});

test("buildBrief adds the plan-only, run-to-completion and pull-failed lines", () => {
  const brief = buildBrief({ ...BRIEF, planOnly: true, interactive: false, pullFailed: true });
  assert.match(brief, /Plan only: stop after the implementation plan/);
  assert.match(brief, /Run to completion: do not ask questions/);
  assert.match(brief, /could not update integration/);
  assert.match(brief, /origin\/integration/);
});

test("buildBrief appends the optional prompt verbatim after a blank line", () => {
  const brief = buildBrief({ ...BRIEF, prompt: "  Line one\nLine two  \n" });
  assert.match(brief, /\n\n## Prompt\nLine one\nLine two\n$/);
});

test("buildBrief ignores a whitespace-only prompt", () => {
  assert.doesNotMatch(buildBrief({ ...BRIEF, prompt: "  \n " }), /## Prompt/);
});

test("buildTask is one line and points at the brief", () => {
  const claude = buildTask({ agent: "claude", storyId: 1188, url: BRIEF.url, briefPath: "/tmp/b.md" });
  assert.equal(
    claude,
    "/axialpower:implement-ticket sc-1188 First read the launch brief at /tmp/b.md and follow it.",
  );
  const codex = buildTask({ agent: "codex", storyId: 1188, url: BRIEF.url, briefPath: "/tmp/b.md" });
  assert.equal(
    codex,
    "Implement Shortcut story sc-1188 (https://app.shortcut.com/x/story/1188). First read the launch brief at /tmp/b.md and follow it.",
  );
  assert.ok(!claude.includes("\n") && !codex.includes("\n"));
});

test("startFolder defaults to the axial-main root and expands ~", () => {
  assert.equal(startFolder(undefined, "/Users/me"), "/Users/me/source/axial-main");
  assert.equal(startFolder("~/work/axial-main", "/Users/me"), "/Users/me/work/axial-main");
  assert.equal(startFolder("/opt/axial-main", "/Users/me"), "/opt/axial-main");
});

test("every agent offers at least one model and one effort", () => {
  for (const agent of Object.values(AGENTS)) {
    assert.ok(agent.models.length > 0 && agent.efforts.length > 0);
  }
});
