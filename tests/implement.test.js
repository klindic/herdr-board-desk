import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENTS,
  buildArgv,
  buildBrief,
  buildTask,
  choose,
  effortsFor,
  familiesFor,
  isReady,
  modelIdFor,
  nextStep,
  normalizeBranch,
  parseCodexModels,
  resolveModel,
  stepsFor,
  versionsFor,
  summarizePulls,
  sanitize,
  startFolder,
  withCodexModels,
} from "../mods/shortcut-board/implement.js";

const EMPTY = { agent: null, model: null, version: null, effort: null };

test("sanitize keeps a valid remembered choice", () => {
  assert.deepEqual(sanitize({ agent: "claude", model: "opus", version: "5.5", effort: "high" }), {
    agent: "claude",
    model: "opus",
    version: "5.5",
    effort: "high",
  });
});

test("sanitize drops values the agent does not offer", () => {
  assert.deepEqual(sanitize({ agent: "codex", model: "opus", effort: "max" }), {
    agent: "codex",
    model: null,
    version: null,
    effort: null,
  });
  assert.deepEqual(sanitize({ agent: "nope", model: "opus", effort: "high" }), EMPTY);
  assert.deepEqual(sanitize(null), EMPTY);
});

test("choose resets model, version and effort when the agent changes", () => {
  const start = { agent: "claude", model: "opus", version: "5.5", effort: "high" };
  assert.deepEqual(choose(start, "agent", "codex"), { agent: "codex", model: null, version: null, effort: null });
  assert.deepEqual(choose(start, "agent", "claude"), start);
  assert.deepEqual(choose(start, "model", "sonnet"), { agent: "claude", model: "sonnet", version: null, effort: null });
});

test("nextStep and isReady walk the Claude stepper", () => {
  assert.equal(nextStep(EMPTY), "agent");
  assert.equal(nextStep({ ...EMPTY, agent: "claude" }), "model");
  assert.equal(nextStep({ ...EMPTY, agent: "claude", model: "opus" }), "version");
  assert.equal(nextStep({ ...EMPTY, agent: "claude", model: "opus", version: "5.5" }), "effort");
  assert.equal(nextStep({ ...EMPTY, agent: "claude", model: "opus", version: "5.5", effort: "high" }), null);
  assert.equal(isReady({ ...EMPTY, agent: "claude", model: "opus", version: "5.5", effort: "high" }), true);
  assert.equal(isReady({ ...EMPTY, agent: "claude", model: "opus", effort: "high" }), false);
  assert.equal(isReady({ ...EMPTY, agent: "claude", model: "opus", version: "5.5" }), false);
  assert.equal(isReady({ ...EMPTY, agent: "claude", model: "opus", version: "9", effort: "high" }), false);
  assert.equal(isReady({ ...EMPTY, agent: "claude", model: "nope", effort: "high" }), false);
});

