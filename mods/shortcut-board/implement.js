// Pure logic for the Implement pane: the choices, the agent's argv, the launch brief and the start folder.
// No Herdr imports, so `node --test tests/` can run it.

// Models and efforts each agent offers. Edit here to add one. Claude takes the latest-model aliases.
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const claudeModel = (id, label) => ({ id, label, efforts: [...CLAUDE_EFFORTS] });

export const AGENTS = {
  claude: {
    label: "Claude",
    models: [
      claudeModel("fable", "Fable"),
      claudeModel("opus", "Opus"),
      claudeModel("sonnet", "Sonnet"),
      claudeModel("haiku", "Haiku"),
    ],
  },
  codex: {
    // Fallback only: the pane replaces this with the list from Codex's own models cache when it can read it.
    label: "Codex",
    models: [
      {
        id: "gpt-6.1-sol",
        label: "gpt-6.1-sol",
        family: "sol",
        version: "6.1",
        efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      },
    ],
  },
};

// Splits a Codex slug like "gpt-6.2-sol" into { family: "sol", version: "6.2" }; {} when it does not match.
function parseSlug(slug) {
  const match = /^gpt-(\d+(?:\.\d+)?)-([a-z0-9]+)$/i.exec(slug);
  return match ? { family: match[2].toLowerCase(), version: match[1] } : {};
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const modelsOf = (catalog, agent) => catalog[agent]?.models ?? [];
const familyKey = (model) => model.family ?? model.id;

// The model families an agent offers, unique, in file order: [{ id, label }].
export function familiesFor(catalog, agent) {
  const out = [];
  for (const model of modelsOf(catalog, agent)) {
    const id = familyKey(model);
    if (out.some((f) => f.id === id)) continue;
    out.push({ id, label: model.family ? capitalize(model.family) : model.label });
  }
  return out;
}

// The versions of one family, in file order. [] when the family has none (Claude, unmatched slugs) or is unknown.
export function versionsFor(catalog, agent, family) {
  return modelsOf(catalog, agent)
    .filter((m) => familyKey(m) === family && m.version)
    .map((m) => m.version);
}

// The catalog model a choice points at, or undefined (version not chosen yet, unknown family, ...).
export function resolveModel(catalog, agent, choice) {
  return modelsOf(catalog, agent).find(
    (m) => familyKey(m) === choice?.model && (m.version ?? null) === (choice?.version ?? null),
  );
}

// The real model id (slug or alias) for argv, or undefined when the choice does not resolve.
export const modelIdFor = (catalog, choice) => resolveModel(catalog, choice?.agent, choice)?.id;

// The steps this choice goes through. The Version step only exists for a family that has versions.
export function stepsFor(catalog, agent, choice) {
  const hasVersions = versionsFor(catalog, agent, choice?.model).length > 0;
  return hasVersions ? ["agent", "model", "version", "effort"] : ["agent", "model", "effort"];
}

// The efforts of the model the choice resolves to, or [] when it does not resolve yet.
export function effortsFor(catalog, agent, choice) {
  return resolveModel(catalog, agent, choice)?.efforts ?? [];
}

// Codex's visible models with their reasoning efforts, from the text of ~/.codex/models_cache.json. [] on anything unexpected.
export function parseCodexModels(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data?.models)) return [];
  const out = [];
  for (const entry of data.models) {
    if (!entry || typeof entry.slug !== "string" || !entry.slug) continue;
    if (entry.visibility !== undefined && entry.visibility !== "list") continue;
    const levels = Array.isArray(entry.supported_reasoning_levels) ? entry.supported_reasoning_levels : [];
    const efforts = levels.map((l) => l?.effort).filter((e) => typeof e === "string" && e);
    if (efforts.length === 0) continue;
    out.push({ id: entry.slug, label: entry.display_name || entry.slug, ...parseSlug(entry.slug), efforts });
  }
  return out;
}

// A new catalog with Codex's models replaced by `models`; the catalog itself when `models` is empty.
export function withCodexModels(catalog, models) {
  if (!Array.isArray(models) || models.length === 0) return catalog;
  return { ...catalog, codex: { ...catalog.codex, models } };
}

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

// A remembered choice, keeping each part only while it is valid in the catalog; a missing version counts as null.
export function sanitize(last, catalog = AGENTS) {
  const result = { agent: null, model: null, version: null, effort: null };
  if (!catalog[last?.agent]) return result;
  const agent = last.agent;
  result.agent = agent;
  if (!familiesFor(catalog, agent).some((f) => f.id === last.model)) return result;
  result.model = last.model;
  const versions = versionsFor(catalog, agent, last.model);
  if (versions.length > 0) {
    if (!versions.includes(last.version)) return result;
    result.version = last.version;
  }
  if (effortsFor(catalog, agent, result).includes(last.effort)) result.effort = last.effort;
  return result;
}

export function choose(choice, step, value, catalog = AGENTS) {
  if (step === "agent") {
    return value === choice.agent ? choice : { agent: value, model: null, version: null, effort: null };
  }
  if (step === "model") {
    if (value === choice.model) return choice;
    const versions = versionsFor(catalog, choice.agent, value);
    return { ...choice, model: value, version: versions.length === 1 ? versions[0] : null, effort: null };
  }
  if (step === "version") {
    const next = { ...choice, version: value };
    const keep = effortsFor(catalog, choice.agent, next).includes(choice.effort);
    return { ...next, effort: keep ? choice.effort : null };
  }
  return { ...choice, [step]: value };
}

export function nextStep(choice, catalog = AGENTS) {
  return stepsFor(catalog, choice.agent, choice).find((step) => !choice[step]) ?? null;
}

export function isReady(choice, catalog = AGENTS) {
  return nextStep(choice, catalog) === null && resolveModel(catalog, choice.agent, choice) !== undefined;
}

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
