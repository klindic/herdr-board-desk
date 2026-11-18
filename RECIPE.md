# Board Desk

Herdr's main layout, reworked for a day of agents and tickets. A Terminals / Board switch sits left of the tab bar: Terminals shows the active tab's panes as usual, Board swaps the whole main area for your Shortcut team's kanban board, and clicking a card opens the story (description, relationships, read-only comments) beside it. The left sidebar ends with live Claude and Codex plan limits (5-hour and weekly). On the right, an icon rail toggles a panel with your open GitHub pull requests or your past Claude Code and Codex sessions for the focused repo.

![Board Desk](preview.png)

## What you see

Left to right:

1. **Sidebar** (300px, `chrome`): the Herdr brand row (46px), the spaces list and the agents list (equal shares, 90px minimum each), the **usage panel**, then Settings and Add machine (69px).
   - Usage panel: a 1px top border, 14px side padding, 12px top and 10px bottom. First a 20px row of three **system gauges**, `CPU`, `RAM` and `GPU`, spread across the width: a 22px label (10px `dim`), a mini bar graph of the last readings (columns 2px wide, 1px apart, up to 12px tall, newest on the right, at 85% opacity; as many columns as fit, up to 16) and a 28px percentage (11px, `muted` below 60%). Then, 12px lower, **QUOTA USAGE** (10px `dim`) with `updated 1m ago` on the right, and one 27px row per limit window: `Claude 5 h`, `Claude 7 days`, `Codex 7 days` (84px; Codex's 5-hour window is left out by `HIDDEN_WINDOWS` in `main.js`, 12.5px `foreground`), a 6px rounded bar filling the rest (track `border`), the percentage (36px, right-aligned) and the time until reset (44px, 10.5px `dim`: `42m`, `3h 32m`, `2d 18h`). Bars, graph columns and percentages share one scale: green `#5ed49a` below 60%, amber `#f2c14e` from 60%, orange `#f59152` from 80%, red `#f2665c` from 92% (light themes `#1f9d63`, `#c98a0b`, `#dd6b20`, `#d64545`). The block sizes itself to fit: 22px padding + 20px gauges + 12px gap + 16px header + 27px per row. A provider that can't load shows one row with its name and a dim reason (`not signed in to Claude Code`, `token expired, open Claude Code to refresh`). If a refresh fails but numbers were loaded before, they stay up with a small red dot by the label; quota older than 10 minutes dims to 60%. With the sidebar folded to its rail (under 160px) the gauges hide and each tool becomes a 36px tile: two letters (`Cl`, `Co`) over its highest percentage in the scale color, details in the tooltip.
2. **Work column**:
   - **Top bar** (42px, one 1px bottom border across its whole width): the **view switch** (190px) then Herdr's tab bar. The switch is a 31px segmented control (8px radius, 1px `border`, 2px padding) with two 25px segments, `>_ Terminals` and a kanban icon with `Board`, 12.8px text; the active segment is `raised` with `foreground` text, the other `muted`. A 1px by 18px `border` divider follows it.
   - **Main view** (8px padding): a stack of the active tab (panes as 10px-radius cards with Herdr's `pane` header, 8px gap) and the **board**.
   - Herdr's Files / Changes panel (hidden by default) and the status bar (28px).
3. **Right panel** (300px, `chrome`): a stack of **Pull requests** and **Sessions**.
4. **Right rail** (44px, `chrome`, 1px left border): 32px icon buttons for Pull requests and Sessions; the shown one is `selected`. Pull requests carries an `accent` badge with the number of PRs waiting for your review.

### The board

All text on the board uses **Inter** (Shortcut's own font), bundled in `mods/shortcut-board/fonts`.

- A card with a 1px `border` and 10px radius on `background`. **Header** (54px, bottom border): `Board` (15px semibold), `All` / `Mine` filter chips (26px pills, the active one `raised` with an `input` border), then right-aligned `9 cards · Team name · updated 2m ago` (12px `dim`, `blocked` when it is an error) and a refresh button that spins while loading.
- **Columns**: one per configured workflow state, side by side with 4px gaps and 18px side padding, scrolling sideways when they don't fit. A column is 220 to 380px wide, sized as if the story pane, the right panel and the Files panel were all closed (so opening any of them never resizes cards). Each starts with an 8px state dot, the state name (13.5px semibold) and the card count (`dim`). Dot colors: Unstarted `idle`, In Progress `working`, In Review `ansi4`, In QA `ansi5`, PO Acceptance `ansi6`, Accepted `done`; other states go by type (unstarted, started, done).
- **Cards** (12px padding, 8px gap, 8px radius, `surface`): `sc-1188` in `ansi4`, the epic in `dim` (truncated) and the age since it last moved (`3d`) on one line; the title in 13.5px `foreground`, wrapping, cut at 140 characters; the owners' short names (`Alex M., Sam R.`) or `No owner` in `muted`; a red `Blocked` (or `Blocking another story`) line when it applies; then `Shortcut` and one `PR #n` button per linked GitHub PR (26px, `raised`, 1px `border`).
- **Card border** is the story's color: `blocked` when blocked, else by type: feature `ansi3`, bug `ansi1`, chore `dim`. Hovering changes nothing. The selected card keeps its border and fills with that color at alpha `2e`.
- **Scrolling**: each column scrolls on its own. The scrollbar is drawn by the mod: a 6px rounded pill in `muted` at 45% opacity, 3px from the edge in a 15px gutter right of the cards, fading in while scrolling and out 0.9s after.

### The story pane

Clicking a card splits the board 60/40 with an 8px gap: the board card on the left, a second bordered 10px-radius card on the right.

- **Header** (54px): `sc-1188`, the state's dot and name, a spinner while loading, `Open in Shortcut` and a close button.
- **Body** (22px side padding, 16px gaps), scrolling with the same rounded thumb: the title (20px semibold), owners · epic (12.5px `muted`), the description rendered as Markdown (headings, lists, task checkboxes, code, links; bare `sc-123` references become Shortcut links), **Story Relationships** and **Comments**.
- **Story Relationships**: a 1px top rule, `Story Relationships` and its count, then a 32px row per link: an icon (`Blocked by`: a ban sign in `blocked`; `Blocks`: a warning triangle in `ansi3`; `Duplicates` / `Duplicated by`: a copy icon; `Relates to`: a link icon), the relationship in `foreground`, the other story's title in `muted` (`dim` once finished), and on the right a 22px `raised` chip with the story type icon (feature sparkle, bug, chore wrench) and its number. `No relationships` when there are none.
- **Comments**: oldest first, each a `surface` card with a 1px `border`: the author semibold and the age in `dim`, then the text as Markdown. Replies are indented 16px. Read-only: there is no way to post. `No comments` when there are none.

### The Implement pane

The Implement button (accent fill, 26px tall, "Implement") sits first in the button row of every card where you are an owner, and in the story header of such a story. It opens a third card in the story's place (same 40%, same border and radius) with a 54px header (`sc-1188`, state dot, spinner while the story loads, close button that goes back to the story) and a scrolling body:

- **Title** under a dim "Implement" label (18px semibold).
- **Stepper**: Agent (Claude, Codex), Model (family: Claude's Fable, Opus, Sonnet, Haiku; Codex's Sol, Astra, Terra, Luna), Version (newest first; skipped when a family has one version, which is picked for you), Effort (the chosen model's own levels). Each step appears once the one before is chosen; all options stay visible and the chosen chip is highlighted. Changing an earlier step clears the later ones it invalidates. The last choice is remembered (`localStorage`). An agent that isn't installed is dimmed and says so. Claude's models are a table in `implement.js`; Codex's are read from `~/.codex/models_cache.json` (hidden entries skipped), with a one-model fallback.
- **Codex note** under the stepper: Codex has no Axial skills, so it works from the ticket and your prompt.
- **Branch**: Shortcut's suggested branch name with anything outside letters, digits, `_` and `-` turned into `-`; a pencil at the end edits it in place (check to save, close to cancel, empty goes back to the suggestion, an invalid name shows an error and is never rewritten).
- **Mode**: an Interactive chip (on); "Run to completion" with a "coming soon" badge, not clickable; a "Plan only, stop before coding" row with an on/off switch at the right end, off by default.
- **Prompt (optional)**: a multi-line textarea, 128px tall, with 10px side padding.
- **Footer**: error (red), warning (amber) and notice lines, then the Start button (accent when ready, grey otherwise). Start needs agent, model, version (if any) and effort, a loaded story, and no run in flight for that story; after a launch it stays disabled until the form changes.

Start does this, in order: checks the chosen agent is installed; checks `axial-api.git` and `fe-app.git` under the axial-main root are on `integration` and runs `git pull --ff-only` in each (a failure warns and tells the agent to pull in its checkout first); writes a launch brief to `~/.cache/herdr-implement/sc-<id>-<timestamp>.md`; runs `tab.new` named `sc-<id>`, in the axial-main root, with the agent's command plus its model and effort flags and a one-line first message. The brief holds the story, the branch, the rule to branch from the latest `integration` with `$AXIAL_ORCHESTRATION_ROOT/bin/create-worktree <branch>`, the Plan only line, your prompt after a blank line, and for Codex the story title and description. The first message for Claude is `/axialpower:implement-ticket sc-<id> First read the launch brief at <path> and follow it.`; for Codex it is a plain "Implement Shortcut story ..." request with the same pointer. Claude gets `--add-dir <brief folder>` placed before `--model` and `--effort`, because `--add-dir` takes any number of values and would otherwise swallow the first message that Herdr appends. The board config has one extra optional setting, `implement_root` (default `~/source/axial-main`).

### Pull requests and Sessions

- **Pull requests**: 42px header (`Pull requests`, the focused terminal's repo name, `updated 2m ago`, a refresh button), then **Mine** and **Review requested** for that repo only. Each row: a 7px CI dot (`done` passing, `blocked` failing, `working` pending), the title, `repo #123`, `draft` or the review state, and the age. Clicking opens it in the browser. Outside a GitHub repo it says so.
- **Sessions**: Claude Code and Codex sessions started in the focused repo, newest first, grouped under Today, Yesterday, This week, This month and Older, each with its program icon, title (the first prompt) and age; a running one says `running, click to show`. Clicking a running session focuses its terminal; clicking an old one resumes it in a new tab. Each row's `⋯` opens a small popup with **Copy session ID** and **Move to Trash** (confirmed; running Claude sessions can't be moved).

## How it behaves

- **Agent status** comes from Herdr's own agents list and tab bar (shipped mods): working spins, blocked and done show a dot, idle is plain.
- **View switch**: clicking a segment selects that child of the `main-view` stack (`layout.select`). Terminals keep running behind the board and come back as they were.
- **Board**: refreshes every 2 minutes and on the refresh button; the last board shows at once on start (kept in `localStorage`). `Mine` shows only cards you own. Clicking a card selects it and opens the story; clicking the selected card again does nothing; clicking anywhere else on the board (not a card, not the story pane) closes it; the close button closes it too. Clicking a relationship row opens that story. `Shortcut`, `PR #n`, `Open in Shortcut` and links in descriptions open the browser. A story is fetched when opened and reused for a minute.
- **Usage panel**: the gauges read every 3 seconds, the quota every 3 minutes. Clicking the gauges opens Activity Monitor; clicking the quota refreshes it now.
- **Pull requests**: refreshes every 2 minutes and follows the focused terminal's repo. It posts a notification when one of your PRs is approved, gets changes requested, or its checks fail.
- **Right rail**: clicking an icon shows its view in the right panel; clicking the shown one hides the panel. It also gives every new child terminal (one with a parent, such as `hc run --bg`) its own pane: the first child of a parent opens right of it, later siblings stack below, and focus goes back to where it was.

## Built from

- **Layout** `layouts/board-desk.json`, cloned from Herdr's `main`: root row of `sidebar` (column: `brand` block `workspace-chrome`; `sidebar-lists` column of `spaces` and `agents`; `usage` block `usage-limits`; `sidebar-footer` block `workspace-chrome` with props `{footer: true}`), `work` (column: `top-bar` row of `view-switch` and `tabs`; `work-body` row of the `main-view` stack (`main`: `{tab: "active"}` with the `pane` header; `board`: `shortcut-board`) and the hidden `panel` stack of `files` / `changes`; `status` block `workspace-status`), `right-panel` (stack `right-views` of `prs`: `my-prs` and `sessions`: `sessions`) and `right-rail`.
- **Shipped mods used**: `workspace-chrome`, `spaces`, `agents`, `tabs`, `pane`, `files`, `changes`, `workspace-status`.
- **`usage-limits`**: runs `sysstats.py` every 3s (macOS: CPU from `host_statistics` load ticks over 0.25s, memory as Activity Monitor's Memory Used = anonymous minus purgeable + wired + compressed pages from `vm_stat` over `hw.memsize`, GPU from `ioreg -c IOAccelerator` "Device Utilization %"; Linux: `/proc/stat` and `/proc/meminfo`, no GPU) and `fetch_usage.py` every 3 minutes, which reads Claude Code's OAuth token from the macOS keychain (`Claude Code-credentials`) and calls `https://api.anthropic.com/api/oauth/usage` (`five_hour`, `seven_day`), and reads `~/.codex/auth.json` and calls `https://chatgpt.com/backend-api/wham/usage` (primary and secondary windows), falling back to the rate limits in the newest `~/.codex/sessions/**/rollout-*.jsonl`. Tokens are only read, never refreshed. Resizes its own block with `layout.resize`. The look is adapted from chelebyy/herdr-agent-workspace's `system-windows` and `quota` mods (see NOTICE).
- **`view-switch`**: reads `layout()` for the stack's active child, `layout.select`, and `layout.resize` to make room for the macOS traffic lights when the sidebar is folded.
- **`shortcut-board`**: runs `fetch_board.py` (board) and `fetch_board.py story <id>` (one story) against the Shortcut REST API v3 (`/groups`, `/workflows`, `/stories/search`, `/stories/{id}`, `/members`, `/epics/{id}`, `/member`). Settings in `config.json` (see `config.example.json`): `team` (name, mention name or id), `columns` (state names, in order; default every non-backlog state), `token_file` (bare token or a `SHORTCUT_API_TOKEN=` line), `demo` (made-up stories, no network), `implement_root` (where Implement starts its agent). `$SHORTCUT_API_TOKEN` wins over `token_file`. Team, workflow, member and epic names are cached for a day in `~/.cache/herdr-shortcut-board.json`. Markdown through `TextView.markdown`. Bundles Inter (SIL Open Font License) and Lucide-style SVG icons.
- **`my-prs`**: `gh api graphql` search for open PRs authored by you and requesting your review; `git remote get-url origin` for the focused repo; `notify` for changes; sets shared `prs.badge`. Optional `config.json` `{"org": "..."}` limits the search to one GitHub organization.
- **`sessions`** and **`session-actions`**: `list_sessions.py` reads `~/.claude/projects`, `~/.claude/sessions`, `~/.codex/sessions` and `~/.codex/session_index.jsonl` (head and tail of each file, cached in `~/.cache/herdr-sessions.json`); resuming uses `tab.new` with `claude --resume <id>` or `codex --no-daemon resume <id>`. `trash_session.py` moves one session file to `~/.Trash/Herdr Sessions`.
- **`right-rail`**: `layout.select` / `layout.show` / `layout.hide` on `right-panel`; `auto-tile.js` watches `terminals()` and uses `terminal.keep` and `pane.focus`.

## Watch out

- The board needs `config.json` with a `team`, and a Shortcut API token (Settings, API Tokens in Shortcut). Without them it shows what is missing; set `"demo": true` to try it first.
- Herdr loads bundled fonts at start and on the next look change; after adding the mod, restart Herdr (or change the theme once) or the board falls back to the system font.
- The usage panel reads the macOS keychain, so on Linux and Windows the Claude rows show `not signed in`, and the GPU gauge only works on macOS (Apple silicon or any GPU exposing IOAccelerator statistics). Codex works anywhere `~/.codex/auth.json` exists. These are undocumented endpoints and may change.
- Pull requests needs `gh` signed in; Sessions moves files to the macOS Trash.
- Herdr's built-in scrollbar can't be styled, so the board's columns and the story pane scroll themselves (`on_scroll_wheel`, content moved with a negative `top`) to draw a rounded thumb. The sideways scrollbar under the columns is still Herdr's.
- Sizes measured with `on_size_change` arrive after the first layout, so the first frame lays out at a default and corrects itself.
- Card widths come from the whole board width plus any open `right-panel` (and its 1px divider) or `panel` (and its 8px gap), never from the 60% left when a story is open; otherwise cards shrink whenever something opens beside the board.
- A reply comment must not set `w_full()`: with its 16px indent it would push out of the pane.
- The view switch and usage panel call `layout.resize` on their own blocks; changing those block ids in the layout breaks it.

## Done when

- The Terminals / Board switch flips the main area between the active tab's panes and the board, and the terminals are untouched when you come back.
- With `"demo": true`, the board shows six columns (Unstarted to Accepted) of made-up stories; a blocked card has a red border, features yellow, chores grey.
- Clicking a card fills it with its border color and opens the story pane at 40%, with the description, two relationships and two comments (the second indented); card widths don't change.
- Clicking empty board space closes the pane; clicking the selected card again keeps it.
- Scrolling a long column shows a rounded thumb beside the cards that fades out after a second.
- With a real `team` and token, the header shows that team's name and the columns match `columns`.
- The usage panel shows CPU, RAM and GPU with mini graphs that grow every 3 seconds, then Claude 5 h, Claude 7 days and Codex 7 days rows with colored bars and time left, and the block is exactly tall enough.
- The right rail toggles Pull requests and Sessions, and its badge counts PRs waiting for your review.
- A card you own shows an Implement button; clicking it opens the Implement pane at 40% with the stepper, the branch (with a pencil), Interactive, Plan only and the optional prompt. Start stays disabled until every step is chosen.
- Pressing Start opens a new `sc-<id>` tab in the axial-main folder, with the chosen agent, model and effort, whose first message points at a launch brief in `~/.cache/herdr-implement/`.
