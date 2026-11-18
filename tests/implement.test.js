import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENTS,
  buildArgv,
  buildBrief,
  buildTask,
  choose,
  effortsFor,
  isReady,
  nextStep,
  normalizeBranch,
  parseCodexModels,
  summarizePulls,
  sanitize,
  startFolder,
  withCodexModels,
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
  assert.match(brief, /\$AXIAL_ORCHESTRATION_ROOT\/bin\/create-worktree <branch>/);
  assert.match(brief, /<branch> is the branch name given above/);
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
  assert.match(brief, /git pull --ff-only/);
});

test("buildBrief appends the optional prompt verbatim after a blank line", () => {
  const brief = buildBrief({ ...BRIEF, prompt: "  Line one\nLine two  \n" });
  assert.match(brief, /\n\n## Prompt\n  Line one\nLine two\n$/);
});

test("buildBrief ignores a whitespace-only prompt", () => {
  assert.doesNotMatch(buildBrief({ ...BRIEF, prompt: "  \n " }), /## Prompt/);
});

test("buildBrief gives codex the story text but not claude", () => {
  const story = { title: "Retry webhooks", description: "  Do the thing.\n\n" };
  const codex = buildBrief({ ...BRIEF, agent: "codex", prompt: "Extra", ...story });
  assert.match(codex, /\n\n## Story\n# Retry webhooks\n\nDo the thing\.\n\n## Prompt\nExtra\n$/);
  assert.doesNotMatch(buildBrief({ ...BRIEF, agent: "claude", ...story }), /## Story/);
});

test("buildBrief handles an empty description and an empty story for codex", () => {
  const brief = buildBrief({ ...BRIEF, agent: "codex", title: "T", description: "" });
  assert.match(brief, /## Story\n# T\n\n\n$/);
  assert.doesNotMatch(buildBrief({ ...BRIEF, agent: "codex", title: "", description: null }), /## Story/);
});

test("buildArgv adds --add-dir for claude only", () => {
  const base = { run: ["claude"], agent: "claude", model: "opus", effort: "high" };
  assert.deepEqual(buildArgv({ ...base, addDir: "/d" }), [...buildArgv(base), "--add-dir", "/d"]);
  assert.ok(!buildArgv(base).includes("--add-dir"));
  const codex = { run: ["codex"], agent: "codex", model: "m", effort: "low" };
  assert.deepEqual(buildArgv({ ...codex, addDir: "/d" }), buildArgv(codex));
});

test("summarizePulls reports nothing when every pull worked", () => {
  assert.equal(summarizePulls([{ repo: "a", ok: true, stderr: "" }, { repo: "b", ok: true, stderr: "x" }]), null);
});

test("summarizePulls picks the last fatal line after progress lines", () => {
  const stderr = "From github.com:x/y\n * branch integration -> FETCH_HEAD\nfatal: Not possible to fast-forward, aborting.\n";
  assert.equal(
    summarizePulls([{ repo: "axial-api.git", ok: false, stderr }]),
    "Could not update axial-api.git (fatal: Not possible to fast-forward, aborting.)",
  );
});

test("summarizePulls falls back to the last line, or nothing", () => {
  assert.equal(summarizePulls([{ repo: "a", ok: false, stderr: "" }]), "Could not update a");
  assert.equal(summarizePulls([{ repo: "a", ok: false, stderr: "one\ntwo\n\n" }]), "Could not update a (two)");
});

test("summarizePulls joins two failures with and", () => {
  assert.equal(
    summarizePulls([
      { repo: "a", ok: false, stderr: "error: boom" },
      { repo: "b", ok: true, stderr: "" },
      { repo: "c", ok: false, stderr: "" },
    ]),
    "Could not update a (error: boom) and c",
  );
});

test("normalizeBranch makes Shortcut branch names safe for create-worktree", () => {
  assert.equal(normalizeBranch("kristijan/sc-123/some-title"), "kristijan-sc-123-some-title");
  assert.equal(normalizeBranch("sc-1188-retry-webhooks"), "sc-1188-retry-webhooks");
  assert.equal(normalizeBranch("123-abc"), null);
  assert.equal(normalizeBranch(""), null);
  assert.equal(normalizeBranch(null), null);
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
  assert.equal(startFolder("~", "/Users/me"), "/Users/me");
  assert.equal(startFolder("/opt/axial-main", "/Users/me"), "/opt/axial-main");
});

test("every agent offers at least one model and one effort", () => {
  for (const agent of Object.values(AGENTS)) {
    assert.ok(agent.models.length > 0);
    assert.equal(agent.efforts, undefined);
    for (const model of agent.models) assert.ok(model.efforts.length > 0);
  }
});

const CACHE = JSON.stringify({
  models: [
    { slug: "gpt-a", display_name: "GPT-A", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }] },
    { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide", supported_reasoning_levels: [{ effort: "low" }] },
    { slug: "gpt-b", visibility: "list", supported_reasoning_levels: [{ effort: "medium" }] },
    { slug: "gpt-none", visibility: "list", supported_reasoning_levels: [] },
    { slug: "gpt-novis", display_name: "NoVis", supported_reasoning_levels: [{ effort: "max" }] },
  ],
});

test("parseCodexModels hides hidden entries, keeps order, uses display_name", () => {
  assert.deepEqual(parseCodexModels(CACHE), [
    { id: "gpt-a", label: "GPT-A", efforts: ["low", "high"] },
    { id: "gpt-b", label: "gpt-b", efforts: ["medium"] },
    { id: "gpt-novis", label: "NoVis", efforts: ["max"] },
  ]);
});

test("parseCodexModels gives [] for bad JSON or an unexpected shape", () => {
  assert.deepEqual(parseCodexModels("not json"), []);
  assert.deepEqual(parseCodexModels(""), []);
  assert.deepEqual(parseCodexModels("null"), []);
  assert.deepEqual(parseCodexModels('{"models": 3}'), []);
  assert.deepEqual(parseCodexModels('{"models": [null, 4]}'), []);
});

test("withCodexModels returns a new catalog without mutating AGENTS", () => {
  const models = [{ id: "x", label: "X", efforts: ["low"] }];
  const before = JSON.stringify(AGENTS);
  const catalog = withCodexModels(AGENTS, models);
  assert.notEqual(catalog, AGENTS);
  assert.deepEqual(catalog.codex.models, models);
  assert.equal(catalog.claude, AGENTS.claude);
  assert.equal(JSON.stringify(AGENTS), before);
  assert.equal(withCodexModels(AGENTS, []), AGENTS);
});

test("effortsFor returns the model's efforts or []", () => {
  assert.deepEqual(effortsFor(AGENTS, "codex", "gpt-6.1-sol"), ["low", "medium", "high", "xhigh", "max", "ultra"]);
  assert.deepEqual(effortsFor(AGENTS, "claude", "opus"), ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(effortsFor(AGENTS, "claude", "nope"), []);
  assert.deepEqual(effortsFor(AGENTS, "nope", "opus"), []);
  assert.deepEqual(effortsFor(AGENTS, "claude", null), []);
});

const SMALL = withCodexModels(AGENTS, [
  { id: "small", label: "Small", efforts: ["low", "medium"] },
  { id: "big", label: "Big", efforts: ["low", "medium", "high"] },
]);

test("sanitize drops an effort the chosen model lacks, using the given catalog", () => {
  assert.deepEqual(sanitize({ agent: "codex", model: "small", effort: "high" }, SMALL), {
    agent: "codex",
    model: "small",
    effort: null,
  });
  assert.deepEqual(sanitize({ agent: "codex", model: "big", effort: "high" }, SMALL).effort, "high");
  assert.equal(sanitize({ agent: "codex", model: "gpt-6.1-sol", effort: "low" }, SMALL).model, null);
});

test("choose clears the effort when the new model lacks it", () => {
  const start = { agent: "codex", model: "big", effort: "high" };
  assert.deepEqual(choose(start, "model", "small", SMALL), { agent: "codex", model: "small", effort: null });
  assert.deepEqual(choose(start, "model", "big", SMALL), start);
  assert.deepEqual(choose({ ...start, effort: "low" }, "model", "small", SMALL).effort, "low");
});
