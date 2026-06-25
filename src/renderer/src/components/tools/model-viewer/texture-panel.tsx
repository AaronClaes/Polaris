import { IconDownload, IconPhotoOff, IconX } from '@tabler/icons-react'
import { type CSSProperties, type ReactElement, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { trpc } from '@/lib/trpc'
import type { TextureInfo } from './load-model'

// Checkerboard behind previews so texture transparency is visible.
const CHECKER: CSSProperties = {
  backgroundColor: '#ffffff',
  backgroundImage:
    'linear-gradient(45deg, #d4d4d4 25%, transparent 25%), linear-gradient(-45deg, #d4d4d4 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d4d4d4 75%), linear-gradient(-45deg, transparent 75%, #d4d4d4 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Base64-encode in chunks so a large texture doesn't blow the call stack.
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * A modal panel listing the model's textures, scoped to the viewer (an `absolute`
 * scrim + right-side aside inside the viewer container) rather than a window-level
 * sheet — so it behaves the same whether the viewer is a box in the page or its
 * own window. Each row previews the texture and downloads the original bytes
 * through the native Save dialog.
 */
export function TexturePanel({
  textures,
  onClose
}: {
  textures: TextureInfo[]
  onClose: () => void
}): ReactElement {
  const saveFile = trpc.dialog.saveFile.useMutation()

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const download = async (texture: TextureInfo): Promise<void> => {
    const buffer = await texture.blob.arrayBuffer()
    await saveFile.mutateAsync({
      filename: texture.filename,
      base64: toBase64(buffer)
    })
  }

  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop; Esc handled above */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-close */}
      <div className="absolute inset-0 z-20 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 z-30 flex w-80 flex-col border-border border-l bg-background shadow-xl">
        <header className="flex shrink-0 items-center justify-between gap-2 border-border border-b px-3 py-2">
          <h2 className="font-medium text-sm">
            Textures <span className="text-muted-foreground">({textures.length})</span>
          </h2>
          <Button size="icon-sm" variant="ghost" onClick={onClose} title="Close" aria-label="Close">
            <IconX />
          </Button>
        </header>
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-3 p-3">
            {textures.map((texture) => (
              <div key={texture.id} className="flex flex-col gap-1.5">
                <div
                  className="relative overflow-hidden rounded-lg border border-border"
                  style={CHECKER}
                >
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="absolute top-1.5 right-1.5 z-10 bg-black/60 text-white shadow-sm hover:bg-black/75"
                    title="Download"
                    aria-label={`Download ${texture.name}`}
                    loading={
                      saveFile.isPending && saveFile.variables?.filename === texture.filename
                    }
                    onClick={() => void download(texture)}
                  >
                    <IconDownload />
                  </Button>
                  {texture.previewUrl ? (
                    <img
                      src={texture.previewUrl}
                      alt={texture.name}
                      className="block max-h-56 w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-40 flex-col items-center justify-center gap-1 text-muted-foreground">
                      <IconPhotoOff className="size-6" />
                      <span className="text-xs">No preview ({texture.format})</span>
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-xs">{texture.slot ?? texture.name}</p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {texture.width && texture.height ? `${texture.width}×${texture.height} · ` : ''}
                    {texture.format} · {formatBytes(texture.byteSize)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </aside>
    </>
  )
}
