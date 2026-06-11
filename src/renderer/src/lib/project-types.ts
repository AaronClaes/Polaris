import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../../main/trpc/router'

type RouterOutputs = inferRouterOutputs<AppRouter>

/** A project with its action groups, actions, and linked repos, as returned by `projects.list`. */
export type ProjectWithActions = RouterOutputs['projects']['list'][number]
export type ProjectActionRow = ProjectWithActions['actions'][number]
export type ActionGroupRow = ProjectWithActions['groups'][number]
/** A GitHub repo linked to a project (the stored snapshot). */
export type ProjectRepoRow = ProjectWithActions['repos'][number]

/** A linked GitHub owner, as returned by `github.listAccounts`. */
export type GithubAccountRow = RouterOutputs['github']['listAccounts'][number]
/** An installed Chromium browser available to link, from `browsers.listInstalled`. */
export type InstalledBrowserRow = RouterOutputs['browsers']['listInstalled'][number]
/** A linked browser with its profiles, as returned by `browsers.listLinked`. */
export type LinkedBrowserRow = RouterOutputs['browsers']['listLinked'][number]
/** A repo the linked tokens can reach, as returned by `github.listRepos`. */
export type GithubRepoRow = RouterOutputs['github']['listRepos']['repos'][number]
/** An open issue (with its assignment bucket), as returned by `github.issuesForRepo`. */
export type IssueRow = RouterOutputs['github']['issuesForRepo']['issues'][number]
/** An open pull request (with its bucket), as returned by `github.pullsForRepo`. */
export type PullRequestRow = RouterOutputs['github']['pullsForRepo']['pulls'][number]
/** A per-project note, as returned by `notes.list`. */
export type NoteRow = RouterOutputs['notes']['list'][number]
/** The stored ProseMirror/TipTap document (the note's `body`). */
export type NoteDoc = NoteRow['body']
/** A project todo, as returned by `todos.list`. */
export type TodoRow = RouterOutputs['todos']['list'][number]
/** A todo plus its owning project, as returned by `todos.listAll` (global view). */
export type GlobalTodoRow = RouterOutputs['todos']['listAll'][number]
