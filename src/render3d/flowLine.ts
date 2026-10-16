/**
 * 连线流光特效：命盘节点 ↔ 人体的「能量传输」感。
 *
 * ============================== 需求 ==============================
 *   · 流光沿连线流动，带拖尾，周期脉冲
 *   · 跑马灯式 RGB：色相随时间循环偏移
 *   · 约 24 条连线，**不能**每条一个材质（会爆 draw call）
 *   · 强度随相机距离自适应（拉近更明显、拉远收敛）
 *
 * ============================== 关键设计 ==============================
 *
 * 1) **一个 draw call 画完 24 条流光**
 *    全部折线塞进**同一个** `LineSegments`，共用**一个** `ShaderMaterial`。
 *    逐线的参数走 attribute：
 *      · position —— 已经是世界坐标（折线离散后的顶点，见下）
 *      · aLineT    —— 该顶点在**本线参数域**里的位置 t（0 = 人体侧，1 = 节点侧）
 *      · aLineId   —— 线索引（0…23），用来在 shader 里哈希出每条线的相位抖动
 *    于是 shader 完全不需要知道「哪条线」的几何信息，只沿着 t 推进脉冲即可。
 *
 * 2) **为什么不用 24 个 TubeGeometry + 24 个材质**
 *    原来 `innerScene.ts` 的 `makeLink()` 每条连线建一个 `TubeGeometry`
 *    （12×5 段）+ 一个独立 ShaderMaterial → 24 draw call、24 个程序状态切换，
 *    而且**无法表达沿线流动**（管体是死几何）。
 *    现在：**折线**（LineSegments 不能画曲线，所以把曲线重新采样成 26 段折线）
 *    + 1 个材质 → 1 draw call，且流体完全由 shader 逐像素算出来。
 *
 * 3) **颜色：不用全光谱，而是在项目三色之间闭环插值**
 *    暖金 #d9b877 → 青绿 #6ee7b7 → 紫 #a78bfa → 回暖金。
 *    理由：本项目调性是「深色星空底 + 暖金主体 + 青绿/紫节点」，克制精致。
 *    全光谱 HSL 硬切（hue 0→360 线性）经过黄绿 #b4ff00、青 #00ffff 这类
 *    高饱和中间色，配 AdditiveBlending 会变成廉价霓虹，与本项目不搭。
 *    三色闭环插值恰好覆盖了「跑马灯换色」的观感，且任意时刻的颜色都落在
 *    项目已有的色域内。**且这条色带本身保持可见的色相变化**
 *    （金≈42° / 青绿≈160° / 紫≈258°），所以不会退化成"只有明暗变化"。
 *
 * 4) **拖尾 = 脉冲头 + 指数衰减尾 + 一个次脉冲**
 *    `pulse(t) = exp(-d*8)  +  0.35 * exp(-d2*16)`，d 是「脉冲头到该点的
 *    沿线距离」（只有 t < head 的一侧才亮）。脉冲头最亮，往身后指数衰减，
 *    形成彗尾；另加一个更短更急的次脉冲，让节奏有"哒-哒"的层次而不是单薄一条。
 *
 * 5) **距离自适应：拉近更明显、拉远收敛**
 *    uFade = 0.62 + clamp01((ref + 2.6 - dist) / 4.4) * 0.83：
 *      · 最近 4.6 → ≈1.45（画面里只剩几条线，给足亮度让"传输感"当主角）
 *      · 默认 6.4 → ≈1.08
 *      · 最远 9.0 → 0.62（24 条线同时出现时压回基线，避免糊成星芒）
 *    拉近时线又长又斜、且只有少数几条在画面里，正是流光最该被看见的时候；
 *    拉远时若继续加亮，24 条加色线会在中央堆成白团，所以反向收敛。
 *    亮度整体乘 1/dist² 量级的补偿已由透视本身提供，这里只调"浓度"。
 *
 * 6) **绕远侧自动淡出**
 *    连线在球体后方时（离相机远）会与人体半透明体叠加成脏光晕。
 *    用 `1 - pow(1 - |dot(视线, 径向)|, k)` 让垂直于视线的线保持亮度、
 *    正对/背对相机的线压暗，避免近端大角度斜线糊在人体上。
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineSegments,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';

/** 每条连线重新采样成多少段折线（LineSegments 画不了曲线） */
export const FLOW_SEGMENTS = 26;

/** 本项目三色环：暖金 → 青绿 → 紫 → 回暖金 */
export const FLOW_PALETTE = ['#d9b877', '#6ee7b7', '#a78bfa'] as const;

