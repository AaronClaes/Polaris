import * as THREE from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

// One shared KTX2 loader for Basis/ETC1S/UASTC textures — used both by the model
// viewer (KHR_texture_basisu inside glTF) and the texture viewer (a standalone
// .ktx2). It transcodes in a worker pool to a GPU-compressed format, so a KTX2 is
// decoded off the main thread and uploaded compressed — no full-resolution RGBA
// ever touches the renderer thread. The transcoder is self-hosted (see
// public/basis). detectSupport needs a WebGL renderer to pick a GPU-supported
// transcode target; a throwaway one on this machine reports the same formats as a
// live canvas, so we create it, detect, and dispose immediately (the loader keeps
// the result, not the renderer).
let ktx2Loader: KTX2Loader | null = null

export function getKtx2Loader(): KTX2Loader {
  if (!ktx2Loader) {
    ktx2Loader = new KTX2Loader()
    ktx2Loader.setTranscoderPath(new URL('basis/', document.baseURI).href)
    const probe = new THREE.WebGLRenderer()
    ktx2Loader.detectSupport(probe)
    probe.dispose()
  }
  return ktx2Loader
}
