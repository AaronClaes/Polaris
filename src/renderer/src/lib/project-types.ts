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
/** A repo the linked tokens can reach, as returned by `github.listRepos`. */
export type GithubRepoRow = RouterOutputs['github']['listRepos']['repos'][number]
