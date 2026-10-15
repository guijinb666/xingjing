/**
 * 3D 人体几何构建。
 *
 * 用参考片实测剖面表（`bodyProfile.ts`）生成**真三维**的打坐人体：
 *
 *   1. **躯干 + 头 + 盘腿：一个连续旋转体**
 *      把「高度 → 半宽/半深」剖面绕 y 轴旋转成曲面。横截面是**椭圆**
 *      （前后扁、左右宽），所以不用 LatheGeometry 的圆形旋转，而是自己
 *      按 phi 采样椭圆截面 —— 这样胸腔是扁的、盘腿是摊开的，符合真实体型。
 *      因为头颈与躯干共用同一条剖面，颈根处宽度天然连续，不会有台阶。
 *
 *   2. **膝部体块**：两团扁球压在盘腿两侧最宽处，让双膝像参考片那样明确凸出。
 *      （参考片剖面在 t 0.7393→0.7426 有一次骤跳，物理上就是腿盘起来的边缘；
 *      轮廓表不能照搬骤跳，改由这里的体块表达。）
 *
 *   3. **手臂**：参考片剖面本身已含手臂，但那是「平面轮廓」的做法。在 3D 里
 *      必须给手臂真实体量，否则从侧面看躯干会缺一块。
 *      做法：沿 肩→肘→腕 路径生成**逐点变半径的管**，贴体下垂不向外鼓。
 *
 *   4. **莲花印手**：掌位一个扁椭球 + 拇指食指相触的环 + 三指。
 *
 * 坐标系：**y 轴向上，原点在人体中心**（HEAD_TOP 与 LAP_BOTTOM 的中点）。
 * 与 `bodyProfile.sampleProfile()` 的输出一致。
 */

import { BufferAttribute, BufferGeometry, Group, Mesh, SphereGeometry, Vector3 } from 'three';
import { BODY_H, HEAD_TOP, LAP_BOTTOM, depthRatioAt, halfWidthAt } from './bodyProfile';

/** 单位坐标 → 世界单位的倍率（人体总高 = BODY_H × scale） */
export const DEFAULT_SCALE = 1;

/** 绕 y 轴一圈的分段数 */
const RADIAL_SEGMENTS = 64;

/** 人体中心高度（单位坐标）：sampleProfile 以它为原点 */
const CENTRE_Y = (HEAD_TOP + LAP_BOTTOM) / 2;

/** 单位坐标 y → 以人体中心为原点的世界坐标 y */
function toWorldY(yUnit: number, scale: number): number {
  return (yUnit - CENTRE_Y) * scale;
}

/**
 * 手臂的「侧向凸包」权重。
 *
 * ============================ 为什么必须这么做 ============================
 * 参考片剖面（`PROFILE`）测的是人形**整体外轮廓**，t 0.36–0.48 的
 * 0.383–0.422 已经**含手臂**。但旋转体是绕 y 轴转一圈的轴对称形状，
 * 直接把「含臂半宽」转一圈，手臂就被转成了**一整圈裙摆**——
 * 从正面看是两块平板，从侧面看躯干凭空宽了一圈。
 *
 * 手臂是**左右两侧的局部凸起**，不是轴对称特征，所以必须按方位角调制：
 * 在肩到腕的高度区间里，只在 ±x（正左右两侧）把半径「推出去」，
 * 推到剖面表含臂的外缘；而在 ±z（前后）保持纯躯干宽度。
 * 这样手臂天然长在体表上，**不可能有缝**，且从任何角度转都连续。
 *
 * 返回 0 = 纯躯干，1 = 推到含臂外缘。
 * ==========================================================================
 */
