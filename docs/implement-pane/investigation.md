# Implement pane: investigation

Living notes. Update as we learn more.

## Goal

A ticket on the Shortcut board that is assigned to you gets an Implement button. It opens a right-side pane, at the same 40% width as the story pane, where you pick an agent, model and effort, then start an implementation in a normal terminal tile.

## What exists today

- `mods/shortcut-board/main.js` renders the board and the story pane. With a story open, the board keeps `BOARD_SHARE = 0.6` of the width and the story takes the rest, so the Implement pane gets the 40% by living in the same slot.
- `mods/shortcut-board/fetch_board.py` already marks each card with `mine` (you are one of the owners). That is the check for showing the button.
- The story detail payload (`story` subcommand of `fetch_board.py`) has name, url, state, type, epic, owners, description, comments and relationships. It does not carry the branch name yet.
- Shortcut's story API has `formatted_vcs_branch_name`, which is the suggested branch name. Needs to be added to the detail payload (and to the card payload if the pane can open from a card without loading the detail first).
- `mods/prompt/main.js` shows the input pattern: `InputState.new({ value })` plus `Input.new(state)` from `gpui-base`. Need to confirm it supports multi-line text for the notes box.

## Starting an agent in a tile

`herdr.d.ts` documents `run("tab.new", { name?, folder?, argv?, task?, focus? })`: `argv` is the agent command and `task` is its first message. That is exactly the launch we need, in a new tab, with no hacks. `terminal.open { argv, folder, place }` is the alternative for a split.

Local agent commands:

- Claude: `claude --model <model> --effort <level> "<first message>"`. `claude --help` confirms `--model` and `--effort`.
- Codex: `codex -m <model> -c model_reasoning_effort="<level>"`. `programs.json` currently runs Codex with `--no-daemon --dangerously-bypass-approvals-and-sandbox`; reuse that `run` array and append flags. To verify: the exact config key for Codex reasoning effort.

## The skills

- `axialpower:implement-ticket` (axial-bazaar marketplace): ticket setup, brainstorming, plan, execution, finish. Treats the Shortcut ticket as the source of truth and asks questions along the way. This is the skill the Claude launch invokes.
- fe-app's ship-ticket skill: not read in detail; may be a better fit when the work is frontend only. Not used in v1.
- The axialpower plugin has only a `.claude-plugin` manifest and its skills use Claude Code tool names. There is no Codex packaging, so Codex cannot use implement-ticket today.

## Constraints and decisions so far

- Interactive by default; the agent opens in a normal terminal tile you can watch and steer.
- The agent decides the repo (axial-api or fe-app); the pane has no repo picker.
- Run to completion is only a best-effort prompt line for now, shown as "coming soon".
- Plan only is off by default.

## Open questions

- Which folder the tile starts in. Proposal: the axial-main root, so both repos are reachable. Confirm that implement-ticket's worktree setup works from there.
- Whether `tab.new`'s `task` is typed into the agent after start, or passed as the initial argument. Either works; it decides whether the first message appears in shell history.
- Valid model names per agent and how to keep the list current. Proposal: a small static list in the mod's config.
