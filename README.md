# Polaris

A personal macOS command center for managing dev projects — GitHub issues/PRs,
environment quicklinks, and launching terminal/IDE/Claude sessions in the right
folder.

> **Status:** scaffolding. The architecture and every layer are wired together
> and proven end-to-end by a single vertical slice (the **Project** entity).
> Real features (GitHub, AI, secrets-backed auth) are stubbed.

## Stack

| Concern               | Choice                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell                 | [Electron](https://www.electronjs.org/) on [electron-vite](https://electron-vite.org/) (React + TypeScript)                                                                                                  |
| Routing / async state | [TanStack Router](https://tanstack.com/router) (hash history) + [TanStack Query](https://tanstack.com/query)                                                                                                 |
| Local UI state        | [Zustand](https://zustand.docs.pmnd.rs/)                                                                                                                                                                     |
| Typed IPC             | [tRPC v11](https://trpc.io/) over IPC via [`electron-trpc-experimental`](https://github.com/makp0/electron-trpc-experimental) + [Zod](https://zod.dev/) + [superjson](https://github.com/blitz-js/superjson) |
| Persistence           | [Drizzle ORM](https://orm.drizzle.team/) + drizzle-kit over [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)                                                                                     |
| UI components         | [coss UI](https://coss.com/ui) (Base UI) + [Tailwind CSS v4](https://tailwindcss.com/)                                                                                                                       |
| Lint / format         | [Biome](https://biomejs.dev/)                                                                                                                                                                                |
| Packaging             | [electron-builder](https://www.electron.build/) (macOS, no notarization)                                                                                                                                     |
| Package manager       | [pnpm](https://pnpm.io/)                                                                                                                                                                                     |

## Architecture

```
src/
  main/                 Electron main process (Node)
    index.ts            window, app lifecycle, IPC handler, global shortcut
    db/                 drizzle schema + better-sqlite3 client + startup migrator
    trpc/               initTRPC + context, appRouter, routers/ (projects, system)
    services/           github (stub), system-launcher (execa), secrets (safeStorage)
  preload/              contextBridge: exposes the electron-trpc link + a tiny api
  renderer/src/         React app (Vite)
    lib/                trpc client, query client, router
    routes/             TanStack Router routes (__root, index = Projects)
    components/         command-palette + coss UI primitives (components/ui)
    stores/             Zustand UI store
drizzle/                generated SQL migrations (shipped as an app resource)
```

**Typed IPC.** The main process defines an `appRouter` (`src/main/trpc/router.ts`)
exposed over Electron IPC by `createIPCHandler`. The renderer consumes it with a
typed `createTRPCReact<AppRouter>()` client wired into TanStack Query — the
`AppRouter` type is imported **type-only**, so no main-process code leaks into the
renderer bundle. superjson is configured on **both** ends so `Date`s (e.g. a
project's `createdAt`) survive the JSON IPC transport.

**Secrets.** `services/secrets.ts` wraps Electron `safeStorage` (Keychain-backed).
Tokens are encrypted there and never stored as plaintext in SQLite. Stubbed
in-memory for now.

**Native module.** better-sqlite3 is a native addon, kept external from the main
bundle. Its own `prebuild-install` (which fetches a plain-Node-ABI binary Electron
can't load) is disabled in `pnpm-workspace.yaml`; instead the `postinstall` script
force-rebuilds it from source against Electron's ABI (`electron-rebuild -f`). execa,
by contrast, is ESM-only and is **bundled** into the CJS main output.

**Launching the editor.** `system.openInEditor` uses `open -a Cursor <path>`
(Launch Services), **not** a bare `cursor`/`code`. A packaged `.app` launched from
Finder/Dock gets a stripped `PATH` that can't resolve those CLIs — `open` is
PATH-independent, so it works in both `pnpm dev` and the shipped app.

## Prerequisites

- Node 22+, pnpm 11+
- macOS with Xcode Command Line Tools (for the native better-sqlite3 build)
- [Cursor](https://cursor.com/) installed (for the "Open in editor" action)

## Scripts

| Command                                    | What it does                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `pnpm install`                             | Installs deps and rebuilds better-sqlite3 for Electron (postinstall).   |
| `pnpm dev`                                 | Launches the app with HMR (Vite renderer + Electron main).              |
| `pnpm build`                               | Typechecks, then bundles main/preload/renderer (`electron-vite build`). |
| `pnpm build:mac`                           | `build` + packages a macOS `.app`/`.dmg` into `dist/`.                  |
| `pnpm build:unpack`                        | `build` + an unpacked `.app` (faster, no dmg) for quick checks.         |
| `pnpm typecheck`                           | Typechecks the node (main/preload) and web (renderer) projects.         |
| `pnpm db:generate`                         | Generates SQL migrations from the drizzle schema into `drizzle/`.       |
| `pnpm db:studio`                           | Opens Drizzle Studio against the dev database.                          |
| `pnpm lint` / `pnpm format` / `pnpm check` | Biome lint / format / lint+format+assist.                               |
| `pnpm rebuild`                             | Manually rebuild better-sqlite3 against Electron's ABI.                 |

## Database & migrations

The SQLite file lives in Electron's per-user data dir
(`~/Library/Application Support/polaris/polaris.db` in dev). Override with
`POLARIS_DB_PATH` — `drizzle.config.ts` reads the same variable so `db:studio`
points at the same file.

Workflow after changing `src/main/db/schema.ts`:

1. `pnpm db:generate` — writes a new migration into `drizzle/`.
2. Start the app — migrations are applied automatically on boot
   (`src/main/db/migrate.ts`). When packaged, the `drizzle/` folder ships as an
   electron-builder `extraResource`.

## Notes

- **pnpm build scripts:** pnpm 11 gates dependency build scripts in
  `pnpm-workspace.yaml` (`allowBuilds`). electron and esbuild are allowed;
  better-sqlite3 is deliberately disabled there and rebuilt for Electron by the
  `postinstall` script instead (see the Native module note above).
- **coss UI:** primitives live in `src/renderer/src/components/ui` (added via
  `pnpm dlx shadcn@latest add @coss/ui`, configured in `components.json`). They
  are excluded from Biome to avoid churn on vendored code.

## Command palette

Press <kbd>⌘⇧P</kbd> (a global shortcut, registered in the main process) or
<kbd>⌘K</kbd> while focused to open the coss command palette. It ships with one
placeholder command.
