# Implement pane: design

Approved in conversation and built. This file describes the pane as it now works; `RECIPE.md` has the exact sizes and behaviour, and `implementation-plan.md` is the original build plan (kept for history, later changes are listed at the end of this file).

## Behaviour

An Implement button shows on any board card or open story where `mine` is true. Clicking it opens the Implement pane in the story slot (board 60%, pane 40%), replacing the story content, with a close control like the story pane's.

## Layout of the pane, top to bottom

1. Ticket header: story id, title, state. Read only.
2. Stepper, one step at a time. Every option stays visible and the chosen one is highlighted:
   1. Agent: Claude or Codex.
   2. Model: the family (Claude: Fable, Opus, Sonnet, Haiku; Codex: Sol, Astra, Terra, Luna).
   3. Version, newest first (skipped when a family has a single version, which is then picked for you).
   4. Effort: the levels the chosen model supports.
   A step shows once the one before it is chosen. The last choice is remembered, so a repeat launch is quick. Claude's models are a table in `implement.js`; Codex's come from `~/.codex/models_cache.json` (hidden entries skipped) with a one-model fallback.
3. Branch: the Shortcut suggested branch name (`formatted_vcs_branch_name`) with anything outside letters, digits, `_` and `-` turned into `-`, because `create-worktree` only accepts those. A pencil at the end edits it; an invalid name is rejected, never rewritten, and an empty box goes back to the suggestion.
4. Mode:
   - Interactive (on). Run to completion is disabled with a "coming soon" badge until implement-ticket has a real unattended mode.
   - Plan only, stop before coding: a text row with an on/off switch at the end (off by default).
5. Optional prompt: a multi-line text area titled "Prompt (optional)", with placeholder text saying it can be left empty and is added to the launch brief that the agent reads first.
6. Start button, disabled until every step is chosen and the story has loaded, while a run for that story is in flight, and after a launch until the form changes.

If Codex is picked, an inline note says: the Axial skills (including implement-ticket) are Claude-only for now, so Codex works from the ticket and your optional prompt without that workflow.

## What Start does

Before the tile opens, Herdr brings the base up to date. In both `axial-api.git` and `fe-app.git` under the axial-main root (which always sit on `integration`), it runs `git pull --ff-only`. This happens for both because the agent has not chosen a repo yet, and it is cheap. Each checkout must be on `integration`. If a pull fails (dirty, diverged or on another branch), Herdr shows a warning and the brief tells the agent to run `git pull --ff-only` in that checkout before `create-worktree`.

Calls `run("tab.new", { name, folder, argv, task })` with focus on the new tab. Nothing is written by an agent before launch; the first message is a template.

- argv: the agent's command with model and effort flags.
- folder: the axial-main root, always. The repo is chosen by the agent, so the tile does not live under axial-api or fe-app.
- name: the story id.

The full instructions go into a launch brief file, `~/.cache/herdr-implement/sc-<id>-<timestamp>.md`, because a multi-line message typed into an agent can submit early. The brief holds the story, the branch name (Shortcut's suggestion with anything outside letters, digits, `_` and `-` turned into `-`), the rule to base the worktree on the latest `integration` with `$AXIAL_ORCHESTRATION_ROOT/bin/create-worktree <branch>`, the plan-only and run-to-completion lines, and your optional prompt after a blank line. For Codex it also holds the story title and description, since Codex cannot read Shortcut. If a pull failed, it tells the agent to `git pull --ff-only` in that checkout first.

The first message is one line. For Claude: `/axialpower:implement-ticket sc-<id> First read the launch brief at <path> and follow it.` For Codex: `Implement Shortcut story sc-<id> (<url>). First read the launch brief at <path> and follow it.`

The agent picks the repo itself, and implement-ticket does the worktree setup and asks questions as usual, in the tile.

## Data changes

- `fetch_board.py`: add `branch` (from `formatted_vcs_branch_name`) to the story payload, and to the card payload if the pane opens from a card.
- Config (`config.json` / `config.example.json`): agent, model and effort lists, the start folder, and last-used choices (last-used may use `localStorage` like the board cache does).

## Code changes

- New view or section in `mods/shortcut-board/main.js`: the Implement pane, sharing the story pane's width logic and close behaviour.
- Implement button on cards and in the story header, gated on `mine`.
- A small pure function that builds argv and the first message from the form state, so it can be tested without the UI.

## Error handling

- Missing branch name: hide the branch row and omit the line from the message.
- `tab.new` rejects: show the error in the pane and keep the form state.
- Agent not installed (`knownAgents()` reports `installed: false`): disable that agent with a short reason.

## Testing

- Unit tests for the argv and message builder (agent x toggles x notes).
- Manual: launch from a real assigned ticket with Claude, confirm the skill starts and asks its questions; launch with Codex and confirm the fallback message.

## Out of scope for now

Unattended pipeline (spec, plan, implementation, draft PR with no engineer), a repo picker, Codex support for Axial skills.

## Changes after the first design

- Codex models and efforts are read from Codex's own cache instead of a fixed list; both agents got a Version step.
- The branch name is editable, and it is made safe for `create-worktree` (which lives at the axial-main root, branches from the checkout's local HEAD and rejects slashes).
- Codex has no Shortcut access, so its brief includes the story title and description.
- Claude gets `--add-dir <brief folder>` so reading the brief does not prompt. It goes before `--model` and `--effort` because `--add-dir` takes any number of values and would swallow the first message Herdr appends after the arguments.
- Plan only is a switch row, not a chip.
