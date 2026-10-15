/**
 * X 光 / 半透明发光体材质。
 *
 * 参考片的质感不是「表面着色」，而是**内部发光**：
 *   · 正对镜头处最亮（视线穿过整个体量，累积的发光最多）
 *   · 边缘处出现菲涅尔亮边（视线掠过体表，法线接近垂直视线）
 *   · 整体低对比、暖金色，像琥珀里透出的光
 *
 * 所以着色器用 classic 的**背向法线菲涅尔**思路：
 *   1. 用 `dot(normal, viewDir)` 算视线与法线的夹角
 *   2. 边缘光 = pow(1 - |cos|, power)，得到轮廓亮边
 *   3. 内部光 = 与 cos 正相关的柔光，模拟穿过体量的累积亮度
 *   4. 加上一层可呼吸的脉动，让静止的形体「活着」
 *
 * 关键实现细节（踩过的坑）：
 *   · **必须开 transparent + depthWrite: false**，否则多个半透明体之间会
 *     互相遮挡出现硬边，而不是加色叠加。
 *   · 用 **AdditiveBlending** 让骨架/经脉在体表内部自然「透出来」。
 *   · 顶点法线要在视图空间计算，因此需要 normalMatrix。
 */

import {
  AdditiveBlending,
  Color,
  DoubleSide,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type IUniform,
  type Side,
} from 'three';

export interface XRayMaterialOptions {
  /** 基色（体表主色） */
  color?: string;
  /** 边缘光颜色 */
  rimColor?: string;
  /** 内部光颜色 */
  coreColor?: string;
  /** 整体不透明度 */
  opacity?: number;
  /** 菲涅尔锐度：越大边缘光越窄越锐 */
  fresnelPower?: number;
  /** 边缘光强度 */
  rimStrength?: number;
  /** 内部光强度 */
  coreStrength?: number;
  /** 法线扰动强度（模拟体表起伏与经络流动） */
  noiseStrength?: number;
  /** 单面还是双面 */
  /** 渲染面：默认 DoubleSide（半透明体需要两面都参与加色混合） */
  side?: Side;
}

