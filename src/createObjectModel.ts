import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// THREE.CapsuleGeometry duplicates every UV-seam vertex (measured: 194 boundary
// edges on the default radius/segments below) -- same benign pattern as box/
// cylinder/sphere/torus, all of which weld cleanly to 0 given a CORRECT weld.
// (A naive vertex-only mergeVertices() reports 64 'non-manifold' edges here, but
// that is a counting artifact, not a real defect: it double-counts a handful of
// near-pole triangles that become degenerate once two of their three corners
// coincide -- confirmed by replicating subdivideCatmullClark's own degenerate-
// triangle-aware vertex identity, which finds a perfectly ordinary 2-manifold.)
// A capsule is the primary shape for skinned limbs/torso (PLAN_1.5), and skinning
// weight computation is O(vertices x bones), so fewer, guaranteed-simple vertices
// is worth having regardless -- authored as a deterministic, closed-by-
// construction mesh instead: shared pole vertices, and
// the radial index taken `% radialSegments` so the seam is never a duplicate
// vertex in the first place, rather than something to weld away afterward.
// Adapted from forge/stage5_rig/emit_rig.py's buildWatertightCapsule (verified
// there: 0 boundary edges, 0 non-manifold edges, deterministic across repeated
// runs) -- ported here rather than imported because this factory and the rig
// emitter are separate generated-output surfaces with no shared runtime module;
// see forge/tests/test_primitive_watertightness.py for the measured proof, and
// coordinate with the rig owner before changing either copy independently.
function buildWatertightCapsule(
  radius: number,
  cylLength: number,
  capSegments: number,
  radialSegments: number,
  heightSegments: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const halfCyl = cylLength / 2;
  const totalSpan = 2 * (Math.PI / 2 * radius) + Math.max(0, cylLength);
  const vOf = (fromBottom: number) => (totalSpan > 0 ? fromBottom / totalSpan : 0);

  const bottomPoleIndex = positions.length / 3;
  positions.push(0, -halfCyl - radius, 0);
  uvs.push(0.5, vOf(0));

  const ringStarts: number[] = [];
  const ringV: number[] = [];
  for (let ring = 1; ring <= capSegments; ring += 1) {
    const phi = (Math.PI / 2) * (ring / capSegments);
    const y = -halfCyl - radius * Math.cos(phi);
    const r = radius * Math.sin(phi);
    const start = positions.length / 3;
    ringStarts.push(start);
    ringV.push(vOf(radius * phi));
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const theta = (radial / radialSegments) * Math.PI * 2;
      positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
      uvs.push(radial / radialSegments, vOf(radius * phi));
    }
  }

  const cylinderRingStarts: number[] = [];
  if (cylLength > 0) {
    for (let step = 1; step <= heightSegments; step += 1) {
      const y = -halfCyl + (cylLength * step) / heightSegments;
      const start = positions.length / 3;
      cylinderRingStarts.push(start);
      const v = vOf(radius * (Math.PI / 2) + halfCyl + y);
      for (let radial = 0; radial < radialSegments; radial += 1) {
        const theta = (radial / radialSegments) * Math.PI * 2;
        positions.push(radius * Math.cos(theta), y, radius * Math.sin(theta));
        uvs.push(radial / radialSegments, v);
      }
    }
  }

  const topRingStarts: number[] = [];
  for (let ring = capSegments - 1; ring >= 1; ring -= 1) {
    const phi = (Math.PI / 2) * (ring / capSegments);
    const y = halfCyl + radius * Math.cos(phi);
    const r = radius * Math.sin(phi);
    const start = positions.length / 3;
    topRingStarts.push(start);
    const v = vOf(radius * (Math.PI / 2) + Math.max(0, cylLength) + radius * (Math.PI / 2 - phi));
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const theta = (radial / radialSegments) * Math.PI * 2;
      positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
      uvs.push(radial / radialSegments, v);
    }
  }

  const topPoleIndex = positions.length / 3;
  positions.push(0, halfCyl + radius, 0);
  uvs.push(0.5, vOf(totalSpan));

  const firstBottomRing = ringStarts[0];
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(bottomPoleIndex, firstBottomRing + radial, firstBottomRing + next);
  }

  const allRings = [...ringStarts, ...cylinderRingStarts, ...topRingStarts];
  for (let i = 0; i < allRings.length - 1; i += 1) {
    const a = allRings[i];
    const b = allRings[i + 1];
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments;
      indices.push(a + radial, a + next, b + next);
      indices.push(a + radial, b + next, b + radial);
    }
  }

  const lastRing = allRings[allRings.length - 1];
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(topPoleIndex, lastRing + next, lastRing + radial);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: seated-lotus-figure
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createSeatedLotusFigureModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "seated-lotus-figure";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 38.0, "aspect": 1.9534, "orientation": {"yaw": 0.0, "pitch": -6.0, "roll": 0.0}, "positionHint": [0.0, 0.55, 3.2], "note": "【本案裁定：不做相机求解】参考图是正交对齐的风格化插画（三视图横排，正视/侧视/后视），无灭点、无透视收敛、无镜头畸变 —— 相机求解脚本所需的输入线索在本参考图上不存在。详见 .img2threejs/projection-route.md。此处 fov/aspect/pitch 仅为**展示用相机**的初始建议值，不是从参考图反解出来的，不得当作测量依据。", "displayCameraOnly": true, "solvedFromReference": false}, "approximationNotes": []};
  root.userData.materialPipeline = {"schemaVersion": 1, "status": "proceed", "registry": "docs/materials/material-reference.json", "analysisArtifact": "material-analysis.json", "targetThreshold": 0.7, "unresolvedNotObservedMaterials": [], "regions": [{"componentId": "figure-cranium", "regionId": "body-shell", "specMaterialId": "body-shell", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "figure-face", "regionId": "body-shell", "specMaterialId": "body-shell", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "figure-neck", "regionId": "body-shell", "specMaterialId": "body-shell", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "figure-thorax", "regionId": "body-shell", "specMaterialId": "body-shell", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "figure-abdomen", "regionId": "body-shell", "specMaterialId": "body-shell", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "figure-pelvis", "regionId": "body-shell", "specMaterialId": "body-shell", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "figure-arm-l", "regionId": "body-shell", "specMaterialId": "body-shell", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "figure-arm-r", "regionId": "body-shell", "specMaterialId": "body-shell", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "figure-hand-l", "regionId": "body-shell", "specMaterialId": "body-shell", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "figure-hand-r", "regionId": "body-shell", "specMaterialId": "body-shell", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "figure-crossleg", "regionId": "body-shell", "specMaterialId": "body-shell", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "figure-ribcage", "regionId": "skeleton", "specMaterialId": "skeleton", "profileId": "procedural-see-through-emissive", "status": "proceed"}, {"componentId": "figure-sternum", "regionId": "skeleton", "specMaterialId": "skeleton", "profileId": "procedural-see-through-emissive", "status": "proceed"}, {"componentId": "figure-spine", "regionId": "skeleton", "specMaterialId": "skeleton", "profileId": "procedural-segment-chain-emissive", "status": "proceed"}, {"componentId": "figure-clavicle", "regionId": "skeleton", "specMaterialId": "skeleton", "profileId": "procedural-see-through-emissive", "status": "proceed"}, {"componentId": "figure-pelvic-girdle", "regionId": "skeleton", "specMaterialId": "skeleton", "profileId": "procedural-see-through-emissive", "status": "proceed"}, {"componentId": "figure-bones-limb", "regionId": "skeleton", "specMaterialId": "skeleton", "profileId": "procedural-see-through-emissive", "status": "proceed"}, {"componentId": "figure-joints", "regionId": "joints", "specMaterialId": "joints", "profileId": "procedural-point-glow", "status": "proceed"}, {"componentId": "figure-meridian", "regionId": "meridian-lines", "specMaterialId": "meridian-lines", "profileId": "procedural-curve-network-emissive", "status": "proceed"}, {"componentId": "figure-dantian", "regionId": "dantian", "specMaterialId": "dantian", "profileId": "procedural-radial-glow", "status": "proceed"}, {"componentId": "figure-brow-point", "regionId": "brow-point", "specMaterialId": "brow-point", "profileId": "procedural-radial-glow", "status": "proceed"}, {"componentId": "lotus-shell", "regionId": "lotus-shell", "specMaterialId": "lotus-shell", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "lotus-petal-mid", "regionId": "lotus-shell", "specMaterialId": "lotus-shell", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "lotus-petal-inner", "regionId": "lotus-shell", "specMaterialId": "lotus-shell", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "lotus-vein", "regionId": "lotus-shell", "specMaterialId": "lotus-shell", "profileId": "procedural-linework-emissive", "status": "proceed"}, {"componentId": "lotus-calyx", "regionId": "lotus-calyx", "specMaterialId": "lotus-calyx", "profileId": "procedural-fresnel-emissive", "status": "proceed"}, {"componentId": "lotus-core", "regionId": "lotus-core", "specMaterialId": "lotus-core", "profileId": "procedural-radial-glow", "status": "proceed"}], "controlledViewsRequired": ["back", "front", "side"], "registryNote": "registry 仅为契约形态对齐而指向官方材质注册表（docs/materials/material-reference.json，27 条成品材质）。本项目 9 种材质并非取自该注册表的任何 profile —— 该注册表收录的是skin/hair/metal/stone 等成品工业材质，与本案「单一暖金半透明发光」的风格化插画材质无对应项。真实来源是自写 fresnel + emission 着色模型（复用应用内 xrayMaterial.ts 的路线），见 .img2threejs/projection-route.md 的路线裁定与 .img2threejs/material-evidence-skip.md 的跳过理由书。", "channelDelivery": "procedural-not-texture-files", "texturelessMaterialCount": 0, "wiringArtifact": "material-analysis.json", "wiringSkipNote": "像素/PBR 提取路线已跳过；本 pipeline 记录的是构建自 spec 的真实构件→材质绑定。"};
  root.userData.materialReferenceRegistry = "docs/materials/material-reference.json";

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["body-shell"] = createSculptMaterial(
    "body-shell",
    {"id": "body-shell", "name": "体表半透明外壳", "type": "procedural-shader", "shaderModel": "custom-fresnel-additive", "baseColor": "#f2e2be", "color": "#f2e2be", "albedo": {"base": "#f2e2be"}, "colorVariation": 0.06, "roughness": 0.35, "metalness": 0.0, "wear": {"enabled": false, "note": "本档位明确不做微表面磨损。"}, "dirt": {"enabled": false}, "localOverrides": [{"id": "chest-glow", "region": "thorax-front", "emissiveGain": 1.18, "note": "胸腹亮部：自上偏前 20 度主光的受光面。"}, {"id": "brow-glow", "region": "brow-point", "emissiveGain": 1.45, "note": "眉间亮斑，第 12 项身份特征。"}, {"id": "dantian-glow", "region": "abdomen-front", "emissiveGain": 1.6, "note": "丹田亮团，被双手托住。"}, {"id": "joint-glow", "region": "joint-points", "emissiveGain": 1.75, "note": "肩/肘/腕/膝/踝与指节共 10 处关节骨点。"}, {"id": "leg-underside-shade", "region": "crossleg-underside", "emissiveGain": 0.82, "note": "盘腿下沿暗部：主光被大腿遮挡。"}, {"id": "jaw-underside-shade", "region": "jaw-underside", "emissiveGain": 0.78, "note": "下颌底暗部。"}, {"id": "petal-underside-shade", "region": "petal-underside", "emissiveGain": 0.8, "note": "花瓣下缘暗部。"}], "shaderNotes": ["自定义 ShaderMaterial：菲涅尔边缘光 + 体量内发光，加色混合（additive），不做标准 PBR 环境反射", "参考片无镜面高光斑、无环境反射、边缘比中心亮、背面结构透过体量可见", "法线方向驱动 fresnel 权重：pow(1.0 - abs(dot(N, V)), 2.2)", "不使用 MeshPhysicalMaterial.transmission（参考质感是体量内发光，非玻璃折射）"], "notes": "单一材质族中的一个成员；全图贯穿同一种暖金渐变，不做多材质混合。", "opacity": 0.55, "textureless": {"declared": true, "evidence": ["three-view.jpg 全图只有一种贯穿全部部件（含莲座）的暖金渐变材质，无纹理/纹样/贴花/胎记可采样", "projection-route.md 已裁定不做投影贴图：三视图是正交对齐插画，无有效透视灭点，相机不可解", "参考图的亮暗本身就是产品要复刻的内部发光效果（体量内发光 + 菲涅尔边缘光），去光照提取 albedo 会删掉 12 项身份特征中的 5 项"]}, "referenceMaterialId": "procedural-fresnel-emissive", "materialFamily": "mineral", "materialSubtype": "warm-ivory-shell", "materialFinish": "translucent-emissive", "materialReference": {"registry": "self-authored-procedural-shader", "profileId": "procedural-fresnel-emissive", "method": "spec-authored-shader-model", "confidence": 0.35, "sourceRefs": [], "requiredMaps": [], "optionalMaps": [], "validationViews": ["front", "side", "back"]}, "materialEvidence": {"componentId": "figure-crossleg", "regionId": "body-shell", "crop": null, "observations": ["全莲花坐，膝间距 0.254H，盘腿总宽 0.446H", "盘腿下沿为暗部", "大腿上表面为亮部"], "hypothesis": {"text": "该区在参考图中被自身遮挡，盘绕方式为推断，置信度最低", "confidence": 0.35, "basis": "三视图目视判读 + 3x3 近景裁切（见 .img2threejs/detail-inventory.md）"}, "alternatives": []}},
    options
  );
  materialMap["skeleton"] = createSculptMaterial(
    "skeleton",
    {"id": "skeleton", "name": "骨骼透亮层", "type": "procedural-shader", "shaderModel": "additive-emissive", "baseColor": "#ffe0a8", "color": "#ffe0a8", "albedo": {"base": "#ffe0a8"}, "colorVariation": 0.06, "roughness": 0.3, "metalness": 0.0, "wear": {"enabled": false, "note": "本档位明确不做微表面磨损。"}, "dirt": {"enabled": false}, "localOverrides": [], "shaderNotes": ["透过体表可见：在 body-shell 之上以加色混合叠加，深度偏移避免 z-fighting", "自发光强度随体表厚度衰减，形成 X 光透亮观感"], "notes": "单一材质族中的一个成员；全图贯穿同一种暖金渐变，不做多材质混合。", "textureless": {"declared": true, "evidence": ["three-view.jpg 全图只有一种贯穿全部部件（含莲座）的暖金渐变材质，无纹理/纹样/贴花/胎记可采样", "projection-route.md 已裁定不做投影贴图：三视图是正交对齐插画，无有效透视灭点，相机不可解", "参考图的亮暗本身就是产品要复刻的内部发光效果（体量内发光 + 菲涅尔边缘光），去光照提取 albedo 会删掉 12 项身份特征中的 5 项"]}, "referenceMaterialId": "procedural-see-through-emissive", "materialFamily": "bone", "materialSubtype": "emissive-limb-bones", "materialFinish": "glow-through", "materialReference": {"registry": "self-authored-procedural-shader", "profileId": "procedural-see-through-emissive", "method": "spec-authored-shader-model", "confidence": 0.85, "sourceRefs": [], "requiredMaps": [], "optionalMaps": [], "validationViews": ["front", "side", "back"]}, "materialEvidence": {"componentId": "figure-bones-limb", "regionId": "skeleton", "crop": null, "observations": ["四肢骨透亮可见：肱骨、尺桡骨、股骨、胫腓骨的体量"], "hypothesis": {"text": "四肢骨为透亮体量，因体表壳半透明而可见，不需要单独描边", "confidence": 0.85, "basis": "三视图目视判读 + 3x3 近景裁切（见 .img2threejs/detail-inventory.md）"}, "alternatives": []}},
    options
  );
  materialMap["joints"] = createSculptMaterial(
    "joints",
    {"id": "joints", "name": "关节亮团", "type": "procedural-shader", "shaderModel": "additive-point-glow", "baseColor": "#fff6e0", "color": "#fff6e0", "albedo": {"base": "#fff6e0"}, "colorVariation": 0.06, "roughness": 0.25, "metalness": 0.0, "wear": {"enabled": false, "note": "本档位明确不做微表面磨损。"}, "dirt": {"enabled": false}, "localOverrides": [], "shaderNotes": ["近白点光源状自发光（关节骨点），加色混合；无镜面反射", "肩/肘/腕/膝/踝与指节共 10 处，强度独立可调"], "notes": "单一材质族中的一个成员；全图贯穿同一种暖金渐变，不做多材质混合。", "textureless": {"declared": true, "evidence": ["three-view.jpg 全图只有一种贯穿全部部件（含莲座）的暖金渐变材质，无纹理/纹样/贴花/胎记可采样", "projection-route.md 已裁定不做投影贴图：三视图是正交对齐插画，无有效透视灭点，相机不可解", "参考图的亮暗本身就是产品要复刻的内部发光效果（体量内发光 + 菲涅尔边缘光），去光照提取 albedo 会删掉 12 项身份特征中的 5 项"]}, "referenceMaterialId": "procedural-point-glow", "materialFamily": "light", "materialSubtype": "emissive-joint-point", "materialFinish": "point-glow", "materialReference": {"registry": "self-authored-procedural-shader", "profileId": "procedural-point-glow", "method": "spec-authored-shader-model", "confidence": 0.75, "sourceRefs": [], "requiredMaps": [], "optionalMaps": [], "validationViews": ["front", "side", "back"]}, "materialEvidence": {"componentId": "figure-joints", "regionId": "joints", "crop": null, "observations": ["肩 / 肘 / 腕 / 膝 / 踝共 10 处骨点比周围亮", "踝点为推断"], "hypothesis": {"text": "关节为近白点光，半径远小于骨骼体量", "confidence": 0.75, "basis": "三视图目视判读 + 3x3 近景裁切（见 .img2threejs/detail-inventory.md）"}, "alternatives": []}},
    options
  );
  materialMap["meridian-lines"] = createSculptMaterial(
    "meridian-lines",
    {"id": "meridian-lines", "name": "经络线", "type": "procedural-shader", "shaderModel": "additive-line", "baseColor": "#ffd9a0", "color": "#ffd9a0", "albedo": {"base": "#ffd9a0"}, "colorVariation": 0.06, "roughness": 0.4, "metalness": 0.0, "wear": {"enabled": false, "note": "本档位明确不做微表面磨损。"}, "dirt": {"enabled": false}, "localOverrides": [], "shaderNotes": ["细亮曲线网络：沿肋间与肢体走向的加色线条，明显细于肋骨", "线条宽度随视距衰减，避免摩尔纹"], "notes": "单一材质族中的一个成员；全图贯穿同一种暖金渐变，不做多材质混合。", "textureless": {"declared": true, "evidence": ["three-view.jpg 全图只有一种贯穿全部部件（含莲座）的暖金渐变材质，无纹理/纹样/贴花/胎记可采样", "projection-route.md 已裁定不做投影贴图：三视图是正交对齐插画，无有效透视灭点，相机不可解", "参考图的亮暗本身就是产品要复刻的内部发光效果（体量内发光 + 菲涅尔边缘光），去光照提取 albedo 会删掉 12 项身份特征中的 5 项"]}, "referenceMaterialId": "procedural-curve-network-emissive", "materialFamily": "light", "materialSubtype": "emissive-meridian", "materialFinish": "line-glow", "materialReference": {"registry": "self-authored-procedural-shader", "profileId": "procedural-curve-network-emissive", "method": "spec-authored-shader-model", "confidence": 0.8, "sourceRefs": [], "requiredMaps": [], "optionalMaps": [], "validationViews": ["front", "side", "back"]}, "materialEvidence": {"componentId": "figure-meridian", "regionId": "meridian-lines", "crop": null, "observations": ["沿肋间与肢体走向的细亮曲线网络", "明显细于肋骨"], "hypothesis": {"text": "经络为细亮曲线，宽度约为肋骨的 1/4", "confidence": 0.8, "basis": "三视图目视判读 + 3x3 近景裁切（见 .img2threejs/detail-inventory.md）"}, "alternatives": []}},
    options
  );
  materialMap["dantian"] = createSculptMaterial(
    "dantian",
    {"id": "dantian", "name": "丹田亮团", "type": "procedural-shader", "shaderModel": "additive-radial-glow", "baseColor": "#fff3d6", "color": "#fff3d6", "albedo": {"base": "#fff3d6"}, "colorVariation": 0.06, "roughness": 0.25, "metalness": 0.0, "wear": {"enabled": false, "note": "本档位明确不做微表面磨损。"}, "dirt": {"enabled": false}, "localOverrides": [], "shaderNotes": ["腹前亮团，被双手托住；径向渐变自发光，加色混合", "中心最亮，向外柔和衰减"], "notes": "单一材质族中的一个成员；全图贯穿同一种暖金渐变，不做多材质混合。", "textureless": {"declared": true, "evidence": ["three-view.jpg 全图只有一种贯穿全部部件（含莲座）的暖金渐变材质，无纹理/纹样/贴花/胎记可采样", "projection-route.md 已裁定不做投影贴图：三视图是正交对齐插画，无有效透视灭点，相机不可解", "参考图的亮暗本身就是产品要复刻的内部发光效果（体量内发光 + 菲涅尔边缘光），去光照提取 albedo 会删掉 12 项身份特征中的 5 项"]}, "referenceMaterialId": "procedural-radial-glow", "materialFamily": "light", "materialSubtype": "emissive-radial-core", "materialFinish": "radial-glow", "materialReference": {"registry": "self-authored-procedural-shader", "profileId": "procedural-radial-glow", "method": "spec-authored-shader-model", "confidence": 0.88, "sourceRefs": [], "requiredMaps": [], "optionalMaps": [], "validationViews": ["front", "side", "back"]}, "materialEvidence": {"componentId": "figure-dantian", "regionId": "dantian", "crop": null, "observations": ["腹前被双手托住处有亮团，是全身最亮处之一"], "hypothesis": {"text": "丹田为径向衰减的点发光，叠加在腹前", "confidence": 0.88, "basis": "三视图目视判读 + 3x3 近景裁切（见 .img2threejs/detail-inventory.md）"}, "alternatives": []}},
    options
  );
  materialMap["brow-point"] = createSculptMaterial(
    "brow-point",
    {"id": "brow-point", "name": "眉间亮斑", "type": "procedural-shader", "shaderModel": "additive-radial-glow", "baseColor": "#fff6e0", "color": "#fff6e0", "albedo": {"base": "#fff6e0"}, "colorVariation": 0.06, "roughness": 0.25, "metalness": 0.0, "wear": {"enabled": false, "note": "本档位明确不做微表面磨损。"}, "dirt": {"enabled": false}, "localOverrides": [], "shaderNotes": ["眉间亮斑，半径约 0.35 颅宽；亮度高于周围颜面", "第 12 项身份特征，加色混合自发光"], "notes": "单一材质族中的一个成员；全图贯穿同一种暖金渐变，不做多材质混合。", "textureless": {"declared": true, "evidence": ["three-view.jpg 全图只有一种贯穿全部部件（含莲座）的暖金渐变材质，无纹理/纹样/贴花/胎记可采样", "projection-route.md 已裁定不做投影贴图：三视图是正交对齐插画，无有效透视灭点，相机不可解", "参考图的亮暗本身就是产品要复刻的内部发光效果（体量内发光 + 菲涅尔边缘光），去光照提取 albedo 会删掉 12 项身份特征中的 5 项"]}, "referenceMaterialId": "procedural-radial-glow", "materialFamily": "light", "materialSubtype": "emissive-brow-spot", "materialFinish": "radial-glow", "materialReference": {"registry": "self-authored-procedural-shader", "profileId": "procedural-radial-glow", "method": "spec-authored-shader-model", "confidence": 0.82, "sourceRefs": [], "requiredMaps": [], "optionalMaps": [], "validationViews": ["front", "side", "back"]}, "materialEvidence": {"componentId": "figure-brow-point", "regionId": "brow-point", "crop": null, "observations": ["眉间亮斑，半径约 0.35 颅宽，亮度高于周围颜面"], "hypothesis": {"text": "眉间为第 12 项身份特征，独立于点光系统", "confidence": 0.82, "basis": "三视图目视判读 + 3x3 近景裁切（见 .img2threejs/detail-inventory.md）"}, "alternatives": []}},
    options
  );
  materialMap["lotus-shell"] = createSculptMaterial(
    "lotus-shell",
    {"id": "lotus-shell", "name": "莲座花瓣", "type": "procedural-shader", "shaderModel": "custom-fresnel-additive", "baseColor": "#efe0c0", "color": "#efe0c0", "albedo": {"base": "#efe0c0"}, "colorVariation": 0.06, "roughness": 0.42, "metalness": 0.0, "wear": {"enabled": false, "note": "本档位明确不做微表面磨损。"}, "dirt": {"enabled": false}, "localOverrides": [], "shaderNotes": ["花瓣外层偏淡金；根部亮、尖端略暗", "每片中央一条纵向叶脉线，根部渐隐；层间有明确前后遮挡"], "notes": "单一材质族中的一个成员；全图贯穿同一种暖金渐变，不做多材质混合。", "opacity": 0.6, "textureless": {"declared": true, "evidence": ["three-view.jpg 全图只有一种贯穿全部部件（含莲座）的暖金渐变材质，无纹理/纹样/贴花/胎记可采样", "projection-route.md 已裁定不做投影贴图：三视图是正交对齐插画，无有效透视灭点，相机不可解", "参考图的亮暗本身就是产品要复刻的内部发光效果（体量内发光 + 菲涅尔边缘光），去光照提取 albedo 会删掉 12 项身份特征中的 5 项"]}, "referenceMaterialId": "procedural-linework-emissive", "materialFamily": "light", "materialSubtype": "emissive-petal-vein", "materialFinish": "line-glow", "materialReference": {"registry": "self-authored-procedural-shader", "profileId": "procedural-linework-emissive", "method": "spec-authored-shader-model", "confidence": 0.78, "sourceRefs": [], "requiredMaps": [], "optionalMaps": [], "validationViews": ["front", "side", "back"]}, "materialEvidence": {"componentId": "lotus-vein", "regionId": "lotus-shell", "crop": null, "observations": ["每片花瓣中央有一条纵向叶脉线，根部渐隐"], "hypothesis": {"text": "叶脉为细亮线，自花瓣中央纵向延伸至尖端前收止", "confidence": 0.78, "basis": "三视图目视判读 + 3x3 近景裁切（见 .img2threejs/detail-inventory.md）"}, "alternatives": []}},
    options
  );
  materialMap["lotus-calyx"] = createSculptMaterial(
    "lotus-calyx",
    {"id": "lotus-calyx", "name": "花托", "type": "procedural-shader", "shaderModel": "custom-fresnel-additive", "baseColor": "#f2e4c4", "color": "#f2e4c4", "albedo": {"base": "#f2e4c4"}, "colorVariation": 0.06, "roughness": 0.38, "metalness": 0.0, "wear": {"enabled": false, "note": "本档位明确不做微表面磨损。"}, "dirt": {"enabled": false}, "localOverrides": [], "shaderNotes": ["花瓣内层偏亮白半透明，紧贴花托直立含苞", "边缘发亮线，加色混合"], "notes": "单一材质族中的一个成员；全图贯穿同一种暖金渐变，不做多材质混合。", "opacity": 0.65, "textureless": {"declared": true, "evidence": ["three-view.jpg 全图只有一种贯穿全部部件（含莲座）的暖金渐变材质，无纹理/纹样/贴花/胎记可采样", "projection-route.md 已裁定不做投影贴图：三视图是正交对齐插画，无有效透视灭点，相机不可解", "参考图的亮暗本身就是产品要复刻的内部发光效果（体量内发光 + 菲涅尔边缘光），去光照提取 albedo 会删掉 12 项身份特征中的 5 项"]}, "referenceMaterialId": "procedural-fresnel-emissive", "materialFamily": "mineral", "materialSubtype": "warm-ivory-shell", "materialFinish": "translucent-emissive", "materialReference": {"registry": "self-authored-procedural-shader", "profileId": "procedural-fresnel-emissive", "method": "spec-authored-shader-model", "confidence": 0.82, "sourceRefs": [], "requiredMaps": [], "optionalMaps": [], "validationViews": ["front", "side", "back"]}, "materialEvidence": {"componentId": "lotus-calyx", "regionId": "lotus-calyx", "crop": null, "observations": ["中央花托是饱满圆顶/水滴形凸起"], "hypothesis": {"text": "花托为回旋体，剖面为水滴形", "confidence": 0.82, "basis": "三视图目视判读 + 3x3 近景裁切（见 .img2threejs/detail-inventory.md）"}, "alternatives": []}},
    options
  );
  materialMap["lotus-core"] = createSculptMaterial(
    "lotus-core",
    {"id": "lotus-core", "name": "莲心光团", "type": "procedural-shader", "shaderModel": "additive-radial-glow", "baseColor": "#fff8e8", "color": "#fff8e8", "albedo": {"base": "#fff8e8"}, "colorVariation": 0.06, "roughness": 0.2, "metalness": 0.0, "wear": {"enabled": false, "note": "本档位明确不做微表面磨损。"}, "dirt": {"enabled": false}, "localOverrides": [], "shaderNotes": ["中央花托饱满圆顶/水滴形凸起；正下方有极亮光心（半径约莲座半径 0.2 倍）", "加色混合，全图最亮处"], "notes": "单一材质族中的一个成员；全图贯穿同一种暖金渐变，不做多材质混合。", "textureless": {"declared": true, "evidence": ["three-view.jpg 全图只有一种贯穿全部部件（含莲座）的暖金渐变材质，无纹理/纹样/贴花/胎记可采样", "projection-route.md 已裁定不做投影贴图：三视图是正交对齐插画，无有效透视灭点，相机不可解", "参考图的亮暗本身就是产品要复刻的内部发光效果（体量内发光 + 菲涅尔边缘光），去光照提取 albedo 会删掉 12 项身份特征中的 5 项"]}, "referenceMaterialId": "procedural-radial-glow", "materialFamily": "light", "materialSubtype": "emissive-calyx-core", "materialFinish": "radial-glow", "materialReference": {"registry": "self-authored-procedural-shader", "profileId": "procedural-radial-glow", "method": "spec-authored-shader-model", "confidence": 0.85, "sourceRefs": [], "requiredMaps": [], "optionalMaps": [], "validationViews": ["front", "side", "back"]}, "materialEvidence": {"componentId": "lotus-core", "regionId": "lotus-core", "crop": null, "observations": ["花托正下方有极亮光心，半径约莲座半径的 0.2 倍"], "hypothesis": {"text": "莲心为径向衰减点发光，是莲座最亮处", "confidence": 0.85, "basis": "三视图目视判读 + 3x3 近景裁切（见 .img2threejs/detail-inventory.md）"}, "alternatives": []}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "\u6253\u5750\u4eba\u4f53 + \u83b2\u82b1\u5ea7\uff08\u6839\u8282\u70b9\uff09__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "打坐人体 + 莲花座（根节点）", "parent": null, "level": "macro", "primitive": "instanced-cluster", "material": null, "topologyRationale": "场景根：承载人体与莲座两个 macro 部件，提供整体自转与缩放的单一枢轴。", "fidelityTier": "macro", "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1], "origin": [0, 0, 0]}, "localFeatures": [], "attachment": null, "bounds": null, "referenceContribution": "root", "actionProfile": {"animationRole": "static", "pivot": {"mode": "component-origin", "note": "静态打坐像：pivot 取部件自身原点，无骨骼驱动需求。"}, "collider": {"mode": "none", "note": "静态展示；不参与物理与拾取碰撞，仅用包围盒做视锥剔除。"}, "destruction": {"breakable": false, "fractureGroup": null}}, "surfaceDetail": {"macro": true, "meso": true, "micro": false}, "evidenceRef": null, "topologyClass": "material-only"};
  node_root_0.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "component-origin", "note": "静态打坐像：pivot 取部件自身原点，无骨骼驱动需求。"}, "collider": {"mode": "none", "note": "静态展示；不参与物理与拾取碰撞，仅用包围盒做视锥剔除。"}, "destruction": {"breakable": false, "fractureGroup": null}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["body-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "\u6253\u5750\u4eba\u4f53 + \u83b2\u82b1\u5ea7\uff08\u6839\u8282\u70b9\uff09";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "打坐人体 + 莲花座（根节点）", "parent": null, "level": "macro", "primitive": "instanced-cluster", "material": null, "topologyRationale": "场景根：承载人体与莲座两个 macro 部件，提供整体自转与缩放的单一枢轴。", "fidelityTier": "macro", "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1], "origin": [0, 0, 0]}, "localFeatures": [], "attachment": null, "bounds": null, "referenceContribution": "root", "actionProfile": {"animationRole": "static", "pivot": {"mode": "component-origin", "note": "静态打坐像：pivot 取部件自身原点，无骨骼驱动需求。"}, "collider": {"mode": "none", "note": "静态展示；不参与物理与拾取碰撞，仅用包围盒做视锥剔除。"}, "destruction": {"breakable": false, "fractureGroup": null}}, "surfaceDetail": {"macro": true, "meso": true, "micro": false}, "evidenceRef": null, "topologyClass": "material-only"};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"mode": "none", "note": "静态展示；不参与物理与拾取碰撞，仅用包围盒做视锥剔除。"};

  const attachment_figure_1 = {"parentId": "root", "parentSocket": "root#socket-figure", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.02, 0.0], "contactType": "overlap", "overlap": 0.006, "gapTolerance": 0.002, "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.0, "evidenceRefs": ["three-view.jpg#front[whole]"], "note": "本案为静态单件打坐像：附件关系用于表达部件间的连续体量衔接（肌肉包裹骨骼、花瓣嵌合花托），overlap 0.006 H 保证无可见缝隙。"};
  const endpoint_figure_1 = makeAttachmentEndpoint(attachment_figure_1);
  const node_figure_1 = new THREE.Group();
  node_figure_1.name = "\u4eba\u4f53\uff08\u6253\u5750\uff09__pivot";
  node_figure_1.scale.set(1, 1, 1);
  if (endpoint_figure_1) {
    node_figure_1.position.copy(endpoint_figure_1.start);
    node_figure_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_figure_1.position.set(0.0, 0.0, 0.0);
    node_figure_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_figure_1.userData.sculptComponent = {"id": "figure", "name": "人体（打坐）", "parent": "root", "level": "macro", "primitive": "capsule", "material": null, "topologyRationale": "人体为一个 macro 部件，内部由 16 个 meso 部件装配。坐姿，全莲花坐，手结禅定印。", "fidelityTier": "macro", "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1], "origin": [0, 0.5, 0]}, "localFeatures": ["sits-on-lotus-contact"], "attachment": {"parentId": "root", "parentSocket": "root#socket-figure", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.02, 0.0], "contactType": "overlap", "overlap": 0.006, "gapTolerance": 0.002, "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.0, "evidenceRefs": ["three-view.jpg#front[whole]"], "note": "本案为静态单件打坐像：附件关系用于表达部件间的连续体量衔接（肌肉包裹骨骼、花瓣嵌合花托），overlap 0.006 H 保证无可见缝隙。"}, "bounds": {"height": "1.000 H", "width": "0.446 H", "depth": "0.300 H"}, "referenceContribution": "critical", "actionProfile": {"animationRole": "static", "pivot": {"mode": "component-origin", "note": "静态打坐像：pivot 取部件自身原点，无骨骼驱动需求。"}, "collider": {"mode": "none", "note": "静态展示；不参与物理与拾取碰撞，仅用包围盒做视锥剔除。"}, "destruction": {"breakable": false, "fractureGroup": null}}, "surfaceDetail": {"macro": true, "meso": true, "micro": false}, "evidenceRef": null, "topologyClass": "continuous-sculpt", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 226, 190, 1.0)", "secondaryAlbedo": "rgba(240, 212, 154, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.86, "evidenceRef": "three-view.jpg#whole-lighting", "note": "参考图全图只有一种贯穿全部部件的暖金渐变材质（image-analysis.md Layer 5）；明度关系为背景最亮、主体靠比背景暖分离（Layer 6）。", "colorGradient": {"type": "linear", "note": "自上偏前 20 度主光：胸腹亮、下颌与盘腿下沿暗", "stops": [{"offset": 0.0, "color": "rgba(242, 226, 190, 1.0)"}, {"offset": 1.0, "color": "rgba(240, 212, 154, 1.0)"}]}}};
  node_figure_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "component-origin", "note": "静态打坐像：pivot 取部件自身原点，无骨骼驱动需求。"}, "collider": {"mode": "none", "note": "静态展示；不参与物理与拾取碰撞，仅用包围盒做视锥剔除。"}, "destruction": {"breakable": false, "fractureGroup": null}};
  (nodes["root"] ?? root).add(node_figure_1);
  nodes["figure"] = node_figure_1;
  const mesh_figure_1Geometry = endpoint_figure_1
    ? new THREE.CylinderGeometry(endpoint_figure_1.endRadius, endpoint_figure_1.baseRadius, endpoint_figure_1.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_figure_1) {
    mesh_figure_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_figure_1 = new THREE.Mesh(
    mesh_figure_1Geometry,
    materialMap["body-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_figure_1.name = "\u4eba\u4f53\uff08\u6253\u5750\uff09";
  if (endpoint_figure_1) {
    mesh_figure_1.position.copy(endpoint_figure_1.midpoint);
    mesh_figure_1.quaternion.copy(endpoint_figure_1.quaternion);
  }
  mesh_figure_1.castShadow = options.castShadow ?? true;
  mesh_figure_1.receiveShadow = options.receiveShadow ?? true;
  mesh_figure_1.userData.sculptComponent = {"id": "figure", "name": "人体（打坐）", "parent": "root", "level": "macro", "primitive": "capsule", "material": null, "topologyRationale": "人体为一个 macro 部件，内部由 16 个 meso 部件装配。坐姿，全莲花坐，手结禅定印。", "fidelityTier": "macro", "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1], "origin": [0, 0.5, 0]}, "localFeatures": ["sits-on-lotus-contact"], "attachment": {"parentId": "root", "parentSocket": "root#socket-figure", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.02, 0.0], "contactType": "overlap", "overlap": 0.006, "gapTolerance": 0.002, "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.0, "evidenceRefs": ["three-view.jpg#front[whole]"], "note": "本案为静态单件打坐像：附件关系用于表达部件间的连续体量衔接（肌肉包裹骨骼、花瓣嵌合花托），overlap 0.006 H 保证无可见缝隙。"}, "bounds": {"height": "1.000 H", "width": "0.446 H", "depth": "0.300 H"}, "referenceContribution": "critical", "actionProfile": {"animationRole": "static", "pivot": {"mode": "component-origin", "note": "静态打坐像：pivot 取部件自身原点，无骨骼驱动需求。"}, "collider": {"mode": "none", "note": "静态展示；不参与物理与拾取碰撞，仅用包围盒做视锥剔除。"}, "destruction": {"breakable": false, "fractureGroup": null}}, "surfaceDetail": {"macro": true, "meso": true, "micro": false}, "evidenceRef": null, "topologyClass": "continuous-sculpt", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 226, 190, 1.0)", "secondaryAlbedo": "rgba(240, 212, 154, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.86, "evidenceRef": "three-view.jpg#whole-lighting", "note": "参考图全图只有一种贯穿全部部件的暖金渐变材质（image-analysis.md Layer 5）；明度关系为背景最亮、主体靠比背景暖分离（Layer 6）。", "colorGradient": {"type": "linear", "note": "自上偏前 20 度主光：胸腹亮、下颌与盘腿下沿暗", "stops": [{"offset": 0.0, "color": "rgba(242, 226, 190, 1.0)"}, {"offset": 1.0, "color": "rgba(240, 212, 154, 1.0)"}]}}};
  node_figure_1.add(mesh_figure_1);
  meshes["figure"] = mesh_figure_1;
  colliders["figure"] = {"mode": "none", "note": "静态展示；不参与物理与拾取碰撞，仅用包围盒做视锥剔除。"};

  const endpoint_lotus_base_2 = makeAttachmentEndpoint(null);
  const node_lotus_base_2 = new THREE.Group();
  node_lotus_base_2.name = "\u83b2\u82b1\u5ea7__pivot";
  node_lotus_base_2.scale.set(1, 1, 1);
  if (endpoint_lotus_base_2) {
    node_lotus_base_2.position.copy(endpoint_lotus_base_2.start);
    node_lotus_base_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lotus_base_2.position.set(0.0, -0.26, 0.0);
    node_lotus_base_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_lotus_base_2.userData.sculptComponent = {"id": "lotus-base", "name": "莲花座", "parent": "root", "level": "macro", "primitive": "lathe", "material": null, "topologyRationale": "莲座为一个 macro 部件，内部由花托 + 三层花瓣 + 莲心共 5 个 meso 部件装配。径向对称。", "fidelityTier": "macro", "transform": {"position": [0, -0.26, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1], "origin": [0, 0.13, 0]}, "localFeatures": ["calyx-dome", "petal-outer-09"], "attachment": {"parent": "figure", "type": "sits-on", "contact": "overlap", "note": "臀部与腿腹叠压在花托上表面，非悬空"}, "bounds": {"height": "0.260 H", "diameter": "1.050 H"}, "referenceContribution": "critical", "actionProfile": {"animationRole": "static", "pivot": {"mode": "component-origin", "note": "静态打坐像：pivot 取部件自身原点，无骨骼驱动需求。"}, "collider": {"mode": "none", "note": "静态展示；不参与物理与拾取碰撞，仅用包围盒做视锥剔除。"}, "destruction": {"breakable": false, "fractureGroup": null}}, "surfaceDetail": {"macro": true, "meso": true, "micro": false}, "evidenceRef": null, "topologyClass": "assembled-solid", "colorMaterialRecipe": {"dominantAlbedo": "rgba(239, 224, 192, 1.0)", "secondaryAlbedo": "rgba(242, 228, 196, 1.0)", "materialClass": "ceramic", "materialClassConfidence": 0.8, "evidenceRef": "three-view.jpg#whole-lighting", "note": "参考图全图只有一种贯穿全部部件的暖金渐变材质（image-analysis.md Layer 5）；明度关系为背景最亮、主体靠比背景暖分离（Layer 6）。"}};
  node_lotus_base_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "component-origin", "note": "静态打坐像：pivot 取部件自身原点，无骨骼驱动需求。"}, "collider": {"mode": "none", "note": "静态展示；不参与物理与拾取碰撞，仅用包围盒做视锥剔除。"}, "destruction": {"breakable": false, "fractureGroup": null}};
  (nodes["root"] ?? root).add(node_lotus_base_2);
  nodes["lotus-base"] = node_lotus_base_2;
  const mesh_lotus_base_2Geometry = endpoint_lotus_base_2
    ? new THREE.CylinderGeometry(endpoint_lotus_base_2.endRadius, endpoint_lotus_base_2.baseRadius, endpoint_lotus_base_2.length, 32, 12)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_lotus_base_2) {
    mesh_lotus_base_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lotus_base_2 = new THREE.SkinnedMesh(
    mesh_lotus_base_2Geometry,
    materialMap["body-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lotus_base_2.name = "\u83b2\u82b1\u5ea7";
  if (endpoint_lotus_base_2) {
    mesh_lotus_base_2.position.copy(endpoint_lotus_base_2.midpoint);
    mesh_lotus_base_2.quaternion.copy(endpoint_lotus_base_2.quaternion);
  }
  mesh_lotus_base_2.castShadow = options.castShadow ?? true;
  mesh_lotus_base_2.receiveShadow = options.receiveShadow ?? true;
  mesh_lotus_base_2.userData.sculptComponent = {"id": "lotus-base", "name": "莲花座", "parent": "root", "level": "macro", "primitive": "lathe", "material": null, "topologyRationale": "莲座为一个 macro 部件，内部由花托 + 三层花瓣 + 莲心共 5 个 meso 部件装配。径向对称。", "fidelityTier": "macro", "transform": {"position": [0, -0.26, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1], "origin": [0, 0.13, 0]}, "localFeatures": ["calyx-dome", "petal-outer-09"], "attachment": {"parent": "figure", "type": "sits-on", "contact": "overlap", "note": "臀部与腿腹叠压在花托上表面，非悬空"}, "bounds": {"height": "0.260 H", "diameter": "1.050 H"}, "referenceContribution": "critical", "actionProfile": {"animationRole": "static", "pivot": {"mode": "component-origin", "note": "静态打坐像：pivot 取部件自身原点，无骨骼驱动需求。"}, "collider": {"mode": "none", "note": "静态展示；不参与物理与拾取碰撞，仅用包围盒做视锥剔除。"}, "destruction": {"breakable": false, "fractureGroup": null}}, "surfaceDetail": {"macro": true, "meso": true, "micro": false}, "evidenceRef": null, "topologyClass": "assembled-solid", "colorMaterialRecipe": {"dominantAlbedo": "rgba(239, 224, 192, 1.0)", "secondaryAlbedo": "rgba(242, 228, 196, 1.0)", "materialClass": "ceramic", "materialClassConfidence": 0.8, "evidenceRef": "three-view.jpg#whole-lighting", "note": "参考图全图只有一种贯穿全部部件的暖金渐变材质（image-analysis.md Layer 5）；明度关系为背景最亮、主体靠比背景暖分离（Layer 6）。"}};
  node_lotus_base_2.add(mesh_lotus_base_2);
  meshes["lotus-base"] = mesh_lotus_base_2;
  colliders["lotus-base"] = {"mode": "none", "note": "静态展示；不参与物理与拾取碰撞，仅用包围盒做视锥剔除。"};

  // PLAN_1.5 WS-C slice 1: bone hierarchy from spec.rig. Model-space joints are
  // converted to parent-local offsets here. Nothing is bound yet (rig.bound === false).
  const bones: Record<string, THREE.Bone> = {};
  const boneOrder: string[] = [];
  const bone_figure_pelvis = new THREE.Bone();
  bone_figure_pelvis.name = "figure-pelvis";
  bone_figure_pelvis.position.set(0.0, 0.48, 0.0);
  root.add(bone_figure_pelvis);
  bones["figure-pelvis"] = bone_figure_pelvis;
  boneOrder.push("figure-pelvis");
  const bone_figure_abdomen = new THREE.Bone();
  bone_figure_abdomen.name = "figure-abdomen";
  bone_figure_abdomen.position.set(0.0, 0.07000000000000006, 0.0);
  bone_figure_pelvis.add(bone_figure_abdomen);
  bones["figure-abdomen"] = bone_figure_abdomen;
  boneOrder.push("figure-abdomen");
  const bone_figure_thorax = new THREE.Bone();
  bone_figure_thorax.name = "figure-thorax";
  bone_figure_thorax.position.set(0.0, 0.06999999999999995, 0.0);
  bone_figure_abdomen.add(bone_figure_thorax);
  bones["figure-thorax"] = bone_figure_thorax;
  boneOrder.push("figure-thorax");
  const bone_figure_neck = new THREE.Bone();
  bone_figure_neck.name = "figure-neck";
  bone_figure_neck.position.set(0.0, 0.19499999999999995, 0.0);
  bone_figure_thorax.add(bone_figure_neck);
  bones["figure-neck"] = bone_figure_neck;
  boneOrder.push("figure-neck");
  const bone_figure_cranium = new THREE.Bone();
  bone_figure_cranium.name = "figure-cranium";
  bone_figure_cranium.position.set(0.0, 0.06000000000000005, 0.0);
  bone_figure_neck.add(bone_figure_cranium);
  bones["figure-cranium"] = bone_figure_cranium;
  boneOrder.push("figure-cranium");
  const bone_figure_face = new THREE.Bone();
  bone_figure_face.name = "figure-face";
  bone_figure_face.position.set(0.0, 0.030000000000000027, 0.038);
  bone_figure_cranium.add(bone_figure_face);
  bones["figure-face"] = bone_figure_face;
  boneOrder.push("figure-face");
  const bone_figure_shoulder_l = new THREE.Bone();
  bone_figure_shoulder_l.name = "figure-shoulder-l";
  bone_figure_shoulder_l.position.set(0.078, 0.14200000000000002, 0.0);
  bone_figure_thorax.add(bone_figure_shoulder_l);
  bones["figure-shoulder-l"] = bone_figure_shoulder_l;
  boneOrder.push("figure-shoulder-l");
  const bone_figure_upperarm_l = new THREE.Bone();
  bone_figure_upperarm_l.name = "figure-upperarm-l";
  bone_figure_upperarm_l.position.set(0.020000000000000004, -0.10199999999999998, 0.0);
  bone_figure_shoulder_l.add(bone_figure_upperarm_l);
  bones["figure-upperarm-l"] = bone_figure_upperarm_l;
  boneOrder.push("figure-upperarm-l");
  const bone_figure_forearm_l = new THREE.Bone();
  bone_figure_forearm_l.name = "figure-forearm-l";
  bone_figure_forearm_l.position.set(-0.010000000000000009, -0.15000000000000002, 0.03);
  bone_figure_upperarm_l.add(bone_figure_forearm_l);
  bones["figure-forearm-l"] = bone_figure_forearm_l;
  boneOrder.push("figure-forearm-l");
  const bone_figure_hand_l = new THREE.Bone();
  bone_figure_hand_l.name = "figure-hand-l";
  bone_figure_hand_l.position.set(-0.032999999999999995, -0.10999999999999999, 0.08);
  bone_figure_forearm_l.add(bone_figure_hand_l);
  bones["figure-hand-l"] = bone_figure_hand_l;
  boneOrder.push("figure-hand-l");
  const bone_figure_shoulder_r = new THREE.Bone();
  bone_figure_shoulder_r.name = "figure-shoulder-r";
  bone_figure_shoulder_r.position.set(-0.078, 0.14200000000000002, 0.0);
  bone_figure_thorax.add(bone_figure_shoulder_r);
  bones["figure-shoulder-r"] = bone_figure_shoulder_r;
  boneOrder.push("figure-shoulder-r");
  const bone_figure_upperarm_r = new THREE.Bone();
  bone_figure_upperarm_r.name = "figure-upperarm-r";
  bone_figure_upperarm_r.position.set(-0.020000000000000004, -0.10199999999999998, 0.0);
  bone_figure_shoulder_r.add(bone_figure_upperarm_r);
  bones["figure-upperarm-r"] = bone_figure_upperarm_r;
  boneOrder.push("figure-upperarm-r");
  const bone_figure_forearm_r = new THREE.Bone();
  bone_figure_forearm_r.name = "figure-forearm-r";
  bone_figure_forearm_r.position.set(0.010000000000000009, -0.15000000000000002, 0.03);
  bone_figure_upperarm_r.add(bone_figure_forearm_r);
  bones["figure-forearm-r"] = bone_figure_forearm_r;
  boneOrder.push("figure-forearm-r");
  const bone_figure_hand_r = new THREE.Bone();
  bone_figure_hand_r.name = "figure-hand-r";
  bone_figure_hand_r.position.set(0.032999999999999995, -0.10999999999999999, 0.08);
  bone_figure_forearm_r.add(bone_figure_hand_r);
  bones["figure-hand-r"] = bone_figure_hand_r;
  boneOrder.push("figure-hand-r");
  const bone_figure_hip_l = new THREE.Bone();
  bone_figure_hip_l.name = "figure-hip-l";
  bone_figure_hip_l.position.set(0.07, -0.010000000000000009, 0.0);
  bone_figure_pelvis.add(bone_figure_hip_l);
  bones["figure-hip-l"] = bone_figure_hip_l;
  boneOrder.push("figure-hip-l");
  const bone_figure_knee_l = new THREE.Bone();
  bone_figure_knee_l.name = "figure-knee-l";
  bone_figure_knee_l.position.set(0.03499999999999999, -0.08999999999999997, 0.06);
  bone_figure_hip_l.add(bone_figure_knee_l);
  bones["figure-knee-l"] = bone_figure_knee_l;
  boneOrder.push("figure-knee-l");
  const bone_figure_ankle_l = new THREE.Bone();
  bone_figure_ankle_l.name = "figure-ankle-l";
  bone_figure_ankle_l.position.set(0.022000000000000006, -0.08000000000000002, -0.019999999999999997);
  bone_figure_knee_l.add(bone_figure_ankle_l);
  bones["figure-ankle-l"] = bone_figure_ankle_l;
  boneOrder.push("figure-ankle-l");
  const bone_figure_hip_r = new THREE.Bone();
  bone_figure_hip_r.name = "figure-hip-r";
  bone_figure_hip_r.position.set(-0.07, -0.010000000000000009, 0.0);
  bone_figure_pelvis.add(bone_figure_hip_r);
  bones["figure-hip-r"] = bone_figure_hip_r;
  boneOrder.push("figure-hip-r");
  const bone_figure_knee_r = new THREE.Bone();
  bone_figure_knee_r.name = "figure-knee-r";
  bone_figure_knee_r.position.set(-0.03499999999999999, -0.08999999999999997, 0.06);
  bone_figure_hip_r.add(bone_figure_knee_r);
  bones["figure-knee-r"] = bone_figure_knee_r;
  boneOrder.push("figure-knee-r");
  const bone_figure_ankle_r = new THREE.Bone();
  bone_figure_ankle_r.name = "figure-ankle-r";
  bone_figure_ankle_r.position.set(-0.022000000000000006, -0.08000000000000002, -0.019999999999999997);
  bone_figure_knee_r.add(bone_figure_ankle_r);
  bones["figure-ankle-r"] = bone_figure_ankle_r;
  boneOrder.push("figure-ankle-r");
  const bone_lotus_base = new THREE.Bone();
  bone_lotus_base.name = "lotus-base";
  bone_lotus_base.position.set(0.0, -0.74, 0.0);
  bone_figure_pelvis.add(bone_lotus_base);
  bones["lotus-base"] = bone_lotus_base;
  boneOrder.push("lotus-base");
  const bone_lotus_calyx = new THREE.Bone();
  bone_lotus_calyx.name = "lotus-calyx";
  bone_lotus_calyx.position.set(0.0, 0.26, 0.0);
  bone_lotus_base.add(bone_lotus_calyx);
  bones["lotus-calyx"] = bone_lotus_calyx;
  boneOrder.push("lotus-calyx");
  // The bones are now in REST position. updateMatrixWorld() before constructing the
  // Skeleton is load-bearing: calculateInverses() reads each bone's CURRENT world matrix,
  // and those inverses are what cancel the rest pose during skinning. Constructed before
  // this call it captures identity matrices, the rest pose never cancels, and every
  // vertex is displaced by its bone's offset at rest. Measured, not assumed --
  // scratchpad/bind_experiment.mjs read (0, 3, 0) for a vertex authored at (0, 2, 0).
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneOrder.map((id) => bones[id]));
  const boneIndexOf = new Map<string, number>(boneOrder.map((id, i) => [id, i]));

  // ---- PLAN_1.5 §4 weight function: ONE function over the complete bone set. No
  // mesh-id or vertex-index branching -- only positions, segment endpoints and the
  // envelope radius derived per §4.3. Ported from forge/stage5_rig/emit_rig.py, which
  // measured max |sum(w) - 1| = 2.98e-8 on executed geometry.
  const BONE_JOINT: Record<string, number[]> = {"figure-pelvis": [0.0, 0.48, 0.0], "figure-abdomen": [0.0, 0.55, 0.0], "figure-thorax": [0.0, 0.62, 0.0], "figure-neck": [0.0, 0.815, 0.0], "figure-cranium": [0.0, 0.875, 0.0], "figure-face": [0.0, 0.905, 0.038], "figure-shoulder-l": [0.078, 0.762, 0.0], "figure-upperarm-l": [0.098, 0.66, 0.0], "figure-forearm-l": [0.088, 0.51, 0.03], "figure-hand-l": [0.055, 0.4, 0.11], "figure-shoulder-r": [-0.078, 0.762, 0.0], "figure-upperarm-r": [-0.098, 0.66, 0.0], "figure-forearm-r": [-0.088, 0.51, 0.03], "figure-hand-r": [-0.055, 0.4, 0.11], "figure-hip-l": [0.07, 0.47, 0.0], "figure-knee-l": [0.105, 0.38, 0.06], "figure-ankle-l": [0.127, 0.3, 0.04], "figure-hip-r": [-0.07, 0.47, 0.0], "figure-knee-r": [-0.105, 0.38, 0.06], "figure-ankle-r": [-0.127, 0.3, 0.04], "lotus-base": [0.0, -0.26, 0.0], "lotus-calyx": [0.0, 0.0, 0.0]};
  const BONE_TIP: Record<string, number[]> = {"figure-pelvis": [0.0, 0.55, 0.0], "figure-abdomen": [0.0, 0.62, 0.0], "figure-thorax": [0.0, 0.76, 0.0], "figure-neck": [0.0, 0.875, 0.0], "figure-cranium": [0.0, 1.0, 0.0], "figure-face": [0.0, 0.96, 0.06], "figure-shoulder-l": [0.098, 0.66, 0.0], "figure-upperarm-l": [0.088, 0.51, 0.03], "figure-forearm-l": [0.055, 0.4, 0.11], "figure-hand-l": [0.02, 0.375, 0.14], "figure-shoulder-r": [-0.098, 0.66, 0.0], "figure-upperarm-r": [-0.088, 0.51, 0.03], "figure-forearm-r": [-0.055, 0.4, 0.11], "figure-hand-r": [-0.02, 0.375, 0.14], "figure-hip-l": [0.105, 0.38, 0.06], "figure-knee-l": [0.127, 0.3, 0.04], "figure-ankle-l": [0.06, 0.12, 0.07], "figure-hip-r": [-0.105, 0.38, 0.06], "figure-knee-r": [-0.127, 0.3, 0.04], "figure-ankle-r": [-0.06, 0.12, 0.07], "lotus-base": [0.0, 0.0, 0.0], "lotus-calyx": [0.0, 0.09, 0.0]};
  const BONE_ENVELOPE: Record<string, number> = {"figure-pelvis": 0.6, "figure-abdomen": 0.6, "figure-thorax": 0.6, "figure-neck": 0.6, "figure-cranium": 0.6, "figure-face": 0.6, "figure-shoulder-l": 0.6, "figure-upperarm-l": 0.6, "figure-forearm-l": 0.6, "figure-hand-l": 0.6, "figure-shoulder-r": 0.6, "figure-upperarm-r": 0.6, "figure-forearm-r": 0.6, "figure-hand-r": 0.6, "figure-hip-l": 0.03, "figure-knee-l": 0.03, "figure-ankle-l": 0.03, "figure-hip-r": 0.03, "figure-knee-r": 0.03, "figure-ankle-r": 0.03, "lotus-base": 0.6, "lotus-calyx": 0.6};
  const _closest = new THREE.Vector3();
  const distanceToSegment = (p: THREE.Vector3, s: number[], e: number[]): number => {
    const ab = [e[0] - s[0], e[1] - s[1], e[2] - s[2]];
    const ap = [p.x - s[0], p.y - s[1], p.z - s[2]];
    const abLenSq = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = abLenSq > 1e-12
      ? THREE.MathUtils.clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / abLenSq, 0, 1)
      : 0;
    _closest.set(s[0] + ab[0] * t, s[1] + ab[1] * t, s[2] + ab[2] * t);
    return p.distanceTo(_closest);
  };
  const computeVertexWeights = (p: THREE.Vector3) => {
    const scored = boneOrder.map((id) => {
      const d = distanceToSegment(p, BONE_JOINT[id], BONE_TIP[id]);
      const u = d / BONE_ENVELOPE[id];
      const falloff = Math.max(0, 1 - u * u);
      return { id, d, w: falloff * falloff };
    });
    scored.sort((a, b) => b.w - a.w);
    const kept = scored.slice(0, 4);
    const total = kept.reduce((sum, c) => sum + c.w, 0);
    const indices = [0, 0, 0, 0];
    const weights = [0, 0, 0, 0];
    if (total > 0) {
      for (let slot = 0; slot < kept.length; slot++) {
        indices[slot] = boneIndexOf.get(kept[slot].id) ?? 0;
        weights[slot] = kept[slot].w / total;
      }
      return { indices, weights, fallback: false };
    }
    // Mandatory zero-sum fallback (PLAN_1.5 §4 / ADR-8). Without it three.js's own
    // normalizeSkinWeights() rewrites an all-zero vertex to (1,0,0,0) against bone 0
    // regardless of distance, which spikes stray vertices toward the hips. Instead:
    // ignore the envelope and pin weight 1.0 to the absolutely nearest bone.
    let nearest = boneOrder[0];
    let nearestDistance = Infinity;
    for (const id of boneOrder) {
      const d = distanceToSegment(p, BONE_JOINT[id], BONE_TIP[id]);
      if (d < nearestDistance) { nearestDistance = d; nearest = id; }
    }
    indices[0] = boneIndexOf.get(nearest) ?? 0;
    weights[0] = 1;
    return { indices, weights, fallback: true };
  };

  // ---- Bake to model space, weight, and bind.
  //
  // The arrangement below was chosen by measurement, not derivation, because the same
  // geometry can be skinned four plausible ways and three of them are wrong. With a
  // vertex authored at model-space (0, 2, 0) fully weighted to a bone at (0, 1, 0) and
  // that bone rotated +90 degrees about X (correct answer: (0, 1, 1)):
  //
  //   pivot transform kept, bind identity     -> rest pose already wrong, no deformation
  //   pivot transform kept, bind matrixWorld  -> (0, 1.5, 0.5): HALF the correct swing,
  //                                              because the pivot applies on top of skinning
  //   geometry baked, pivot bypassed          -> (0, 1, 1): correct
  //   no pivot at all                         -> (0, 1, 1): correct, and identical
  //
  // The last two agreeing is the finding: what matters is that the mesh's own world
  // transform is identity and its geometry lives in the skeleton's space. So each skinned
  // mesh gets its world matrix folded into its vertex data and is reparented to `root`
  // with an identity transform. Meshes are leaves -- components are added to their pivot
  // Group, never to another mesh -- so reparenting one moves nothing else.
  // Pivots back to REST for the bake: the geometry that lands in the buffer must be
  // the same rest pose the skeleton's inverse bind matrices cancel, not the pose.
  nodes["figure-shoulder-l"]?.rotation.set(0, 0, 0);
  nodes["figure-upperarm-l"]?.rotation.set(0, 0, 0);
  nodes["figure-forearm-l"]?.rotation.set(0, 0, 0);
  nodes["figure-hand-l"]?.rotation.set(0, 0, 0);
  nodes["figure-shoulder-r"]?.rotation.set(0, 0, 0);
  nodes["figure-upperarm-r"]?.rotation.set(0, 0, 0);
  nodes["figure-forearm-r"]?.rotation.set(0, 0, 0);
  nodes["figure-hand-r"]?.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const skinnedMeshNames: string[] = [];
  let boundCount = 0;
  for (const boneId of boneOrder) {
    const mesh = meshes[boneId];
    if (!mesh) continue;
    const position = mesh.geometry.getAttribute('position');
    if (!position) continue;
    mesh.updateWorldMatrix(true, false);
    // applyMatrix4 mutates the vertex buffer in place and is NOT idempotent: running it
    // twice on one geometry applies the world matrix squared, and every component lands
    // somewhere it has no reason to be -- the model reads as blown apart rather than
    // wrong. Throw rather than skip, because a silent skip would leave a mesh in the
    // wrong space and the failure would resurface later as a subtler misplacement.
    if (mesh.geometry.userData.worldBaked) {
      throw new Error(
        `geometry for '${boneId}' is already world-baked; baking twice squares the ` +
        'world matrix and scatters the parts. Build a fresh factory instead of re-binding.'
      );
    }
    mesh.geometry.applyMatrix4(mesh.matrixWorld);
    mesh.geometry.userData.worldBaked = true;
    root.add(mesh);
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrixWorld(true);
    // Vertices are model-space now, which is the space the weight function measures in,
    // so no per-vertex matrix multiply is needed any more.
    const count = position.count;
    const skinIndices = new Uint16Array(count * 4);
    const skinWeights = new Float32Array(count * 4);
    const vertex = new THREE.Vector3();
    for (let v = 0; v < count; v++) {
      vertex.fromBufferAttribute(position, v);
      const { indices, weights } = computeVertexWeights(vertex);
      for (let slot = 0; slot < 4; slot++) {
        skinIndices[v * 4 + slot] = indices[slot];
        skinWeights[v * 4 + slot] = weights[slot];
      }
    }
    mesh.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    mesh.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    skinnedMeshNames.push(boneId);
    const skinned = mesh as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh) continue;
    // bindMode is left at its default (AttachedBindMode). The bones live under `root`
    // rather than under any one mesh because a single Skeleton is shared by every skinned
    // mesh and cannot be parented under all of them; with root and each mesh at identity
    // the bone world matrices are the same either way.
    skinned.bind(skeleton, new THREE.Matrix4());
    // A SkinnedMesh's boundingSphere is computed from its REST vertex data and is not
    // recomputed when bones move, so a posed limb that swings outside its rest bounds gets
    // culled and vanishes -- worse, it vanishes only from certain camera angles, which
    // reads as a geometry bug rather than a culling one. Disabling the test outright is
    // chosen over recomputing bounds every frame because these are small, always-onscreen
    // character parts where the test saves nothing. Recorded in userData.rig so a consumer
    // that DOES need culling knows it has to supply its own bounds.
    skinned.frustumCulled = false;
    boundCount += 1;
  }

  // Pose restored on the pivots. The skinned meshes no longer hang off them -- they
  // were reparented to `root` -- so this drives only the non-skinned descendants
  // (ear shells, eye cavities), which have no bone of their own and would otherwise
  // stay at rest while the head they sit on turns. The bones get the same rotations
  // applied separately, so nothing is posed twice.
  nodes["figure-shoulder-l"]?.rotation.set(-68.0, 0.0, -8.0);
  nodes["figure-upperarm-l"]?.rotation.set(-68.0, 0.0, 0.0);
  nodes["figure-forearm-l"]?.rotation.set(-52.0, 0.0, 6.0);
  nodes["figure-hand-l"]?.rotation.set(-14.0, 0.0, 14.0);
  nodes["figure-shoulder-r"]?.rotation.set(-68.0, 0.0, 8.0);
  nodes["figure-upperarm-r"]?.rotation.set(-68.0, 0.0, 0.0);
  nodes["figure-forearm-r"]?.rotation.set(-52.0, 0.0, -6.0);
  nodes["figure-hand-r"]?.rotation.set(-14.0, 0.0, -14.0);
  root.updateMatrixWorld(true);

  // The authored pose, moved from the pivots onto the bones (see _rig_pose_lines). Set
  // AFTER bind() so that the rest pose -- not this one -- is what the skeleton's inverse
  // bind matrices cancel.
  bone_figure_shoulder_l.rotation.set(-68.0, 0.0, -8.0);
  bone_figure_upperarm_l.rotation.set(-68.0, 0.0, 0.0);
  bone_figure_forearm_l.rotation.set(-52.0, 0.0, 6.0);
  bone_figure_hand_l.rotation.set(-14.0, 0.0, 14.0);
  bone_figure_shoulder_r.rotation.set(-68.0, 0.0, 8.0);
  bone_figure_upperarm_r.rotation.set(-68.0, 0.0, 0.0);
  bone_figure_forearm_r.rotation.set(-52.0, 0.0, -6.0);
  bone_figure_hand_r.rotation.set(-14.0, 0.0, -14.0);
  root.updateMatrixWorld(true);
  skeleton.update();
  root.userData.rig = { bones, skeleton, boneOrder, boneIndexOf, skinAttributes: skinnedMeshNames, bound: skinnedMeshNames.length > 0 && boundCount === skinnedMeshNames.length, frustumCulled: false, cullingNote: 'skinned meshes set frustumCulled = false; bone motion does not update a SkinnedMesh boundingSphere, so a consumer that needs culling must recompute bounds per frame' };

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "renderingApproach": "procedural-geometry + custom-additive-shader", "noTextureMaps": true, "noTextureMapsRationale": "本案走『程序化几何 + 自写 shader』路线，**不使用任何贴图**（无 albedo/roughness/normal/height/AO 位图）。所有表面变化来自：几何分件（肋骨条带与肋间缝隙、花瓣层间遮挡）、顶点着色、以及 shader 内的程序化噪声与梯度。与 lookDevTargets.materialPass 中模板默认的贴图要求相冲突 —— 这是有意的偏离，理由见 projection-route.md。", "materialPass": {"goal": "在深色底（#07080b）上以加色发光复刻参考片的暖金半透明主体，纯程序化不着贴图", "qualityPriority": "reference-fidelity", "noTextureMaps": true, "texturelessRationale": "本主体无纹理细节：全图单一暖金渐变，身份信息全部在剪影、比例与发光层次里。依 validate_textureless 的合法豁免口声明 textureless，而不是伪造渲染器永不读取的贴图分辨率。", "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "optOutReason": "projection-route.md 裁定不做投影与去光照：参考图无灭点、相机不可解，且去光照会删掉 5 项身份特征（肋骨透亮、花瓣边缘亮线、丹田/眉间/莲心亮团、关节骨点、经络线）。", "script": "forge/stage1_intake/extract_pbr_evidence.py", "targetThreshold": 0.7, "stopOnLowConfidence": true, "authority": "skipped-by-ratified-decision"}, "normalOrBumpRequired": false, "requiredChannels": ["emissive", "fresnel-rim", "interior-glow"], "materialLayers": [], "acceptance": ["深色底上主体靠比背景暖而非比背景亮分离，背景不被主体发光洗白", "无镜面高光斑、无环境反射", "骨骼与关节透过体表可见（加色叠加可读）", "菲涅尔边缘光在全部轮廓成立"], "texturelessExemption": "9 种材质均以 textureless.declared=true + evidence 声明「无可采样的纹理细节」，跳过贴图**文件**门槛；但上述五项着色**响应**依然具备，只是由程序化几何与着色器承载。两者不矛盾：textureless 描述参考图有无可投影纹理，independentMapChannels 描述渲染器需要哪些响应。", "minimumTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "channelDelivery": "procedural-not-texture-files", "channelDeliveryDetail": {"albedo": "各部件 colorMaterialRecipe 的 dominantAlbedo / secondaryAlbedo（reference 取样自 image-analysis.md Layer 5/6）", "roughness": "材质标量 + 自写 body-shell 的区域 roughness 分区（胸腹受光面略低、盘腿下沿与花瓣下缘略高）", "height": "真实几何：肋间暗缝、花瓣层叠、脊椎节间缝隙、经络凸起全部由几何产生，不使用位移贴图", "normal": "解析法线（LatheGeometry / 放样 / 参数曲面自带），无需法线贴图", "ambient-occlusion": "自写 cavity AO + 接触 AO：肋间、花瓣层间、人体与莲座接触处"}}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "keyLight": {"direction": "自上偏前约 20°", "colorTemp": "暖白", "description": "亮部落在胸腹、大腿上表面、花瓣上表面；暗部落在花瓣下缘、盘腿下沿、下颌底。", "evidenceRef": "three-view.jpg#side[whole]"}, "fillLight": {"direction": "环境半球光，天顶偏暖、地面偏暗", "intensity": "低", "description": "仅用于抬暗部，不得产生方向性第二高光。"}, "rimLight": {"type": "fresnel-based，非独立光源", "description": "由 materialPass.fresnel-rim 层实现，全周均匀。"}, "interiorEmission": {"description": "体量内部发光，由 volume-core + skeleton-emission 两层实现。这是参考图最主要的光源。", "evidenceRef": "three-view.jpg#front[rib-6..rib-9]"}, "exposure": 1.0, "toneMapping": "ACESFilmic", "background": {"value": "#07080b", "note": "【有意偏离参考图】参考图是近白底 #fdfbf5，本应用保留深色底 #07080b。明度关系反转：深底上主体靠『加色发光』分离，而非靠『比背景暖』。发光强度需在深底上重新标定。已由用户裁定。", "evidenceRef": "user-decision:bg-dark-retained"}, "contactShadow": {"required": true, "note": "人体与花托的接触处需要柔和暗部，避免主体看起来悬空（attachment gate 会查此项）。"}}};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createSeatedLotusFigureLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "seated-lotus-figure look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"id": "key", "type": "directional", "direction": "自上偏前约 20°（俯角 70°，方位角正前）", "color": "#fff1d6", "intensity": "medium", "highlights": ["胸腹", "大腿上表面", "花瓣上表面", "颅顶前部"], "shadows": ["花瓣下缘", "盘腿下沿", "下颌底", "肋间缝隙"], "evidenceRef": "three-view.jpg#side[whole]", "confidence": 0.85}, {"id": "fill", "type": "hemisphere", "direction": "天顶偏暖 / 地面偏暗", "colorSky": "#3a3630", "colorGround": "#0a0a0c", "intensity": "low", "note": "仅用于抬起暗部，不得产生方向性第二高光。", "confidence": 0.6}, {"id": "rim", "type": "fresnel-shader", "direction": "全周", "color": "#fff8e8", "power": 2.4, "intensity": "high", "note": "由自写 shader 的菲涅尔项实现，**不是**独立光源。所有剪影轮廓发亮。", "evidenceRef": "three-view.jpg#front[silhouette]", "confidence": 0.9}, {"id": "interior-emission", "type": "volumetric-emissive", "direction": "各向同性（沿体积内）", "color": "#f0d49a", "intensity": "high", "note": "参考图最主要的光源。由 volume-core + skeleton-emission 两层实现，使骨骼透过体表可见。", "evidenceRef": "three-view.jpg#front[rib-6..rib-9]", "confidence": 0.88}, {"id": "background", "type": "scene-background", "color": "#07080b", "note": "【有意偏离参考图】参考图为近白底 #fdfbf5，本应用保留深色底（用户裁定）。明度关系反转：深底上主体靠『加色发光』分离，而非靠『比背景暖』。", "confidence": 1.0}, {"id": "tone-mapping", "role": "tone-mapping", "description": "ACESFilmic 色调映射，exposure 1.0；渲染器 outputColorSpace = SRGBColorSpace，albedo/emissive 走 sRGB，法线/粗糙度/AO 走线性（NoColorSpace）。"}, {"id": "contact-shadow", "role": "contact-shadow", "description": "人体与莲座接触处用 ambient occlusion 近似接触阴影；莲座底部与地面之间不做投影贴图，改用向下渐隐的径向暗晕 + 花托下方的极亮光心制造落座感。"}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "renderingApproach": "procedural-geometry + custom-additive-shader", "noTextureMaps": true, "noTextureMapsRationale": "本案走『程序化几何 + 自写 shader』路线，**不使用任何贴图**（无 albedo/roughness/normal/height/AO 位图）。所有表面变化来自：几何分件（肋骨条带与肋间缝隙、花瓣层间遮挡）、顶点着色、以及 shader 内的程序化噪声与梯度。与 lookDevTargets.materialPass 中模板默认的贴图要求相冲突 —— 这是有意的偏离，理由见 projection-route.md。", "materialPass": {"goal": "在深色底（#07080b）上以加色发光复刻参考片的暖金半透明主体，纯程序化不着贴图", "qualityPriority": "reference-fidelity", "noTextureMaps": true, "texturelessRationale": "本主体无纹理细节：全图单一暖金渐变，身份信息全部在剪影、比例与发光层次里。依 validate_textureless 的合法豁免口声明 textureless，而不是伪造渲染器永不读取的贴图分辨率。", "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "optOutReason": "projection-route.md 裁定不做投影与去光照：参考图无灭点、相机不可解，且去光照会删掉 5 项身份特征（肋骨透亮、花瓣边缘亮线、丹田/眉间/莲心亮团、关节骨点、经络线）。", "script": "forge/stage1_intake/extract_pbr_evidence.py", "targetThreshold": 0.7, "stopOnLowConfidence": true, "authority": "skipped-by-ratified-decision"}, "normalOrBumpRequired": false, "requiredChannels": ["emissive", "fresnel-rim", "interior-glow"], "materialLayers": [], "acceptance": ["深色底上主体靠比背景暖而非比背景亮分离，背景不被主体发光洗白", "无镜面高光斑、无环境反射", "骨骼与关节透过体表可见（加色叠加可读）", "菲涅尔边缘光在全部轮廓成立"], "texturelessExemption": "9 种材质均以 textureless.declared=true + evidence 声明「无可采样的纹理细节」，跳过贴图**文件**门槛；但上述五项着色**响应**依然具备，只是由程序化几何与着色器承载。两者不矛盾：textureless 描述参考图有无可投影纹理，independentMapChannels 描述渲染器需要哪些响应。", "minimumTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "channelDelivery": "procedural-not-texture-files", "channelDeliveryDetail": {"albedo": "各部件 colorMaterialRecipe 的 dominantAlbedo / secondaryAlbedo（reference 取样自 image-analysis.md Layer 5/6）", "roughness": "材质标量 + 自写 body-shell 的区域 roughness 分区（胸腹受光面略低、盘腿下沿与花瓣下缘略高）", "height": "真实几何：肋间暗缝、花瓣层叠、脊椎节间缝隙、经络凸起全部由几何产生，不使用位移贴图", "normal": "解析法线（LatheGeometry / 放样 / 参数曲面自带），无需法线贴图", "ambient-occlusion": "自写 cavity AO + 接触 AO：肋间、花瓣层间、人体与莲座接触处"}}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "keyLight": {"direction": "自上偏前约 20°", "colorTemp": "暖白", "description": "亮部落在胸腹、大腿上表面、花瓣上表面；暗部落在花瓣下缘、盘腿下沿、下颌底。", "evidenceRef": "three-view.jpg#side[whole]"}, "fillLight": {"direction": "环境半球光，天顶偏暖、地面偏暗", "intensity": "低", "description": "仅用于抬暗部，不得产生方向性第二高光。"}, "rimLight": {"type": "fresnel-based，非独立光源", "description": "由 materialPass.fresnel-rim 层实现，全周均匀。"}, "interiorEmission": {"description": "体量内部发光，由 volume-core + skeleton-emission 两层实现。这是参考图最主要的光源。", "evidenceRef": "three-view.jpg#front[rib-6..rib-9]"}, "exposure": 1.0, "toneMapping": "ACESFilmic", "background": {"value": "#07080b", "note": "【有意偏离参考图】参考图是近白底 #fdfbf5，本应用保留深色底 #07080b。明度关系反转：深底上主体靠『加色发光』分离，而非靠『比背景暖』。发光强度需在深底上重新标定。已由用户裁定。", "evidenceRef": "user-decision:bg-dark-retained"}, "contactShadow": {"required": true, "note": "人体与花托的接触处需要柔和暗部，避免主体看起来悬空（attachment gate 会查此项）。"}}};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createSeatedLotusFigureEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameSeatedLotusFigureCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createSeatedLotusFigurePresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureSeatedLotusFigureRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createSeatedLotusFigureInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
