import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    // better-sqlite3 + sharp (native) and draco3dgltf (loads its own wasm via fs)
    // stay external. execa and the gltf-transform/meshopt stack are ESM-only, so
    // they're bundled into the CJS main output instead of being require(esm)'d.
    // sharp, pulled in transitively by @gltf-transform/functions, stays external
    // as a native module.
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          'execa',
          '@gltf-transform/core',
          '@gltf-transform/extensions',
          '@gltf-transform/functions',
          'meshoptimizer'
        ]
      })
    ],
    build: {
      rollupOptions: {
        // The optimize worker runs as a utilityProcess, so it needs its own entry
        // alongside the main process (→ out/main/optimize.worker.js).
        input: {
          index: resolve('src/main/index.ts'),
          'optimize.worker': resolve('src/main/services/optimize/worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