function armBulge(phi: number, yUnit: number): number {
  // 纵向包络：肩 (0.461) 到腕 (-0.03) 之间有效，两端平滑淡出。
  //
  // ⚠️ 两端必须**真正平滑淡出到 0**，否则凸包会在肩/腕处留下两个
  // 环形硬边；而凸包本身是一段圆柱面，法线朝侧方，菲涅尔的 core 项
  // （pow(cosTheta,1.35)）在那里拿不到亮度 —— 渲染出来就是
  // **两条从肩贯穿到盘腿的竖直暗带**，像贴了两条胶带。
  // 修正：① 纵向用 sin^0.9 在两端收敛（原 ^0.62 收得太慢，两端仍接近满值）；
  //      ② 中段包络从钟形改为「上臂饱满、往下单调收细」，让凸包在
  //         体表上是一条渐隐的棱而不是等宽圆柱；
  //      ③ 方位角从 |cos|^3.2 收到 |cos|^2.2，让凸包更宽更柔，
  //         法线过渡更缓和，不会形成一个窄而陡的深槽。
  const shoulderY = 0.461;
  const wristY = -0.03;
  if (yUnit > shoulderY || yUnit < wristY) return 0;

  const u = (shoulderY - yUnit) / (shoulderY - wristY); // 0=肩 1=腕
  // 纵向：两端收到 0，中段偏上最饱满
  const along = Math.sin(Math.PI * u) ** 0.9;
  // 上臂最饱满，向前臂单调收细
  const taper = 1 - 0.34 * Math.max(0, u - 0.30);
  const profile = along * taper;

  // 方位角包络：只在 ±x 附近推出，前后为 0
  const c = Math.cos(phi);
  const lateral = Math.pow(Math.abs(c), 2.2);

  return profile * lateral;
}

/** 手臂凸包最多把半宽推到躯干的多少倍（1.0 = 不外扩，只用于微调） */
const ARM_BULGE_GAIN = 1.0;

/**
 * 按剖面表生成躯干 + 头 + 盘腿的**单个连续旋转体**。
 *
 * 因为剖面表同时覆盖头、颈、躯干、盘腿，所以这一个网格就是整个人体外形，
 * 不存在「头单独建模与躯干接不上」的问题。
 *
 * 截面不是纯椭圆，而是**椭圆 + 左右两侧手臂凸包**（见 `armBulge`）：
 * 这样手臂是体表自身的形变，不是另建的管子，两者之间不会出现黑缝。
 */
export function buildBodyGeometry(o: { scale?: number; steps?: number } = {}): BufferGeometry {
  const scale = o.scale ?? DEFAULT_SCALE;
  const steps = o.steps ?? 160;

  const positions: number[] = [];
  const indices: number[] = [];

  // 逐层采样：每层是一个带侧向凸包的椭圆环
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const yUnit = HEAD_TOP - t * BODY_H;
    const hw = halfWidthAt(yUnit);
    const halfW = hw * scale;
    const halfD = hw * depthRatioAt(yUnit) * scale;
    const y = toWorldY(yUnit, scale);

    for (let j = 0; j <= RADIAL_SEGMENTS; j++) {
      const phi = (j / RADIAL_SEGMENTS) * Math.PI * 2;
      const cos = Math.cos(phi);
      const sin = Math.sin(phi);

      // 基准椭圆半径
      const baseX = cos * halfW;
      const baseZ = sin * halfD;

      // 侧向凸包：沿该方位角把点往外推
      const bulge = armBulge(phi, yUnit) * ARM_BULGE_GAIN;
      // 推出量取「该方向上的椭圆半径」的一个比例，方向沿该方位角
      const r0 = Math.hypot(baseX, baseZ);
      const push = r0 * bulge * 0.34;

      const inv = r0 > 1e-6 ? 1 / r0 : 0;
      positions.push(baseX + baseX * inv * push, y, baseZ + baseZ * inv * push);
    }
  }

  // 连成三角网（四边形拆两个三角）
  const stride = RADIAL_SEGMENTS + 1;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < RADIAL_SEGMENTS; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = (i + 1) * stride + j;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 用「曲线 + 逐点半径」生成管状几何。
 * three 自带的 TubeGeometry 只支持恒定半径，而需要从粗到细的锥管时用它。
 */