const VERT = /* glsl */ `
uniform float uTime;
uniform float uDistScale;

attribute float aLineT;
attribute float aLineId;

varying float vT;
varying float vLineId;
varying float vRadial;   // 该点在视图空间里「径向 vs 视线」的夹角因子
varying float vDepth;    // 视图空间深度（近/远）

void main() {
  vT = aLineT;
  vLineId = aLineId;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);

  // 视图空间里相机在原点：从相机指向该点的方向
  vec3 toPoint = normalize(mv.xyz);
  // 该点相对本体中心（模型空间原点）的径向方向，也转到视图空间
  vec3 radialV = normalize((modelViewMatrix * vec4(normalize(position), 0.0)).xyz);
  // |cos| 接近 1 = 连线的径向基本朝向/背离相机（近端、远端那种"戳向镜头"的线）
  vRadial = abs(dot(toPoint, radialV));
  vDepth = -mv.z;

  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uOpacity;
uniform float uFade;      // 距离自适应总强度
uniform float uDistScale; // 相机距离 / 参考距离
uniform vec3  uPalA;
uniform vec3  uPalB;
uniform vec3  uPalC;

varying float vT;
varying float vLineId;
varying float vRadial;
varying float vDepth;

// 便宜的 1D 哈希：按线索引给每条线不同的相位/速度，避免所有线整齐划一
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

/** 三色闭环插值：0→A，1/3→B，2/3→C，1→A */
vec3 palette(float u) {
  u = fract(u);
  float s = u * 3.0;
  if (s < 1.0) return mix(uPalA, uPalB, s);
  if (s < 2.0) return mix(uPalB, uPalC, s - 1.0);
  return mix(uPalC, uPalA, s - 2.0);
}

void main() {
  // —— 每条线的相位 / 速度抖动 ——
  float r1 = hash11(vLineId * 1.37 + 0.11);
  float r2 = hash11(vLineId * 2.71 + 4.63);
  float speed = 0.20 + r1 * 0.13;

  // 脉冲头位置：从人体(t=0) 走向节点(t=1)，到顶后环绕
  float head = fract(uTime * speed + r2);

  // —— 拖尾：只有落在脉冲头**身后**的一侧才亮 ——
  //
  // 衰减系数是调出来的：9.0 时尾巴拖到整条线的 ~40%，看起来像彗尾；
  // 太大（如 20）脉冲缩成一个点、失去"传输"感，太小（如 4）整条线均匀发亮、
  // 看不出方向。
  float d = head - vT;
  if (d < 0.0) d += 1.0;          // 环绕
  float trail = exp(-d * 7.0);     // 主脉冲（长尾）

  // 次脉冲：更靠前、更短更急，给出"哒-哒"的层次
  float head2 = fract(head + 0.42);
  float d2 = head2 - vT;
  if (d2 < 0.0) d2 += 1.0;
  float trail2 = exp(-d2 * 16.0) * 0.6;

  float pulse = trail + trail2;
  // 软上限：叠加后可能到 1.6，压到 ~1.15 峰值，避免 24 条线在加色混合下
  // 把中央（人体/丹田）糊成一片白。这是"看得清脉冲"与"不糊"的平衡点。
  pulse = pulse / (1.0 + 0.42 * pulse);

  // —— 起点/终点处收一下，避免在人体表面和标牌上糊成一坨 ——
  float ends = smoothstep(0.0, 0.10, vT) * (1.0 - smoothstep(0.86, 1.0, vT));

  // —— 颜色：整条线随时间跑马灯换色 ——
  //
  // 关键：**颜色与强度必须解耦**。
  // 早先写成 col * pulse * 2.35，问题是 pulse 峰值处三个通道都被乘到
  // 远超 1，加色混合后整条线**褪成白色** —— 实测截图里脉冲区平均 RGB
  // 是 (65,69,74)，饱和度只有 0.149，等于"跑马灯 RGB"完全没跑起来。
  //
  // 现在改成：先算**归一化的色相方向**（保持色度），再单独用亮度标量驱动
  // 强度；并且把"提亮"做成往本项目高光色 #efd9a4 方向的小幅偏移，
  // 而不是往纯白去 —— 峰值时仍然是暖金/青绿/紫，只是更亮。
  // 色相分两段叠加：
  //   · 全局慢移 (uTime*0.085) —— 所有线整体的"时辰流转"，保证任意两条线的
  //     相对关系在变，不会出现"第 3 条永远是青色"这种静态映射。
  //   · 沿线快扫 (vT*0.9)     —— **跑马灯的关键**：同一条线上从人体端到节点端
  //     颜色也在一路推过去，于是肉眼看到的是一条金→青→紫的色带在流动，
  //     而不是整条线同步闪。
  // 两者相加，整体色相变化率约 0.085+0.9*speed ≈ 0.3/s，跑完一轮约 3.3s，
  // 与脉冲周期同量级，观感上"光在跑、颜色在换"是同一件事。
  float hue = uTime * 0.085 + vLineId * 0.041 + vT * 0.9;
  vec3 col = palette(hue);
  // 高光方向 = 本项目 goldBright #efd9a4，保证峰值也落在项目色域内
  const vec3 HOT = vec3(0.937, 0.851, 0.643);
  col = mix(col, HOT, clamp(trail * 0.55, 0.0, 0.55));

  // —— 侧向淡出：径向正对/背对相机的线压暗，防止斜线糊在人体上 ——
  float sideFade = mix(0.42, 1.0, pow(1.0 - vRadial, 1.6));

  // —— 基底线：永远保留一丝微光，让"命盘↔人体"的结构关系始终可读 ——
  float base = 0.14;

  // —— 强度（亮度标量）——
  //
  // 分两级：pulse 只驱动 alpha（"有多亮"），颜色 col 已经归一化
  // 到本项目的三色上，**不再被 pulse 乘**。这正是"跑马灯 RGB 不会褪成白"
  // 的关键：亮度走 alpha，色度走 rgb，两者互不污染。
  float a = (base + pulse * 2.0) * ends * sideFade * uFade * uOpacity;

  // 拉近时脉冲更饱满（与 uFade 同向，方向由 TS 侧 uFade 主导，
  // 这里只做 ±10% 的微调，让"近处更强、远处更收"的手感更连贯）
  float near = clamp(uDistScale, 0.6, 1.6);
  a *= mix(1.10, 0.92, clamp((near - 0.7) / 0.7, 0.0, 1.0));

  a = clamp(a, 0.0, 1.0);

  // 颜色不再乘 pulse：色相恒定保持在项目色域内，亮度由 alpha 表达。
  // （旧写法 col*(0.45+pulse*1.9) 会让峰值三通道全部溢出 → 加色混合后变白）
  gl_FragColor = vec4(col, a);
}
`;

