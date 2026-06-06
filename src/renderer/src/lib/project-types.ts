import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../../main/trpc/router'

type RouterOutputs = inferRouterOutputs<AppRouter>

/** A project with its action groups and actions, as returned by `projects.list`. */
export type ProjectWithActions = RouterOutputs['projects']['list'][number]
export type ProjectActionRow = ProjectWithActions['actions'][number]
export type ActionGroupRow = ProjectWithActions['groups'][number]
