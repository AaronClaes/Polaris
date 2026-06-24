import { router } from '.'
import { actionsRouter } from './routers/actions'
import { browsersRouter } from './routers/browsers'
import { dialogRouter } from './routers/dialog'
import { emailBlocklistRouter } from './routers/email-blocklist'
import { emailContactsRouter } from './routers/email-contacts'
import { faviconRouter } from './routers/favicon'
import { githubRouter } from './routers/github'
import { gmailRouter } from './routers/gmail'
import { googleRouter } from './routers/google'
import { groupsRouter } from './routers/groups'
import { notesRouter } from './routers/notes'
import { projectsRouter } from './routers/projects'
import { settingsRouter } from './routers/settings'
import { tagsRouter } from './routers/tags'
import { todosRouter } from './routers/todos'
import { toolsRouter } from './routers/tools'
import { trackedItemsRouter } from './routers/tracked-items'

export const appRouter = router({
  projects: projectsRouter,
  groups: groupsRouter,
  actions: actionsRouter,
  github: githubRouter,
  google: googleRouter,
  gmail: gmailRouter,
  favicon: faviconRouter,
  browsers: browsersRouter,
  dialog: dialogRouter,
  notes: notesRouter,
  todos: todosRouter,
  tags: tagsRouter,
  settings: settingsRouter,
  emailContacts: emailContactsRouter,
  emailBlocklist: emailBlocklistRouter,
  trackedItems: trackedItemsRouter,
  tools: toolsRouter
})

// Consumed type-only by the renderer for a fully typed IPC client.
export type AppRouter = typeof appRouter
