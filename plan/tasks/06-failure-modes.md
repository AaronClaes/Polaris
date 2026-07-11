# Task 6 — Failure modes + polish

**Tracer goal:** every way creation can be blocked or half-fail reads clearly in
the dialog, and the "branch exists but no worktree" state is a first-class,
recoverable state — not a mystery.

## Scope

In: the failure UX for everything Tasks 2–5 left rough. Out: new capability.

## Failure matrix

| Situation | Behavior |
|---|---|
| Token lacks Contents: write | Dialog error naming the owner: "the token for X can't create branches — update its permissions". No local fallback. |
| Repo has no local path / path missing on disk | Dialog blocked with a pointer to the repo's settings (where `setRepoPath` lives). No auto-clone. |
| GitHub branch created, local `worktree add` failed (dirty clone, collision, network) | Branch stays. Error shown with the git output. The issue row now shows "branch, no worktree" — its create affordance offers the existing-branch mode (Task 5's PR path) as the retry, prefilled. |
| Target worktree path already occupied | Detected in `creationInfo` → dialog warns before submit rather than failing after the GitHub write. |
| Branch name collides with an existing ref | Same: check against the refs list already fetched for the base-branch select; inline validation on the name input. |
| `git`/shell fails wholesale (bad clone, no git) | Error banner with the raw stderr — never silent. |

## Implementation notes

- `creationInfo` becomes the single preflight: token scope (cheap probe or
  surfaced on first failure — prefer reporting from the actual mutation error to
  avoid an extra API call), clone path validity, existing refs, occupied paths.
  The dialog renders blockers inline and disables submit.
- Map the GraphQL error codes (`FORBIDDEN` / missing scope) to the friendly
  token message; everything else shows the underlying message plus context.
- Loading/pending states: create button spinner, popover actions disabled while
  a mutation runs, query invalidations after create/remove (some of this exists
  from earlier tasks — sweep it for consistency).
- Sweep: sanitization edge cases (branch names that collapse to empty →
  fall back to `issue-<number>`), long names truncated in the popover with
  tooltips, dark/light rendering of the new components.

## Validation

1. Revoke write on a token (or use a read-only one) → create fails with the
   named-owner message; nothing created locally.
2. Unset a repo's path → dialog blocks and links to repo settings.
3. Pre-create the target folder → dialog warns before any GitHub write.
4. Force a local failure after branch creation (e.g. make the root read-only)
   → error shown; row shows branch-without-worktree; retry via the create
   affordance succeeds after fixing permissions.
5. Try a branch name that already exists → inline validation, submit disabled.
