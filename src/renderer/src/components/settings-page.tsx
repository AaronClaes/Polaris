import {
  IconBrandGithub,
  IconInfoCircle,
  IconPalette,
  IconPlug,
  IconSettings,
  IconX,
  type TablerIcon
} from '@tabler/icons-react'
import { useRouter } from '@tanstack/react-router'
import { type ReactElement, type ReactNode, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

function GeneralPanel(): ReactElement {
  return (
    <PanelPlaceholder
      title="General"
      description="App-wide preferences. Nothing to configure here just yet."
    >
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Coming soon</CardTitle>
          <CardDescription>
            Startup behavior, default project, and other general options will live here.
          </CardDescription>
        </CardHeader>
      </Card>
    </PanelPlaceholder>
  )
}

function IntegrationsPanel(): ReactElement {
  return (
    <PanelPlaceholder
      title="Integrations"
      description="Connect external services so Polaris can pull in your work."
    >
      <Card>
        <CardHeader className="flex-row items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-foreground">
            <IconBrandGithub className="size-5" />
          </span>
          <div className="grid flex-1 gap-0.5">
            <CardTitle className="flex items-center gap-2 text-base">
              GitHub
              <Badge variant="secondary" size="sm">
                Coming soon
              </Badge>
            </CardTitle>
            <CardDescription>
              Link your account to surface repositories, issues, and pull requests.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" disabled>
            Connect
          </Button>
        </CardHeader>
      </Card>
    </PanelPlaceholder>
  )
}

function AppearancePanel(): ReactElement {
  return (
    <PanelPlaceholder
      title="Appearance"
      description="Theme and display options. Placeholder for now."
    >
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Coming soon</CardTitle>
          <CardDescription>Light/dark theme and accent color will live here.</CardDescription>
        </CardHeader>
      </Card>
    </PanelPlaceholder>
  )
}

function AboutPanel(): ReactElement {
  return (
    <PanelPlaceholder title="About" description="Polaris — your personal command center.">
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Polaris</CardTitle>
          <CardDescription>Version and build details will appear here.</CardDescription>
        </CardHeader>
      </Card>
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
  },
  {
    id: 'appearance',
    label: 'Appearance',
    Icon: IconPalette,
    render: AppearancePanel
  },
  { id: 'about', label: 'About', Icon: IconInfoCircle, render: AboutPanel }
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

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-8 py-10">{active.render()}</div>
        </main>
      </div>
    </div>
  )
}
