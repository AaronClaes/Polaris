// Model-specific naming helper. Generic base64 + image-mime helpers now live in
// the shared module (../shared/bytes, ../shared/image-format).

/** Output filename for a model: original basename with a `.glb` extension. */
export function glbName(name: string): string {
  return `${name.replace(/\.(glb|gltf|obj)$/i, '')}.glb`
}