export interface FlowLinesOptions {
  /** 线的条数（节点数） */
  count: number;
  /** 相机参考距离（默认 6.4，与 InnerScene.distance 初值一致） */
  refDistance?: number;
}

/**
 * 流光连线组：一个 LineSegments + 一个 ShaderMaterial = 一个 draw call。
 *
 * 用法：
 *   const flow = new FlowLines({ count: nodes.length });
 *   flow.setLine(i, points);   // 折线顶点（世界坐标，已经带弯曲）
 *   flow.update(dt, cameraDistance);
 */
export class FlowLines {
  readonly object: LineSegments;
  readonly material: ShaderMaterial;

  private readonly count: number;
  private readonly refDistance: number;
  private readonly attrT: BufferAttribute;
  private readonly attrId: BufferAttribute;
  private readonly attrPos: BufferAttribute;
  /** 顶点缓冲：每条线 S 段 → 2S 个顶点，LineSegments 需要成对顶点 */
  private readonly vertices: Float32Array;
  private time = 0;

  constructor(o: FlowLinesOptions) {
    this.count = Math.max(1, o.count);
    this.refDistance = o.refDistance ?? 6.4;

    const vpf = FLOW_SEGMENTS * 2; // 每条线 S 段 → 2S 个顶点
    const total = this.count * vpf;

    this.vertices = new Float32Array(total * 3);
    const ts = new Float32Array(total);
    const ids = new Float32Array(total);

    // 先把 t 与 lineId 填好 —— 它们在 build 阶段不会变
    for (let i = 0; i < this.count; i++) {
      for (let s = 0; s < FLOW_SEGMENTS; s++) {
        const k = i * vpf + s * 2;
        ts[k] = s / FLOW_SEGMENTS;
        ts[k + 1] = (s + 1) / FLOW_SEGMENTS;
        ids[k] = i;
        ids[k + 1] = i;
      }
    }

    this.attrPos = new BufferAttribute(this.vertices, 3);
    this.attrPos.setUsage(35048); // THREE.DynamicDrawUsage
    this.attrT = new BufferAttribute(ts, 1);
    this.attrId = new BufferAttribute(ids, 1);

    const geo = new BufferGeometry();
    geo.setAttribute('position', this.attrPos);
    geo.setAttribute('aLineT', this.attrT);
    geo.setAttribute('aLineId', this.attrId);
    geo.setDrawRange(0, this.count * vpf);

    const uniforms: Record<string, IUniform> = {
      uTime: { value: 0 },
      uOpacity: { value: 0.9 },
      uFade: { value: 0.55 },
      uDistScale: { value: 1 },
      uPalA: { value: new Color(FLOW_PALETTE[0]) },
      uPalB: { value: new Color(FLOW_PALETTE[1]) },
      uPalC: { value: new Color(FLOW_PALETTE[2]) },
    };

    this.material = new ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.object = new LineSegments(geo, this.material);
    this.object.frustumCulled = false;
  }

