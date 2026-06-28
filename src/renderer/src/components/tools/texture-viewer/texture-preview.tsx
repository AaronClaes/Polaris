import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { type ReactElement, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

/** Which color/alpha channels are visible in the preview. */
export interface Channels {
  r: boolean
  g: boolean
  b: boolean
  a: boolean
}

export const ALL_CHANNELS: Channels = { r: true, g: true, b: true, a: true }

export function isAllChannels(ch: Channels): boolean {
  return ch.r && ch.g && ch.b && ch.a
}

// A full-screen quad in clip space (camera-independent): vUv runs 0→1 across the
// viewport. The fragment shader does everything the old CSS layers + JS pixel
// filtering did — tiling, the boundary grid, the transparency checkerboard, and
// per-channel isolation — in one GPU pass, so it's real-time at any resolution and
// works identically for raster and (GPU-compressed) KTX2.
const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uMap;
  uniform float uRepeat;      // tiles across the viewport's width
  uniform float uAspect;      // texture width / height (keeps tiles undistorted)
  uniform vec2  uResolution;  // viewport size in CSS px
  uniform float uDpr;         // device pixel ratio (for px-stable checker)
  uniform vec4  uChannels;    // r,g,b,a visibility as 0/1
  uniform float uGrid;        // boundary grid on/off
  uniform vec3  uGridColor;

  // 8 CSS-px checkerboard behind transparent texels, matching the old CSS look.
  vec3 checker(vec2 fragPx) {
    vec2 cell = floor(fragPx / (8.0 * uDpr));
    float c = mod(cell.x + cell.y, 2.0);
    return mix(vec3(1.0), vec3(0.831), c); // #ffffff / #d4d4d4
  }

  void main() {
    // Screen UV with origin top-left, so row 0 (image top) sits at the top.
    vec2 s = vec2(vUv.x, 1.0 - vUv.y);
    float containerAspect = uResolution.x / max(uResolution.y, 1.0);
    // uRepeat tiles across; vertical span derived so each tile keeps the texture's
    // aspect ratio — seams read true even for non-square textures.
    float vSpan = uRepeat * uAspect / containerAspect;
    vec2 uv = vec2(s.x * uRepeat, s.y * vSpan);

    vec4 c = texture2D(uMap, uv);

    // Channel isolation: a single color channel (or alpha alone) renders as
    // grayscale — the useful view for a packed channel.
    float colorCount = uChannels.r + uChannels.g + uChannels.b;
    bool alphaOnly = uChannels.a > 0.5 && colorCount < 0.5;
    bool singleColor = colorCount > 0.5 && colorCount < 1.5 && uChannels.a < 0.5;

    vec4 outc;
    if (alphaOnly) {
      outc = vec4(vec3(c.a), 1.0);
    } else if (singleColor) {
      float v = uChannels.r > 0.5 ? c.r : (uChannels.g > 0.5 ? c.g : c.b);
      outc = vec4(vec3(v), 1.0);
    } else {
      outc = vec4(
        uChannels.r > 0.5 ? c.r : 0.0,
        uChannels.g > 0.5 ? c.g : 0.0,
        uChannels.b > 0.5 ? c.b : 0.0,
        uChannels.a > 0.5 ? c.a : 1.0
      );
    }

    vec3 rgb = mix(checker(gl_FragCoord.xy), outc.rgb, outc.a);

    // Boundary grid, exact (it shares the texture's tile coordinates) and a
    // constant ~1px wide at any repeat/zoom. The UV→pixel step is constant for this
    // linear mapping, so we compute it directly — no derivative extension needed.
    if (uGrid > 0.5) {
      vec2 uvPerPx = vec2(uRepeat / max(uResolution.x, 1.0), vSpan / max(uResolution.y, 1.0));
      vec2 d = abs(fract(uv - 0.5) - 0.5) / uvPerPx;
      float line = 1.0 - min(min(d.x, d.y), 1.0);
      rgb = mix(rgb, uGridColor, line * 0.85);
    }

    gl_FragColor = vec4(rgb, 1.0);
  }
`

function TextureQuad({
  texture,
  sourceWidth,
  sourceHeight,
  repeat,
  grid,
  channels
}: {
  texture: THREE.Texture
  sourceWidth: number
  sourceHeight: number
  repeat: number
  grid: boolean
  channels: Channels
}): ReactElement {
  const { size, viewport, invalidate } = useThree()
  const materialRef = useRef<THREE.ShaderMaterial>(null)

  // Created once; values are mutated each frame so prop changes never rebuild the
  // material (and the texture always reaches the sampler regardless of mount timing).
  const uniforms = useMemo(
    () => ({
      uMap: { value: null as THREE.Texture | null },
      uRepeat: { value: 1 },
      uAspect: { value: 1 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uDpr: { value: 1 },
      uChannels: { value: new THREE.Vector4(1, 1, 1, 1) },
      uGrid: { value: 1 },
      uGridColor: { value: new THREE.Color(0.22, 0.741, 0.973) } // sky-400
    }),
    []
  )

  // Sync from the latest props straight onto the live material before each frame.
  useFrame(() => {
    const u = materialRef.current?.uniforms
    if (!u) return
    u.uMap.value = texture
    u.uRepeat.value = repeat
    u.uAspect.value = sourceWidth && sourceHeight ? sourceWidth / sourceHeight : 1
    u.uResolution.value.set(size.width, size.height)
    u.uDpr.value = viewport.dpr
    u.uChannels.value.set(
      channels.r ? 1 : 0,
      channels.g ? 1 : 0,
      channels.b ? 1 : 0,
      channels.a ? 1 : 0
    )
    u.uGrid.value = grid ? 1 : 0
  })

  // On-demand frameloop: request a repaint only when an input changes. useFrame
  // (above) syncs the uniforms on whatever frame this triggers, so the drawn frame
  // is always current. Mount and resize repaints are auto-requested by r3f.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these deps are repaint triggers, not read in the effect
  useEffect(() => {
    invalidate()
  }, [texture, repeat, grid, channels, size.width, size.height, viewport.dpr, invalidate])

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
      />
    </mesh>
  )
}

/**
 * The seamlessness preview: tiles the texture to test how it repeats, with an
 * optional boundary grid and per-channel isolation. All of it is one GPU shader
 * pass on a full-screen quad (ortho/clip-space), so loading and switching do no
 * main-thread pixel work — the foundation a future 3D mode extends from. Rendered
 * `flat`/`linear` so texels reach the screen unaltered (raw bytes), matching what a
 * channel inspector expects.
 */
export function TexturePreview({
  texture,
  sourceWidth,
  sourceHeight,
  repeat,
  grid,
  channels
}: {
  texture: THREE.Texture
  sourceWidth: number
  sourceHeight: number
  repeat: number
  grid: boolean
  channels: Channels
}): ReactElement {
  return (
    <Canvas
      className="absolute inset-0"
      flat
      linear
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true }}
    >
      <TextureQuad
        texture={texture}
        sourceWidth={sourceWidth}
        sourceHeight={sourceHeight}
        repeat={repeat}
        grid={grid}
        channels={channels}
      />
    </Canvas>
  )
}