test("buildArgv appends the agent's own flags to its run command", () => {
  assert.deepEqual(buildArgv({ run: ["claude"], agent: "claude", model: "claude-opus-5-5", effort: "high" }), [
    "claude",
    "--model",
    "claude-opus-5-5",
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
  const base = { run: ["claude"], agent: "claude", model: "claude-opus-5-5", effort: "high" };
  assert.deepEqual(buildArgv({ ...base, addDir: "/d" }), [
    "claude",
    "--add-dir",
    "/d",
    "--model",
    "claude-opus-5-5",
    "--effort",
    "high",
  ]);
  // The last argument must not be a value of --add-dir, because the first message is appended after it.
  assert.equal(buildArgv({ ...base, addDir: "/d" }).at(-2), "--effort");
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

const EFFORTS = ["low", "medium", "high"];
const CODEX_CACHE = JSON.stringify({
  models: [
    ["gpt-6.2-sol", ["low", "medium", "high", "max"]],
    ["gpt-6.1-sol", EFFORTS],
    ["gpt-6-sol", EFFORTS],
    ["gpt-5.6-sol", EFFORTS],
    ["gpt-6-luna", ["low", "medium"]],
    ["gpt-5.6-luna", EFFORTS],
    ["codex-mini", ["low"]],
    ["gpt-6.3-nova", ["low"]],
  ].map(([slug, efforts]) => ({
    slug,
    visibility: "list",
    supported_reasoning_levels: efforts.map((effort) => ({ effort })),
  })),
});
const CODEX = withCodexModels(AGENTS, parseCodexModels(CODEX_CACHE));
const CHOICE = (agent, model = null, version = null, effort = null) => ({ agent, model, version, effort });

test("parseCodexModels adds family and version for matching slugs only", () => {
  const models = parseCodexModels(CODEX_CACHE);
  assert.deepEqual(models[0], { id: "gpt-6.2-sol", label: "gpt-6.2-sol", family: "sol", version: "6.2", efforts: ["low", "medium", "high", "max"] });
  assert.equal(models[2].version, "6");
  assert.deepEqual(models[6], { id: "codex-mini", label: "codex-mini", efforts: ["low"] });
  assert.equal("family" in models[6], false);
  assert.equal(parseCodexModels('{"models":[{"slug":"GPT-6.1-SOL","supported_reasoning_levels":[{"effort":"low"}]}]}')[0].family, "sol");
});

test("the static Codex fallback carries family and version", () => {
  assert.equal(AGENTS.codex.models[0].family, "sol");
  assert.equal(AGENTS.codex.models[0].version, "6.1");
});

test("familiesFor lists unique families in file order", () => {
  assert.deepEqual(familiesFor(CODEX, "codex"), [
    { id: "sol", label: "Sol" },
    { id: "luna", label: "Luna" },
    { id: "codex-mini", label: "codex-mini" },
    { id: "nova", label: "Nova" },
  ]);
  assert.deepEqual(familiesFor(AGENTS, "claude").map((f) => f.id), ["fable", "opus", "sonnet", "haiku"]);
  assert.deepEqual(familiesFor(AGENTS, "claude")[1], { id: "opus", label: "Opus" });
  assert.deepEqual(familiesFor(AGENTS, "nope"), []);
});

test("versionsFor lists a family's versions in file order", () => {
  assert.deepEqual(versionsFor(CODEX, "codex", "sol"), ["6.2", "6.1", "6", "5.6"]);
  assert.deepEqual(versionsFor(CODEX, "codex", "luna"), ["6", "5.6"]);
  assert.deepEqual(versionsFor(CODEX, "codex", "codex-mini"), []);
  assert.deepEqual(versionsFor(AGENTS, "claude", "opus"), ["5.5", "5", "4.8", "4.7", "4.6", "4.5", "4.1", "4"]);
  assert.deepEqual(versionsFor(CODEX, "codex", null), []);
});

test("resolveModel and modelIdFor find the real model", () => {
  assert.equal(resolveModel(CODEX, "codex", CHOICE("codex", "sol", "6")).id, "gpt-6-sol");
  assert.equal(resolveModel(CODEX, "codex", CHOICE("codex", "sol", "5.6")).id, "gpt-5.6-sol");
  assert.equal(resolveModel(CODEX, "codex", CHOICE("codex", "sol")), undefined);
  assert.equal(resolveModel(CODEX, "codex", CHOICE("codex", "codex-mini")).id, "codex-mini");
  assert.equal(resolveModel(CODEX, "codex", CHOICE("codex", "luna", "6.2")), undefined);
  assert.equal(modelIdFor(AGENTS, CHOICE("claude", "opus")), undefined);
  assert.equal(modelIdFor(AGENTS, CHOICE("claude", "opus", "4.1")), "claude-opus-4-1");
  assert.equal(modelIdFor(AGENTS, CHOICE("claude", "opus", "5.5")), "claude-opus-5-5");
  assert.equal(modelIdFor(AGENTS, CHOICE("claude", "fable", "5")), "claude-fable-5");
  assert.equal(modelIdFor(CODEX, CHOICE("codex", "luna", "5.6")), "gpt-5.6-luna");
  assert.equal(modelIdFor(CODEX, CHOICE("codex", "luna")), undefined);
  assert.equal(modelIdFor(AGENTS, EMPTY), undefined);
});

test("stepsFor adds Version only for a family that has versions", () => {
  assert.deepEqual(stepsFor(CODEX, "codex", CHOICE("codex")), ["agent", "model", "effort"]);
  assert.deepEqual(stepsFor(CODEX, "codex", CHOICE("codex", "sol")), ["agent", "model", "version", "effort"]);
  assert.deepEqual(stepsFor(CODEX, "codex", CHOICE("codex", "codex-mini")), ["agent", "model", "effort"]);
  assert.deepEqual(stepsFor(AGENTS, "claude", CHOICE("claude")), ["agent", "model", "effort"]);
  assert.deepEqual(stepsFor(AGENTS, "claude", CHOICE("claude", "opus")), ["agent", "model", "version", "effort"]);
});

test("effortsFor takes the whole choice and needs it to resolve", () => {
  assert.deepEqual(effortsFor(CODEX, "codex", CHOICE("codex", "sol", "6.2")), ["low", "medium", "high", "max"]);
  assert.deepEqual(effortsFor(CODEX, "codex", CHOICE("codex", "sol")), []);
  assert.deepEqual(effortsFor(AGENTS, "claude", CHOICE("claude", "opus")), []);
  assert.deepEqual(effortsFor(AGENTS, "claude", CHOICE("claude", "opus", "5.5")), ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(effortsFor(AGENTS, "claude", CHOICE("claude", "nope")), []);
  assert.deepEqual(effortsFor(AGENTS, "nope", CHOICE("nope", "opus")), []);
});

test("choose model clears version and effort, and auto-selects a single version", () => {
  const start = CHOICE("codex", "sol", "6", "high");
  assert.deepEqual(choose(start, "model", "luna", CODEX), CHOICE("codex", "luna"));
  assert.deepEqual(choose(start, "model", "sol", CODEX), start);
  assert.deepEqual(choose(CHOICE("codex"), "model", "nova", CODEX), CHOICE("codex", "nova", "6.3"));
  assert.deepEqual(choose(CHOICE("codex", "sol", "6", "high"), "model", "codex-mini", CODEX), CHOICE("codex", "codex-mini"));
});

test("choose version keeps the effort only when the resolved model supports it", () => {
  assert.deepEqual(choose(CHOICE("codex", "sol", "6.2", "max"), "version", "6.1", CODEX), CHOICE("codex", "sol", "6.1"));
  assert.deepEqual(choose(CHOICE("codex", "sol", "6.2", "high"), "version", "6", CODEX), CHOICE("codex", "sol", "6", "high"));
  assert.deepEqual(choose(CHOICE("codex", "sol"), "version", "6.2", CODEX), CHOICE("codex", "sol", "6.2"));
  assert.deepEqual(choose(CHOICE("codex", "sol", "6.2"), "effort", "max", CODEX), CHOICE("codex", "sol", "6.2", "max"));
});

test("sanitize validates family, version and effort in turn", () => {
  assert.deepEqual(sanitize(CHOICE("codex", "sol", "6.2", "max"), CODEX), CHOICE("codex", "sol", "6.2", "max"));
  assert.deepEqual(sanitize(CHOICE("codex", "sol", "9", "low"), CODEX), CHOICE("codex", "sol"));
  assert.deepEqual(sanitize(CHOICE("codex", "luna", "6.2", "low"), CODEX), CHOICE("codex", "luna"));
  assert.deepEqual(sanitize(CHOICE("codex", "sol", "6", "max"), CODEX), CHOICE("codex", "sol", "6"));
  assert.deepEqual(sanitize(CHOICE("codex", "codex-mini", null, "low"), CODEX), CHOICE("codex", "codex-mini", null, "low"));
});

test("sanitize handles old-format choices without a version", () => {
  assert.deepEqual(sanitize({ agent: "claude", model: "opus", effort: "high" }, CODEX), CHOICE("claude", "opus"));
  assert.deepEqual(sanitize({ agent: "claude", model: "opus", effort: "high" }), CHOICE("claude", "opus"));
  assert.deepEqual(sanitize({ agent: "codex", model: "gpt-6.1-sol", effort: "low" }, CODEX), CHOICE("codex"));
});

test("nextStep and isReady walk the Codex stepper", () => {
  assert.equal(nextStep(CHOICE("codex"), CODEX), "model");
  assert.equal(nextStep(CHOICE("codex", "sol"), CODEX), "version");
  assert.equal(nextStep(CHOICE("codex", "sol", "6.2"), CODEX), "effort");
  assert.equal(nextStep(CHOICE("codex", "sol", "6.2", "low"), CODEX), null);
  assert.equal(nextStep(CHOICE("codex", "codex-mini"), CODEX), "effort");
  assert.equal(isReady(CHOICE("codex", "sol", "6.2", "low"), CODEX), true);
  assert.equal(isReady(CHOICE("codex", "sol", null, "low"), CODEX), false);
  assert.equal(isReady(CHOICE("codex", "codex-mini", null, "low"), CODEX), true);
  assert.equal(isReady(CHOICE("codex", "sol", "9", "low"), CODEX), false);
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

test("the Claude catalog has versioned entries with real model ids, newest first", () => {
  const models = AGENTS.claude.models;
  assert.equal(models.length, 18);
  assert.deepEqual(versionsFor(AGENTS, "claude", "fable"), ["5.2", "5.1", "5"]);
  assert.deepEqual(versionsFor(AGENTS, "claude", "sonnet"), ["5.5", "5", "4.6", "4.5", "4"]);
  assert.deepEqual(versionsFor(AGENTS, "claude", "haiku"), ["5.5", "4.5"]);
  assert.deepEqual(models.find((m) => m.id === "claude-opus-5-5"), {
    id: "claude-opus-5-5",
    label: "Opus 5.5",
    family: "opus",
    version: "5.5",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  });
  assert.equal(models.find((m) => m.id === "claude-sonnet-4").label, "Sonnet 4");
});

test("choose model does not auto-select a Claude family with several versions", () => {
  assert.deepEqual(choose(CHOICE("claude"), "model", "haiku"), CHOICE("claude", "haiku"));
  assert.deepEqual(choose(CHOICE("claude", "haiku", "4.5", "high"), "version", "5.5"), CHOICE("claude", "haiku", "5.5", "high"));
});

test("sanitize drops an old Claude choice without a version at the version step", () => {
  assert.deepEqual(sanitize({ agent: "claude", model: "sonnet", version: null, effort: "max" }), CHOICE("claude", "sonnet"));
  assert.deepEqual(sanitize({ agent: "claude", model: "sonnet", version: "4.6", effort: "max" }), CHOICE("claude", "sonnet", "4.6", "max"));
});