  /**
   * 设置第 i 条线的折线顶点。
   *
   * 传入点数必须 >= 2；多余的点不用。内部把它重采样成 FLOW_SEGMENTS 段，
   * 这样不同长度的线也有统一的 t 域（脉冲速度看起来一致）。
   */
  setLine(i: number, points: Array<Vector3 | [number, number, number]>): void {
    if (i < 0 || i >= this.count || points.length < 2) return;
    const vpf = FLOW_SEGMENTS * 2;
    const base = i * vpf * 3;

    // 先把控制点重采样成 FLOW_SEGMENTS+1 个等距（按弧长近似）采样点
    const n = points.length;
    const sample = (u: number): [number, number, number] => {
      const f = u * (n - 1);
      const i0 = Math.min(n - 2, Math.floor(f));
      const frac = f - i0;
      const p0 = points[i0];
      const p1 = points[i0 + 1];
      const ax = Array.isArray(p0) ? p0[0] : p0.x;
      const ay = Array.isArray(p0) ? p0[1] : p0.y;
      const az = Array.isArray(p0) ? p0[2] : p0.z;
      const bx = Array.isArray(p1) ? p1[0] : p1.x;
      const by = Array.isArray(p1) ? p1[1] : p1.y;
      const bz = Array.isArray(p1) ? p1[2] : p1.z;
      return [ax + (bx - ax) * frac, ay + (by - ay) * frac, az + (bz - az) * frac];
    };

    for (let s = 0; s < FLOW_SEGMENTS; s++) {
      const a = sample(s / FLOW_SEGMENTS);
      const b = sample((s + 1) / FLOW_SEGMENTS);
      const k = base + s * 6;
      this.vertices[k] = a[0];
      this.vertices[k + 1] = a[1];
      this.vertices[k + 2] = a[2];
      this.vertices[k + 3] = b[0];
      this.vertices[k + 4] = b[1];
      this.vertices[k + 5] = b[2];
    }
    this.attrPos.needsUpdate = true;
  }

  /** 每帧更新：推进时间 + 按相机距离算自适应强度 */
  update(dt: number, cameraDistance: number): void {
    this.time += dt;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    const d = cameraDistance / this.refDistance;
    u.uDistScale.value = d;
    // 距离自适应：**拉近更明显、拉远收敛**（对齐产品要求的方向）。
    //
    // 为什么是这个方向：拉近时画面里只剩几条线、每条都又长又粗地横在眼前，
    // 正是"能量在传输"最该被看见的时候，给足亮度；拉远时 24 条线同时出现，
    // 再往上加就糊成星芒，于是压回基底线 —— 远端仍看得见结构，但不抢主体。
    //
    // 映射：6.4(默认) → 1.0；4.6(最近) → 1.45；9.0(最远) → 0.62
    // 用一条线性插值再 clamp，避免极端视距下线性外推出怪值。
    const near = clamp01((this.refDistance + 2.6 - cameraDistance) / 4.4); // 4.6→1, 9.0→0
    u.uFade.value = 0.62 + near * 0.83;
  }

  /** 设置整体不透明度（入场淡入用） */
  setOpacity(v: number): void {
    this.material.uniforms.uOpacity.value = clamp01(v);
  }

  get timeValue(): number {
    return this.time;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 供外部复用的调色板同步（避免 Color 被 tree-shake） */
export const FLOW_COLORS = {
  gold: new Color(FLOW_PALETTE[0]),
  teal: new Color(FLOW_PALETTE[1]),
  purple: new Color(FLOW_PALETTE[2]),
};
