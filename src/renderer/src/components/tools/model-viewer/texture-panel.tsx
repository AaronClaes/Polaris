import {
  IconArrowBackUp,
  IconDownload,
  IconPhotoOff,
  IconPhotoUp,
  IconX
} from '@tabler/icons-react'
import { type CSSProperties, type ReactElement, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { isReplaceable, type TextureInfo, type TextureOverride } from './load-model'

const IMAGE_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/ktx2,.ktx2'

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

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|ktx2)$/i.test(file.name)
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

const OVERLAY_BUTTON = 'bg-black/60 text-white hover:bg-black/75'

function TextureRow({
  texture,
  override,
  downloading,
  onDownload,
  onPickReplacement,
  onDropReplacement,
  onRevert
}: {
  texture: TextureInfo
  override: TextureOverride | undefined
  downloading: boolean
  onDownload: () => void
  onPickReplacement: () => void
  onDropReplacement: (file: File) => void
  onRevert: () => void
}): ReactElement {
  const [dragging, setDragging] = useState(false)
  const replaceable = isReplaceable(texture)
  const replaced = override != null

  const previewUrl = override?.previewUrl ?? texture.previewUrl
  const format = override?.format ?? texture.format
  const width = override ? override.width : texture.width
  const height = override ? override.height : texture.height
  const byteSize = override ? override.byteSize : texture.byteSize
  const vramBytes = override ? override.vramBytes : texture.vramBytes

  return (
    <div className="flex flex-col gap-1.5">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: image drop target */}
      <div
        className={cn(
          'relative overflow-hidden rounded-lg border',
          dragging ? 'border-ring ring-2 ring-ring' : 'border-border'
        )}
        style={CHECKER}
        onDragOver={
          replaceable
            ? (e) => {
                e.preventDefault()
                e.stopPropagation()
                setDragging(true)
              }
            : undefined
        }
        onDragLeave={replaceable ? () => setDragging(false) : undefined}
        onDrop={
          replaceable
            ? (e) => {
                e.preventDefault()
                e.stopPropagation()
                setDragging(false)
                const file = Array.from(e.dataTransfer.files).find(isImageFile)
                if (file) onDropReplacement(file)
              }
            : undefined
        }
      >
        <div className="absolute top-1.5 right-1.5 z-10 flex gap-1">
          {replaceable && (
            <Button
              size="icon-xs"
              variant="ghost"
              className={OVERLAY_BUTTON}
              title="Replace…"
              aria-label={`Replace ${texture.name}`}
              onClick={onPickReplacement}
            >
              <IconPhotoUp />
            </Button>
          )}
          {replaced && (
            <Button
              size="icon-xs"
              variant="ghost"
              className={OVERLAY_BUTTON}
              title="Revert to original"
              aria-label={`Revert ${texture.name}`}
              onClick={onRevert}
            >
              <IconArrowBackUp />
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            className={OVERLAY_BUTTON}
            title="Download"
            aria-label={`Download ${texture.name}`}
            loading={downloading}
            onClick={onDownload}
          >
            <IconDownload />
          </Button>
        </div>

        {previewUrl ? (
          <img
            src={previewUrl}
            alt={texture.name}
            className="block max-h-56 w-full object-contain"
          />
        ) : (
          <div className="flex h-40 flex-col items-center justify-center gap-1 text-muted-foreground">
            <IconPhotoOff className="size-6" />
            <span className="text-xs">No preview ({format})</span>
          </div>
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/60 font-medium text-xs">
            Drop to replace
          </div>
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate font-medium text-xs">
          {texture.slot ?? texture.name}
          {replaced && <span className="ml-1 font-normal text-muted-foreground">· replaced</span>}
        </p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {width && height ? `${width}×${height} · ` : ''}
          {format} · {formatBytes(byteSize)}
        </p>
        {vramBytes > 0 && (
          <p
            className="text-muted-foreground text-xs tabular-nums"
            title="Estimated GPU memory once uploaded. Normal images decode to RGBA8; KTX2 stays compressed."
          >
            VRAM {formatBytes(vramBytes)}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * A modal panel listing the model's textures, scoped to the viewer (an `absolute`
 * scrim + right-side aside inside the viewer container) rather than a window-level
 * sheet — so it behaves the same whether the viewer is a box in the page or its
 * own window. Each row previews the texture, downloads the original bytes through
 * the native Save dialog, and (glTF only) replaces the texture from a dropped /
 * picked image with a revert back to the original.
 */
export function TexturePanel({
  textures,
  overrides,
  onReplace,
  onRevert,
  onClose
}: {
  textures: TextureInfo[]
  overrides: Record<string, TextureOverride>
  onReplace: (texture: TextureInfo, file: File) => void
  onRevert: (texture: TextureInfo) => void
  onClose: () => void
}): ReactElement {
  const saveFile = trpc.dialog.saveFile.useMutation()
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<TextureInfo | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const download = async (
    texture: TextureInfo,
    override: TextureOverride | undefined
  ): Promise<void> => {
    const blob = override?.blob ?? texture.blob
    const filename = override?.filename ?? texture.filename
    const buffer = await blob.arrayBuffer()
    await saveFile.mutateAsync({ filename, base64: toBase64(buffer) })
  }

  const pickReplacement = (texture: TextureInfo): void => {
    pendingRef.current = texture
    inputRef.current?.click()
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
            {textures.map((texture) => {
              const override = overrides[texture.id]
              const filename = override?.filename ?? texture.filename
              return (
                <TextureRow
                  key={texture.id}
                  texture={texture}
                  override={override}
                  downloading={saveFile.isPending && saveFile.variables?.filename === filename}
                  onDownload={() => void download(texture, override)}
                  onPickReplacement={() => pickReplacement(texture)}
                  onDropReplacement={(file) => onReplace(texture, file)}
                  onRevert={() => onRevert(texture)}
                />
              )
            })}
          </div>
        </ScrollArea>
      </aside>

      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          const texture = pendingRef.current
          if (file && texture) onReplace(texture, file)
          pendingRef.current = null
          e.target.value = ''
        }}
      />
    </>
  )
}
