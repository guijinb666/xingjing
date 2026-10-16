/**
 * 诞生星轨 · three.js 日心轨道场景。
 *
 * ============================ 与旧 2D 版的关系 ============================
 * 旧版 `render/OrbitCanvas.tsx` 在 2D canvas 上画椭圆轨道 + 圆点 + 标签。
 * 本文件把同一份**几何与时间语义**搬到 three.js：
 *   · 轨道仍是「圆 + 纵向压扁」，压扁比沿用 `tokens.orbits.squash`
 *   · 天体位置仍由 `rDraw / angle` 决定，而 `angle` 仍由 `domain/astro/orbit` 给出
 * 差别只在于：天体从「圆点」升级为**细化的三维行星**，相机可自由推拉。
 *
 * ★★★ 铁律（不可违反）★★★
 *   角速度只来自真实公转周期 ω = 2π/T：
 *       angle = phase0 + 2π · (days / 365.25) / period
 *   本文件的 `applyDays()` **只做一件事**：读取上游算好的 angle，把它摆到星球位置。
 *   它绝不参与角度计算，也绝不使用 squash / 相机距离 / 半径去修正角度。
 *   squash 只出现在**绘制坐标 y 分量**与**轨道椭圆的几何**上。
 *
 * ============================ 坐标系约定 ============================
 * 世界单位沿用「参考画布 1440×1080」的像素标定：Neptune 轨道半径 722。
 * 所以 `tokens.orbits.radii / cx / cy` 可以原样喂进来，无需换算 ——
 * 这与旧 2D 版的标定完全一致，视觉构图得以延续。
 *
 *   世界坐标：X = 右，Y = 上（three 默认），Z = 朝向观众
 *   轨道平面：XZ 平面（水平的黄道面）—— 这样相机抬高基线后能看到椭圆投影，
 *            与旧版「纵向压扁 0.43」表达的是同一个透视感觉，但这次是真 3D。
 *   旧版 squash 的等价实现：把整个轨道系统在 Z 方向 scale(squash)？
 *            ✗ 不行 —— 那会把行星也压扁成椭球。
 *            正解：在**计算天体位置时**对 z 分量乘 squash（见 bodyPosition），
 *            轨道椭圆用 EllipseCurve 自建（同样只对 z 乘 squash）。
 */

import {
  AdditiveBlending,
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  EllipseCurve,
  Group,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  PointLight,
  BufferGeometry,
  BufferAttribute,
  Scene,
  Sprite,
  SpriteMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  ACESFilmicToneMapping,
  type Material,
  type WebGLRenderer,
} from 'three';
import type { BodyKey, BodyDef, OrbitBody } from '@/domain/types';
import { orbits, tokens } from '@/styles/tokens';
import { BODIES } from '@/domain/astro/planets';
import {
  buildSaturnRingGeometries,
  applyAtmosphereRim,
  createCloudMaterial,
  createSunMaterial,
  getSunGlowTexture,
  planetMaterialFor,
} from './planetMaterials';

/** 太阳与行星的**外观半径**（世界单位像素 @ 参考画布）。纯视觉，不参与任何物理量 */
const SUN_RADIUS = 20;
const SUN_GLOW_SCALE = SUN_RADIUS * 7.4;
/** 行星外观半径：在旧 2D 圆点尺寸上放大，使其在近景能撑满屏幕 */
const PLANET_RADIUS_BOOST = 2.1;

/** 入场展开动画（与 tokens.motion.orbitIntro 对应） */
const INTRO_MS = 1400;

/** 世界坐标系中心（对应 tokens.orbits.cx / cy，但转成 3D） */
const CX = orbits.cx - orbits.designW / 2;
const CY = 0;
const CZ = orbitalsCenterZ();

/** 参考画布中心到太阳的距离（把 cx/cy 平移到原点，方便居中取景） */
function orbitalsCenterZ(): number {
  // 旧版 cy=531 在 1080 高度里接近居中偏上；3D 里用 0 即可，
  // 因为 squash 已经把 Z 压到 ±310，整体天然居中。
  return 0;
}

/** 相机距离限位 —— 决定「放大缩小」的范围 */
export const MIN_DISTANCE = 90;
export const MAX_DISTANCE = 2600;
/** 初始距离：恰好能把海王星轨道（722×0.43 压扁后）全收进视野 */
export const DEFAULT_DISTANCE = 1560;