function taperingTube(
  points: Vector3[],
  radii: number[],
  radialSegments: number,
): BufferGeometry {
  // 采样曲线得到等距点与 Frenet 标架
  const curve = new (class extends Array<Vector3> {})();
  void curve;
  const n = points.length;
  const positions: number[] = [];
  const indices: number[] = [];

  // 手工构造沿路径的标架（避免依赖 three 内部 API，更可控）：
  // 用「参考上方向」叉乘切线得到法线，再叉乘得到副法线。
  const tangent: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    tangent.push(new Vector3().subVectors(next, prev).normalize());
  }
  // 初始参考向量：与切线不平行即可
  let ref = new Vector3(0, 0, 1);
  if (Math.abs(tangent[0].dot(ref)) > 0.9) ref = new Vector3(1, 0, 0);

  let normal = new Vector3().crossVectors(tangent[0], ref).normalize();
  for (let i = 0; i < n; i++) {
    // 平行传输：把上一段法线投影到当前切线的垂直平面，避免扭转
    if (i > 0) {
      const t = tangent[i];
      normal = normal
        .clone()
        .sub(t.clone().multiplyScalar(normal.dot(t)))
        .normalize();
    }
    const binormal = new Vector3().crossVectors(tangent[i], normal).normalize();
    const r = radii[i];
    for (let j = 0; j <= radialSegments; j++) {
      const phi = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(phi);
      const sin = Math.sin(phi);
      positions.push(
        points[i].x + r * (cos * normal.x + sin * binormal.x),
        points[i].y + r * (cos * normal.y + sin * binormal.y),
        points[i].z + r * (cos * normal.z + sin * binormal.z),
      );
    }
  }

  const stride = radialSegments + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = (i + 1) * stride + j;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** 沿路径做 Catmull–Rom 加密采样（自己实现，避免依赖 three 曲线类） */
function resample(points: Vector3[], count: number): Vector3[] {
  if (points.length < 2) return points.slice();
  const out: Vector3[] = [];
  const segs = points.length - 1;
  for (let i = 0; i < count; i++) {
    const u = (i / (count - 1)) * segs;
    const i0 = Math.min(segs - 1, Math.floor(u));
    const f = u - i0;
    const p0 = points[Math.max(0, i0 - 1)];
    const p1 = points[i0];
    const p2 = points[i0 + 1];
    const p3 = points[Math.min(segs, i0 + 2)];
    // Catmull–Rom（张力 0.5）
    const f2 = f * f;
    const f3 = f2 * f;
    const cr = (a: number, b: number, c: number, d: number): number =>
      0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
    out.push(
      new Vector3(
        cr(p0.x, p1.x, p2.x, p3.x),
        cr(p0.y, p1.y, p2.y, p3.y),
        cr(p0.z, p1.z, p2.z, p3.z),
      ),
    );
  }
  return out;
}

/**
 * 莲花印手：掌心扁椭球 + 拇指食指相触的环 + 三根伸展的手指。
 * 参照参考片：两手分置两膝上方，拇指与食指指尖相触成环。
 *
 * ⚠️ 这里**只有手**是独立网格。手臂与膝**不再**建独立网格 ——
 *    `buildArmGeometry`（肩→腕锥管）与 `buildKneeBlocks`（两团扁球）都已删除。
 *    原因见 innerScene 的注释：在 `AdditiveBlending` + `depthWrite:false` 下
 *    每块网格都**各自保留轮廓**，手臂会变成两根浮在体外的粗柱并留下贯穿暗缝，
 *    膝球会变成盘腿两侧飘着的两个悬空圆球。它们现已改为
 *    `buildBodyGeometry` 内部 `armBulge()` 的**方位角侧向凸包**与盘腿剖面本身。
 *    手之所以仍可独立，是因为它位于体表**之外**（骑在膝头圆顶上）。
 */
