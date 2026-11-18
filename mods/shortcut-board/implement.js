// Pure logic for the Implement pane: the choices, the agent's argv, the launch brief and the start folder.
// No Herdr imports, so `node --test tests/` can run it.

// Models and efforts each agent offers. Edit here to add one. Claude takes the latest-model aliases.
export const AGENTS = {
  claude: {
    label: "Claude",
    models: [
      { id: "fable", label: "Fable" },
      { id: "opus", label: "Opus" },
      { id: "sonnet", label: "Sonnet" },
      { id: "haiku", label: "Haiku" },
    ],
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  codex: {
    label: "Codex",
    models: [{ id: "gpt-6.1-sol", label: "gpt-6.1-sol" }],
    efforts: ["low", "medium", "high"],
  },
};

export const STEPS = ["agent", "model", "effort"];

// The integration checkouts under the axial-main root. Both are updated before every launch,
// because the agent has not chosen a repo yet.
export const BASE_REPOS = ["axial-api.git", "fe-app.git"];

const DEFAULT_ROOT = "~/source/axial-main";

export function startFolder(configured, homeDir) {
  const path = configured || DEFAULT_ROOT;
  if (path === "~") return homeDir;
  return path.startsWith("~/") ? `${homeDir}${path.slice(1)}` : path;
}

// Shortcut's formatted branch name can hold slashes, which create-worktree rejects. Returns null when nothing usable is left.
export function normalizeBranch(name) {
  if (!name) return null;
  const cleaned = String(name).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(cleaned) ? cleaned : null;
}

// One warning line for the pulls that failed, or null when all succeeded.
// results: [{ repo, ok, stderr }]. Each failure shows the last fatal:/error: line, else the last non-empty line.
export function summarizePulls(results) {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return null;
  const parts = failed.map(({ repo, stderr }) => {
    const lines = String(stderr ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const reason = [...lines].reverse().find((line) => /^(fatal|error):/.test(line)) ?? lines.at(-1);
    return reason ? `${repo} (${reason})` : repo;
  });
  return `Could not update ${parts.join(" and ")}`;
}

// A remembered choice, with anything the agent no longer offers dropped.
export function sanitize(last) {
  const agent = AGENTS[last?.agent] ? last.agent : null;
  if (!agent) return { agent: null, model: null, effort: null };
  const model = AGENTS[agent].models.some((m) => m.id === last.model) ? last.model : null;
  const effort = AGENTS[agent].efforts.includes(last.effort) ? last.effort : null;
  return { agent, model, effort };
}

export function choose(choice, step, value) {
  if (step === "agent") {
    return value === choice.agent ? choice : { agent: value, model: null, effort: null };
  }
  return { ...choice, [step]: value };
}

export const nextStep = (choice) => STEPS.find((step) => !choice[step]) ?? null;
export const isReady = (choice) => nextStep(choice) === null;

// `run` is the agent's own command from Herdr's program table (knownAgents()).
// `addDir` lets claude read the brief folder without a permission prompt; codex ignores it.
export function buildArgv({ run, agent, model, effort, addDir }) {
  if (agent === "claude") {
    return [...run, "--model", model, "--effort", effort, ...(addDir ? ["--add-dir", addDir] : [])];
  }
  return [...run, "-m", model, "-c", `model_reasoning_effort="${effort}"`];
}

// The full instructions, saved to a file so multi-line text never has to be typed into the agent.
export function buildBrief({ storyId, url, branch, interactive, planOnly, prompt, pullFailed, agent, title, description }) {
  const lines = [`Shortcut story: sc-${storyId}${url ? ` (${url})` : ""}. The story is the source of truth.`];
  if (branch) lines.push(`Use the branch name ${branch}.`);
  lines.push(
    "Base the work on the latest integration branch: from the repo's checkout under the axial-main root " +
      "(axial-api.git or fe-app.git, whichever repo you choose), run $AXIAL_ORCHESTRATION_ROOT/bin/create-worktree <branch>." +
      (branch ? " <branch> is the branch name given above." : "") +
      " Only branch from something else if the Prompt section below says so.",
  );
  if (pullFailed) {
    lines.push(
      "Herdr could not update integration automatically. Before running create-worktree, run git pull --ff-only " +
        "in that checkout (it must be on integration); if that fails, stop and tell me.",
    );
  }
  if (planOnly) {
    lines.push("Plan only: stop after the implementation plan is written and wait for me. Do not write code.");
  }
  if (!interactive) {
    lines.push("Run to completion: do not ask questions. Decide, and log your assumptions in the PR description.");
  }
  let text = lines.join("\n");
  const body = (description ?? "").trim();
  if (agent === "codex" && (title || body)) text += `\n\n## Story\n# ${title ?? ""}\n\n${body}`;
  const extra = (prompt ?? "").replace(/^(\s*\n)+/, "").trimEnd();
  if (extra) text += `\n\n## Prompt\n${extra}`;
  return `${text}\n`;
}

// The one-line first message. Codex has no Axial skills, so it gets a plain request.
export function buildTask({ agent, storyId, url, briefPath }) {
  const read = `First read the launch brief at ${briefPath} and follow it.`;
  if (agent === "claude") return `/axialpower:implement-ticket sc-${storyId} ${read}`;
  return `Implement Shortcut story sc-${storyId} (${url}). ${read}`;
}