/**
 * 距离补偿指数。
 *
 * 标签 / 引线如果完全按世界尺寸走，拉近后会变成糊满屏幕的巨幅文字；
 * 完全补偿（指数 1）又会让标注像贴在屏幕上的贴纸、失去纵深。
 * 取 0.62 幂：保留「靠近会稍大」的立体感，同时保证近景读得出字。
 */
const LABEL_DIST_COMPENSATION = 0.62;
/** 标签尺寸基准（世界单位），对应旧版 reference canvas 上的 13px 字号 */
const LABEL_BASE_SIZE = 34;
/** 星球本身的距离补偿指数：拉近时行星要长大（否则「占满屏幕」做不到），但不线性膨胀 */
const PLANET_DIST_COMPENSATION = 0.86;
/** 参考视距（用于距离补偿的基准） */
const REF_DISTANCE = DEFAULT_DISTANCE;

/** 程序化生成标签精灵贴图的画布尺寸 */
const LABEL_TEX_W = 512;
const LABEL_TEX_H = 128;

export interface OrbitSceneOptions {
  bodies: OrbitBody[];
  width: number;
  height: number;
}

/** 一颗行星的运行时状态 */
interface PlanetNode {
  def: BodyDef;
  key: BodyKey;
  /** 半径缩放组（把位置 + 压扁一次性应用） */
  root: Group;
  /** 星球网格（用于近距离细节） */
  mesh: Mesh;
  /** 土星环组（可 null） */
  ring: Group | null;
  /** 地球云层壳 */
  clouds: Mesh | null;
  /** 大气辉光壳 */
  atmosphere: Mesh | null;
  /** 标签精灵 */
  label: Sprite;
  /** 引线（行星 → 标签） */
  leader: Line;
  /** 该星球的基础外观半径 */
  baseRadius: number;
  /** 自转角（视觉，独立于公转） */
  spin: number;
  /** 自转速度（rad/s）：气态行星快，岩石行星慢 */
  spinSpeed: number;
}

/** 由 BodyDef 推出星球外观半径 */
function radiusOf(def: BodyDef): number {
  return def.size * PLANET_RADIUS_BOOST;
}

/** 气态行星自转更快（视觉差异，与公转角速度无关） */
function spinSpeedOf(key: BodyKey): number {
  switch (key) {
    case 'Jupiter':
      return 0.5;
    case 'Saturn':
      return 0.44;
    case 'Uranus':
      return 0.3;
    case 'Neptune':
      return 0.32;
    case 'Earth':
      return 0.24;
    case 'Mars':
      return 0.22;
    case 'Venus':
      return 0.05;
    default:
      return 0.08; // 水星：自转极慢（真实 58.6 天），这里给一个几乎不可察觉的值
  }
}

/**
 * 某个天体在 days 天的**绘制**位置。
 *
 *   x = cos(angle) · r
 *   z = sin(angle) · r · squash        ← squash 只作用于绘制的 z 分量
 *   y = 0                              ← 黄道面
 *
 * ★ angle 是上游算好的；本函数只负责「摆位置」，不做任何时间/角度推导。
 */
function bodyPosition(angle: number, rDraw: number, out: Vector3): Vector3 {
  return out.set(
    Math.cos(angle) * rDraw,
    0,
    Math.sin(angle) * rDraw * orbits.squash,
  );
}

/** ease-out cubic */
function easeOutCubic(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - Math.pow(1 - c, 3);
}

