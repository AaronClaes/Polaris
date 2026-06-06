/**
 * Predefined project accent colors. A project stores the `key`; rendering uses
 * `hex` (full strength for the glyph, low-opacity for its tinted backdrop). A
 * curated palette keeps choices consistent and good-looking.
 */
export interface ProjectColor {
  key: string
  name: string
  hex: string
}

export const PROJECT_COLORS: readonly ProjectColor[] = [
  { key: 'slate', name: 'Slate', hex: '#64748b' },
  { key: 'red', name: 'Red', hex: '#ef4444' },
  { key: 'orange', name: 'Orange', hex: '#f97316' },
  { key: 'amber', name: 'Amber', hex: '#f59e0b' },
  { key: 'green', name: 'Green', hex: '#22c55e' },
  { key: 'teal', name: 'Teal', hex: '#14b8a6' },
  { key: 'blue', name: 'Blue', hex: '#3b82f6' },
  { key: 'indigo', name: 'Indigo', hex: '#6366f1' },
  { key: 'violet', name: 'Violet', hex: '#8b5cf6' },
  { key: 'pink', name: 'Pink', hex: '#ec4899' }
]

export const DEFAULT_COLOR_KEY = 'blue'

const COLORS_BY_KEY = new Map(PROJECT_COLORS.map((color) => [color.key, color]))

/** Resolve a color key, falling back to the default for unknown keys. */
export function getColor(key: string): ProjectColor {
  return COLORS_BY_KEY.get(key) ?? COLORS_BY_KEY.get(DEFAULT_COLOR_KEY) ?? PROJECT_COLORS[0]
}