export function buildHandGroup(o: { scale?: number; side?: 1 | -1 } = {}): Group {
  const scale = o.scale ?? DEFAULT_SCALE;
  const s = o.side ?? 1;
  const g = new Group();

  // 手落在**膝头圆顶的正上方**（不是悬在身体两侧的空中，也不能埋进盘腿曲面里）。
  //
  // ⚠️ 手位必须与 PROFILE 的盘腿段联动，不能写死（已三次放错）：
  //   ① 盘腿段收窄后（峦顶半宽 0.538 在 y=-0.16），原先写死的
  //      x=±0.375 / y=+0.020 落在半宽 0.319 的体表**内部**，手完全看不见；
  //   ② 放到 x=±0.442 / z=0.055 又太靠外太靠前：手指朝上翘出体表，
  //      从正面看只是一团歪斜的糊斑，读不出掌心与指环；
  //   ③ 参考片的手是**平放**在膝头圆顶上、掌心朝下、指尖朝前，
  //      z 只略前移，且整个手都要**贴着体表**。
  //   现取 y=-0.128（峦顶附近，体表半宽 0.520）→ 手 x=±0.428（0.82×半宽，
  //   这样掌心一半在体表内、一半露在外面，被加色混合勾出轮廓），
  //   z 仅前移 0.030，并把手指改为**向前平伸**而不是向上翘。
  const HAND_Y = -0.128;
  const hx = s * 0.428;
  const hy = toWorldY(HAND_Y, scale);
  const hz = 0.030 * scale;

  // 掌
  const palm = new SphereGeometry(0.055 * scale, 18, 14);
  palm.scale(1.0, 1.25, 0.6);
  const palmMesh = new Mesh(palm);
  palmMesh.position.set(hx * scale, hy, hz);
  g.add(palmMesh);

  // 拇指食指相触成环（莲花印）：环**向前平置**在掌心上方，不竖起来。
  //    原先环是竖直圆（xy 平面），从正面看像一根竖着的圆棒插在手上。
  //    参考片的手是掌心朝上、环口朝斜前——所以环要落在 **xz 平面附近的斜面**：
  //    x 分量保持左右张开，y 只抬 0.006，z 分量给足前伸。
  const ringPts: Vector3[] = [];
  const RING = 16;
  for (let i = 0; i < RING; i++) {
    const a = (i / RING) * Math.PI * 2;
    ringPts.push(
      new Vector3(
        hx * scale + Math.cos(a) * 0.023 * scale,
        hy + 0.008 * scale + Math.sin(a) * 0.007 * scale, // 压扁成斜置的环
        hz + 0.020 * scale + Math.sin(a) * 0.016 * scale,
      ),
    );
  }
  g.add(new Mesh(taperingTube(ringPts, new Array(RING).fill(0.0075 * scale), 8)));

  // 三根伸展的手指：**向前平伸**（指尖朝前 z+，几乎不上抬）。
  //    原先终点是 hy + 0.062（向上翘 0.062），渲染出来是抠起的爪。
  //    参考片手指沿膝头表面向前摊开，所以这里 y 只加 0.008，
  //    改为主要的 z 位移（0.052）并在左右略微散开。
  for (let k = 0; k < 3; k++) {
    const ang = -0.42 + k * 0.34;
    const finger = [
      new Vector3(hx * scale, hy + 0.004 * scale, hz + 0.006 * scale),
      new Vector3(
        hx * scale + s * Math.sin(ang) * 0.044 * scale,
        hy + 0.008 * scale,
        hz + 0.052 * scale,
      ),
    ];
    const fpts = resample(finger, 6);
    g.add(new Mesh(taperingTube(fpts, new Array(6).fill(0.0075 * scale), 7)));
  }

  return g;
}
