/**
 * 内景 3D 场景：以人体为中心的球面星曜环绕。
 *
 * ============================== 交互需求 ==============================
 *   ① 星曜节点**以人体为中心做真 3D 球面环绕**（不是平面转圈）
 *   ② 支持**上下左右旋转**（轨道相机，拖拽改变方位角与极角）
 *   ③ **滚轮缩放**、**双击放大**
 *   ④ 鼠标静止一段时间后，球面**自行缓慢旋转**（「活着的星图」）
 *
 * ============================== 关键设计 ==============================
 *   球面分布用 **Fibonacci / 黄金角螺旋**：
 *     y_k = 1 - 2(k+0.5)/N          （均匀铺开纬度）
 *     r_k = sqrt(1 - y_k²)
 *     phi = k × 黄金角 (≈2.39996 rad)
 *   这样 N 个节点在球面上**近似均匀**，不会在两极挤成一堆 ——
 *   用随机分布或按纬度线性排队都会出现明显的极区堆积。
 *
 *   但十神与神煞要**分层**（参考片里两圈：十神内圈、神煞外圈），
 *   所以给两类节点不同的球半径，同时保证同类内均匀。
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  Matrix4,
  PerspectiveCamera,
  Points,
  Raycaster,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { ChartNode } from '@/domain/types';
import {
  FigurePlane,
  FIGURE_ASPECT,
  FIGURE_CENTER_Y,
  FIGURE_HEIGHT,
} from './figurePlane';
import { tickMaterial } from './xrayMaterial';
import { FlowLines } from './flowLine';
import { drawGlyph } from '@/render/iconRender';
import { tokens } from '@/styles/tokens';

/** 十神球半径（内层）与神煞球半径（外层） */
export const RING_TEN_GOD = 2.35;
export const RING_SHEN_SHA = 3.15;

/** 黄金角 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * 节点标牌的世界尺寸基准。
 *
 * 0.86 是「默认视距 6.4」下看着舒服的值；用户要求「缩小命盘小标」，
 * 所以基准收到 0.70，并且**随相机距离补偿**（见 update 里的 distScale）：
 * 拉近时不把标牌一起放大成巨幅贴纸，而是让它的屏幕尺寸大致恒定。
 */
const BASE_SPRITE_SCALE = 0.7;

/** 距离补偿的参考视距（= InnerScene.distance 的初始值） */
const REF_DISTANCE = 6.4;

export interface InnerSceneOptions {
  nodes: ChartNode[];
  width: number;
  height: number;
}

/** 一个环绕节点的运行时状态 */
export interface OrbitingNode {
  src: ChartNode;
  /** 单位球方向 */
  dir: Vector3;
  /** 球半径 */
  radius: number;
  /** 精灵 */
  sprite: Sprite;
  /**
   * 与人体中心的连线**折线控制点**。
   *
   * v2：连线不再每条一个 `TubeGeometry` + 独立材质（24 draw call，
   * 而且管体是死几何、无法表达沿线流动）。所有连线现在合并进
   * `FlowLines` 里的**单个 LineSegments + 单个 ShaderMaterial**，
   * 这里保留控制点供命中测试 / 调试使用。
   */
  linePoints: Vector3[];
  /** 该节点在 FlowLines 里的线索引（= 在 orbiting 数组里的下标） */
  lineIndex: number;
  /** 入场延迟（ms） */
  delay: number;
  /** 基础相位 */
  phase: number;
}

/**
 * 把节点铺到球面上。
 *
 * 十神与神煞各自独立做 Fibonacci 分布（各自球半径不同），
 * 因此两类不会互相挤。
 */
