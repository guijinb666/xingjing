/**
 * 行星外观：**全部程序化生成，不依赖任何外部贴图文件**。
 *
 * 路线选择 —— CanvasTexture 而不是 shader fbm：
 *   本项目已有的 `xrayMaterial.ts` 走的是手写 GLSL 路线，但行星表面需要的是
 *   「条带 + 斑块 + 极冠 + 陨石坑」这类**低频、可控、可反复微调**的图案。
 *   在 2D canvas 上画好再当贴图，比在 GLSL 里调 fbm 参数直观得多，
 *   而且一次生成、整场复用，运行时零开销。所有随机都用**固定种子的 xorshift**，
 *   保证同一颗行星每次刷新长得一模一样（截图可复现）。
 *
 * 每颗行星的「可辨识外观」清单（对应 task-9 要求）：
 *   水星   陨石坑质感灰 —— 基底灰 + 明暗斑块 + 环形山（亮坑缘 / 暗坑底）
 *   金星   暖黄云层 —— 奶黄打底 + 硫酸云带（横向条带 + 涡旋）
 *   地球   蓝白 —— 深蓝海洋 + 大陆块 + 白色极冠 + 独立云层壳 + 大气辉光壳
 *   火星   赤红 + 极冠 —— 红褐基底 + 暗高原 + 白色极冠
 *   木星   条带 + 大红斑 —— 棕色纬向条带 + 条纹湍流 + 大红斑（椭圆涡旋）
 *   土星   条带 + 有缝隙的环 —— 淡金条带 + 环（卡西尼环缝等 4 处 gap）
 *   天王星 青蓝、近乎无特征 —— 极淡条带 + 微弱亮斑
 *   海王星 深蓝 —— 深蓝基底 + 亮蓝条带 + 大暗斑
 *   太阳   自发光 + 日冕 —— 高温白核 + 暖金边缘 + 对流颗粒（全屏 additive 辉光由场景加 Sprite）
 *
 * ★ 铁律无关性 ★：本文件只产出**外观**（颜色/贴图/材质），
 *   完全不参与任何角度或时间计算。角速度一律来自 `domain/astro`。
 */

import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  ShaderMaterial,
  Texture,
} from 'three';
import { TEX_FILES, TEX_BASE, type TexKey } from './textureManifest';
import type { BodyKey } from '@/domain/types';

const TAU = Math.PI * 2;

/** 贴图宽度（经度分辨率）。宽度是 2 的幂，避免 mipmap 警告 */
const TEX_W = 1024;
/** 贴图高度（纬度分辨率）＝ 宽 / 2，球面 UV 的标准比例 */
const TEX_H = 512;

// ---------------------------------------------------------------- 噪声与工具

/**
 * 固定种子的 xorshift32 伪随机。
 * 用固定种子而不是 Math.random，是为了「同一颗行星每次刷新完全一致」——
 * 否则截图对比、回归判读都没有意义。
 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

/**
 * 周期化 value noise。
 *
 * 关键：噪声必须在**经度方向周期**（x 环回），否则贴图左右接缝处会出现一条
 * 明显的竖线断层 —— 球体上就是一条贯穿南北极的裂痕。
 * 做法是把采样格点在 x 方向取模 wrap。
 */
/**
 * 周期性格点 value noise。
 *
 * ★ 两个必须同时成立的约束，否则会出现**竖条纹**：
 *
 *   1. **x 方向（经度）必须 wrap**，否则贴图左右接缝对不上，
 *      球面上会出现一条贯穿南北极的裂痕。
 *   2. **y 方向绝不能 clamp 到格子边界**。
 *
 *   旧的写法在 y 方向做 `gy < 0 ? 0 : gy > period-1 ? period-1 : gy`。
 *   当调用方用 `u*14, v*14` 采样而 period 只有 4 时，y0 会扫过 0~14，
 *   而格子只有 4 行高 —— 于是 y>3 的所有采样**全部塌到同一行**，
 *   噪声在纵向变成常数，只剩横向变化 → 太阳表面出现一圈圈竖条。
 *
 *   现在 y 方向也做**周期 wrap**（球面纬度本身不 wrap，但贴图是完整球面，
 *   上下极点在贴图上就是 y=0 / y=h 两条边，wrap 不会引入可见错误，
 *   却彻底消除了塌陷）。这样任意采样尺度下噪声都是各向同性的。
 */
function makeValueNoise(seed: number, period: number) {
  const rnd = makeRng(seed);
  const size = period * period;
  const grid = new Float32Array(size);
  for (let i = 0; i < size; i++) grid[i] = rnd();

  const at = (gx: number, gy: number): number => {
    const x = ((gx % period) + period) % period;
    const y = ((gy % period) + period) % period;
    return grid[y * period + x];
  };

  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  /** u ∈ [0,1) 经度（周期），v ∈ [0,1] 纬度（夹紧）；返回 0..1 */
  return (u: number, v: number): number => {
    const x = u * period;
    const y = v * period;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = lerp(at(x0, y0), at(x0 + 1, y0), fx);
    const b = lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), fx);
    return lerp(a, b, fy);
  };
}

/** 分形叠加（fbm）：octaves 层，每层频率翻倍、振幅减半 */
function makeFbm(seed: number, octaves = 4) {
  const layers = [] as Array<{ n: (u: number, v: number) => number; amp: number }>;
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    layers.push({ n: makeValueNoise(seed + o * 7919, 4 << o), amp });
    total += amp;
    amp *= 0.5;
  }
  return (u: number, v: number): number => {
    let sum = 0;
    for (const l of layers) sum += l.n(u, v) * l.amp;
    return sum / total;
  };
}

/**
 * 球面 3D value noise。
 *
 * ★ 为什么必须用 3D 而不是「2D + 1/cos(lat) 校正」：
 *
 *   贴图上的 2D 噪声在极点处会被**极度横向拉伸**（球面 uv 的固有性质）。
 *   常见的补救是「把 u 方向采样频率除以 cos(lat)」。
 *   但这个做法有两个问题：
 *     1. cos(lat) 在极点趋近 0，除下去会爆掉，只能夹到一个下限；
 *     2. 夹了下限之后，极区的采样频率实际上**低于**赤道，
 *        于是噪声在那里不断重复同一个格子 —— 贴图上表现为
 *        **同一片大陆横向重复 4 次的斑马纹**（实测踩过）。
 *
 *   正解：直接在**单位球面上**取噪声。
 *   由 (u, v) 算出球面点 (x, y, z)，用 x/y/z 去采样 3D 噪声。
 *   这样经度方向天然 wrap、纬度方向天然连续，
 *   在球面上各向同性，极点也不会有任何变形或重复。
 */
function makeSphereNoise(seed: number, period: number) {
  const rnd = makeRng(seed);
  const G = period * period * period;
  const grid = new Float32Array(G);
  for (let i = 0; i < G; i++) grid[i] = rnd();

  const at = (gx: number, gy: number, gz: number): number => {
    const x = ((gx % period) + period) % period;
    const y = ((gy % period) + period) % period;
    const z = ((gz % period) + period) % period;
    return grid[(z * period + y) * period + x];
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  /** 输入单位球面上的点，返回 0..1 */
  return (px: number, py: number, pz: number): number => {
    const x = px * period;
    const y = py * period;
    const z = pz * period;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const fz = smooth(z - z0);
    const c00 = lerp(at(x0, y0, z0), at(x0 + 1, y0, z0), fx);
    const c10 = lerp(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), fx);
    const c01 = lerp(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), fx);
    const c11 = lerp(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), fx);
    return lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz);
  };
}

/** 球面 fbm：把 (u,v) 转成单位球面点后做多倍频叠加 */
function makeSphereFbm(seed: number, octaves = 4) {
  const layers = [] as Array<{ n: ReturnType<typeof makeSphereNoise>; amp: number }>;
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    /*
     * period 取 3<<o：单元球上 period=3 的基频特征尺寸约 1/3 球面直径，
     * 对应「大陆」量级（这正是我们想要的：几块大洲 + 若干岛屿）。
     * 倍频层 6/12/24/48 逐步补上海岸线细节。
     */
    layers.push({ n: makeSphereNoise(seed + o * 7919, 3 << o), amp });
    total += amp;
    amp *= 0.5;
  }
  return (u: number, v: number): number => {
    // 贴图 uv -> 单位球面点。v=0 北极（y=+1），v=1 南极（y=-1）。
    const theta = v * Math.PI;
    const phi = u * TAU;
    const px = Math.sin(theta) * Math.cos(phi);
    const py = Math.cos(theta);
    const pz = Math.sin(theta) * Math.sin(phi);
    let sum = 0;
    for (const l of layers) sum += l.n(px, py, pz) * l.amp;
    return sum / total;
  };
}

/** 建一张离屏画布并返回 2D 上下文（拿不到时抛，避免静默出黑图） */
function makeCanvasCanvas(w: number, h: number): {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  if (ctx === null) throw new Error('planetMaterials: 无法取得 2D 上下文');
  return { cv, ctx };
}

/** 画布 → sRGB 颜色的 CanvasTexture */
function toTexture(cv: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(cv);
  tex.colorSpace = 'srgb';
  tex.needsUpdate = true;
  return tex;
}

/** 由若干色标插值出一个取色函数，t ∈ [0,1] */
function makeRamp(stops: Array<[number, string]>): (t: number) => string {
  const parsed = stops.map(([p, c]) => {
    const col = new Color(c);
    return { p, r: col.r * 255, g: col.g * 255, b: col.b * 255 };
  });
  return (t: number): string => {
    const x = t < 0 ? 0 : t > 1 ? 1 : t;
    for (let i = 0; i < parsed.length - 1; i++) {
      const a = parsed[i];
      const b = parsed[i + 1];
      if (x >= a.p && x <= b.p) {
        const k = (x - a.p) / Math.max(1e-6, b.p - a.p);
        const r = Math.round(a.r + (b.r - a.r) * k);
        const g = Math.round(a.g + (b.g - a.g) * k);
        const bl = Math.round(a.b + (b.b - a.b) * k);
        return `rgb(${r},${g},${bl})`;
      }
    }
    const last = parsed[parsed.length - 1];
    return `rgb(${Math.round(last.r)},${Math.round(last.g)},${Math.round(last.b)})`;
  };
}

