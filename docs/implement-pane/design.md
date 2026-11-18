# Implement pane: design

Approved in conversation. Status: ready for implementation planning.

## Behaviour

An Implement button shows on any board card or open story where `mine` is true. Clicking it opens the Implement pane in the story slot (board 60%, pane 40%), replacing the story content, with a close control like the story pane's.

## Layout of the pane, top to bottom

1. Ticket header: story id, title, state. Read only.
2. Stepper, one step at a time:
   1. Agent: Claude or Codex.
   2. Model: list depends on the agent.
   3. Effort: list depends on the agent.
   Each chosen step collapses to a chip you can click to change. The next step slides in. Defaults are remembered from the last run, so a repeat launch is quick.
3. Branch: the Shortcut suggested branch name (`formatted_vcs_branch_name`), shown read only.
4. Toggles:
   - Interactive (on by default) or Run to completion. Run to completion is disabled with a "coming soon" badge until implement-ticket has a real unattended mode.
   - Plan only, stop before coding (off by default).
5. Optional prompt: a multi-line text area titled "Prompt (optional)", with placeholder text saying it can be left empty and is added to the end of the first message.
6. Start button, disabled until agent, model and effort are chosen.

If Codex is picked, an inline note says: the Axial skills (including implement-ticket) are Claude-only for now, so Codex works from the ticket and your optional prompt without that workflow.

## What Start does

Before the tile opens, Herdr brings the base up to date. In both `axial-api.git` and `fe-app.git` under the axial-main root (which always sit on `integration`), it runs `git pull --ff-only`. This happens for both because the agent has not chosen a repo yet, and it is cheap. If a pull fails (dirty or diverged checkout), Herdr shows a warning and adds a line to the first message telling the agent to `git fetch` and base its worktree on `origin/integration`.

Calls `run("tab.new", { name, folder, argv, task })` with focus on the new tab. Nothing is written by an agent before launch; the first message is a template.

- argv: the agent's command with model and effort flags.
- folder: the axial-main root, always. The repo is chosen by the agent, so the tile does not live under axial-api or fe-app.
- name: the story id and a short title.

First message for Claude:

```
/axialpower:implement-ticket sc-<id>
Use the branch name <formatted_vcs_branch_name>.
Always base the worktree on the latest `integration` (use `bin/create-worktree <branch>` from the repo's `.git` checkout). Only branch from something else if the optional prompt says so.
[Plan only] Stop after the implementation plan is written and wait for me.
[Run to completion] Do not ask questions; decide, and log assumptions.
[Optional prompt] a blank line, then your text verbatim (omitted when empty)
```

For Codex the first line is replaced by "Implement Shortcut story sc-<id> (<url>)", since the skill is not available.

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