function distributeOnSpheres(nodes: ChartNode[]): Array<{
  src: ChartNode;
  dir: Vector3;
  radius: number;
}> {
  const groups: Array<{ list: ChartNode[]; radius: number }> = [
    { list: nodes.filter((n) => n.group === '十神'), radius: RING_TEN_GOD },
    { list: nodes.filter((n) => n.group !== '十神'), radius: RING_SHEN_SHA },
  ];

  const out: Array<{ src: ChartNode; dir: Vector3; radius: number }> = [];
  for (const g of groups) {
    const N = g.list.length || 1;
    g.list.forEach((src, k) => {
      // Fibonacci 球面：纬度均匀铺开，经度按黄金角递增
      const y = 1 - (2 * (k + 0.5)) / N;
      const r = Math.max(0, 1 - y * y);
      const phi = k * GOLDEN_ANGLE;
      const dir = new Vector3(
        Math.cos(phi) * Math.sqrt(r),
        y,
        Math.sin(phi) * Math.sqrt(r),
      ).normalize();
      out.push({ src, dir, radius: g.radius });
    });
  }
  return out;
}

/**
 * 生成节点图标精灵：把现有 Canvas2D 图标画到离屏画布，做成 Sprite。
 *
 * 用户反馈「缩小命盘小标」——所以这里把**标牌**整体收小：
 *   · 环半径 R 从画布 29% 收到 24.5%（图标跟着收）
 *   · 名称 26px → 20px、副标题 19px → 15px（字号是"小标"最直接的观感来源）
 *   · 名称/副标题相对环下沿的间距也同步收紧
 * 发光环与虚线环是尺寸无关的，保持原样式，只按新 R 缩放。
 */