const VERT = /* glsl */ `
varying vec3 vNormalV;
varying vec3 vViewDirV;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  vUv = uv;
  // 视图空间法线：菲涅尔必须在视图空间算，否则相机旋转时亮边不跟随
  vNormalV = normalize(normalMatrix * normal);

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // 视图空间里，相机位于原点，所以 0 - mvPosition.xyz 就是视线方向
  vViewDirV = normalize(-mvPosition.xyz);

  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRimColor;
uniform vec3 uCoreColor;
uniform float uOpacity;
uniform float uFresnelPower;
uniform float uRimStrength;
uniform float uCoreStrength;
uniform float uTime;
uniform float uBreath;
uniform float uNoiseStrength;

varying vec3 vNormalV;
varying vec3 vViewDirV;
varying vec3 vWorldPos;
varying vec2 vUv;

// 便宜的 3D 值噪声：用于体表流动纹理
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
        mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

void main() {
  vec3 N = normalize(vNormalV);
  vec3 V = normalize(vViewDirV);

  // 双面渲染时，背面法线要翻转，否则背面菲涅尔全黑
  float frontFacing = gl_FrontFacing ? 1.0 : 0.0;
  if (!gl_FrontFacing) N = -N;

  float cosTheta = clamp(dot(N, V), 0.0, 1.0);

  // 1) 菲涅尔边缘光：视线掠过体表处最亮
  float fres = pow(1.0 - cosTheta, uFresnelPower);

  // 2) 内部光：正对镜头处最亮（模拟视线穿过整个体量的累积发光）
  float core = pow(cosTheta, 1.35);

  // 3) 体表流动噪声：让形体像有能量在内部缓慢流动
  float n = noise(vWorldPos * 3.4 + vec3(0.0, uTime * 0.16, uTime * 0.09));
  n = n * 0.5 + 0.5;
  float flow = 1.0 + (n - 0.5) * uNoiseStrength;

  // 4) 呼吸：整体亮度随呼吸缓慢起伏
  float breath = 1.0 + uBreath * 0.16;

  // ============ 背面必须大幅压暗 ============
  //
  // 这是**远视距下人体糊成实心金钟**的根因。
  // 加色混合 + DoubleSide 时，同一个像素上：
  //   · 正面片元（core 大 → 亮）
  //   · 背面片元（背面法线翻转后 core 同样大 → 同样亮）
  //   · 骨架、经脉两层
  // 全部相加。近距离时各层在屏幕上分离，还能看出结构；
  // 远距离时前后两面在屏幕空间几乎重合，四层直接累加到饱和 ——
  // 整个人就被糊成一个不透光的金色圆锥，头颈肩手臂盘腿全部丢失。
  //
  // 背面在 X 光里本来只该提供「体量感」（一点淡淡的底色），
  // 不该参与发光叠加，所以这里把它压到 0.18 倍。
  float backWeight = mix(1.0, 0.18, 1.0 - frontFacing);

  vec3 col = uCoreColor * (core * uCoreStrength)
           + uRimColor * (fres * uRimStrength)
           + uColor * 0.10;

  col *= flow * breath * backWeight;

  float alpha = uOpacity * (0.20 + core * 0.55 + fres * 0.85) * backWeight;
  alpha = clamp(alpha, 0.0, 1.0);

  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * 创建 X 光材质。
 *
 * 注意：**不要在多个网格间复用同一个材质实例**，因为每个网格可能需要
 * 不同的 opacity / fresnelPower（例如骨架要比体表亮、经脉要比骨架暗）。
 */
export function createXRayMaterial(o: XRayMaterialOptions = {}): ShaderMaterial {
  const uniforms: Record<string, IUniform> = {
    uColor: { value: new Color(o.color ?? '#d9b877') },
    uRimColor: { value: new Color(o.rimColor ?? '#ffe9c0') },
    uCoreColor: { value: new Color(o.coreColor ?? '#ffd79a') },
    uOpacity: { value: o.opacity ?? 0.55 },
    uFresnelPower: { value: o.fresnelPower ?? 2.6 },
    uRimStrength: { value: o.rimStrength ?? 1.35 },
    uCoreStrength: { value: o.coreStrength ?? 0.42 },
    uNoiseStrength: { value: o.noiseStrength ?? 0.34 },
    uTime: { value: 0 },
    uBreath: { value: 0 },
  };

  return new ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    // 关掉深度写入，避免半透明体之间互相遮挡成硬边；
    // 靠加色混合得到「层层透出来」的 X 光感。
    depthWrite: false,
    blending: AdditiveBlending,
    side: o.side ?? DoubleSide,
  });
}

/**
 * 骨架 / 经脉用的「简版」发光材质：没有内部光，只有边缘光 + 恒定亮度，
 * 这样它在体表内部仍然清晰可见（参考片里脊柱与肋骨就是这样透出来的）。
 */
export function createGlowMaterial(o: {
  color?: string;
  opacity?: number;
  fresnelPower?: number;
} = {}): ShaderMaterial {
  return createXRayMaterial({
    color: o.color ?? '#ffe0ae',
    rimColor: o.color ?? '#ffe0ae',
    coreColor: o.color ?? '#ffe0ae',
    opacity: o.opacity ?? 0.3,
    fresnelPower: o.fresnelPower ?? 1.4,
    rimStrength: 0.5,
    coreStrength: 0.95,
    noiseStrength: 0.18,
  });
}

/** 让材质的时间/呼吸 uniform 随时间推进（在 rAF 里每帧调用） */
export function tickMaterial(
  mat: ShaderMaterial,
  time: number,
  breath: number,
): void {
  const u = mat.uniforms;
  if (u.uTime) u.uTime.value = time;
  if (u.uBreath) u.uBreath.value = breath;
}

/** 供外部选用的法线辅助（避免 tree-shaking 掉 Vector3 的类型引用） */
export const _up = new Vector3(0, 1, 0);
void UniformsUtils;
void UniformsLib;