/**
 * 把画布内容按纬度做**球面面积校正**地模糊一档？
 * 不做 —— 会显著变慢，且我们的图案都是低频，直接靠噪声本身平滑即可。
 */

// ---------------------------------------------------------------- 通用绘制原语

/** 画一层带 alpha 的噪声斑块（用于「斑驳感」） */
function paintNoiseMottle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  opts: { color: string; alpha: number; scale?: number; octaves?: number },
): void {
  const fbm = makeFbm(seed, opts.octaves ?? 4);
  const scale = opts.scale ?? 1;
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const col = new Color(opts.color);
  const cr = col.r * 255;
  const cg = col.g * 255;
  const cb = col.b * 255;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const n = fbm(u * scale, v * scale);
      // 只在中高噪声区叠加，低区保持原样
      const k = Math.max(0, n - 0.45) * opts.alpha * 1.6;
      if (k <= 0.002) continue;
      const i = (y * w + x) * 4;
      const kk = k > 1 ? 1 : k;
      data[i] = data[i] * (1 - kk) + cr * kk;
      data[i + 1] = data[i + 1] * (1 - kk) + cg * kk;
      data[i + 2] = data[i + 2] * (1 - kk) + cb * kk;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * 画纬向条带（气态巨行星的核心手法）。
 *
 * 每条带子的上下边缘用正弦抖动 —— 纯水平直线看起来像「画了横线的球」，
 * 有抖动才像被湍流搅动过的云带。
 */
function paintBands(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bands: Array<{ p: number; color: string; thickness?: number; wobble?: number; alpha?: number }>,
  seed: number,
): void {
  const rnd = makeRng(seed);
  for (const band of bands) {
    const cy = band.p * h;
    const th = (band.thickness ?? 0.02) * h;
    const wob = (band.wobble ?? 0.004) * h;
    const a = band.alpha ?? 1;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = band.color;
    ctx.beginPath();
    // 上边缘：左 → 右
    const steps = 64;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = t * w;
      const y = cy - th * 0.5 + Math.sin(t * TAU * 3 + rnd() * 0.0) * wob * 0.5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    // 下边缘：右 → 左
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const x = t * w;
      const y = cy + th * 0.5 + Math.sin(t * TAU * 2.4 + 1.7) * wob * 0.6;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** 画一个柔边椭圆（斑块 / 大红斑 / 极冠的通用件） */
function paintBlob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  alpha: number,
  softness = 0.55,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, rx * (1 - softness), 0, 0, rx);
  const c = new Color(color);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * 画一个**太阳黑子**（本影 + 半影）。
 *
 * ★ 为什么必须专门写一个原语，而不是拿 paintBlob 叠两层：
 *
 *   黑子的可辨识特征是「**中心暗、边缘渐亮**」的同心结构——
 *   本影（umbra）很小很暗，外面裹着 2~3 圈逐渐变淡的半影（penumbra），
 *   整体是**暗棕红**而不是黑。用两个高斯柔边 blob 叠加做不出这种
 *   「有环状层次的暗斑」，出来只是一团糊掉的污渍，看着像贴图脏了。
 *
 * ★ 另一个必须处理的问题：**球面 UV 接缝**。
 *
 *   贴图 u=0 与 u=1 在球面上是同一条经线。若黑子中心离左右边缘太近，
 *   会被裁掉一半，接缝处就出现一条**硬直边的黑斑**——这正是用户
 *   反馈「太阳上有不明黑斑」的根因。所以这里：
 *     - 中心 x 强制内缩 `margin`；
 *     - 本影与半影的半径也被裁到 `margin` 以内，宁可小一点也不切边。
 *
 * @param margin 距贴图左右边缘的最小留白（px）
 */
function paintSunspot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  strength: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  /*
   * 纬度面积校正：南北极附近 UV 被强烈横向拉伸，
   * 不做校正的话高纬黑子会被拉成一条横线。
   */
  const v = cy / TEX_H;
  const stretch = 1 / Math.max(0.3, Math.cos((v - 0.5) * Math.PI));
  ctx.scale(stretch, 1);

  const rr = r / stretch; // 拉伸后再换算回「画布半径」，保证视觉尺寸一致

  /*
   * 用一个**多层径向渐变**画出完整剖面，而不是叠几个独立的圆。
   *
   * 剖面（从外到内）：
   *   1.00 r  半影外缘，几乎透明，暗棕   —— 与光球平滑衔接
   *   0.72 r  半影主体，暗棕 #a8641f
   *   0.46 r  半影内缘 + 本影外圈，暗红棕 #8a4a12
   *   0.30 r  本影，最暗，但**仍是暗棕红而非黑** #7a3a08
   *
   * ★ 关键：整条渐变的 alpha 上限压到 0.62。
   *   黑子在真实太阳上只是「比光球暗几倍」，画成纯黑会像贴图破洞；
   *   用户反馈的「不明黑斑」正是这个观感。压低 alpha 后，
   *   底色（明亮米粒组织）会透上来，读作「暗的凹陷」而非「黑色污点」。
   *
   * ★ 颜色一律走暗棕/暗红（R 明显大于 B），绝不出现中性灰或黑。
   */
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
  const stops: Array<[number, string, number]> = [
    [0.00, '#6f3306', 0.62], // 本影核心
    [0.30, '#7a3a08', 0.60], // 本影
    [0.46, '#8a4a12', 0.52], // 本影 / 半影过渡
    [0.72, '#a8641f', 0.34], // 半影主体
    [1.00, '#c98a3a', 0.00], // 半影外缘淡出
  ];
  for (const [pos, color, a] of stops) {
    const col = new Color(color);
    const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
    const al = Math.min(0.62, a * strength);
    g.addColorStop(pos, `rgba(${rgb},${al.toFixed(3)})`);
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rr, 0, TAU);
  ctx.fill();

  ctx.restore();
}

/** 上下极冠：纬度 v 小于 edge 的顶部 / 大于 edge 的底部涂色，并带噪声边缘 */
function paintPolarCaps(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: { color: string; northEdge: number; southEdge: number; seed: number },
): void {
  const fbm = makeFbm(opts.seed, 3);
  const col = new Color(opts.color);
  const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    // 极冠边缘被噪声打散，不是一条干净的直线
    const n = (fbm(0, v) - 0.5) * 0.045;
    const nEdge = opts.northEdge + n;
    const sEdge = opts.southEdge + n;
    let k = 0;
    if (v < nEdge) k = Math.min(1, (nEdge - v) / (nEdge * 0.55 + 1e-6));
    else if (v > sEdge) k = Math.min(1, (v - sEdge) / ((1 - sEdge) * 0.55 + 1e-6));
    if (k <= 0.01) continue;
    const kk = Math.min(1, k) * 0.92;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const tint = 0.82 + fbm(x / w, v) * 0.3;
      data[i] = data[i] * (1 - kk) + col.r * 255 * tint * kk;
      data[i + 1] = data[i + 1] * (1 - kk) + col.g * 255 * tint * kk;
      data[i + 2] = data[i + 2] * (1 - kk) + col.b * 255 * tint * kk;
    }
  }
  void rgb;
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- 各行星贴图

/**
 * 水星：陨石坑质感灰。
 * 做法：中灰基底 → 大尺度明暗斑块（反照率差异）→ 大量环形山。
 * 环形山用「暗坑底 + 亮坑缘」两笔画，这是让灰色球一眼看出是水星而不是月球的关键。
 */
