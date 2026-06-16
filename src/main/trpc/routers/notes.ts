import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { type NoteDoc, notes, projects } from '../../db/schema'
import { publicProcedure, router } from '..'

// A fresh note starts as an empty TipTap document (a single empty paragraph).
const emptyDoc: NoteDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

// The owning project, joined into the global list so each row can show which
// project it belongs to (null for an unlinked note).
const projectRef = {
  id: projects.id,
  name: projects.name,
  icon: projects.icon,
  color: projects.color
}

// The persisted editor document. Validated structurally (a non-null, non-array
// object with a `type`) rather than fully — the renderer owns the real schema.
const noteBody = z.custom<NoteDoc>(
  (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && 'type' in value,
  'Invalid note document'
)

export const notesRouter = router({
  // A project's notes, pinned first, then most-recently-edited. Bodies are
  // included so the editor can open a note without a second round-trip; the
  // list is loaded lazily (only when the Notes tab is open), so it stays cheap.
  list: publicProcedure
    .input(z.object({ projectId: z.number().int() }))
    .query(({ ctx, input }) =>
      ctx.db
        .select()
        .from(notes)
        .where(eq(notes.projectId, input.projectId))
        .orderBy(desc(notes.pinned), desc(notes.updatedAt))
        .all()
    ),

  // Every note, each tagged with its owning project — for the global "All notes"
  // view. A left join so unlinked notes (null `projectId`) are included too, with
  // a null `project`. Bodies are included (same as `list`) so the editor can open
  // a selected note without a second round-trip.
  listAll: publicProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        id: notes.id,
        projectId: notes.projectId,
        title: notes.title,
        body: notes.body,
        plaintext: notes.plaintext,
        pinned: notes.pinned,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
        project: projectRef
      })
      .from(notes)
      .leftJoin(projects, eq(notes.projectId, projects.id))
      .orderBy(desc(notes.pinned), desc(notes.updatedAt))
      .all()
  ),

  create: publicProcedure
    // Null (or omitted) creates an unlinked note — see the schema note.
    .input(z.object({ projectId: z.number().int().nullable().optional() }))
    .mutation(({ ctx, input }) =>
      ctx.db
        .insert(notes)
        .values({ projectId: input.projectId ?? null, title: '', body: emptyDoc, plaintext: '' })
        .returning()
        .get()
    ),

  // Persist an edit: store the document plus its denormalized title/plaintext,
  // and bump `updatedAt` so the note floats to the top of the recency sort.
  update: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        title: z.string(),
        body: noteBody,
        plaintext: z.string()
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...values } = input
      return ctx.db
        .update(notes)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(notes.id, id))
        .returning()
        .get()
    }),

  // (Re)file a note under a project, or unlink it (null). Like `setPinned`, this
  // leaves `updatedAt` alone — moving a note isn't a content edit, so it shouldn't
  // reorder it within the recency sort.
  setProject: publicProcedure
    .input(z.object({ id: z.number().int(), projectId: z.number().int().nullable() }))
    .mutation(({ ctx, input }) =>
      ctx.db
        .update(notes)
        .set({ projectId: input.projectId })
        .where(eq(notes.id, input.id))
        .returning()
        .get()
    ),

  // Pin/unpin. Deliberately leaves `updatedAt` alone — pinning isn't an edit, so
  // it shouldn't reorder the note within its group.
  setPinned: publicProcedure
    .input(z.object({ id: z.number().int(), pinned: z.boolean() }))
    .mutation(({ ctx, input }) =>
      ctx.db
        .update(notes)
        .set({ pinned: input.pinned })
        .where(eq(notes.id, input.id))
        .returning()
        .get()
    ),

  delete: publicProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => {
    ctx.db.delete(notes).where(eq(notes.id, input.id)).run()
    return { id: input.id }
  })
})
