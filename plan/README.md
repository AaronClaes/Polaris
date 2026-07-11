# Worktrees from issues — implementation plan

Polaris creates git worktrees from GitHub issues/PRs and hands off: you open the
worktree in your terminal/IDE and start Claude yourself. Polaris never runs the
work — it is the dispatcher, not the workspace.

Full design rationale was settled in the 2026-07-11 grill session. The decisions
that shape everything:

- **State is fully derived — no worktree tables.** Issue → branches comes from
  GitHub (`linkedBranches`, already synced); branch → worktree comes from
  `git worktree list` on the repo's local clone. Everything keys on **branches**,
  not items, so fused issue/PR rows, duplicate prevention and externally created
  worktrees all fall out for free. Only *config* persists: the global worktrees
  root and per-repo setup recipes.
- **GitHub is the source of truth for issue↔branch.** Creation goes through the
  `createLinkedBranch` mutation (shows in the issue's Development panel; the
  existing sync picks it up). PATs need Contents: write; no local-only fallback.
- **Disk layout:** `<root>/<owner>/<repo>/<branch-sanitized>`, root a global
  setting defaulting to `~/polaris/worktrees`.
- **Creation dialog:** pre-derived editable branch name (`123-slug`), base branch
  (default preselected), resulting-path preview, setup-recipe select (single
  choice + None, last-used preselected). Designed to later grow "open IDE" /
  "launch Claude" checkboxes — not in v1.
- **Setup recipes:** ordered list of named `{label, command}` per linked repo.
  Chosen recipe runs after creation via the login-shell pattern
  (`$SHELL -ilc`, cwd = new worktree, env `REPO_PATH` / `WORKTREE_PATH` /
  `BRANCH` / `ISSUE_NUMBER`). A failing recipe still counts as created.
- **Surfacing:** per-row only — issues table + tasks feed (issues/PRs). No
  worktree → hover "Create worktree…"; exists → persistent glyph opening a
  popover (branch, path, Open in IDE / Terminal / Finder via the global default
  apps, Remove). Remove blocks on dirty state and only ever deletes the folder —
  branches always survive.
- **PR rows:** create = fetch + worktree the existing head branch (no GitHub
  write). Fork PRs get no worktree option.
- **Failure posture:** half-failure (GitHub branch created, local add failed)
  keeps the branch — the derived model renders "branch without worktree" as a
  legitimate state and creation from an existing branch is the retry. Missing
  token scope or missing local clone path block with clear errors (no
  auto-clone).
- **Deferred (post-v1):** worktrees overview tab, stale-worktree nudges,
  post-create checkboxes, running project actions inside worktrees.

## Tracer-bullet tasks

Each task cuts main → tRPC → renderer and ends with something you can validate
in the running dev app before the next slice starts.

| # | Task | Validates |
|---|------|-----------|
| 1 | [Derived read path](tasks/01-derived-read-path.md) | The whole state model, before any write code exists |
| 2 | [Creation happy path](tasks/02-creation-happy-path.md) | GitHub-linked branch → local worktree, end to end |
| 3 | [Popover launchers + remove](tasks/03-launchers-and-remove.md) | The daily-driver loop: open in IDE/terminal, clean up |
| 4 | [Setup recipes](tasks/04-setup-recipes.md) | Config storage/UI + post-create environment prep |
| 5 | [Tasks feed + PR rows](tasks/05-feed-and-prs.md) | Branch-keyed resolution across both surfaces |
| 6 | [Failure modes + polish](tasks/06-failure-modes.md) | Every blocked/half-failed path reads clearly |

## Working agreement

- After each task: `typecheck` + Biome + `electron-vite build` green, then Aaron
  validates in the dev app (Electron GUI is not verifiable from Claude's env).
- Commit only via `/commit`, one commit per validated task.
- Biome style throughout: single quotes, no semicolons, line width 100.
