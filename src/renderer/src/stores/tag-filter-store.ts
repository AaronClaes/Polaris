import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Which tags are turned OFF in the header. Modeled as the disabled set (not the
 * enabled one) so a freshly created tag is visible by default — a tag is on
 * unless its id is listed here. Persisted to localStorage so the chosen focus
 * (e.g. "personal off") survives a restart. A stale id left after a tag is
 * deleted is harmless: it simply matches no project.
 */
interface TagFilterState {
  disabledTagIds: number[]
  /** Flip one tag between shown and hidden. */
  toggle: (tagId: number) => void
  /** Set a tag explicitly on (enabled) or off (disabled). */
  setEnabled: (tagId: number, enabled: boolean) => void
}

export const useTagFilterStore = create<TagFilterState>()(
  persist(
    (set) => ({
      disabledTagIds: [],
      toggle: (tagId) =>
        set((state) => ({
          disabledTagIds: state.disabledTagIds.includes(tagId)
            ? state.disabledTagIds.filter((id) => id !== tagId)
            : [...state.disabledTagIds, tagId]
        })),
      setEnabled: (tagId, enabled) =>
        set((state) => ({
          disabledTagIds: enabled
            ? state.disabledTagIds.filter((id) => id !== tagId)
            : state.disabledTagIds.includes(tagId)
              ? state.disabledTagIds
              : [...state.disabledTagIds, tagId]
        }))
    }),
    { name: 'polaris-tag-filter' }
  )
)