/** 生成行星名字标签的精灵贴图（同色小圆点 + 中文名） */
function makeLabelTexture(cn: string, color: string): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = LABEL_TEX_W;
  cv.height = LABEL_TEX_H;
  const ctx = cv.getContext('2d');
  if (ctx === null) return new CanvasTexture(cv);
  ctx.clearRect(0, 0, LABEL_TEX_W, LABEL_TEX_H);

  const cy = LABEL_TEX_H / 2;
  // 同色小圆点
  ctx.beginPath();
  ctx.arc(22, cy, 7, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // 中文名：serif，与站点标题气质一致
  ctx.font = `500 44px ${tokens.font.sans}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  // 描边保证在亮背景（行星表面）上也读得清
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(7,8,11,0.85)';
  ctx.strokeText(cn, 46, cy);
  ctx.fillStyle = tokens.color.text;
  ctx.fillText(cn, 46, cy);

  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 星尘背景（少量远景光点，给推拉一个空间参照）。
 * 刻意稀疏：星轨区的星空底由页面级 `starfield-layer` 负责，这里只求一点纵深。
 */
function makeStarDust(): Points {
  const N = 520;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 1400 + Math.random() * 2600;
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    pos[i * 3] = Math.cos(phi) * s * r;
    pos[i * 3 + 1] = u * r * 0.6;
    pos[i * 3 + 2] = Math.sin(phi) * s * r;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  const mat = new PointsMaterial({
    size: 3.5,
    color: new Color('#cfd6e6'),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    sizeAttenuation: true,
  });
  return new Points(geo, mat);
}

// ------------------------------------------------------------------ 场景类

/**
 * 星轨场景控制器。
 *
 * 生命周期：`new OrbitScene(opts)` → 每帧 `update(dt, renderer)` → `dispose()`。
 * 相机由外部改写 `distance / azimuth / polar`，惯性也由外部驱动
 * （`applyInertia(dt)` 供宿主调用；这样「滚轮惯性」的参数留在交互层）。
 */
export class OrbitScene {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  /** 相机球坐标（由外部交互改写） */
  distance = DEFAULT_DISTANCE;
  azimuth = 0;
  /** 极角：π/2 = 水平；越小越高（俯视） */
  polar = Math.PI / 2 - 0.34;

  private readonly root = new Group();
  private readonly orbitLines = new Group();
  private readonly planets: PlanetNode[] = [];
  /** 本场景创建的所有材质（dispose 时统一释放） */
  private readonly planetMats: Material[] = [];

  private time = 0;
  /**
   * 相机注视点（世界坐标）。
   *
   * 默认 (0,0,0) 即太阳。近景聚焦某颗行星时，宿主把它设成该行星位置，
   * 否则相机只会「拉得很近但仍然看着太阳」，行星会被推出画面。
   */
  focusPoint = new Vector3(0, 0, 0);

  introElapsed = Number.POSITIVE_INFINITY;
  private introStarted = false;
  private enterElapsed = 0;
  private stopped = false;

  /** 最近一次 applyDays 使用的天数（仅调试/断言用，不参与计算） */
  lastDays = 0;

  constructor(o: OrbitSceneOptions) {
    this.camera = new PerspectiveCamera(42, o.width / Math.max(1, o.height), 1, 12000);
    this.scene.add(this.camera);
    this.camera.position.set(0, 0, this.distance);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(this.root);
    this.root.add(this.orbitLines);

    this.buildLights();
    this.buildStarDust();
    this.buildSun();
    this.buildOrbits(o.bodies);
    this.buildPlanets(o.bodies);
  }

  // ----------------------------------------------------------- 光照

  private buildLights(): void {
    // 太阳是唯一主光源：平行光从太阳（原点）射出，但为了近景有可辨的明暗交界，
    // 用一盏方向光斜射，位置随相机侧向偏移在 update 里微调。
    const key = new DirectionalLight(0xfff3dc, 2.35);
    key.position.set(0.42, 0.3, 1);
    this.scene.add(key);
    this.keyLight = key;

    // 补光：行星夜面不至于纯黑（原片里暗面仍隐约可见）
    const fill = new DirectionalLight(0x4a5a86, 0.42);
    fill.position.set(-0.7, -0.25, -0.8);
    this.scene.add(fill);

    this.scene.add(new AmbientLight(0x1a1f2b, 1.0));

    // 太阳本体的点光（让近处的行星内侧被照亮，增强「围绕太阳」的感觉）
    const sunLight = new PointLight(0xffe2ac, 1.6, 5200, 2);
    sunLight.position.set(0, 0, 0);
    this.scene.add(sunLight);
  }

  private keyLight: DirectionalLight | null = null;

  // ----------------------------------------------------------- 星空尘

  private buildStarDust(): void {
    this.scene.add(makeStarDust());
  }

  // ----------------------------------------------------------- 太阳

  private buildSun(): void {
    const mat = createSunMaterial();
    this.planetMats.push(mat);
    const sun = new Mesh(new SphereGeometry(SUN_RADIUS, 40, 26), mat);
    this.root.add(sun);
    this.sunMesh = sun;

    // 日冕：additive 精灵，尺寸是本体数倍
    /*
     * ★ 内层日冕必须参与深度测试（depthTest: true），否则它会盖在太阳
     *   本体之上 —— 精灵中心那团最亮的白点在球面正中形成一个
     *   「镜头光斑」似的亮圆点，近景非常显眼（截图
     *   _shots/orbit-3d-03-close-sun.png 确认）。
     *   开启深度测试后，太阳本体（半径 20、位于同一原点）会把
     *   日冕中心挡掉，只剩球缘外的一圈辉光 —— 这才是日冕该有的样子。
     *
     *   仍然保留 depthWrite: false：additive 辉光不该写深度，
     *   否则会把它自己的深度写进缓冲、挡住后面更远的行星。
     */
    const glowMat = new SpriteMaterial({
      map: getSunGlowTexture(),
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      opacity: 0.95,
    });
    const glow = new Sprite(glowMat);
    glow.scale.set(SUN_GLOW_SCALE, SUN_GLOW_SCALE, 1);
    glow.position.set(0, 0, 0);
    glow.renderOrder = 1;
    this.sunGlow = glow;
    this.root.add(glow);

    // 一层更外扩的极淡光晕（近景时铺满画面边缘，强化「这颗星在发光」）
    /*
     * 外层光晕同样开启深度测试：它比太阳大得多，只有正中那一小块
     * 会被本体遮住（正是我们要的），外围辉光不受影响。
     */
    const haloMat = new SpriteMaterial({
      map: getSunGlowTexture(),
      color: 0xffd79a,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      opacity: 0.3,
    });
    const halo = new Sprite(haloMat);
    halo.scale.set(SUN_GLOW_SCALE * 2.6, SUN_GLOW_SCALE * 2.6, 1);
    halo.renderOrder = 2;
    this.sunHalo = halo;
    this.root.add(halo);
  }

  private sunMesh: Mesh | null = null;
  private sunGlow: Sprite | null = null;
  private sunHalo: Sprite | null = null;

  // ----------------------------------------------------------- 轨道线

  /**
   * 轨道路径：**用 EllipseCurve 自建**而不是把整组做 scale(squash)。
   *
   * 原因见文件头：整体 scale 会把行星也压成椭球。
   * 这里只对 z 分量乘 squash，得到与旧 2D 版完全一致的椭圆，
   * 但每条线是真 3D 曲线，相机抬高后能看出纵深。
   */
  private buildOrbits(bodies: OrbitBody[]): void {
    for (const b of bodies) {
      const segs = 256;
      const curve = new EllipseCurve(0, 0, b.rDraw, b.rDraw, 0, Math.PI * 2, false, 0);
      const pts = curve.getPoints(segs);
      const arr = new Float32Array(pts.length * 3);
      pts.forEach((p: Vector2, i: number) => {
        arr[i * 3] = p.x;
        arr[i * 3 + 1] = 0;
        arr[i * 3 + 2] = p.y * orbits.squash;
      });
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(arr, 3));
      const mat = new LineBasicMaterial({
        color: 0xd9b877,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      });
      const line = new Line(geo, mat);
      // 每条轨道单独存到 userData，供入场展开动画使用
      line.userData.rDraw = b.rDraw;
      this.orbitLines.add(line);
    }
  }

  // ----------------------------------------------------------- 行星

  private buildPlanets(bodies: OrbitBody[]): void {
    for (const b of bodies) {
      const R = radiusOf(b);

      // root：承载「星球 + 环 + 云层 + 大气」的整体，位置每帧写入
      const root = new Group();

      // —— 星球本体 ——
      // 面数克制：近景才需要细节，但 SphereGeometry 是曲面细分的成本大头，
      // 用 48×32 在近景（占满屏幕）也不露多边形棱边，远景更是绰绰有余。
      const geo = new SphereGeometry(R, 48, 32);
      const mat = planetMaterialFor(b.key, b.color);
      this.planetMats.push(mat);
      const mesh = new Mesh(geo, mat);
      // 让行星有一个自然的初始自转角（否则贴图接缝朝向观众）
      mesh.rotation.z = MathUtils.degToRad(8 + (b.key.length * 3) % 20);
      root.add(mesh);

      /*
       * —— 大气辉光 ——
       *
       * ★ 不再是独立的 1.12R 球壳（那会在近景留下「硬色环 + 暗缝」，
       *   见 planetMaterials.applyAtmosphereRim 的注释），而是直接注入
       *   星球本体的着色器。所以这里没有额外的 Mesh，
       *   atmosphere 恒为 null；保留该字段是为了让其它读取处无需改动。
       */
      const atmosphere: Mesh | null = null;
      const atmoColor = atmosphereColorOf(b.key);
      if (atmoColor !== null) {
        applyAtmosphereRim(mat, atmoColor, atmosphereStrengthOf(b.key));
      }

      // —— 云层壳（地球专属） ——
      let clouds: Mesh | null = null;
      if (b.key === 'Earth') {
        const cloudMat = createCloudMaterial();
        this.planetMats.push(cloudMat);
        clouds = new Mesh(new SphereGeometry(R * 1.035, 40, 26), cloudMat);
        root.add(clouds);
      }

      // —— 土星环：多段 RingGeometry，段间留白 = 真缝隙 ——
      let ring: Group | null = null;
      if (b.hasRing === true) {
        ring = new Group();
        for (const rg of buildSaturnRingGeometries()) {
          // 环带表里的半径以「行星半径 = 1」为单位
          const g = rg.geometry.clone();
          g.scale(R, R, R);
          const m = new Mesh(g, rg.material);
          // RingGeometry 在 XY 平面 → 转到 XZ 平面；再给一点真实的轴倾角（26.7°）
          m.rotation.set(Math.PI / 2, 0, 0);
          this.planetMats.push(rg.material);
          ring.add(m);
        }
        ring.rotation.z = MathUtils.degToRad(26.7);
        ring.rotation.x = MathUtils.degToRad(26.7);
        root.add(ring);
      }

      // —— 标签精灵 ——
      const labelTex = makeLabelTexture(b.cn, b.color);
      const labelMat = new SpriteMaterial({
        map: labelTex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
      const label = new Sprite(labelMat);
      label.renderOrder = 10;
      this.root.add(label);

      // —— 引线（星球 → 标签）——
      const leaderGeo = new BufferGeometry();
      leaderGeo.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(6), 3),
      );
      const leaderMat = new LineBasicMaterial({
        color: new Color(b.color).getHex(),
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      });
      const leader = new Line(leaderGeo, leaderMat);
      this.root.add(leader);

      // 淡色的行星名底座（长按/悬停可读，此处只需可见）
      const node: PlanetNode = {
        def: b,
        key: b.key,
        root,
        mesh,
        ring,
        clouds,
        atmosphere,
        label,
        leader,
        baseRadius: R,
        spin: 0,
        spinSpeed: spinSpeedOf(b.key),
      };
      this.root.add(root);
      this.planets.push(node);
    }
  }

  // ----------------------------------------------------------- 每帧更新

  /**
   * 每帧推进。
   *
   * ★ 注意：`dt` 只驱动**纯视觉**的量（自转、云层、入场动画、脉冲）。
   *   公转角绝不在这里推进 —— 它由宿主把上游 `bodies[].angle` 通过
   *   `applyDays` 喂进来，保证唯一真相源是 `domain/astro/orbit`。
   */
  update(dt: number, renderer: WebGLRenderer): void {
    if (this.stopped) return;
    const d = Math.min(Math.max(dt, 0), 0.1);
    this.time += d;
    if (this.introStarted) this.introElapsed = Math.min(INTRO_MS, this.introElapsed + d * 1000);
    this.enterElapsed += d * 1000;

    const intro = this.introStarted ? easeOutCubic(this.introElapsed / INTRO_MS) : 0;
    const sunAlpha = this.introStarted ? Math.min(1, (this.introElapsed / INTRO_MS) * 1.4) : 0;

    // —— 相机（球坐标） ——
    const sp = Math.sin(this.polar);
    const fp = this.focusPoint;
    this.camera.position.set(
      fp.x + Math.sin(this.azimuth) * sp * this.distance,
      fp.y + Math.cos(this.polar) * this.distance,
      fp.z + Math.cos(this.azimuth) * sp * this.distance,
    );
    this.camera.lookAt(fp.x, fp.y, fp.z);
    this.scene.updateMatrixWorld();

    // 主光随相机侧转（始终从左上打过来，近景的明暗交界位置稳定）
    if (this.keyLight !== null) {
      this.keyLight.position.set(
        Math.sin(this.azimuth + 0.6) * 1600,
        620,
        Math.cos(this.azimuth + 0.6) * 1600,
      );
    }

    // —— 太阳 ——
    if (this.sunMesh !== null) {
      (this.sunMesh.material as MeshBasicMaterial).opacity = sunAlpha;
      (this.sunMesh.material as MeshBasicMaterial).transparent = sunAlpha < 0.999;
      this.sunMesh.scale.setScalar(1 + Math.sin(this.time * 0.9) * 0.006);
    }
    if (this.sunGlow !== null) {
      (this.sunGlow.material as SpriteMaterial).opacity = 0.95 * sunAlpha;
      /*
       * ★ 屏幕空间恒定的光晕。
       *
       *   诊断脚本（scripts/_orbit-diag.mjs）实测：默认参数下这个 Sprite
       *   在 dist=306 时就有 1361px 高 —— 0.95 不透明度的 additive 精灵
       *   横跨整个视口，近景必然把画面罩成一片暖橘。
       *
       *   物理上「世界尺寸恒定」的物体在屏幕上会随拉近变大（1/d 关系），
       *   而太阳的光晕本来就该是**屏幕空间近似恒定**的。
       *   所以缩放必须正比于 distance 而不是反比。
       *   用 GLOW_SCREEN_REF 把「参考距离下 7.4×太阳半径」换算成屏幕目标。
       */
      const gs = SUN_GLOW_SCALE * (this.distance / REF_DISTANCE);
      this.sunGlow.scale.set(gs, gs, 1);
    }
    if (this.sunHalo !== null) {
      /*
       * ★ 外扩光晕同理，且不透明度要**随拉近而降**。
       *
       *   旧实现写成 `0.26 * (REF/distance)^0.9`：拉近时 (REF/d) 变大，
       *   于是不透明度不降反升 —— 诊断脚本实测 dist=306 处 opacity=3.388
       *   （超过 1，等于全不透明），这就是近景整屏被冲白的直接原因。
       *
       *   现在：缩放同样是屏幕空间恒定，不透明度随拉近按 1/d 线性压到很低。
       */
      const kd = clamp01(REF_DISTANCE / Math.max(1, this.distance) / 6);
      const hs = SUN_GLOW_SCALE * 2.6 * (this.distance / REF_DISTANCE);
      this.sunHalo.scale.set(hs, hs, 1);
      (this.sunHalo.material as SpriteMaterial).opacity = 0.26 * sunAlpha * kd;
    }

    // —— 轨道线：入场展开 + 距离补偿的线宽感（用透明度表达） ——
    for (const child of this.orbitLines.children) {
      const line = child as Line;
      const rDraw = line.userData.rDraw as number;
      const geo = line.geometry as BufferGeometry;
      const pos = geo.getAttribute('position') as BufferAttribute;
      const k = intro * rDraw;
      for (let i = 0; i < pos.count; i++) {
        const a = (i / (pos.count - 1)) * Math.PI * 2;
        pos.setX(i, Math.cos(a) * k);
        pos.setZ(i, Math.sin(a) * k * orbits.squash);
      }
      pos.needsUpdate = true;
      geo.computeBoundingSphere();
      const mat = line.material as LineBasicMaterial;
      // 拉近时轨道线会变得非常淡（因为相机贴近某一段），保持恒定的低透明度即可
      mat.opacity = 0.18 * intro;
    }

    // —— 行星 ——
    /*
     * 行星尺寸的距离补偿：屏幕目标「占屏比例随拉近而上升」，
     * 但没有 1/d 那么猛（1/d 会让近景行星瞬间占满整屏盖住一切）。
     * 指数 0.86 < 1，即世界尺寸随 distance^0.86 增长，
     * 屏幕尺寸随 distance^(-0.14) 缓慢增长。
     */
    const distComp = Math.pow(this.distance / REF_DISTANCE, PLANET_DIST_COMPENSATION);
    const labelDistComp = Math.pow(this.distance / REF_DISTANCE, LABEL_DIST_COMPENSATION);

    for (let pi = 0; pi < this.planets.length; pi++) {
      const p = this.planets[pi];
      // 入场：行星位置沿半径从 0 展开
      const app = clamp01((this.enterElapsed - 220 - pi * 90) / 900);
      const eased = easeOutCubic(app);

      // ★ 位置来自 applyDays 写入的 userData（上游算好的 angle × 上游给的 rDraw）
      const angle = p.root.userData.angle as number;
      const rDraw = p.root.userData.rDraw as number;
      bodyPosition(angle, rDraw * (this.introStarted ? intro : 0), TMP_V);

      p.root.position.copy(TMP_V);
      p.root.visible = eased > 0.001;
      if (!p.root.visible) {
        p.label.visible = false;
        p.leader.visible = false;
        continue;
      }
      p.root.scale.setScalar(1);

      // 星球自转（纯视觉）
      p.spin += p.spinSpeed * d;
      p.mesh.rotation.y = p.spin;
      if (p.ring !== null) p.ring.rotation.y = -p.spin * 0.35;
      if (p.clouds !== null) p.clouds.rotation.y = p.spin * 1.22;

      // 星球尺寸的距离补偿：拉近 → 变大，但要能撑满屏幕
      const scale = distComp * (0.86 + 0.14 * eased) * (1 + Math.sin(this.time * 1.1 + p.spin) * 0.008);
      p.root.userData.baseScale = scale;

      // —— 标签：沿「太阳 → 行星」方向再向外偏移，绝不遮住星球 ——
      const pr = p.baseRadius * scale;
      const dir = TMP_V2.copy(p.root.position);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      dir.normalize();
      /** 标签相对行星中心的外推距离（世界单位） */
      const lift = pr + LABEL_BASE_SIZE * labelDistComp * 1.5;
      p.label.position.copy(p.root.position).addScaledVector(dir, lift);
      const labelScale = LABEL_BASE_SIZE * labelDistComp;
      p.label.scale.set(labelScale * 4, labelScale, 1);
      p.label.visible = eased > 0.6;
      (p.label.material as SpriteMaterial).opacity = clamp01((eased - 0.6) / 0.4) * 0.95;

      // 引线：从星球边缘到标签
      const lp = p.leader.geometry.getAttribute('position') as BufferAttribute;
      TMP_V3.copy(p.root.position).addScaledVector(dir, pr + labelScale * 0.3);
      lp.setXYZ(0, TMP_V3.x, TMP_V3.y, TMP_V3.z);
      lp.setXYZ(1, p.label.position.x, p.label.position.y, p.label.position.z);
      lp.needsUpdate = true;
      p.leader.geometry.computeBoundingSphere();
      p.leader.visible = eased > 0.6;
      (p.leader.material as LineBasicMaterial).opacity = 0.55 * clamp01((eased - 0.6) / 0.4);
    }

    // 入场完成后就不再需要展开动画
    renderer.render(this.scene, this.camera);
  }

  // ----------------------------------------------------------- 外部契约

  /** 视口尺寸变化 */
  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** 启动入场展开动画（进入视口时调用一次） */
  startIntro(): void {
    if (this.introStarted) return;
    this.introStarted = true;
    this.introElapsed = 0;
  }

  /** 是否已完成入场（供宿主决定是否还需要重绘） */
  get introDone(): boolean {
    return this.introStarted && this.introElapsed >= INTRO_MS;
  }

  /**
   * 把上游算好的天体角度/半径写进场景。
   *
   * ★ 本方法**不做任何角度计算** —— 只做一次赋值。
   *   它存在的唯一目的是让「角速度来自真实周期 ω=2π/T」这条铁律
   *   在渲染层**没有第二处实现**，从而不可能被 squash 或相机参数污染。
   */
  applyDays(bodies: OrbitBody[], days: number): void {
    this.lastDays = days;
    const n = Math.min(bodies.length, this.planets.length);
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      const p = this.planets[i];
      if (b.key !== p.key) {
        // 顺序变了就按 key 找（防御：正常情况不会发生）
        const hit = this.planets.find((x) => x.key === b.key);
        if (hit === undefined) continue;
        hit.root.userData.angle = b.angle;
        hit.root.userData.rDraw = b.rDraw;
        continue;
      }
      p.root.userData.angle = b.angle;
      p.root.userData.rDraw = b.rDraw;
    }
  }

  /** 当前相机到太阳的距离（供 playwright 断言「缩放确实改变了相机距离」） */
  get cameraDistance(): number {
    return this.camera.position.length();
  }

  /** 把相机拉到指定距离（被 MIN/MAX_DISTANCE 夹紧） */
  setDistance(d: number): number {
    this.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, d));
    return this.distance;
  }

  /**
   * 世界坐标 → 屏幕像素。供宿主做「双击某颗行星则聚焦」的命中测试。
   * 返回 null 表示在相机背后。
   */
  projectToScreen(v: Vector3, width: number, height: number): { x: number; y: number } | null {
    const p = TMP_V3.copy(v).project(this.camera);
    if (p.z < -1 || p.z > 1) return null;
    return {
      x: (p.x * 0.5 + 0.5) * width,
      y: (-p.y * 0.5 + 0.5) * height,
    };
  }

  /** 命中测试：屏幕点落在哪颗行星的屏幕圆内（用于双击聚焦） */
  hitTest(sx: number, sy: number, width: number, height: number): BodyKey | null {
    let best: BodyKey | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    const distComp = Math.pow(this.distance / REF_DISTANCE, PLANET_DIST_COMPENSATION);
    for (const p of this.planets) {
      const proj = this.projectToScreen(p.root.position, width, height);
      if (proj === null) continue;
      const r = p.baseRadius * distComp;
      // 屏幕半径 ≈ 世界半径 / (距离 · tan(fov/2)) · (height/2)
      const screenR =
        (r / Math.max(1, this.distance)) *
        (height / (2 * Math.tan((this.camera.fov * Math.PI) / 360)));
      const hitR = Math.max(screenR * 2.4, 16);
      const d = Math.hypot(sx - proj.x, sy - proj.y);
      if (d < hitR && d < bestD) {
        bestD = d;
        best = p.key;
      }
    }
    return best;
  }

  /** 某行星当前的世界坐标（供聚焦动画使用） */
  planetPosition(key: BodyKey): Vector3 | null {
    const p = this.planets.find((x) => x.key === key);
    if (p === undefined) return null;
    return p.root.position.clone();
  }

  /** 某行星在**完整展开**（intro=1）时的世界坐标（探针/聚焦前预设用） */
  planetRestPosition(key: BodyKey): Vector3 | null {
    const p = this.planets.find((x) => x.key === key);
    if (p === undefined) return null;
    const angle = p.root.userData.angle as number;
    const rDraw = p.root.userData.rDraw as number;
    return bodyPosition(angle, rDraw, new Vector3());
  }

  /** 某行星的外观半径（世界单位） */
  planetRadius(key: BodyKey): number {
    const p = this.planets.find((x) => x.key === key);
    return p === undefined ? 0 : p.baseRadius;
  }

  /** 土星环带数（供截图脚本断言「环有缝隙」：7 段环带之间有 3 处留白） */
  get saturnRingBandCount(): number {
    const saturn = this.planets.find((p) => p.key === 'Saturn');
    return saturn?.ring?.children.length ?? 0;
  }

  dispose(): void {
    this.stopped = true;
    this.scene.traverse((obj) => {
      const anyObj = obj as unknown as {
        geometry?: BufferGeometry;
        material?: unknown;
      };
      anyObj.geometry?.dispose();
      const mat = anyObj.material as
        | (MeshBasicMaterial | SpriteMaterial | LineBasicMaterial)
        | undefined;
      if (mat && 'map' in mat && mat.map) (mat.map as CanvasTexture).dispose();
      mat?.dispose();
    });
    this.planets.length = 0;
  }
}

/** 复用的临时向量（避免每帧分配） */
const TMP_V = new Vector3();
const TMP_V2 = new Vector3();
const TMP_V3 = new Vector3();

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 各行星是否有大气辉光壳，以及色相 */
function atmosphereColorOf(key: BodyKey): string | null {
  switch (key) {
    case 'Earth':
      return '#5e9dff';
    case 'Venus':
      return '#ffd79a';
    case 'Mars':
      return '#e08a5a';
    case 'Jupiter':
      return '#ffd9a8';
    case 'Saturn':
      return '#ffe3b0';
    case 'Uranus':
      return '#9fe6ea';
    case 'Neptune':
      return '#7f9dff';
    default:
      return null; // 水星无大气
  }
}

/** 大气辉光强度 */
function atmosphereStrengthOf(key: BodyKey): number {
  switch (key) {
    /*
     * 强度直接叠在星球表面（线性相加），所以数值比「独立壳」时代小很多；
     * 过大会让整个球面发白、贴图细节被冲掉。
     */
    case 'Earth':
      return 0.52;
    case 'Venus':
      return 0.55;
    case 'Uranus':
      return 0.42;
    case 'Neptune':
      return 0.4;
    default:
      return 0.3;
  }
}

/** 供 UI 复用：轨道面上的行星半径基准（调试用） */
export const ORBIT_WORLD = { CX, CY, CZ, SQUASH: orbits.squash };

/** 未被直接使用但需要保留的导出（避免 bundler 误判为死代码） */
export const _orbitConstants = {
  BODIES,
  DoubleSide,
  ACESFilmicToneMapping,
};
