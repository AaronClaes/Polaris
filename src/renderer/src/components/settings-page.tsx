import { IconPlug, IconSettings, IconX, type TablerIcon } from '@tabler/icons-react'
import { useRouter } from '@tanstack/react-router'
import { type ReactElement, type ReactNode, useEffect, useState } from 'react'
import { AppIconImg } from '@/components/action-icon'
import { BrowsersIntegration } from '@/components/browsers-integration'
import { GitHubIntegration } from '@/components/github-integration'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Select, SelectItem, SelectPopup, SelectTrigger } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { THEME_OPTIONS, type Theme, useTheme } from '@/lib/theme'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

interface SettingsSection {
  id: string
  label: string
  Icon: TablerIcon
  render: () => ReactElement
}

/** Shared placeholder layout for a settings panel. */
function PanelPlaceholder({
  title,
  description,
  children
}: {
  title: string
  description: string
  children?: ReactNode
}): ReactElement {
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h2 className="font-heading font-semibold text-xl tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children}
    </div>
  )
}

/** Segmented Light / Dark / Auto picker, bound to the global theme store. */
function ThemeToggle(): ReactElement {
  const [theme, setTheme] = useTheme()
  return (
    <ToggleGroup
      variant="outline"
      value={[theme]}
      // Ignore the empty array (clicking the active item) so one is always set.
      onValueChange={(next) => {
        if (next[0]) setTheme(next[0] as Theme)
      }}
      aria-label="Theme"
    >
      {THEME_OPTIONS.map(({ value, label, Icon }) => (
        <ToggleGroupItem key={value} value={value}>
          <Icon />
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** One default-app row: a title/description and a dropdown to pick the app. */
function DefaultAppRow({
  title,
  description,
  options,
  value,
  onChange
}: {
  title: string
  description: string
  options: { key: string; name: string }[]
  value: string | undefined
  onChange: (key: string) => void
}): ReactElement {
  const selected = options.find((option) => option.key === value)
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="grid gap-0.5">
          <CardTitle className="text-sm">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Select value={value ?? null} onValueChange={(next) => next && onChange(next)}>
          <SelectTrigger className="w-52">
            <span className="flex items-center gap-2 truncate">
              {selected && <AppIconImg appKey={selected.key} size={18} />}
              {selected?.name ?? 'Select…'}
            </span>
          </SelectTrigger>
          <SelectPopup>
            {options.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                <span className="flex items-center gap-2 truncate">
                  <AppIconImg appKey={option.key} size={18} />
                  {option.name}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </CardContent>
    </Card>
  )
}

/** Default terminal + IDE pickers. These drive the "Terminal" / "IDE" actions,
 *  which open a project's directory in the chosen app without a stored command. */
function DefaultAppsSection(): ReactElement {
  const utils = trpc.useUtils()
  const { data } = trpc.settings.defaultApps.useQuery()
  const setDefaultApp = trpc.settings.setDefaultApp.useMutation({
    onSuccess: () => utils.settings.defaultApps.invalidate()
  })

  return (
    <section className="grid gap-3">
      <h3 className="font-medium text-sm">Default apps</h3>
      <DefaultAppRow
        title="Terminal"
        description="Opened by Terminal actions."
        options={data?.terminals ?? []}
        value={data?.terminal}
        onChange={(key) => setDefaultApp.mutate({ kind: 'terminal', key })}
      />
      <DefaultAppRow
        title="IDE"
        description="Opened by IDE actions."
        options={data?.ides ?? []}
        value={data?.ide}
        onChange={(key) => setDefaultApp.mutate({ kind: 'ide', key })}
      />
    </section>
  )
}

function GeneralPanel(): ReactElement {
  return (
    <PanelPlaceholder title="General" description="App-wide preferences.">
      <section className="grid gap-3">
        <h3 className="font-medium text-sm">Appearance</h3>
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="grid gap-0.5">
              <CardTitle className="text-sm">Theme</CardTitle>
              <CardDescription>Auto follows your system setting.</CardDescription>
            </div>
            <ThemeToggle />
          </CardContent>
        </Card>
      </section>
      <DefaultAppsSection />
    </PanelPlaceholder>
  )
}

function IntegrationsPanel(): ReactElement {
  return (
    <PanelPlaceholder
      title="Integrations"
      description="Connect external services so Polaris can pull in your work."
    >
      <div className="grid gap-4">
        <GitHubIntegration />
        <BrowsersIntegration />
      </div>
    </PanelPlaceholder>
  )
}

const SECTIONS: SettingsSection[] = [
  { id: 'general', label: 'General', Icon: IconSettings, render: GeneralPanel },
  {
    id: 'integrations',
    label: 'Integrations',
    Icon: IconPlug,
    render: IntegrationsPanel
  }
]

/**
 * Full-screen settings: a draggable title bar, a vertical section menu, and the
 * active section's panel. Mounted outside the sidebar layout.
 */
export function SettingsPage(): ReactElement {
  const router = useRouter()
  const [activeId, setActiveId] = useState(SECTIONS[0].id)
  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0]

  const close = (): void => {
    if (router.history.canGoBack()) router.history.back()
    else router.navigate({ to: '/' })
  }

  // Esc closes settings, matching the close button.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="drag-region relative flex h-10 shrink-0 items-center justify-center border-border border-b bg-background pl-20">
        <span className="font-medium text-sm">Settings</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="no-drag absolute right-1.5"
          aria-label="Close settings"
          title="Close settings"
          onClick={close}
        >
          <IconX />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 overflow-y-auto border-border border-r p-3">
          <ul className="grid gap-0.5">
            {SECTIONS.map((section) => {
              const isActive = section.id === activeId
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(section.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                      '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
                      isActive
                        ? 'bg-accent font-medium text-accent-foreground [&_svg]:text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                    )}
                  >
                    <section.Icon />
                    {section.label}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto scrollbar-gutter-stable">
          <div className="mx-auto max-w-2xl px-8 py-10">{active.render()}</div>
        </main>
      </div>
    </div>
  )
}