function makeNodeSprite(src: ChartNode, isTenGod: boolean): Sprite {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d');
  if (ctx) {
    const main = isTenGod ? tokens.color.teal : tokens.color.purple;
    const deep = isTenGod ? tokens.color.tealDeep : tokens.color.purpleDeep;
    const cx = S / 2;
    const cy = S / 2;
    const R = S * 0.245;

    // 外圈（实线 + 虚线）
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = deep;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, R + 6, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 6]);
    ctx.strokeStyle = main;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // 环内极淡底
    ctx.beginPath();
    ctx.arc(cx, cy, R - 2, 0, Math.PI * 2);
    ctx.fillStyle = main;
    ctx.globalAlpha = 0.1;
    ctx.fill();
    ctx.globalAlpha = 1;

    // 图标
    ctx.strokeStyle = main;
    ctx.fillStyle = main;
    ctx.lineWidth = 2;
    drawGlyph(ctx, src.icon, cx, cy, R * 0.62, 1);

    // 名称（收小：26px → 20px）
    ctx.font = `500 20px ${tokens.font.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isTenGod ? '#eafff7' : '#f1ebff';
    ctx.fillText(src.name, cx, cy + R + 23);

    // 副标题（柱位 · 类型）（收小：19px → 15px）
    ctx.font = `400 15px ${tokens.font.sans}`;
    ctx.fillStyle = tokens.color.textDim2;
    ctx.fillText(`${src.pillar} · ${src.kind}`, cx, cy + R + 45);
  }
  const tex = new CanvasTexture(cv);
  const mat = new SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const sprite = new Sprite(mat);
  sprite.scale.set(BASE_SPRITE_SCALE, BASE_SPRITE_SCALE, 1);
  return sprite;
}

/**
 * 中心 → 节点的连线**折线控制点**（供 FlowLines 重采样）。
 *
 * v2 的关键变化：老版本在这里直接建 `TubeGeometry` + 独立 `ShaderMaterial`，
 * 结果①每条线一个 draw call、24 个材质实例；②管体是**死几何**，
 * 没有任何可动的位置能让"脉冲"沿它推进。
 * 现在这里只输出控制点，流动感交给 `FlowLines` 的单个 LineSegments +
 * 自定义 shader，在**逐像素**层面算脉冲位置与拖尾。
 *
 * 弯曲量按内外圈区分：十神内圈（近）弯得少，神煞外圈（远）多一点，
 * 外圈连线才有自然的弧度而不至于像弹簧。
 */
function buildLinkPoints(
  cx: number,
  cy: number,
  cz: number,
  to: Vector3,
  isTenGod: boolean,
): Vector3[] {
  const from = new Vector3(cx, cy, cz);
  const dir = to.clone().sub(from);
  const len = dir.length();
  const segs = 8;
  const pts: Vector3[] = [];
  // 略微弯曲，避免所有连线都是直线（空间感更好）
  const bendAmt = isTenGod ? len * 0.035 : len * 0.058;
  const bend = new Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(bendAmt);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push(
      from
        .clone()
        .add(dir.clone().multiplyScalar(t))
        .add(bend.clone().multiplyScalar(Math.sin(t * Math.PI))),
    );
  }
  return pts;
}

/**
 * ============================ 人体遮挡（半透明） ============================
 *
 * 需求：星曜节点绕人体环绕，**身后的**节点要被人体挡住，但人体是半透明的，
 * 所以只能**明显减淡**、不能消失；**身前的**节点必须照常明亮。
 *
 * 为什么不能靠 depthTest 解决：
 *   深度测试是**二值**的 —— 要么被剔、要么全过，得不到"半透明部分遮挡"。
 *   而且人体两层材质是 `depthTest:false` + `renderOrder 1/2`，本来就无视深度
 *   缓冲；节点 sprite 是 `depthWrite:false`（从不写深度）且 renderOrder 默认 0，
 *   于是人体**无条件**盖在所有节点之上 —— 前面的节点也被盖住了，
 *   后面的节点遮挡关系甚至与真实深度相反（旋转时会看到"前节点被挡、
 *   后节点穿帮"的错乱）。根因是**渲染顺序而非真实前后关系**。
 *
 * 采用的路线：**每帧逐节点做屏幕空间判定 + opacity 衰减**。
 *   ① 后方判定：把节点变换到相机空间，比 z。
 *      相机看向原点、人体质心在原点，所以人体所在平面的相机空间 z ≡ -distance。
 *      节点 z 更大（更负得少）= 更远 = 在人体之后。
 *      用相机空间 z 而不是"到相机距离"，是因为距离是标量、不区分前后。
 *   ② 轮廓判定：人体是 Sprite（公告板），**局部 XY 轴恒等于相机右/上轴**，
 *      所以相机空间里 |x| < halfW 且 |y - cy| < halfH 就是精确的矩形包含判定，
 *      不必自己推 NDC 与纵横比的换算（那样容易在非方形窗口下算错）。
 *   ③ 两条都满足 ⇒ 该节点被判为"被人体遮挡"，opacity 乘一个系数。
 *
 * 系数取值见 OCCLUDE_FACTOR 的注释（实测微调过）。
 */
const OCCLUDE_FACTOR = 0.34;

/**
 * 轮廓判定的宽容边（世界单位）。
 *
 * 贴图里人体是个剪影，四角是透明的，而判定用的是**外接矩形**，
 * 所以矩形的四角其实没有像素。留一点正向余量会让"擦边"的节点
 * 也被误判为遮挡。这里取负值：把矩形**内缩** 6%，宁可漏判（节点更亮）
 * 也不要错判（明明在人体旁边却被压暗，那会显得莫名其妙）。
 */
const OCCLUDE_INSET = 0.94;

/**
 * 遮挡衰减的软过渡带（占半宽/半高的比例）。
 *
 * 若用硬边判定，节点在人体轮廓边缘扫过时会"啪"地跳一下亮度。
 * 这里在矩形边缘留 18% 的过渡带，用 smoothstep 平滑过渡。
 */
const OCCLUDE_FEATHER = 0.18;

/**
 * 前后判定的深度余量（世界单位）。
 *
 * 相机看向原点、人体质心在原点，所以人体平面的相机空间 z ≡ -distance。
 * 节点要在**严格更远**时才算被遮挡。留 2cm 是纯防抖：节点轨道半径最小 2.35，
 * 与人体不可能真的共面，但浮点误差 + 呼吸缩放会让临界那一瞬反复翻转。
 */
const OCCLUDE_DEPTH_EPS = 0.02;

/** 星尘（远处的细碎光点，给球面环绕一个空间参照） */
function makeStarDust(): Points {
  const N = 900;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    // 球壳随机
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const r = 9 + Math.random() * 14;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    pos[i * 3] = Math.cos(phi) * s * r;
    pos[i * 3 + 1] = u * r;
    pos[i * 3 + 2] = Math.sin(phi) * s * r;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  const mat = new PointsMaterial({
    size: 0.055,
    color: new Color('#cfd6e6'),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  return new Points(geo, mat);
}

/**
 * 内景 3D 场景控制器。
 *
 * 生命周期：`new InnerScene(...)` → `attach(renderer)` → 每帧 `update(dt)`。
 * 相机操作由外部（InnerOrbitView）负责改写 `azimuth / polar / distance`。
 */
export class InnerScene {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly nodesRoot = new Group();
  readonly orbiting: OrbitingNode[] = [];

  /** 相机球坐标（由外部交互改写） */
  azimuth = 0.4;
  polar = Math.PI / 2 - 0.16;
  distance = 6.4;

  /** 自动旋转：用户停止操作 AUTO_DELAY 毫秒后恢复 */
  autoSpin = true;
  autoSpinSpeed = 0.085; // rad/s

  /** 中央人体平面层（两层：半透明暖金剪影 + 加色发光叠加） */
  private figure!: FigurePlane;
  private readonly nodeMats: ShaderMaterial[] = [];
  /** 流光连线的宿主 Group（挂 nodesRoot 下，与节点同步自转） */
  private readonly flowRoot = new Group();
  /** 全部连线的流光：单个 LineSegments = 1 draw call */
  private flow!: FlowLines;
  /** 星尘（setFlowOnly 时要一起隐藏） */
  private starDust!: Points;
  /**
   * 调试：只显示流光。
   *
   * 必须是**状态位**而不是一次性 `visible = false` ——
   * `update()` 每帧都在按入场进度改写 `sprite.visible`，
   * 一次性设置会在下一帧被覆盖掉（踩过）。
   */
  private flowOnly = false;
  /** 最近一帧的实际 draw call 数（renderer.info 读回，供 HUD/验收） */
  lastDrawCalls = 0;
  private time = 0;
  private enterElapsed = 0;
  private stopped = false;

  /**
   * 逐帧遮挡计算的**复用**临时对象。
   *
   * 每帧要遍历 ~24 个节点，若在循环里 new Vector3 / 矩阵，会产生
   * 每秒上千次短命对象分配（GC 抖动）。这里全部复用。
   */
  private readonly tmpVec = new Vector3();
  private readonly tmpMat = new Matrix4();
  /** 最近一帧被判为「被人体遮挡」的节点与系数（验收脚本要打印这个） */
  readonly lastOccluded: Array<{ id: string; name: string; factor: number }> = [];

  constructor(o: InnerSceneOptions) {
    this.camera = new PerspectiveCamera(42, o.width / o.height, 0.1, 200);
    this.scene.add(this.camera);

    // —— 人体：平面贴图层 ——
    //
    // 这里原本是 `buildBodyGeometry` 的程序化旋转体 + 等粗 TubeGeometry 骨架 +
    // Lathe 花瓣壳片。那条路线已废弃，原因写在 `figurePlane.ts` 头部：
    // 图元堆叠表达不了参考图的连续有机曲面（圆管必然是「黑棒」、壳片必然
    // 渲染成透明三角片交叉）。改用参考图本身处理出的两层素材：
    //   base = 半透明暖金剪影，glow = 骨骼/丹田/火焰的加色发光。
    // 素材是正对镜头的一张正交图，用 Sprite 保证任何环绕视角下人体都是正的。
    this.figure = new FigurePlane();
    this.scene.add(this.figure.group);

    // —— 星尘 ——
    this.starDust = makeStarDust();
    this.scene.add(this.starDust);

    // —— 环绕节点 ——
    this.scene.add(this.nodesRoot);
    const placed = distributeOnSpheres(o.nodes);

    // 流光连线：**一个** LineSegments + **一个** ShaderMaterial 画完全部连线
    // （= 1 draw call）。挂在 nodesRoot 下让它跟节点一起自转；几何写的是
    // nodesRoot 局部坐标，变换由父级统一带动。
    this.flow = new FlowLines({ count: placed.length, refDistance: REF_DISTANCE });
    this.flowRoot.add(this.flow.object);
    this.nodesRoot.add(this.flowRoot);

    placed.forEach((p, i) => {
      const isTenGod = p.src.group === '十神';
      const pos = p.dir.clone().multiplyScalar(p.radius);
      const sprite = makeNodeSprite(p.src, isTenGod);
      sprite.position.copy(pos);
      // 命中测试用：把节点身份挂到 sprite 上
      sprite.userData.nodeId = p.src.id;
      sprite.userData.nodeIndex = i;
      this.nodesRoot.add(sprite);

      // 末端 4% 外扩：脉冲"抵达"标牌边缘而不是消失在圆心，能量感到位
      const tip = pos.clone().multiplyScalar(1.04);
      const pts = buildLinkPoints(0, 0, 0, tip, isTenGod);
      this.flow.setLine(i, pts);
      // 十神内圈线短而亮；神煞外圈线长，稍微压一点避免整体过曝。
      // 权重通过 aLineId 的整数部分之外的方式无法逐线传，
      // 这里用「线长归一」的近似：外圈 t 域更长，shader 里
      // 已按 t 归一，故只需整体调 uOpacity（见 update）。
      this.orbiting.push({
        src: p.src,
        dir: p.dir,
        radius: p.radius,
        sprite,
        linePoints: pts,
        lineIndex: i,
        delay: 240 + i * 58,
        phase: i * 0.7,
      });
    });
  }

  /** 每帧更新；dt 为秒 */
  update(dt: number, renderer: WebGLRenderer): void {
    if (this.stopped) return;
    this.time += dt;
    this.enterElapsed += dt * 1000;

    // 呼吸（人体比节点慢，形成层次）
    const breath = 0.5 + 0.5 * Math.sin((this.time / 4.2) * Math.PI * 2);
    const nodeBreath = 0.5 + 0.5 * Math.sin((this.time / 1.4) * Math.PI * 2);

    for (const m of this.nodeMats) tickMaterial(m, this.time, breath);

    // 人体随呼吸微微起伏（幅度与节点层一致，由 FigurePlane 内部实现）
    this.figure.update(dt, breath);

    // 自动旋转
    if (this.autoSpin) this.azimuth += this.autoSpinSpeed * dt;

    // 相机（球坐标 → 直角坐标，y 轴向上）
    const sinP = Math.sin(this.polar);
    this.camera.position.set(
      Math.cos(this.azimuth) * sinP * this.distance,
      Math.cos(this.polar) * this.distance,
      Math.sin(this.azimuth) * sinP * this.distance,
    );
    this.camera.lookAt(0, 0, 0);

    // 节点入场 + 呼吸缩放
    //
    // 标牌的屏幕尺寸补偿 —— **逐节点**算，不能用相机到原点的距离。
    //
    // 节点在半径 2.35 / 3.15 的球面上，而双击放大把相机拉到 3.2：相机几乎贴在
    // 神煞球面上，近侧节点与相机只差零点几个单位，透视的 1/距离会把它放大到糊满
    // 屏幕。全局标量 (distance / REF_DISTANCE) 对这种「相机进入节点球内部」的情况
    // 无能为力 —— 这正是"放大后一张标牌占满画面"的成因。
    //
    // 改为用「相机到该节点的真实距离」d：世界尺寸取 ∝ d^0.9，则屏幕尺寸
    // ∝ d^(-0.1)，与视距基本无关。指数取 0.9 而非 1.0，是为了留一点"近的稍大"
    // 的纵深，不至于像贴纸一样完全没有空间感。
    const camPos = this.camera.position;

    // —— 人体遮挡判定所需的公共量（每帧只算一次）——
    //
    // 人体是 Sprite，其世界尺寸 = FIGURE_HEIGHT * 呼吸缩放；中心在 (0, cy, 0)。
    // 转到相机空间后，它的"半宽/半高"就是下面这两个值（相机空间单位 = 世界单位）。
    const figScale = 1 + breath * 0.012;
    const figHalfH = (FIGURE_HEIGHT * figScale) / 2;
    const figHalfW = figHalfH * FIGURE_ASPECT;
    // 人体质心的相机空间 z。人体在原点，所以直接取相机位置变换后的 -z。
    // 相机看向原点 ⇒ 原点的相机空间 z = -|camPos| = -this.distance。
    const figZ = -this.distance;
    // 倒置相机矩阵：世界 → 相机空间（复用，不要每节点重复 invert）
    this.camera.updateMatrixWorld();
    this.tmpMat.copy(this.camera.matrixWorld).invert();
    const viewMat = this.tmpMat;

    this.lastOccluded.length = 0;
    let entered = 0;
    for (const n of this.orbiting) {
      const app = clamp01((this.enterElapsed - n.delay) / 760);
      const eased = 1 - Math.pow(1 - app, 3);
      entered = Math.max(entered, eased);
      if (eased <= 0.001 || this.flowOnly) {
        n.sprite.visible = false;
        continue;
      }
      n.sprite.visible = true;
      // 下限只取 0.05：屏幕尺寸 = 世界尺寸/真实距离，若把距离截到大值，
      // 世界尺寸被冻住而分母仍用真实距离，反而会重新放大。d^0.9 让屏幕尺寸
      // 随 d 只按 d^(-0.1) 变化，本身就有界，无需靠截断来兜。
      const d2node = Math.max(0.05, camPos.distanceTo(n.sprite.position));
      const nodeScale = Math.pow(d2node / REF_DISTANCE, 0.9);
      const puls = 1 + Math.sin(this.time * 1.6 + n.phase) * 0.045 * nodeBreath;
      const sc = BASE_SPRITE_SCALE * nodeScale * (0.86 + 0.14 * eased) * puls;
      n.sprite.scale.set(sc, sc, 1);

      // —— 被人体遮挡时的亮度衰减 ——
      // 必须**乘在** eased 之上，而不是替换它 ——
      // 否则会覆盖掉入场淡入与后续可能的呼吸透明度变化（踩过类似的坑）。
      const occl = this.occlusionFactor(n.sprite.position, viewMat, figZ, figHalfW, figHalfH);
      if (occl < 1) {
        this.lastOccluded.push({ id: n.src.id, name: n.src.name, factor: occl });
      }
      (n.sprite.material as SpriteMaterial).opacity = eased * occl;
    }

    // —— 流光连线 ——
    // ① FlowLines 内部推进 uTime，并按相机距离算 uFade / uDistScale
    //   （拉近→收敛，拉远→变细变亮，见 flowLine.ts 的注释）
    // ② 整体淡入跟随入场进度：乘 1.3 让线比最慢的节点先到位，
    //   开场不会出现"先有线后有点"的割裂感
    this.flow.update(dt, this.distance);
    this.flow.setOpacity(Math.min(1, entered * 1.3));

    renderer.render(this.scene, this.camera);
    this.lastDrawCalls = renderer.info.render.calls;
  }

  /**
   * 单个节点被人体遮挡的程度。返回 1 = 不遮挡，< 1 = 需要减淡。
   *
   * 判定分两步（都要求同时成立才算被遮挡）：
   *   ① **在人体之后**：节点相机空间 z 大于人体平面的 z。
   *      注意相机空间里 z 是负的、越远越负，所以"更远"= z 更大。
   *   ② **落在人体屏幕轮廓内**：人体是公告板，其局部 XY 轴 = 相机右/上轴，
   *      所以相机空间里 (x, y) 直接与人体中心的矩形比较即可，
   *      不需要推 NDC、也不会被窗口纵横比影响。
   *
   * 只在 X（横向）上留过渡带：节点是绕着竖直轴环绕的，穿越人体轮廓
   * 绝大多数是**左右**进出，纵向几乎总是落在人体高度之内（人体高 2.10，
   * 而节点在半径 2.35/3.15 的球面上，上下极点附近才可能超出）。
   * 两个方向都加 feather 也能做，但横向上更常见，且上下加软边会让
   * "从头顶/脚底经过"的节点糊掉，反而更脏。
   *
   * @param worldPos 节点世界坐标（这里会写入复用向量，调用方不要保留引用）
   */
  private occlusionFactor(
    worldPos: Vector3,
    viewMat: Matrix4,
    figZ: number,
    figHalfW: number,
    figHalfH: number,
  ): number {
    // 世界 → 相机空间
    this.tmpVec.copy(worldPos).applyMatrix4(viewMat);
    const vz = this.tmpVec.z;
    // vz 更大 = 更远（相机空间 z 是负的）。只有真的更远才算"在人体之后"。
    // 留 2cm 世界单位的余量：节点轨道半径最小 2.35，人体在原点，
    // 两者的前后关系不会真的贴上；这点余量纯粹是防浮点抖动，
    // 让"正好落在人体平面上"的极端瞬态不会被忽明忽暗地反复翻转。
    if (vz <= figZ + OCCLUDE_DEPTH_EPS) return 1;

    const ax = Math.abs(this.tmpVec.x) / figHalfW;
    const ay = Math.abs(this.tmpVec.y - FIGURE_CENTER_Y) / figHalfH;

    // 把矩形**内缩**一点：贴图里人体是剪影、矩形四角本来就是透明的，
    // 擦着四角过去的节点不该被判定为遮挡（那会显得莫名其妙地暗）。
    const a = Math.max(ax, ay) / OCCLUDE_INSET;
    if (a >= 1) return 1;

    // 边缘软过渡：中心（a=0）完全遮挡，接近边缘（a→1）恢复无遮挡。
    // 用 smoothstep 而不是硬边，否则节点扫过轮廓边缘时会"啪"地跳一下亮度。
    const soft = smoothstep(1 - OCCLUDE_FEATHER, 1, a);
    return 1 + (OCCLUDE_FACTOR - 1) * (1 - soft);
  }

  /**
   * 屏幕坐标 → 命中的节点 id（供 task-4 的点击弹窗使用）。
   *
   * 用 Raycaster 对节点 sprite 做交点测试（three 的 Sprite 支持 raycast，
   * 因为它是始终面向相机的公告板）。`x`/`y` 传**相对 canvas 左上角**的
   * CSS 像素；内部换算成 NDC。
   *
   * 注意：需要先有 `camera.updateMatrixWorld()` —— update() 每帧都会改
   * 相机位置，所以这里自己调一次，避免外部在没有渲染过时调用拿到旧矩阵。
   */
  pickNode(x: number, y: number, width: number, height: number): string | null {
    this.camera.updateMatrixWorld();
    this.nodesRoot.updateMatrixWorld(true);
    const ndc = new Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    ray.params.Sprite = { threshold: 0 };
    const hits = ray.intersectObjects(
      this.orbiting.filter((n) => n.sprite.visible).map((n) => n.sprite),
      false,
    );
    if (!hits.length) return null;
    const id = hits[0].object.userData.nodeId;
    return typeof id === 'string' ? id : null;
  }

  /** 节点 id → 世界坐标（供弹窗做"指向节点"的定位动画） */
  nodeWorldPosition(id: string): Vector3 | null {
    const n = this.orbiting.find((o) => o.src.id === id);
    if (!n) return null;
    this.nodesRoot.updateMatrixWorld(true);
    return n.sprite.getWorldPosition(new Vector3());
  }

  /** 视口尺寸变化时重建相机纵横比（相机纵横比错了画面会拉伸） */
  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /**
   * 调试开关：只显示流光连线（关掉人体 / 星尘 / 节点标牌）。
   *
   * 用途是把"流光本身长什么样"从场景里隔离出来 —— 验收时用来确认
   * 脉冲、拖尾、颜色循环都清晰，而不是被人体和标牌挡住看不清。
   */
  setFlowOnly(on: boolean): void {
    this.flowOnly = on;
    this.figure.setVisible(!on);
    this.starDust.visible = !on;
    // sprite.visible 由 update() 每帧驱动，这里只作为"是否允许显示"的开关
    if (on) {
      for (const n of this.orbiting) n.sprite.visible = false;
    }
  }

  /** 节点沿球面自转（保留接口：可在外部驱动整体缓慢旋转） */
  dispose(): void {
    this.stopped = true;
    this.flow?.dispose();
    this.scene.traverse((obj) => {
      const anyObj = obj as unknown as { geometry?: BufferGeometry; material?: unknown };
      anyObj.geometry?.dispose();
      const mat = anyObj.material as
        | (ShaderMaterial | SpriteMaterial | PointsMaterial)
        | undefined;
      if (mat && 'map' in mat && mat.map) mat.map.dispose();
      mat?.dispose();
    });
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** GLSL 同名函数的 JS 版：edge0→0，edge1→1，中间三次平滑 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
