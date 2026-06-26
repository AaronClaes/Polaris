/// <reference types="vite/client" />

// draco3dgltf ships Emscripten glue without types. Each factory takes optional
// module overrides (we feed it `wasmBinary`) and resolves to the Draco module that
// gltf-transform's KHR_draco_mesh_compression extension consumes.
declare module 'draco3dgltf/draco_encoder_gltf_nodejs' {
  const createEncoderModule: (options?: {
    wasmBinary?: ArrayBuffer | Uint8Array
    locateFile?: (path: string) => string
  }) => Promise<unknown>
  export default createEncoderModule
}
declare module 'draco3dgltf/draco_decoder_gltf_nodejs' {
  const createDecoderModule: (options?: {
    wasmBinary?: ArrayBuffer | Uint8Array
    locateFile?: (path: string) => string
  }) => Promise<unknown>
  export default createDecoderModule
}
