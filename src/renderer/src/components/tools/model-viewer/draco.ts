import createDracoDecoderModule from 'draco3dgltf/draco_decoder_gltf_nodejs'
import createDracoEncoderModule from 'draco3dgltf/draco_encoder_gltf_nodejs'

// Draco encoder/decoder modules for the shared gltf-transform IO. The wasm is
// self-hosted in public/draco (like the three.js decoder) and handed to the
// Emscripten factory as `wasmBinary`, so there's no locateFile/XHR guesswork and
// it resolves under both the dev server and the packaged file:// app. The glue
// comes from draco3dgltf; its node-only `require('fs')` path is gated behind
// runtime env detection and never runs in the renderer. Modules are created once
// and reused — registering them on the IO enables Draco encoding *and* lets the IO
// read Draco-compressed inputs (so they're no longer gated out of Optimize/Export).

async function fetchWasm(file: string): Promise<Uint8Array> {
  const url = new URL(`draco/${file}`, document.baseURI).href
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status}).`)
  return new Uint8Array(await res.arrayBuffer())
}

let encoderPromise: Promise<unknown> | null = null
export function getDracoEncoder(): Promise<unknown> {
  encoderPromise ??= fetchWasm('draco_encoder.wasm').then((wasmBinary) =>
    createDracoEncoderModule({ wasmBinary })
  )
  return encoderPromise
}

let decoderPromise: Promise<unknown> | null = null
export function getDracoDecoder(): Promise<unknown> {
  decoderPromise ??= fetchWasm('draco_decoder_gltf.wasm').then((wasmBinary) =>
    createDracoDecoderModule({ wasmBinary })
  )
  return decoderPromise
}