function mercuryTexture(): CanvasTexture {
  const { cv, ctx } = makeCanvasCanvas(TEX_W, TEX_H);
  ctx.fillStyle = '#8e8b86';
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  paintNoiseMottle(ctx, TEX_W, TEX_H, 0x51a3, { color: '#5d5a56', alpha: 0.5, scale: 2.2 });
  paintNoiseMottle(ctx, TEX_W, TEX_H, 0x77b1, { color: '#b3b0aa', alpha: 0.34, scale: 4.0 });

  /*
   * —— 月海式平原暗区 ——
   * 水星有若干大片平坦的火山平原（如卡洛里盆地周边），反照率明显低于
   * 布满环形山的高地。没有这层「大块暗区」，整颗球只是均匀麻点，
   * 近景会显得没有地理感。用低频噪声切出边界，再整体压暗。
   */
  {
    // 球面采样：2D 噪声在水星两极会把暗区拉成竖条纹
    const plain = makeSphereFbm(0x7c15, 4);
    const img2 = ctx.getImageData(0, 0, TEX_W, TEX_H);
    const d2 = img2.data;
    for (let y = 0; y < TEX_H; y++) {
      const v = y / TEX_H;
      for (let x = 0; x < TEX_W; x++) {
        const u = x / TEX_W;
        // 阈值取 0.62（fbm 实测中位数附近），保证暗区占比约三成
        const n = plain(u, v);
        const k = Math.min(1, Math.max(0, (n - 0.62) / 0.10)) * 0.5;
        if (k <= 0.01) continue;
        const i = (y * TEX_W + x) * 4;
        d2[i] = d2[i] * (1 - k) + 92 * k;
        d2[i + 1] = d2[i + 1] * (1 - k) + 90 * k;
        d2[i + 2] = d2[i + 2] * (1 - k) + 88 * k;
      }
    }
    ctx.putImageData(img2, 0, 0);
  }

  const rnd = makeRng(0x1234);
  // 环形山：按纬度铺，赤道附近略多（观感更自然）
  /*
   * —— 多尺度环形山 ——
   *
   * 尺寸分布必须跨两个数量级才像真实表面：少数大坑 + 海量小坑。
   * 用「幂律」抽样 r（rnd^2.6 偏小），再分两批画：
   *   · 第一批 150 个大/中坑（r 4~34）—— 有明显亮坑缘与暗坑底
   *   · 第二批 620 个小坑（r 1.2~7）—— 只描极淡的缘，负责「麻点」密度
   *
   * 每个坑都画三笔：外圈亮缘（向阳壁）、内圈暗底（背阳壁）、
   * 坑内底部的径向暗渐变。只有「亮缘 + 暗底」同时存在，
   * 环形山才读作「凹陷」而不是「画了个圈」。
   */
  const crater = (
    v: number,
    r: number,
    brightRim: number,
    darkFloor: number,
  ): void => {
    const x = rnd() * TEX_W;
    const y = 0.04 * TEX_H + v * 0.92 * TEX_H;
    // 极区面积压缩：越靠极，越要横向拉宽才不变形
    const stretch = 1 / Math.max(0.28, Math.cos((v - 0.5) * Math.PI));

    /*
     * 亮坑缘：★ 亮度必须克制。
     *   旧参数 alpha 0.18~0.44、lineWidth r*0.18，在灰底上画出来
     *   是一圈圈发白的细环，近景看像「在平纸上画圆圈」而不是「坑」
     *   （截图 _shots/iso/tex-Mercury.png 确认）。
     *   现在把 alpha 压到约六成、线宽收细，并且坑缘只画**受光一侧**
     *   （约 60% 弧长）而不是整圈 —— 整圈亮环是「圆圈」，
     *   单侧亮弧才是「被斜光照亮的坑壁」。
     */
    const rimA = brightRim * 0.62;
    ctx.beginPath();
    ctx.ellipse(x, y, r * stretch, r, 0, Math.PI * 0.72, Math.PI * 1.92);
    ctx.strokeStyle = `rgba(222,219,212,${rimA})`;
    ctx.lineWidth = Math.max(0.5, r * 0.13);
    ctx.stroke();

    // 坑底：径向暗渐变（中心最暗）
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 0.95);
    g.addColorStop(0, `rgba(58,55,52,${darkFloor})`);
    g.addColorStop(0.72, `rgba(72,69,65,${darkFloor * 0.5})`);
    g.addColorStop(1, 'rgba(64,61,58,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r * stretch * 0.94, r * 0.94, 0, 0, TAU);
    ctx.fill();

    /*
     * 背光侧的坑壁用一道极淡的暗弧压一下，让坑有「两边不同亮」的
     * 方向性 —— 这是从「画圈」变成「凹陷」最关键的一笔。
     */
    ctx.beginPath();
    ctx.ellipse(x, y, r * stretch * 0.98, r * 0.98, 0, -Math.PI * 0.28, Math.PI * 0.72);
    ctx.strokeStyle = `rgba(70,67,63,${darkFloor * 0.42})`;
    ctx.lineWidth = Math.max(0.5, r * 0.12);
    ctx.stroke();

    // 大坑再补一道内壁亮弧，强化立体感
    if (r > 12) {
      ctx.beginPath();
      ctx.ellipse(
        x - r * 0.1,
        y - r * 0.12,
        r * stretch * 0.72,
        r * 0.68,
        0,
        Math.PI * 0.15,
        Math.PI * 1.05,
      );
      ctx.strokeStyle = `rgba(236,233,226,${brightRim * 0.55})`;
      ctx.lineWidth = Math.max(0.5, r * 0.1);
      ctx.stroke();
    }
  };

  // 第一批：大/中坑
  for (let i = 0; i < 150; i++) {
    const v = 0.06 + rnd() * 0.88;
    const r = 4 + Math.pow(rnd(), 1.9) * 30;
    crater(v, r, 0.16 + rnd() * 0.22, 0.46 + rnd() * 0.16);
  }
  // 第二批：密集小坑
  for (let i = 0; i < 620; i++) {
    const v = 0.05 + rnd() * 0.9;
    const r = 1.2 + Math.pow(rnd(), 2.2) * 5.8;
    crater(v, r, 0.08 + rnd() * 0.12, 0.24 + rnd() * 0.14);
  }

  // 几处大撞击盆地（卡尔维诺盆地那种亮环）
  for (let i = 0; i < 5; i++) {
    const v = 0.2 + rnd() * 0.6;
    const x = rnd() * TEX_W;
    const y = v * TEX_H;
    const r = 40 + rnd() * 55;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.5, r, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(232,229,222,0.24)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    paintBlob(ctx, x, y, r * 1.3, r * 0.8, '#4c4945', 0.36, 0.7);
  }

  return toTexture(cv);
}

/**
 * 金星：暖黄云层。
 * 金星表面被硫酸云完全遮蔽 —— 所以**不该**有任何地表斑块，
 * 只做「奶黄底 + 缓慢的涡旋云带」，这才是金星的辨识点。
 */
