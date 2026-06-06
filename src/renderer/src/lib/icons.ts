import {
  IconApi,
  IconBolt,
  IconBook,
  IconBox,
  IconBrandDocker,
  IconBrandFigma,
  IconBrandGithub,
  IconBrandNextjs,
  IconBrandReact,
  IconBrandSlack,
  IconBrandVercel,
  IconBriefcase,
  IconBug,
  IconBuildingStore,
  IconChartBar,
  IconCloud,
  IconCode,
  IconCpu,
  IconDatabase,
  IconDeviceLaptop,
  IconFlask,
  IconFolder,
  IconHome,
  IconKey,
  IconLayoutDashboard,
  IconLink,
  IconMail,
  IconMessageCircle,
  IconNote,
  IconPalette,
  IconPlanet,
  IconRocket,
  IconServer,
  IconSettings,
  IconShoppingCart,
  IconStack2,
  IconStar,
  IconTerminal2,
  IconUsers,
  IconWorld,
  type TablerIcon
} from '@tabler/icons-react'

/**
 * Curated subset of Tabler icons that projects, action groups, and actions can
 * all pick from. The entity stores the `key`; lookups resolve to the component.
 * A deliberately small, good-looking starter set — a full searchable picker can
 * come later.
 */
export interface IconOption {
  key: string
  label: string
  Icon: TablerIcon
}

export const ICONS: readonly IconOption[] = [
  { key: 'folder', label: 'Folder', Icon: IconFolder },
  { key: 'rocket', label: 'Rocket', Icon: IconRocket },
  { key: 'code', label: 'Code', Icon: IconCode },
  { key: 'terminal', label: 'Terminal', Icon: IconTerminal2 },
  { key: 'link', label: 'Link', Icon: IconLink },
  { key: 'world', label: 'World', Icon: IconWorld },
  { key: 'github', label: 'GitHub', Icon: IconBrandGithub },
  { key: 'database', label: 'Database', Icon: IconDatabase },
  { key: 'server', label: 'Server', Icon: IconServer },
  { key: 'stack', label: 'Stack', Icon: IconStack2 },
  { key: 'box', label: 'Box', Icon: IconBox },
  { key: 'bolt', label: 'Bolt', Icon: IconBolt },
  { key: 'star', label: 'Star', Icon: IconStar },
  { key: 'home', label: 'Home', Icon: IconHome },
  { key: 'briefcase', label: 'Briefcase', Icon: IconBriefcase },
  { key: 'bug', label: 'Bug', Icon: IconBug },
  { key: 'cloud', label: 'Cloud', Icon: IconCloud },
  { key: 'laptop', label: 'Laptop', Icon: IconDeviceLaptop },
  { key: 'api', label: 'API', Icon: IconApi },
  { key: 'react', label: 'React', Icon: IconBrandReact },
  { key: 'vercel', label: 'Vercel', Icon: IconBrandVercel },
  { key: 'nextjs', label: 'Next.js', Icon: IconBrandNextjs },
  { key: 'docker', label: 'Docker', Icon: IconBrandDocker },
  { key: 'figma', label: 'Figma', Icon: IconBrandFigma },
  { key: 'slack', label: 'Slack', Icon: IconBrandSlack },
  { key: 'palette', label: 'Palette', Icon: IconPalette },
  { key: 'book', label: 'Book', Icon: IconBook },
  { key: 'flask', label: 'Flask', Icon: IconFlask },
  { key: 'dashboard', label: 'Dashboard', Icon: IconLayoutDashboard },
  { key: 'store', label: 'Store', Icon: IconBuildingStore },
  { key: 'cart', label: 'Cart', Icon: IconShoppingCart },
  { key: 'message', label: 'Message', Icon: IconMessageCircle },
  { key: 'mail', label: 'Mail', Icon: IconMail },
  { key: 'users', label: 'Users', Icon: IconUsers },
  { key: 'settings', label: 'Settings', Icon: IconSettings },
  { key: 'chart', label: 'Chart', Icon: IconChartBar },
  { key: 'key', label: 'Key', Icon: IconKey },
  { key: 'planet', label: 'Planet', Icon: IconPlanet },
  { key: 'cpu', label: 'CPU', Icon: IconCpu },
  { key: 'note', label: 'Note', Icon: IconNote }
]

export const DEFAULT_ICON_KEY = 'folder'
/** Default glyph for a freshly created action group. */
export const DEFAULT_GROUP_ICON_KEY = 'stack'

const ICONS_BY_KEY = new Map(ICONS.map((icon) => [icon.key, icon]))

/** Resolve an icon key, falling back to the default for unknown keys. */
export function getIcon(key: string): IconOption {
  return ICONS_BY_KEY.get(key) ?? ICONS_BY_KEY.get(DEFAULT_ICON_KEY) ?? ICONS[0]
}
