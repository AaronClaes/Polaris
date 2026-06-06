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
  IconMail,
  IconMessageCircle,
  IconNote,
  IconPalette,
  IconPlanet,
  IconRocket,
  IconServer,
  IconSettings,
  IconShoppingCart,
  IconStar,
  IconTerminal2,
  IconUsers,
  IconWorld,
  type TablerIcon
} from '@tabler/icons-react'

/**
 * Curated subset of Tabler icons projects can pick from. A project stores the
 * `key`; lookups resolve to the component. This is a deliberately small,
 * good-looking starter set — a full searchable picker can come later.
 */
export interface ProjectIcon {
  key: string
  label: string
  Icon: TablerIcon
}

export const PROJECT_ICONS: readonly ProjectIcon[] = [
  { key: 'folder', label: 'Folder', Icon: IconFolder },
  { key: 'rocket', label: 'Rocket', Icon: IconRocket },
  { key: 'code', label: 'Code', Icon: IconCode },
  { key: 'terminal', label: 'Terminal', Icon: IconTerminal2 },
  { key: 'world', label: 'World', Icon: IconWorld },
  { key: 'github', label: 'GitHub', Icon: IconBrandGithub },
  { key: 'database', label: 'Database', Icon: IconDatabase },
  { key: 'server', label: 'Server', Icon: IconServer },
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

const ICONS_BY_KEY = new Map(PROJECT_ICONS.map((icon) => [icon.key, icon]))

/** Resolve an icon key, falling back to the default for unknown keys. */
export function getProjectIcon(key: string): ProjectIcon {
  return ICONS_BY_KEY.get(key) ?? ICONS_BY_KEY.get(DEFAULT_ICON_KEY) ?? PROJECT_ICONS[0]
}