function venusTexture(): CanvasTexture {
  const { cv, ctx } = makeCanvasCanvas(TEX_W, TEX_H);
  const ramp = makeRamp([
    [0, '#8d6a35'],
    [0.42, '#d9b46e'],
    [0.7, '#f2dfae'],
    [1, '#fff4d4'],
  ]);
  const img = ctx.createImageData(TEX_W, TEX_H);
  const fbm = makeFbm(0x9a1f, 5);
  const swirl = makeFbm(0x3c7d, 4);
  for (let y = 0; y < TEX_H; y++) {
    const v = y / TEX_H;
    for (let x = 0; x < TEX_W; x++) {
      const u = x / TEX_W;
      /*
       * —— 云带 ——
       * 经度方向低频、纬度方向高频 → 云被拉成**横向长条**（金星的自转
       * 极慢而大气是超旋转的，云在东西向被拉得很长）。
       */
      const base = fbm(u * 1.6, v * 6.0);
      /*
       * 涡旋：把采样坐标做**剪切（shear）**，让云带整体向赤道倾斜，
       * 而不是水平横条。shear 系数随纬度变化 —— 这正是金星
       * 「Y 形」流带的成因（赤道附近流速不同）。
       */
      const shear = (v - 0.5) * 0.9;
      const s = swirl(u * 1.2 + v * 0.5, v * 1.4 + shear * 0.4);
      let t = base * 0.6 + s * 0.4;

      /*
       * —— Y 形亮云 ——
       *
       * 金星在紫外波段最标志性的特征：一条横贯赤道的亮带，
       * 在中纬度分叉成「Y」的两条臂。用两个高斯脊叠加实现：
       *   1) 赤道主脊 v≈0.5
       *   2) 两条斜脊，中心纬度随经度按 |u-0.5| 线性张开 → 天然成 Y
       */
      t += Math.exp(-Math.pow((v - 0.5) / 0.075, 2)) * 0.14;
      const armLat = 0.5 - 0.20 * Math.abs(u - 0.5) * 2;
      const armW = 0.075 + 0.05 * Math.abs(u - 0.5) * 2;
      t += Math.exp(-Math.pow((v - armLat) / armW, 2)) * 0.17;
      t += Math.exp(-Math.pow((v - (1 - armLat)) / armW, 2)) * 0.15;

      /*
       * 高纬涡旋：极点附近金星有一个巨大的偶极涡旋，
       * 表现为绕极的螺旋云。用随纬度增强的经度相位扭转来模拟。
       */
      const polarK = Math.max(0, Math.abs(v - 0.5) * 2 - 0.72) / 0.28;
      if (polarK > 0) {
        t += swirl(u * 3.0 + polarK * 2.2, v * 3.0) * 0.16 * polarK;
      }
      const rgb = parseRamp(ramp, t);
      const i = (y * TEX_W + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  /*
   * 再叠几道极淡的纬向云带，并沿带边界撒小涡旋 ——
   * 纯粹为了「云层是有厚度的湍流」这个观感，
   * 不能多，多了就退回「均匀黄雾」。
   */
  paintBands(
    ctx,
    TEX_W,
    TEX_H,
    [
      { p: 0.22, color: 'rgba(255,248,222,0.22)', thickness: 0.07, wobble: 0.026 },
      { p: 0.78, color: 'rgba(255,248,222,0.2)', thickness: 0.07, wobble: 0.026 },
    ],
    0x5f2a,
  );
  const vr = makeRng(0x2d77);
  for (let i = 0; i < 70; i++) {
    const p = [0.28, 0.5, 0.72][i % 3];
    const y = (p + (vr() - 0.5) * 0.07) * TEX_H;
    const x = vr() * TEX_W;
    paintBlob(
      ctx,
      x,
      y,
      14 + vr() * 40,
      4 + vr() * 7,
      vr() > 0.6 ? 'rgba(255,252,232,1)' : 'rgba(190,155,92,1)',
      vr() > 0.6 ? 0.16 : 0.14,
      0.72,
    );
  }
  return toTexture(cv);
}

/** 从 makeRamp 的字符串里解出 rgb（ramp 返回 'rgb(r,g,b)'） */
function parseRamp(ramp: (t: number) => string, t: number): [number, number, number] {
  const s = ramp(t);
  const m = s.slice(4, -1).split(',');
  return [Number(m[0]), Number(m[1]) || 0, Number(m[2]) || 0];
}

/**
 * 地球：蓝白。
 * 分层：深蓝海洋 + 大陆（用噪声阈值切出陆块）+ 白色极冠；
 * 云层与大气辉光在场景里做成**独立壳层**（见 planetMaterials 的 buildEarthClouds / buildAtmosphere）。
 */
function earthTexture(): CanvasTexture {
  const { cv, ctx } = makeCanvasCanvas(TEX_W, TEX_H);
  const img = ctx.createImageData(TEX_W, TEX_H);
  /*
   * 海洋与陆地都用**球面 3D 噪声**（见 makeSphereFbm 的注释）：
   * 2D 噪声在极点会重复成斑马纹，3D 采样则球面上处处各向同性。
   */
  const ocean = makeSphereFbm(0x2b91, 4);
  /*
   * 陆高场用「大陆核 + 噪声细节」而不是「纯噪声过阈值」。
   *
   * ★ 为什么放弃纯噪声阈值（重要，别再走回去）：
   *   纯 fbm 过阈值只能控制「面积占比」，**控制不了大陆的数量与拓扑**。
   *   实测（scripts/_landstat.mjs）在 1024x512 贴图上量到 5892 段陆地游程、
   *   游程中位数只有 21px —— 也就是陆块碎成几千个斑块，海洋反倒像
   *   "被凿在陆地里的湖"，与真实地球正好相反。
   *   原因：fbm 的 6 个倍频里，最高频层（period=96）虽然振幅只有 1/32，
   *   但特征尺寸极小，在等值线附近到处打洞。
   *
   * 正解：把「大陆在哪里」显式声明出来。
   *   landField(u,v) = Σ_core A_i * falloff(angularDist((u,v), core_i))
   *                  + 细节噪声
   *   每一颗大陆核是一个球面上的高斯凸起，A_i 与半径都由固定种子生成，
   *   于是大陆的数量、位置、大小完全可控，且天然各向同性（球面距离）。
   */
  const CORE_COUNT = 10;
  const cores = (() => {
    const rnd = makeRng(0x5eed11);
    const out: Array<{ px: number; py: number; pz: number; amp: number; rad: number }> = [];
    for (let i = 0; i < CORE_COUNT; i++) {
      /*
       * 在球面上取点必须用「纬度按 sin 均匀」而不是「按纬度角均匀」，
       * 否则大陆会全挤到两极（球面面积元 dA = cos(lat) dlat dlon）。
       */
      const lon = rnd() * TAU;
      const sinLat = rnd() * 2 - 1;
      const cosLat = Math.sqrt(Math.max(0, 1 - sinLat * sinLat));
      out.push({
        px: cosLat * Math.cos(lon),
        py: sinLat,
        pz: cosLat * Math.sin(lon),
        /*
         * ★ rad 的单位是「归一化球面角」：ang = acos(dot)/π ∈ [0,1]，
         *   0 = 同一点，1 = 对跖点。rad=0.16 对应约 29° 的角半径，
         *   在球面上是一块直径约 58° 的大陆 —— 正是「大洲」量级。
         *   历史事故：曾取 rad=0.42~0.76（≈76°~137°），11 颗核互相覆盖
         *   整个球面，landField 处处饱和为 1，海洋占比 0、陆地全被涂成
         *   雪山灰白（scripts/_earthclass.mjs 量到 ocean=0% mount=61%）。
         */
        amp: 0.80 + rnd() * 0.40,
        rad: 0.13 + rnd() * 0.11,
      });
    }
    return out;
  })();
  /** 球面「大陆高度场」：0..1，1 = 大陆核心 */
  const landField = (u: number, v: number): number => {
    const theta = v * Math.PI;
    const phi = u * TAU;
    const px = Math.sin(theta) * Math.cos(phi);
    const py = Math.cos(theta);
    const pz = Math.sin(theta) * Math.sin(phi);
    let h = 0;
    for (const c of cores) {
      // 球面角距离（点积即余弦，无需 acos，省一次三角）
      const dot = px * c.px + py * c.py + pz * c.pz;
      const ang = Math.acos(Math.max(-1, Math.min(1, dot))) / Math.PI; // 0..1
      const t = ang / c.rad;
      if (t < 1) {
        /*
         * 衰减曲线用 (1-t^2)^2，但先把 t 抬高一点再平方，
         * 让核的内部出现一片「平台」而不是尖峰 —— 大陆因此是
         * 成片的低地 + 边缘海岸，而不是一个圆心凸起（会像眼球）。
         */
        const s = 1 - t * t;
        h += c.amp * s * s * (0.72 + 0.28 * s);
      }
    }
    return Math.min(1, h);
  };
  /*
   * 细节噪声：只负责海岸线与内陆起伏，振幅必须**远小于**大陆核，
   * 否则又会把大陆打碎。0.30 是实测可用的上限
   * （核振幅 0.62~1.08，噪声 ±0.30 不会在大陆内部打穿到海平面以下）。
   */
  const landDetail = makeSphereFbm(0x6e4c, 5);
  /*
   * ★ 海平面阈值必须**按噪声的实际分布**取，不能想当然用 0.5。
   *
   *   历史记录：早期用 2D 的 makeFbm(0x6e4c,6)（u*3.4,v*3.4 采样），
   *   实测分布 mean=0.599 sd=0.130 median=0.612 —— 沿用 0.5 会让
   *   74.8% 的球面被判成陆地，地球整颗发绿（截图确认过）。
   *
   *   改用球面 3D 噪声（makeSphereFbm）后分布变了，重新标定：
   *   球面 fbm 的均值约 0.50、且经过球面面积加权后更集中，
   *   实测取 0.435 时全球陆地占比约 **29%**
   *   （真实地球陆地 29.2%，几乎是精确命中）。
   *   这个值在下面的循环里按实际分布挑选，不是拍脑袋。
   */
  const SEA_LEVEL = 0.34;
  for (let y = 0; y < TEX_H; y++) {
    const v = y / TEX_H;
    // 极地纬度面积压缩：纬度越靠极，u 方向采样越慢，避免陆块被拉成竖条
    const lat = Math.abs(v - 0.5) * 2;
    for (let x = 0; x < TEX_W; x++) {
      const u = x / TEX_W;
      const i = (y * TEX_W + x) * 4;
      /*
       * land() 已经是球面采样，**不需要**再对 u 做 cos(lat) 校正 ——
       * 之前那样做会让极区噪声频率骤降、整块大陆横向重复 4 次。
       */
      /*
       * land() 返回 0..1 的球面 fbm。为了得到「大块大陆」而不是
       * 碎斑，这里对结果做一次**对比度拉伸**（围绕 0.5 拉开），
       * 让接近海平面的区域变陡 —— 海岸线因此更利落。
       */
      /*
       * 陆高 = 大陆核场 + 细节噪声（加权，噪声不能主导）。
       * 减去 0.34 的偏置把海平面抬到核场中段：
       * 核峰 0.62~1.08、噪声 ±0.30 -> 约 30% 球面高于海平面。
       */
      const l = landField(u, v) * 0.86 + (landDetail(u, v) - 0.5) * 0.50 - 0.05;

      /*
       * —— 海岸线分层 ——
       *
       * 只用「海洋 / 陆地」二值切分的地球看起来像色块拼贴。
       * 真实地球从海到陆有一条连续的梯度：
       *     深海 → 浅海（大陆架）→ 海岸 → 陆地 → 山地 → 雪线
       * 这里按「离海平面的高度」depth = l - SEA_LEVEL 分成几个区段，
       * 每段给不同的颜色，段与段之间用 smoothstep 过渡。
       *
       * ★ 另外必须做**纬度面积校正**：贴图 u 方向在极区被压缩，
       *   不校正的话陆块在高纬会被拉成竖长条。做法是把 u 方向的
       *   采样频率除以 cos(lat)，等价于在画布上把极区的陆块横向铺开。
       */
      const o = ocean(u, v);
      const depth = l - SEA_LEVEL;

      let r: number;
      let g: number;
      let b: number;
      if (depth < 0) {
        /* —— 海洋 —— 越深越暗越蓝 */
        const dk = Math.min(1, -depth / 0.16); // 0=近岸, 1=深海
        r = 26 - dk * 18 + o * 16;
        g = 54 - dk * 30 + o * 40;
        b = 104 - dk * 34 + o * 60;
        /*
         * 浅海 / 大陆架：depth 在 [-0.03, 0) 之间提亮成青绿，
         * 这是「海岸线」最直观的信号——一圈比深海亮的青边。
         */
        const shelf = Math.min(1, Math.max(0, (depth + 0.03) / 0.03));
        r += shelf * 30;
        g += shelf * 62;
        b += shelf * 34;
      } else {
        /* —— 陆地 —— 按高度分带 */
        const dry = Math.min(1, lat * 1.15);
        // 海岸带（低地）：饱和绿
        let lr = 44 + dry * 78;
        let lg = 96 + (1 - dry) * 34 - dry * 26;
        let lb = 42 + dry * 40;
        /*
         * 山脉：depth 大 = 内陆高地，向棕灰过渡并提亮（受光面）。
         * 用 0.10 作为「山地」起点，0.22 以上算高海拔。
         */
        const mt = Math.min(1, Math.max(0, (depth - 0.16) / 0.34));
        lr = lr * (1 - mt) + (128 + dry * 34) * mt;
        lg = lg * (1 - mt) + (118 + dry * 22) * mt;
        lb = lb * (1 - mt) + (108 + dry * 20) * mt;
        /*
         * 雪线：高纬（dry 大）雪线降得更低；山地很高（depth 大）也积雪。
         * 用 smoothstep 让雪线不是一条硬边。
         */
        /*
         * 雪线：★ 阈值必须显著高于「大陆核典型高度」，否则整块大陆会被涂成白色。
         *   历史事故：原为 snowAlt = (depth-0.19)/0.10，而大陆核场的 depth
         *   实测可轻松超过 0.5 —— 于是几乎所有陆地都判成雪，贴图下半张全白
         *   （截图 _shots/iso/tex-Earth.png 确认）。
         *   现在 0.42 起步、0.16 宽度，只有核部最高的那一圈山脉积雪；
         *   高纬（dry>0.86）另有 0.7 权重的纬度雪，形成南北极附近的雪原。
         */
        const snowAlt = Math.max(0, (depth - 0.42) / 0.16);
        const snowLat = Math.max(0, (dry - 0.86) / 0.14);
        const snow = Math.min(1, snowAlt + snowLat * 0.7);
        lr = lr * (1 - snow) + 238 * snow;
        lg = lg * (1 - snow) + 242 * snow;
        lb = lb * (1 - snow) + 248 * snow;

        r = lr;
        g = lg;
        b = lb;
      }
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 极冠（冰盖）
  paintPolarCaps(ctx, TEX_W, TEX_H, {
    color: '#f2f7ff',
    northEdge: 0.085,
    southEdge: 0.925,
    seed: 0x1a2b,
  });
  return toTexture(cv);
}

/** 地球云层壳贴图：白絮状，alpha 通道承载云的浓淡 */
function earthCloudTexture(): CanvasTexture {
  const { cv, ctx } = makeCanvasCanvas(TEX_W, TEX_H);
  const fbm = makeFbm(0x7d31, 5);
  const img = ctx.createImageData(TEX_W, TEX_H);
  for (let y = 0; y < TEX_H; y++) {
    const v = y / TEX_H;
    for (let x = 0; x < TEX_W; x++) {
      const u = x / TEX_W;
      // 云在经度方向拉长（风带），纬度方向频率高
      const n = fbm(u * 2.6, v * 4.2);
      // 赤道辐合带 + 中纬风暴带：云更密
      const bandBoost =
        Math.exp(-Math.pow((v - 0.5) / 0.07, 2)) * 0.22 +
        Math.exp(-Math.pow((v - 0.24) / 0.1, 2)) * 0.18 +
        Math.exp(-Math.pow((v - 0.76) / 0.1, 2)) * 0.18;
      /*
       * 云量阈值同样要贴合分布：fbm 均值 ~0.6，若用 0.52 会让 70%+ 球面
       * 覆盖厚云，地球看起来是个白球而不是「蓝白」。取 0.70 让云占约 30%。
       */
      const a = Math.min(1, Math.max(0, (n + bandBoost - 0.70) / 0.26));
      // 云最高只到 0.82 不透明度，保证底下的蓝海always透出来
      
      const i = (y * TEX_W + x) * 4;
      img.data[i] = 244;
      img.data[i + 1] = 248;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 0.82 * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(cv);
}

/**
 * 火星：赤红 + 极冠。
 * 做法：锈红基底 → 大尺度暗高原（如大瑟提斯）→ 亮尘暴区 → 南北极冠。
 */
function marsTexture(): CanvasTexture {
  const { cv, ctx } = makeCanvasCanvas(TEX_W, TEX_H);
  const img = ctx.createImageData(TEX_W, TEX_H);
  /*
   * 用**球面 fbm** 而不是 2D fbm：2D 噪声在极点会被横向极度拉伸，
   * 火星这类以地表纹理为主的星球会明显露出「极区竖条纹」。
   * 球面 3D 采样则全球各向同性（详见 makeSphereFbm 注释）。
   */
  const fbm = makeSphereFbm(0x4f17, 6);
  /* 中尺度起伏：给沙丘/岩床的次级纹理，单独一层避免被基频吃掉 */
  const mid = makeSphereFbm(0x9a42, 4);
  const ramp = makeRamp([
    [0, '#6d2d1a'],
    [0.34, '#a8482a'],
    [0.6, '#c9683a'],
    [0.82, '#dd8f57'],
    [1, '#efc08a'],
  ]);
  for (let y = 0; y < TEX_H; y++) {
    const v = y / TEX_H;
    for (let x = 0; x < TEX_W; x++) {
      const u = x / TEX_W;
      const n = fbm(u, v) * 0.74 + (mid(u, v) - 0.5) * 0.34 + 0.06;
      const rgb = parseRamp(ramp, Math.max(0, Math.min(1, n)));
      const i = (y * TEX_W + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  /*
   * 撞击坑：火星南半球高地密布陨石坑，是它区别于「红色无特征球」的关键。
   * 只画坑缘亮弧 + 坑底暗晕两笔，小尺度、低对比（远处看不出、近景成质感）。
   */
  const crnd = makeRng(0x7d5a);
  for (let i = 0; i < 260; i++) {
    const v = 0.30 + crnd() * 0.68;
    const cx = crnd() * TEX_W;
    const cy = v * TEX_H;
    const r = 2 + Math.pow(crnd(), 2.0) * 13;
    const stretch = 1 / Math.max(0.3, Math.cos((v - 0.5) * Math.PI));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(stretch, 1);
    const rr = r / stretch;
    // 坑底暗晕
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
    g.addColorStop(0, 'rgba(92,42,24,0.34)');
    g.addColorStop(0.7, 'rgba(112,54,30,0.16)');
    g.addColorStop(1, 'rgba(120,60,34,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, TAU);
    ctx.fill();
    // 坑缘亮弧（受光侧）
    ctx.strokeStyle = 'rgba(233,190,150,0.30)';
    ctx.lineWidth = Math.max(0.5, rr * 0.16);
    ctx.beginPath();
    ctx.arc(0, 0, rr * 0.92, Math.PI * 0.12, Math.PI * 1.06);
    ctx.stroke();
    ctx.restore();
  }
  /*
   * 水手谷式的巨型峡谷系统：一条横贯赤道附近的长条暗红裂谷。
   * 这是火星最容易辨认的地貌之一，用几段相连的细长渐变压出来。
   */
  const vrnd = makeRng(0x2c88);
  let vx = 0.18 * TEX_W;
  let vy = 0.50 * TEX_H;
  for (let seg = 0; seg < 9; seg++) {
    const w = 60 + vrnd() * 70;
    const h = 5 + vrnd() * 7;
    paintBlob(ctx, vx, vy, w, h, '#5e2413', 0.30, 0.72);
    paintBlob(ctx, vx, vy + 1, w * 0.8, h * 0.5, '#6d2f18', 0.22, 0.6);
    vx += w * 0.75;
    vy += (vrnd() - 0.5) * 16;
  }

  // 大瑟提斯式的暗高原（大块深色区）
  const rnd = makeRng(0x33c1);
  for (let i = 0; i < 9; i++) {
    const v = 0.16 + rnd() * 0.68;
    paintBlob(
      ctx,
      rnd() * TEX_W,
      v * TEX_H,
      60 + rnd() * 130,
      30 + rnd() * 60,
      '#6d2c18',
      0.34,
      0.85,
    );
  }
  // 亮尘区
  for (let i = 0; i < 7; i++) {
    paintBlob(
      ctx,
      rnd() * TEX_W,
      (0.2 + rnd() * 0.6) * TEX_H,
      50 + rnd() * 110,
      26 + rnd() * 50,
      '#e8b177',
      0.28,
      0.85,
    );
  }
  // 极冠：火星南北极冠比地球小但更亮
  paintPolarCaps(ctx, TEX_W, TEX_H, {
    color: '#f6f4ee',
    northEdge: 0.055,
    southEdge: 0.945,
    seed: 0x8ac3,
  });
  return toTexture(cv);
}

/**
 * 木星：条带 + 大红斑（本任务近景的核心验收点）。
 *
 * 条带不是均匀横条：木星的带边界被**湍流撕出波浪和小涡流**，
 * 所以这里先铺 14 条主带，再在带边界附近随机抛一批小椭圆涡旋，
 * 最后叠大红斑（暗红椭圆 + 亮环 + 内部旋涡）。
 */
function jupiterTexture(): CanvasTexture {
  const { cv, ctx } = makeCanvasCanvas(TEX_W, TEX_H);
  /*
   * 基底：木星整体奶黄（亮区），暗带另铺。
   * 真实木星一共约 10 条主导带/区（南北各 5），带边界不规则且被湍流撕开。
   * 这里先铺 7 条亮区、7 条暗带，条数按真实比例（越靠赤道越宽）。
   */
  ctx.fillStyle = '#d9c39a';
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  /*
   * 先叠一层**球面噪声**做低频明暗不均：真实木星的带不是等宽的，
   * 同一条带在经度方向上时宽时窄、时明时暗。
   * 2D 噪声会在极点拉成条纹，木星纬度覆盖几乎没有极区，
   * 但带本身横贯全球，仍用球面采样最稳。
   */
  const jN = makeSphereFbm(0x7ac3, 5);
  const jImg = ctx.getImageData(0, 0, TEX_W, TEX_H);
  for (let y = 0; y < TEX_H; y++) {
    const v = y / TEX_H;
    for (let x = 0; x < TEX_W; x++) {
      const u = x / TEX_W;
      const k = (jN(u, v) - 0.5) * 0.30;
      const i = (y * TEX_W + x) * 4;
      jImg.data[i] = Math.max(0, Math.min(255, jImg.data[i] * (1 + k)));
      jImg.data[i + 1] = Math.max(0, Math.min(255, jImg.data[i + 1] * (1 + k * 0.94)));
      jImg.data[i + 2] = Math.max(0, Math.min(255, jImg.data[i + 2] * (1 + k * 0.86)));
    }
  }
  ctx.putImageData(jImg, 0, 0);

  // 亮区（zones）先铺，再压暗带（belts）
  paintBands(
    ctx,
    TEX_W,
    TEX_H,
    [
      { p: 0.10, color: 'rgba(232,222,198,0.62)', thickness: 0.055, wobble: 0.007 },
      { p: 0.175, color: 'rgba(248,240,220,0.72)', thickness: 0.055, wobble: 0.007 },
      { p: 0.30, color: 'rgba(252,246,230,0.74)', thickness: 0.062, wobble: 0.008 },
      { p: 0.435, color: 'rgba(250,243,226,0.66)', thickness: 0.058, wobble: 0.007 },
      { p: 0.565, color: 'rgba(248,241,224,0.62)', thickness: 0.055, wobble: 0.008 },
      { p: 0.70, color: 'rgba(244,236,214,0.68)', thickness: 0.058, wobble: 0.007 },
      { p: 0.86, color: 'rgba(230,222,204,0.58)', thickness: 0.062, wobble: 0.008 },
    ],
    0x11aa,
  );
  // 暗带（棕/赭）
  paintBands(
    ctx,
    TEX_W,
    TEX_H,
    [
      // 赤道带（EB）最宽最红，是木星最醒目的特征之一
      { p: 0.238, color: 'rgba(158,104,62,0.74)', thickness: 0.038, wobble: 0.010 },
      { p: 0.365, color: 'rgba(146,94,56,0.80)', thickness: 0.046, wobble: 0.012 },
      { p: 0.50, color: 'rgba(178,124,78,0.52)', thickness: 0.040, wobble: 0.011 },
      { p: 0.635, color: 'rgba(142,90,54,0.80)', thickness: 0.048, wobble: 0.013 },
      { p: 0.775, color: 'rgba(150,98,60,0.74)', thickness: 0.044, wobble: 0.012 },
      { p: 0.912, color: 'rgba(118,78,50,0.62)', thickness: 0.044, wobble: 0.009 },
    ],
    0x22bb,
  );
  // 南北极区整体压暗
  paintPolarCaps(ctx, TEX_W, TEX_H, {
    color: '#8a6a52',
    northEdge: 0.06,
    southEdge: 0.94,
    seed: 0x44cc,
  });

  // 带边界的湍流涡旋：在暗带边界上抛小椭圆，模拟木星的「花椰菜」边缘
  const rnd = makeRng(0x9f31);
  const beltPs = [0.238, 0.365, 0.50, 0.635, 0.775, 0.912];
  for (let i = 0; i < 420; i++) {
    const p = beltPs[i % beltPs.length];
    const y = (p + (rnd() - 0.5) * 0.045) * TEX_H;
    const x = rnd() * TEX_W;
    const rx = 8 + rnd() * 34;
    const ry = 3 + rnd() * 9;
    const bright = rnd() > 0.5;
    paintBlob(
      ctx,
      x,
      y,
      rx,
      ry,
      bright ? '#f3e7cb' : '#7d4f31',
      bright ? 0.3 : 0.32,
      0.7,
    );
  }

  // ★ 大红斑：位于南半球（约 22°S），暗红椭圆 + 亮环 + 内部旋涡
  const grsX = 0.62 * TEX_W;
  /*
   * 大红斑位于约 22°S。v = 0.5 + lat/180 且 v=0 是北极、
   * v=1 是南极 -> 22°S 对应 v ≈ 0.5 + 22/180 ≈ 0.622。
   * （早期取 0.665 略偏南，近景对位不够准。）
   */
  const grsY = 0.622 * TEX_H;
  const grsRX = 96;
  const grsRY = 48;
  // 外圈亮环（红斑被亮云包裹）——真实 GRS 四周是明亮的白色钩状云
  paintBlob(ctx, grsX - grsRX * 0.35, grsY, grsRX * 1.55, grsRY * 1.75, '#f7eed8', 0.46, 0.75);
  // 主体
  ctx.save();
  ctx.translate(grsX, grsY);
  ctx.scale(1, grsRY / grsRX);
  const gGrad = ctx.createRadialGradient(0, 0, grsRX * 0.12, 0, 0, grsRX);
  gGrad.addColorStop(0, 'rgba(198,86,50,0.98)');
  gGrad.addColorStop(0.5, 'rgba(176,66,38,0.95)');
  gGrad.addColorStop(0.82, 'rgba(160,70,44,0.72)');
  gGrad.addColorStop(1, 'rgba(150,80,54,0)');
  ctx.fillStyle = gGrad;
  ctx.beginPath();
  ctx.arc(0, 0, grsRX, 0, TAU);
  ctx.fill();
  // 内部同心涡旋
  ctx.globalAlpha = 0.4;
  for (let k = 1; k <= 3; k++) {
    ctx.beginPath();
    ctx.arc(0, 0, grsRX * (0.2 + k * 0.2), 0, TAU);
    ctx.strokeStyle = k % 2 === 0 ? 'rgba(226,150,110,0.6)' : 'rgba(120,40,26,0.6)';
    ctx.lineWidth = 2.6;
    ctx.stroke();
  }
  ctx.restore();

  return toTexture(cv);
}

/**
 * 土星：淡金条带（比木星柔和得多）。
 * 环不在这里 —— 环是独立几何（见 buildSaturnRings），必须能透光、有缝隙。
 */
function saturnTexture(): CanvasTexture {
  const { cv, ctx } = makeCanvasCanvas(TEX_W, TEX_H);
  /*
   * 土星：淡金、条带远比木星柔和（雾气遮蔽，对比度低），
   * 赤道带略偏暖、极区偏冷灰。辨识点在于「金 + 极柔 + 有条缝隙的环」，
   * 所以条带只做低对比，绝不画成木星那种强暗带。
   */
  ctx.fillStyle = '#e0cda0';
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  // 低频明暗不均（球面采样，避免极区条纹）
  const sN = makeSphereFbm(0x3ad9, 4);
  const sImg = ctx.getImageData(0, 0, TEX_W, TEX_H);
  for (let y = 0; y < TEX_H; y++) {
    const v = y / TEX_H;
    for (let x = 0; x < TEX_W; x++) {
      const k = (sN(x / TEX_W, v) - 0.5) * 0.16;
      const i = (y * TEX_W + x) * 4;
      sImg.data[i] = Math.max(0, Math.min(255, sImg.data[i] * (1 + k)));
      sImg.data[i + 1] = Math.max(0, Math.min(255, sImg.data[i + 1] * (1 + k * 0.95)));
      sImg.data[i + 2] = Math.max(0, Math.min(255, sImg.data[i + 2] * (1 + k * 0.85)));
    }
  }
  ctx.putImageData(sImg, 0, 0);
  paintBands(
    ctx,
    TEX_W,
    TEX_H,
    [
      { p: 0.135, color: 'rgba(206,182,132,0.34)', thickness: 0.055, wobble: 0.009 },
      { p: 0.245, color: 'rgba(236,220,178,0.40)', thickness: 0.062, wobble: 0.008 },
      { p: 0.345, color: 'rgba(198,170,118,0.36)', thickness: 0.055, wobble: 0.010 },
      { p: 0.455, color: 'rgba(242,230,196,0.42)', thickness: 0.070, wobble: 0.008 },
      { p: 0.575, color: 'rgba(202,176,124,0.34)', thickness: 0.058, wobble: 0.010 },
      { p: 0.685, color: 'rgba(238,224,186,0.38)', thickness: 0.062, wobble: 0.009 },
      { p: 0.800, color: 'rgba(196,168,116,0.36)', thickness: 0.058, wobble: 0.010 },
      { p: 0.900, color: 'rgba(210,188,142,0.30)', thickness: 0.062, wobble: 0.008 },
    ],
    0x66dd,
  );
  paintNoiseMottle(ctx, TEX_W, TEX_H, 0x2f81, { color: '#b59a68', alpha: 0.20, scale: 4.0 });
  paintPolarCaps(ctx, TEX_W, TEX_H, {
    color: '#9a8a6a',
    northEdge: 0.1,
    southEdge: 0.9,
    seed: 0x7788,
  });
  return toTexture(cv);
}

/** 天王星：青蓝、近乎无特征（只有极淡的条带与一两处亮斑） */
function uranusTexture(): CanvasTexture {
  const { cv, ctx } = makeCanvasCanvas(TEX_W, TEX_H);
  const img = ctx.createImageData(TEX_W, TEX_H);
  /*
   * 天王星：★ 辨识点就是「几乎什么都没有」——
   * 甲烷大气把可见光特征全部抹平，只有极淡的青蓝与一条若有若无的亮带。
   * 细节做多反而会失真，所以这里刻意保守。
   */
  const fbm = makeSphereFbm(0x1c2d, 4);
  const ramp = makeRamp([
    [0, '#7cc4cc'],
    [0.45, '#9ad8dd'],
    [0.8, '#b6e8ea'],
    [1, '#cdf2f4'],
  ]);
  for (let y = 0; y < TEX_H; y++) {
    const v = y / TEX_H;
    for (let x = 0; x < TEX_W; x++) {
      const n = fbm(x / TEX_W, v) * 0.62 + 0.19;
      const rgb = parseRamp(ramp, n);
      const i = (y * TEX_W + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 极淡的条带（几乎看不出，这是天王星的辨识特征：太光滑了）
  paintBands(
    ctx,
    TEX_W,
    TEX_H,
    [
      { p: 0.34, color: 'rgba(190,232,236,0.2)', thickness: 0.06, wobble: 0.01 },
      { p: 0.66, color: 'rgba(150,206,214,0.18)', thickness: 0.06, wobble: 0.01 },
    ],
    0x99ee,
  );
  // 两三处极淡亮斑
  const rnd = makeRng(0xabcd);
  for (let i = 0; i < 3; i++) {
    paintBlob(ctx, rnd() * TEX_W, (0.3 + rnd() * 0.4) * TEX_H, 70, 34, '#dcf7f8', 0.2, 0.9);
  }
  return toTexture(cv);
}

/** 海王星：深蓝 + 亮蓝条带 + 大暗斑 */
function neptuneTexture(): CanvasTexture {
  const { cv, ctx } = makeCanvasCanvas(TEX_W, TEX_H);
  const img = ctx.createImageData(TEX_W, TEX_H);
  /*
   * 海王星：最深的蓝 + 几道亮蓝带 + 大暗斑（Great Dark Spot）。
   * 大暗斑是它唯一的强特征，必须够明显，否则远处看就是个蓝点。
   */
  const fbm = makeSphereFbm(0x5e6f, 5);
  const detail = makeSphereFbm(0x7b13, 3);
  const ramp = makeRamp([
    [0, '#1e3a86'],
    [0.42, '#3357b6'],
    [0.72, '#527cd8'],
    [1, '#8fb0f2'],
  ]);
  for (let y = 0; y < TEX_H; y++) {
    const v = y / TEX_H;
    for (let x = 0; x < TEX_W; x++) {
      const u = x / TEX_W;
      const n = fbm(u, v) * 0.66 + (detail(u, v) - 0.5) * 0.22 + 0.20;
      const rgb = parseRamp(ramp, n);
      const i = (y * TEX_W + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 亮蓝条带
  paintBands(
    ctx,
    TEX_W,
    TEX_H,
    [
      { p: 0.26, color: 'rgba(150,180,244,0.42)', thickness: 0.05, wobble: 0.012 },
      { p: 0.44, color: 'rgba(120,155,235,0.34)', thickness: 0.06, wobble: 0.014 },
      { p: 0.72, color: 'rgba(158,188,246,0.4)', thickness: 0.05, wobble: 0.012 },
    ],
    0xcc11,
  );
  // 大暗斑（南半球）
  paintBlob(ctx, 0.34 * TEX_W, 0.63 * TEX_H, 96, 46, '#16265c', 0.68, 0.75);
  paintBlob(ctx, 0.34 * TEX_W, 0.63 * TEX_H, 150, 72, '#7fa4ee', 0.22, 0.9);
  const rnd = makeRng(0x2468);
  for (let i = 0; i < 4; i++) {
    paintBlob(ctx, rnd() * TEX_W, (0.25 + rnd() * 0.4) * TEX_H, 46, 22, '#dbe6ff', 0.24, 0.9);
  }
  return toTexture(cv);
}

/**
 * 太阳：对流颗粒（自发光）。
 * 太阳本体用 MeshBasicMaterial（不受光照，本身即光源），
 * 所以这张贴图直接就是「看上去的颜色」，不需要考虑光照响应。
 */
function sunTexture(): CanvasTexture {
  const { cv, ctx } = makeCanvasCanvas(TEX_W, TEX_H);
  const img = ctx.createImageData(TEX_W, TEX_H);
  /*
   * 米粒组织（granulation）。
   *
   * ★ 修复记录：原先 `gran` 用 u*14、`big` 用 u*2.2。
   *   `big` 的基频格点 period=4，采样尺度只有 2.2 —— 也就是说整个球面
   *   只跨了 2.2 个格点，低频项退化成**一两条横贯球面的暗带**，
   *   远看就是太阳脸上两道竖直暗痕（用户会觉得是「脏」）。
   *
   *   现在把低频项提到 5.5 个格点量级，它才真正读作「大尺度对流胞」，
   *   而不是一条带；同时把权重从 0.55 压到 0.42，让高频粒状纹理主导。
   */
  const gran = makeFbm(0x1357, 5);
  const big = makeFbm(0x2469, 3);
  const ramp2 = makeRamp([
    [0, '#c9660f'],
    [0.32, '#f2952c'],
    [0.6, '#ffc861'],
    [0.82, '#ffeab8'],
    [1, '#fffdf4'],
  ]);
  for (let y = 0; y < TEX_H; y++) {
    const v = y / TEX_H;
    for (let x = 0; x < TEX_W; x++) {
      const u = x / TEX_W;
      // 米粒组织：高频小颗粒 + 低频大尺度明暗
      /*
       * 经度方向格点密度可以高一些（贴图横向 1024），纬度方向低一些
       * （横向 512），这样米粒在球面上是接近方形的，不会拉成竖条。
       */
      const g = gran(u * 16, v * 12);
      const b = big(u * 5.5, v * 4.0);
      const t = Math.min(1, Math.max(0, g * 0.58 + b * 0.42));
      const rgb = parseRamp(ramp2, t);
      const i = (y * TEX_W + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  /*
   * —— 太阳黑子 ——
   *
   * ★ 修复记录（用户反馈「太阳上有不明黑斑」）：
   *
   *   旧实现有三个叠加的错误，合起来让黑子读作「贴图上的一块黑污渍」：
   *     1. `x = rnd() * TEX_W` 没有边缘留白 —— 画在 x≈0 / x≈TEX_W 的黑子
   *        被 UV 接缝裁掉一半，接缝处留下**硬直边的黑斑**。这就是「不明」。
   *     2. 半径过大（r*2.0，最大 50px）且双层高斯糊在一起，没有本影/半影结构。
   *     3. 颜色 #3a1702 + alpha 0.85 接近纯黑，在明亮的米粒组织上反差过强。
   *
   *   现在：中心强制内缩；单个更小但数量更多（12 个）；每个都有
   *   本影 + 3 圈半影；颜色不低于 #7a3a08 量级。
   */
  const rnd = makeRng(0x8642);
  const SUNSPOT_X_MARGIN = 96;
  const SUNSPOT_Y_MARGIN = 78;
  for (let i = 0; i < 12; i++) {
    /*
     * 纬度集中在低纬活动带（太阳黑子实际就出现在 ±30° 附近）。
     * 用「两次取样取中间」把分布往 0.5 附近收，而不是均匀撒；
     * 落在 v∈[0.28,0.72] 之外的以 0.35 的概率保留，作为零星高纬黑子。
     * 这样既符合天文，也避免极点附近 UV 拉伸把黑子拉变形。
     */
    let v = (rnd() + rnd()) * 0.5;
    if (v < 0.28 || v > 0.72) {
      if (rnd() > 0.35) v = 0.34 + rnd() * 0.32;
    }
    /*
     * 纵向也留白：贴图上下边缘对应南北极，那里 UV 被极度拉伸，
     * 黑子会被拉成一条横线；同时避免被贴图边界裁掉。
     * 这是「不明黑斑」的第二个来源——被裁一半的黑子在球上是个硬边缺口。
     */
    const y = SUNSPOT_Y_MARGIN + v * (TEX_H - SUNSPOT_Y_MARGIN * 2);

    /*
     * 本影半径 6~13px（旧实现等效 9~25px 的双层叠加，明显过大）。
     * 半影外径约为本影的 2.2 倍，但整体仍受 margin 约束。
     */
    /*
     * 本影半径 7~16px。半影外径 = 本影 × 3.0 —— 这个比例是为了
     * 让半影在近景下**有肉眼可见的宽度**（真实黑子半影约为
     * 本影的 2~3 倍）。之前的 2.2 倍在半影 alpha 很低时等于没有。
     */
    const r = 7 + rnd() * 9;
    const outer = r * 3.0;
    const x = SUNSPOT_X_MARGIN + rnd() * (TEX_W - SUNSPOT_X_MARGIN * 2);
    const strength = 0.72 + rnd() * 0.28;
    paintSunspot(ctx, x, y, outer, strength);
  }
  return toTexture(cv);
}

// ---------------------------------------------------------------- 贴图缓存

const cache = new Map<TexKey, Texture>();

/**
 * 贴图来源标记：'asset' = 预烘焙静态图就位；'procedural' = 回退到现场逐像素生成。
 * 供验收脚本断言「确实走了静态资源路径」。
 */
let textureSource: 'asset' | 'procedural' | null = null;

/** 当前贴图来源（null = 尚未预载） */
export function getTextureSource(): 'asset' | 'procedural' | null {
  return textureSource;
}

/**
 * 预载 11 张**预烘焙贴图**。
 *
 * ★ 为什么必须有这一步（根因记录，实测数据）：
 *   原先 11 张贴图是进入星轨时**同步逐像素**在 2D canvas 上算出来的。
 *   `_probe/tex-bench.html` 实测账单：8 颗行星各约 950ms、太阳 220ms、
 *   云层 64ms、日冕 0.1ms，**首次合计 7876ms**；浏览器里表现为
 *   `PerformanceObserver` 捕获到的 **10905ms 主线程长任务** ——
 *   页面整整冻结 11 秒，用户读作「星轨加载不出来」。
 *   CPU 剖面把热点指到 `makeValueNoise` 的格点采样闭包（self 2863ms）。
 *
 *   现在改成：构建期用 `scripts/bake-textures.mjs` 把同样这些画布烘焙成
 *   `public/textures/*.webp`，运行时只做**异步**图片解码（不占主线程），
 *   场景构建时直接命中缓存。
 *
 * 失败容忍：任何一张 404/解码失败都**不 reject**，只是该 key 不走缓存，
 *   回退到原程序化路径（`getPlanetTexture` 等内部的 `switch`）。
 *   这样即使 `public/textures` 不存在，功能也不缺失（只是慢回 11 秒）。
 */
export function preloadTextures(): Promise<void> {
  if (preloadPromise !== null) return preloadPromise;
  preloadPromise = (async (): Promise<void> => {
    const keys = Object.keys(TEX_FILES) as TexKey[];
    await Promise.all(keys.map((k) => loadBakedTexture(k)));
    const hit = keys.filter((k) => cache.has(k)).length;
    textureSource = hit === keys.length ? 'asset' : 'procedural';
    if (hit !== keys.length) {
      console.warn(
        `[planetMaterials] 预烘焙贴图仅命中 ${hit}/${keys.length} 张，` +
          '未命中者将现场生成（会有主线程卡顿）。请先运行 scripts/bake-textures.mjs。',
      );
    }
  })();
  return preloadPromise;
}

let preloadPromise: Promise<void> | null = null;

/** 载入单张烘焙贴图；失败时 resolve（由调用方回退），不 reject */
function loadBakedTexture(key: TexKey): Promise<void> {
  return new Promise<void>((resolve) => {
    const spec = TEX_FILES[key];
    const img = new Image();
    img.decoding = 'async';
    img.onload = (): void => {
      const tex = new Texture(img);
      tex.colorSpace = 'srgb';
      tex.name = `baked:${key}`;
      tex.needsUpdate = true;
      cache.set(key, tex);
      resolve();
    };
    img.onerror = (): void => {
      console.warn(`[planetMaterials] 烘焙贴图读取失败，回退程序化：${spec.file}`);
      resolve();
    };
    img.src = `${TEX_BASE}${spec.file}`;
  });
}

/** 取（并缓存）某天体的表面贴图。同一颗行星整场只生成一次 */
export function getPlanetTexture(key: BodyKey): Texture {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let tex: CanvasTexture;
  switch (key) {
    case 'Mercury':
      tex = mercuryTexture();
      break;
    case 'Venus':
      tex = venusTexture();
      break;
    case 'Earth':
      tex = earthTexture();
      break;
    case 'Mars':
      tex = marsTexture();
      break;
    case 'Jupiter':
      tex = jupiterTexture();
      break;
    case 'Saturn':
      tex = saturnTexture();
      break;
    case 'Uranus':
      tex = uranusTexture();
      break;
    case 'Neptune':
      tex = neptuneTexture();
      break;
    default:
      tex = mercuryTexture();
      break;
  }
  cache.set(key, tex);
  return tex;
}

/** 太阳表面贴图 */
export function getSunTexture(): Texture {
  const hit = cache.get('Sun');
  if (hit !== undefined) return hit;
  const tex = sunTexture();
  cache.set('Sun', tex);
  return tex;
}

/** 地球云层贴图 */
export function getEarthCloudTexture(): Texture {
  const hit = cache.get('EarthClouds');
  if (hit !== undefined) return hit;
  const tex = earthCloudTexture();
  cache.set('EarthClouds', tex);
  return tex;
}

/** 释放所有缓存贴图（场景 dispose 时调用；实际是模块级缓存，一般不必释放） */
export function disposeTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
  preloadPromise = null;
  textureSource = null;
}

// ---------------------------------------------------------------- 材质构造

/** 目标外观：由调用方给出的行星「基准色」，用于给贴图上色温（tint） */
export interface PlanetLook {
  /** 表面贴图 */
  map: Texture;
  /** 光照下的固有色乘子 */
  color: number;
  /** 粗糙度（岩石行星高、气态行星低） */
  roughness: number;
  /** 金属度（行星皆为 0） */
  metalness: number;
}

/**
 * 建一颗行星的**表面材质**。
 *
 * 用 MeshStandardMaterial 而不是 Basic：行星要靠太阳的平行光产生**明暗交界线**，
 * 这是「球体」而不是「贴了图的圆片」最直接的视觉信号。
 * 但为了让暗面不至于全黑（原片里暗面仍隐约可见），场景会补一盏极弱的冷色环境光。
 */
export function createPlanetMaterial(look: PlanetLook): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    map: look.map,
    color: look.color,
    roughness: look.roughness,
    metalness: look.metalness,
  });
  return mat;
}

/**
 * 给行星材质**原地**加一圈大气边缘辉光（用 onBeforeCompile 注入）。
 *
 * ★ 为什么不用独立的「大气壳」Mesh：
 *
 *   原先的做法是在行星外面套一个 1.12R 的球壳，用 BackSide + additive
 *   渲染。它的投影是一圈**带宽恒定的环**，环的内边界恰好落在行星轮廓上，
 *   于是近景会看到「球面上有一道和球边缘分离的硬色环」，环与球之间
 *   还有一条暗缝（截图实测确认，地球/木星/金星都有）。
 *   根因：壳的剪影环宽由 (1.12R − R) 决定，与视线角度无关，
 *   既不受行星贴图控制，也无法做出「贴着轮廓线、向外柔和溢出」的形状。
 *
 * ★ 现在的做法：
 *
 *   直接在行星表面着色器的 fragment 末尾注入菲涅尔项。
 *   vNormal 与视线夹角 -> 掠射处（球面边缘）最亮，向球心平滑衰减。
 *   因为就在球面上算，辉光**天然贴合轮廓**，不可能出现缝隙，
 *   也不增加任何绘制调用。半球背光侧的辉光也自然正确（法线朝向决定）。
 *
 * @param mat   行星材质（会被就地修改）
 * @param color 大气色（十六进制）
 * @param intensity 强度，0 关闭
 */
export function applyAtmosphereRim(
  mat: MeshStandardMaterial,
  color: string,
  intensity: number,
): void {
  if (intensity <= 0) return;
  const c = new Color(color);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAtmoColor = { value: c };
    shader.uniforms.uAtmoIntensity = { value: intensity };

    // 顶点：把视线方向与法线传到片元
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vAtmoN;
         varying vec3 vAtmoV;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         {
           vec4 atmoMv = modelViewMatrix * vec4(transformed, 1.0);
           vAtmoN = normalize(normalMatrix * objectNormal);
           vAtmoV = normalize(-atmoMv.xyz);
         }`,
      );

    // 片元：在最终颜色上叠加菲涅尔辉光
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 uAtmoColor;
         uniform float uAtmoIntensity;
         varying vec3 vAtmoN;
         varying vec3 vAtmoV;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         {
           /*
            * 菲涅尔：球面边缘（掠射）最强，球心为 0。
            * 3.4 次幂让辉光集中在很窄的一圈，看起来像薄大气而不是雾罩。
            * 乘 max(0, N·V) 的补：背光面不额外加光，避免夜面被描边。
            */
           float atmoNdv = abs(dot(normalize(vAtmoN), normalize(vAtmoV)));
           float atmoF = pow(1.0 - atmoNdv, 3.4);
           gl_FragColor.rgb += uAtmoColor * atmoF * uAtmoIntensity;
         }`,
      );
  };
  // onBeforeCompile 变了要让 three 重新编译
  mat.customProgramCacheKey = () => `atmo:${color}:${intensity.toFixed(3)}`;
  mat.needsUpdate = true;
}

/** 每颗行星的材质参数表（岩石 vs 气态） */
export function planetMaterialFor(key: BodyKey, baseColor: string): MeshStandardMaterial {
  const rocky = key === 'Mercury' || key === 'Mars';
  const dusty = key === 'Venus';
  const earth = key === 'Earth';
  const icy = key === 'Uranus' || key === 'Neptune';
  return createPlanetMaterial({
    map: getPlanetTexture(key),
    color: new Color(baseColor).getHex(),
    roughness: rocky ? 0.94 : dusty ? 0.8 : earth ? 0.72 : icy ? 0.62 : 0.68,
    metalness: 0,
  });
}

/**
 * 太阳材质：自发光。
 * MeshBasicMaterial = 不受光照影响，本身就是最亮的物体；
 * 再叠一层 additive 的日冕 Sprite（在场景里加）表达外发光。
 */
export function createSunMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map: getSunTexture(),
    color: 0xffffff,
    fog: false,
  });
}

/**
 * 日冕辉光贴图：径向渐变（白 → 金 → 透明）。
 * 场景里用 additive 的 Sprite 贴在太阳上，尺寸是太阳半径的数倍。
 */
export function getSunGlowTexture(): Texture {
  const cached = cache.get('SunGlow');
  if (cached !== undefined) return cached;
  const S = 256;
  const { cv, ctx } = makeCanvasCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  /*
   * ★ 日冕的能量必须**集中在核心**，衰减要快。
   *
   *   旧参数（0.12→0.95、0.28→0.42、0.55→0.13）把能量铺得很开，
   *   而 Sprite 是 `depthTest:false` 的 additive，于是近景时整个画面
   *   被罩上一层暖橘，木星大红斑、火星地表全被冲掉（截图实测确认）。
   *
   *   新参数把 92% 的能量压在前 18% 半径内，外圈只剩极淡的光尾。
   */
  g.addColorStop(0, 'rgba(255,255,250,1)');
  g.addColorStop(0.08, 'rgba(255,246,214,0.98)');
  g.addColorStop(0.18, 'rgba(255,220,142,0.55)');
  g.addColorStop(0.34, 'rgba(246,182,84,0.16)');
  g.addColorStop(0.60, 'rgba(226,148,58,0.045)');
  g.addColorStop(1, 'rgba(200,124,44,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = toTexture(cv);
  cache.set('SunGlow', tex);
  return tex;
}

/** 行星大气辉光壳材质（BackSide + additive，制造边缘一圈冷光） */
export function createAtmosphereMaterial(color: string, intensity = 1): ShaderMaterial {
  const c = new Color(color);
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: c },
      uIntensity: { value: intensity },
      uPower: { value: 3.1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uPower;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        /*
         * 大气辉光壳（壳半径 = 行星半径 × 1.12）。
         *
         * ★ 为什么用 BackSide + 菲涅尔，以及为什么能量必须集中在「掠射」处：
         *
         *   1) BackSide 渲染的是壳体**远侧**的背面。它在屏幕上恰好占据
         *      「行星圆盘之外 → 壳轮廓线之内」那一圈（壳的剪影环），
         *      也就是现实里大气该露出来的位置。
         *
         *   2) 这一圈上法线与视线的夹角接近 90°，ndv = |N·V| 很小。
         *      反过来，越靠近壳轮廓线的外缘，背面越接近侧对相机，
         *      ndv 越小。
         *
         *   3) 所以「亮 = 1 - ndv」这个方向是对的，但**必须再乘一个
         *      从行星轮廓向外的衰减**，否则整圈会等亮度贴边，
         *      视觉上就是给星球描了一道硬色轮廓线（截图实测确认过：
         *      地球曾经出现一道内外都硬的蓝色圆环，环和球之间还有暗缝）。
         *
         *   4) 让能量在 ndv 稍大处（即更靠近行星轮廓、光程更厚）最强，
         *      向壳外缘平滑衰减到 0，就得到一条柔和、从边缘溢出的辉光。
         *
         *   注：本材质是 AdditiveBlending，只做加法，绝不会压暗底色；
         *      之前看到的「暗环」其实是壳体在行星圆盘上留下的空白带，
         *      由 mask 的分布错误造成，而不是混合模式的问题。
         */
        float ndv = abs(dot(normalize(vN), normalize(vView)));

        // 菲涅尔：掠射（ndv→0）最强
        float rim = pow(1.0 - ndv, uPower);

        // 从壳轮廓（ndv≈0）向行星轮廓（ndv≈0.42）渐强，再向内迅速归零。
        // smoothstep 的两端决定辉光带的宽度与峰值位置。
        float band = smoothstep(0.02, 0.30, ndv) * (1.0 - smoothstep(0.34, 0.52, ndv));

        float f = rim * band;
        gl_FragColor = vec4(uColor, f * uIntensity * 1.6);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: BackSide,
  });
}

/** 云层壳材质 */
export function createCloudMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: getEarthCloudTexture(),
    transparent: true,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
    side: FrontSide,
  });
}

/**
 * 土星环：**带缝隙**的环（本任务近景的另一个验收点）。
 *
 * 做法：用 RingGeometry 的多个环带拼出来，每段环带一个 mesh，
 * 段与段之间的**留白就是缝隙** —— 这比在一整张环贴图上画几条透明线更可靠，
 * 因为缝隙是真的没有几何，放大后不会被 mipmap 糊掉。
 *
 * 环带半径（以行星半径 R 为单位，参照土星真实环系）：
 *   D 环  1.11–1.24  暗
 *   C 环  1.24–1.53  暗（半透明，可以透出行星本体）
 *   ── 卡西尼环缝 1.95–2.03 ──
 *   B 环  1.53–1.95  最亮最密
 *   A 环  2.03–2.27  较亮
 *   ── 恩克环缝 2.21–2.24（在 A 环内）──
 *   F 环  2.32–2.35  极细
 */
export function saturnRingBands(): Array<{
  inner: number;
  outer: number;
  color: string;
  opacity: number;
}> {
  return [
    { inner: 1.11, outer: 1.24, color: '#8c7f68', opacity: 0.3 },
    { inner: 1.24, outer: 1.52, color: '#a99b7e', opacity: 0.46 },
    { inner: 1.53, outer: 1.72, color: '#d8c9a4', opacity: 0.82 },
    { inner: 1.72, outer: 1.95, color: '#c9b892', opacity: 0.72 },
    // ← 1.95–2.03 卡西尼环缝（无几何 = 真缝隙）
    { inner: 2.03, outer: 2.205, color: '#cbb995', opacity: 0.62 },
    // ← 2.205–2.245 恩克环缝
    { inner: 2.245, outer: 2.31, color: '#bfae8b', opacity: 0.5 },
    // ← 2.31–2.33 空隙
    { inner: 2.33, outer: 2.36, color: '#cabf9e', opacity: 0.34 },
  ];
}

/** 用环带表拼出环几何组（单位：1 = 行星半径） */
export function buildSaturnRingGeometries(): Array<{
  geometry: RingGeometry;
  material: MeshBasicMaterial;
}> {
  return saturnRingBands().map((b) => ({
    geometry: new RingGeometry(b.inner, b.outer, 160, 1),
    material: new MeshBasicMaterial({
      color: new Color(b.color),
      transparent: true,
      opacity: b.opacity,
      side: DoubleSide,
      depthWrite: false,
    }),
  }));
}

