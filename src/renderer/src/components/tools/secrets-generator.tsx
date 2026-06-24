import { IconCheck, IconCopy, IconRefresh } from '@tabler/icons-react'
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'

type Encoding = 'hex' | 'base64' | 'base64url' | 'alphanumeric'

const ENCODINGS: { value: Encoding; label: string }[] = [
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' },
  { value: 'base64url', label: 'Base64URL' },
  { value: 'alphanumeric', label: 'Alphanumeric' }
]

const FIXED_LENGTHS = [32, 64, 128, 256, 512]

const MIN_CUSTOM_BITS = 8
const MAX_CUSTOM_BITS = 4096

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** N bits of cryptographic randomness, rounded up to whole bytes. */
function randomBytesForBits(bits: number): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(bits / 8))
  crypto.getRandomValues(bytes)
  return bytes
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Faithful base62 of the bytes (read as one big-endian integer), left-padded so
 * leading zero bytes don't shorten it. Same entropy as the raw bytes, rendered
 * with a URL/env-safe [0-9A-Za-z] alphabet — so switching to this encoding shows
 * the same key, not a fresh one.
 */
function toBase62(bytes: Uint8Array): string {
  let num = 0n
  for (const b of bytes) num = (num << 8n) | BigInt(b)
  let out = ''
  while (num > 0n) {
    out = BASE62[Number(num % 62n)] + out
    num /= 62n
  }
  const width = Math.ceil((bytes.length * 8) / Math.log2(62))
  return out.padStart(width, '0')
}

function encode(bytes: Uint8Array, encoding: Encoding): string {
  switch (encoding) {
    case 'hex':
      return toHex(bytes)
    case 'base64':
      return toBase64(bytes)
    case 'base64url':
      return toBase64Url(bytes)
    case 'alphanumeric':
      return toBase62(bytes)
  }
}

/** Copy-to-clipboard button that flips to a check for a moment after copying. */
function CopyButton({ value, label }: { value: string; label: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = (): void => {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1200)
      },
      () => {}
    )
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={copied ? 'Copied' : `Copy ${label}`}
      title="Copy"
      onClick={copy}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </Button>
  )
}

/** A read-only key field with copy + regenerate controls. */
function KeyField({
  value,
  label,
  onRegenerate
}: {
  value: string
  label: string
  onRegenerate: () => void
}): ReactElement {
  return (
    <InputGroup>
      <InputGroupInput
        readOnly
        value={value}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        className="font-mono text-xs"
      />
      <InputGroupAddon align="inline-end">
        <CopyButton value={value} label={label} />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Regenerate ${label}`}
          title="Regenerate"
          onClick={onRegenerate}
        >
          <IconRefresh />
        </Button>
      </InputGroupAddon>
    </InputGroup>
  )
}

function Row({ header, children }: { header: ReactNode; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-7 items-center justify-between gap-2">{header}</div>
      {children}
    </div>
  )
}

/**
 * Generates random keys at a range of bit lengths, rendered in a chosen
 * encoding. Everything runs locally via the Web Crypto API — keys are held in
 * memory only and never persisted or sent anywhere. The encoding is a view over
 * the same random bytes, so switching it reformats each key rather than rolling
 * a new one; regenerate (per row or all) is what rolls fresh bytes.
 */
export function SecretsGenerator(): ReactElement {
  const [encoding, setEncoding] = useState<Encoding>('hex')
  // Raw bytes per row, keyed by row id (the bit length, or 'custom').
  const [bytesByKey, setBytesByKey] = useState<Record<string, Uint8Array>>(() => {
    const initial: Record<string, Uint8Array> = {}
    for (const bits of FIXED_LENGTHS) initial[String(bits)] = randomBytesForBits(bits)
    return initial
  })

  const [customInput, setCustomInput] = useState('')
  const customBits = useMemo(() => {
    const n = Number.parseInt(customInput, 10)
    if (!Number.isFinite(n) || n < MIN_CUSTOM_BITS || n > MAX_CUSTOM_BITS) return null
    return n
  }, [customInput])

  // Roll fresh bytes for the custom row whenever its (valid) length changes.
  useEffect(() => {
    if (customBits == null) return
    setBytesByKey((prev) => ({ ...prev, custom: randomBytesForBits(customBits) }))
  }, [customBits])

  const regenerate = (key: string, bits: number): void => {
    setBytesByKey((prev) => ({ ...prev, [key]: randomBytesForBits(bits) }))
  }

  const regenerateAll = (): void => {
    setBytesByKey((prev) => {
      const next: Record<string, Uint8Array> = { ...prev }
      for (const bits of FIXED_LENGTHS) next[String(bits)] = randomBytesForBits(bits)
      if (customBits != null) next.custom = randomBytesForBits(customBits)
      return next
    })
  }

  const customBytes = bytesByKey.custom

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5">
          {ENCODINGS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={encoding === option.value ? 'default' : 'ghost'}
              onClick={() => setEncoding(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={regenerateAll}>
          <IconRefresh />
          Regenerate all
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        {FIXED_LENGTHS.map((bits) => {
          const bytes = bytesByKey[String(bits)]
          const value = bytes ? encode(bytes, encoding) : ''
          return (
            <Row
              key={bits}
              header={
                <>
                  <span className="font-medium text-foreground text-sm tabular-nums">
                    {bits}-bit
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {value.length} chars
                  </span>
                </>
              }
            >
              <KeyField
                value={value}
                label={`${bits}-bit key`}
                onRegenerate={() => regenerate(String(bits), bits)}
              />
            </Row>
          )
        })}

        <Row
          header={
            <>
              <span className="font-medium text-foreground text-sm">Custom</span>
              <InputGroup className="w-36">
                <InputGroupInput
                  type="number"
                  inputMode="numeric"
                  min={MIN_CUSTOM_BITS}
                  max={MAX_CUSTOM_BITS}
                  placeholder="384"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  className="text-right tabular-nums"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>bits</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </>
          }
        >
          {customBits != null && customBytes ? (
            <KeyField
              value={encode(customBytes, encoding)}
              label={`${customBits}-bit key`}
              onRegenerate={() => regenerate('custom', customBits)}
            />
          ) : (
            <p className="text-muted-foreground text-xs">
              Enter a length from {MIN_CUSTOM_BITS} to {MAX_CUSTOM_BITS} bits.
            </p>
          )}
        </Row>
      </div>
    </div>
  )
}
