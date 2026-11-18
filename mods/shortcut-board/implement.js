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
  return path.startsWith("~/") ? `${homeDir}${path.slice(1)}` : path;
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
export function buildArgv({ run, agent, model, effort }) {
  if (agent === "claude") return [...run, "--model", model, "--effort", effort];
  return [...run, "-m", model, "-c", `model_reasoning_effort="${effort}"`];
}

// The full instructions, saved to a file so multi-line text never has to be typed into the agent.
export function buildBrief({ storyId, url, branch, interactive, planOnly, prompt, pullFailed }) {
  const lines = [`Shortcut story: sc-${storyId}${url ? ` (${url})` : ""}. The story is the source of truth.`];
  if (branch) lines.push(`Use the branch name ${branch}.`);
  lines.push(
    "Base the work on the latest integration branch: create the worktree from integration with " +
      "bin/create-worktree <branch>, run from axial-api.git or fe-app.git (whichever repo you choose). " +
      "Only branch from something else if the Prompt section below says so.",
  );
  if (pullFailed) {
    lines.push(
      "Herdr could not update integration automatically. Run git fetch and base the worktree on origin/integration.",
    );
  }
  if (planOnly) {
    lines.push("Plan only: stop after the implementation plan is written and wait for me. Do not write code.");
  }
  if (!interactive) {
    lines.push("Run to completion: do not ask questions. Decide, and log your assumptions in the PR description.");
  }
  let text = lines.join("\n");
  const extra = (prompt ?? "").trim();
  if (extra) text += `\n\n## Prompt\n${extra}`;
  return `${text}\n`;
}

// The one-line first message. Codex has no Axial skills, so it gets a plain request.
export function buildTask({ agent, storyId, url, briefPath }) {
  const read = `First read the launch brief at ${briefPath} and follow it.`;
  if (agent === "claude") return `/axialpower:implement-ticket sc-${storyId} ${read}`;
  return `Implement Shortcut story sc-${storyId} (${url}). ${read}`;
}
