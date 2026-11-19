# Board Desk for Herdr

A [Herdr](https://herdr.dev) layout for working with coding agents and a Shortcut board side by side.

![Board Desk](preview.png)

- **Terminals / Board switch** left of the tab bar: swap the main area between your terminals and your Shortcut team's kanban board.
- **Markdown view**: a third switch beside Terminals and Board. Drop `.md` files on the view or on the Markdown switch to open them (several stay open as tabs), then flip between the rendered Preview and the raw Text. Relative links to other `.md` files open in the viewer, and the reload button re-reads the file.
- **Story pane**: click a card to read its description, pull requests (clickable, with state, review and diff size), relationships and comments next to the board (read-only).
- **Asks**: a right-panel view that collects every agent waiting on you (approvals, questions, replies). Answer from the card, jump to the terminal or dismiss it; a macOS notification and the rail badge tell you when a new one arrives.
- **Implement**: on a story assigned to you, an Implement button (on the card when the story has no relationships, and always in the story header) opens a pane to choose Claude or Codex, the model, its version and the effort, then starts that agent in a new tab to implement the story.
- **Usage panel**: CPU, RAM and GPU gauges and Claude and Codex 5-hour and weekly plan limits at the bottom of the sidebar.
- **Right rail**: your open GitHub pull requests and your past Claude Code and Codex sessions for the focused repo; child terminals get their own pane.

## Install

Ask the agent in your Herdr window to add it:

> Add the Herdr layout from https://github.com/klindic/herdr-board-desk

Or by hand: copy `layouts/board-desk.json` into `~/.config/herdr-app/layouts/` and each folder in `mods/` into `~/.config/herdr-app/mods/` (rename any that clash with mods you already have), then switch with `ctrl-shift-l`. Restart Herdr once so the bundled Inter font loads.

## Configure

- **Board**: copy `mods/shortcut-board/config.example.json` to `config.json` and set your `team` (name, mention name or id) and the `columns` (workflow state names) to show. Put your Shortcut API token in `$SHORTCUT_API_TOKEN` or in the file `token_file` points at. Set `"demo": true` to try it with made-up stories.
- **Asks** (right panel, bell icon): lists every agent whose status is blocked. Each card shows the agent's space and tab, how long it has waited, the question, the command or detail above it and its numbered options, read from the agent's terminal screen (`hc read`). Approvals send the clicked option at once; questions highlight the option and send it with Answer; a prompt without options gets a reply box. Open terminal focuses the agent's pane, Dismiss hides that ask until it changes, and Here/All filters by the focused space. A new ask posts a macOS notification (via `osascript`, skipped when you are looking at that agent) and sets the rail and Dock badge. Answers are sent as the option's number with `hc keys`, which works for Claude Code and Codex prompts.
- **Implement** (stories assigned to you): the Implement button opens a pane at 40% width. Pick the agent (Claude or Codex), the model, its version and the effort; each step shows once the one before it is chosen, and every option stays visible with the chosen one highlighted. Codex's models and efforts come from Codex's own cache (`~/.codex/models_cache.json`). The pane also shows the branch (Shortcut's suggestion, editable with the pencil), an Interactive mode (Run to completion is marked "coming soon"), a Plan only switch, and an optional multi-line prompt. Start pulls `integration` in `axial-api.git` and `fe-app.git`, then opens the agent in a new tab in the axial-main folder (`implement_root` in the board config, default `~/source/axial-main`). Claude is told to run `/axialpower:implement-ticket` (it needs the Axial `axialpower` plugin); Codex has no Axial skills, so it gets the story text instead. The full instructions go into a launch brief saved in `~/.cache/herdr-implement/`, and the agent's first message just points at it. This part is written for Axial's setup (`axial-main` with `axial-api.git` and `fe-app.git` checkouts); the rest of the board works for any Shortcut team.
- **Pull requests** (optional): copy `mods/my-prs/config.example.json` to `config.json` and set `org` to search one GitHub organization only. Needs `gh` signed in.
- **Usage panel**: nothing to set. It reads the logins Claude Code (macOS keychain) and Codex (`~/.codex/auth.json`) already have.

## What it touches

Before installing, know that these mods run programs and reach the network: the board calls the Shortcut API; the usage panel calls Anthropic's and OpenAI's usage endpoints with your existing Claude Code and Codex tokens (read-only, never refreshed); Pull requests runs `gh`, and the story pane runs `gh pr view` for each pull request linked to the story; Implement runs `git pull --ff-only` in your two integration checkouts, writes launch briefs to `~/.cache/herdr-implement/`, reads `~/.codex/models_cache.json` and starts Claude or Codex; Asks reads agent terminal screens with `hc read`, sends keystrokes with `hc keys` and `hc send`, and posts macOS notifications with `osascript`; the Markdown view reads the files you drop on it; Sessions reads `~/.claude` and `~/.codex` and can move a session file to the Trash.

`RECIPE.md` describes the whole layout in enough detail to rebuild it from scratch.

## Development

`npm test` runs the node tests for the Implement logic, the Asks screen parser and the Markdown view's path helpers and the Python test for the fetch script. The mods themselves only run inside Herdr; `herdr-app check mods/shortcut-board` loads one once and reports problems.

## License

MIT, see `LICENSE`. The usage panel's look is adapted from [chelebyy/herdr-agent-workspace](https://github.com/chelebyy/herdr-agent-workspace) (Apache 2.0) and [Lakris2407/herdr-quota](https://github.com/Lakris2407/herdr-quota) (MIT); the bundled Inter font is under the SIL Open Font License. See `NOTICE`.
