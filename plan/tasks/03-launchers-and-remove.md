# Task 3 — Popover launchers + remove

**Tracer goal:** the daily loop closes — from the glyph popover you open a
worktree in your IDE/terminal/Finder and, when done, remove it from Polaris.

## Scope

In: the three launchers, remove with dirty-state block. Out: any project-action
integration (explicitly rejected for v1 — launchers use the global default apps
only), stale nudges.

## Implementation

**Launchers**
- Reuse `runOpenApp` / `resolveTerminal` / `resolveIde` from
  `services/action-runner.ts` + `services/default-apps.ts` with cwd = the
  worktree path. Router mutation `open({ path, target: 'terminal'|'ide'|'finder' })`
  — thin wrapper, no new service code beyond an export if something is private.
- Popover rows: Open in <IDE name> / Open in <Terminal name> / Reveal in Finder
  (names + icons from the existing default-apps queries, same as the actions UI).

**Remove**
- `removeWorktree({ repoPath, worktreePath })` in the worktrees service:
  1. Dirty check: `git -C <worktree> status --porcelain` non-empty → refuse.
     Also refuse on unpushed commits (`git -C <worktree> log @{u}.. --oneline`;
     treat a missing upstream as "has unpushed work" — safer default).
  2. `git worktree remove <worktreePath>` (never `--force`).
  Branches — local and remote — are never touched.
- Popover "Remove worktree" with a confirm step (reuse the vendored confirm
  dialog if one exists; otherwise a simple two-click confirm). Blocked case
  shows the reason ("uncommitted changes — clean up in your terminal").

## Validation

1. Open in IDE / Terminal / Finder each land in the worktree directory using
   your configured default apps.
2. Remove on a clean worktree: folder gone, glyph gone, branch still on GitHub
   and in `git branch`.
3. Touch a file in the worktree → remove is blocked with the dirty message;
   commit it without pushing → still blocked (unpushed).
