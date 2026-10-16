/**
 * 打坐人体 + 莲花座 —— 分件程序化几何（img2threejs 规格实现）。
 *
 * ## 为什么重写
 *
 * 旧实现（`bodyGeometry.ts`）把「头 + 躯干 + 盘腿」做成**一个绕 y 轴的旋转体**，
 * 再用 `armBulge()` 按方位角推出局部凸包来「假装」手臂。旋转体在数学上
 * 无法表达三类结构，而这三类恰好是参考图的身份特征：
 *
 *   1. **盘腿**：双膝在左右、腿肚在前后，横截面是矩形而非圆。
 *      旋转体只能给出一个「摊开的飞碟」。
 *   2. **肩宽**：肩带前后薄（0.80 深度比）而左右宽，与躯干同一层高却不同宽。
 *   3. **莲花座**：22 片花瓣分三层，是**径向阵列**，旋转体给不出花瓣间隙。
 *
 * ## 本实现的结构
 *
 * 截面不再假设圆，而是**带方位角调制的超椭圆**：
 *
 *     r(θ) = ( |cosθ|^n + |sinθ|^n )^(-1/n)
 *
 * n = 2 是椭圆，n → ∞ 是矩形。盘腿截面 n ≈ 2.9（近矩形，四角即双膝），
 * 躯干 n ≈ 2.2。再叠一层**前后非对称**（胸廓前凸 / 腰椎前凹 / 臀后凸），
 * 这是侧视 S 形轮廓的来源，也是纯旋转体永远做不到的。
 *
 * ## 坐标系（严格遵循 spec.coordinateFrame）
 *
 *   · front  = 人体面向 +Z
 *   · up     = +Y
 *   · right  = **人体左侧 = +X**（观察者视角右手边是 -X）
 *   · origin = 人体总高的中点
 *   · H = 1.000 世界单位 = 人体总高（不含莲座），人体 y ∈ [0, 1.000]
 *   · 莲座高 0.26 H，位于 y ∈ [-0.26, 0]
 *
 * ## 尺寸来源（不得凭空编）
 *
 * 全部来自 `spec.preSpecAssessment.anatomy.proportions`（单位 HU = 0.125 H）
 * 与 `bodyProfile.ts` 的逐行实测剖面（31 帧平均）。两者口径不同：
 * 前者是坐姿解剖比例，后者是像素实测外轮廓。本模块以 **anatomy 为主尺**，
 * 用 bodyProfile 校准纵向分布。
 */

import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  LatheGeometry,
  Mesh,
  Object3D,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';

// ============================================================
// 尺度常量（H = 1.000 = 人体总高，不含莲座）
// ============================================================

/** 人体总高（世界单位）。规格锁定，首次渲染后不得变更。 */
export const H = 1.0;

/** 头身单位：1 HU = 0.125 H */
export const HU = 0.125 * H;

/** 坐姿头身数（spec.anatomy.styleHeads） */
export const STYLE_HEADS = 8.0;

/** 人体在场景 y 轴的范围：盘腿底 y = 0，颅顶 y = H */
export const FIGURE_BOTTOM = 0;
export const FIGURE_TOP = H;

/**
 * 莲座：高 **0.3719 H**（逐像素实测），位于人体下方。
 *
 * 规格写 0.26 H，实测 0.372 H —— 大 43%。以实测为准，理由同剖面表：
 * 目标是复刻参考图。
 * 分界 t=0.729 时 人体 882px / 莲座 328px → 328/882 = 0.3719。
 * 含莲座总高 = 1.3719 H。
 *
 * 直径实测 0.9456 H（规格写 1.05 H，实测小 10%）。
 */
export const LOTUS_HEIGHT = 0.3719 * H;
export const LOTUS_TOP = 0;
export const LOTUS_BOTTOM = -LOTUS_HEIGHT;
/** 莲座直径 0.9456 H → 半径 0.4728 H */
export const LOTUS_RADIUS = 0.4728 * H;

/** 含莲座总高（H 口径），用于相机取景与场景包围盒 */
export const TOTAL_HEIGHT = LOTUS_HEIGHT + H;

// ============================================================
// 关键高度（anatomy 口径，H = 1）
// ============================================================
//
// 由 proportions 反推（HU → H 乘 0.125）：
//   肩峰   shoulderWidth 1.6 HU 的一半 = 0.8 HU = 0.100 H
//   topic: 颅顶 1.000 → 下颌 0.875 → 颈底 0.845 → 肩带 0.762
//          胸廓 0.68 → 腰 0.61 → 髋 0.48 → 盘腿顶 0.34 → 盘腿底 0
const Y = {
  crown: 1.0,
  /** 眉间亮斑 */
  browPoint: 0.925,
  /** 耳上缘 */
  earTop: 0.90,
  /** 眼线（闭合眼睑） */
  eyeLine: 0.878,
  /** 鼻底 */
  noseBase: 0.845,
  /** 颏（下颌底） */
  chin: 0.825,
  /** 颈底 / 胸廓顶 */
  neckBase: 0.79,
  /** 肩峰 */
  shoulder: 0.762,
  /** 胸廓中心 */
  thorax: 0.68,
  /** 胸骨上端 */
  sternumTop: 0.735,
  /** 胸骨下端 */
  sternumBottom: 0.575,
  /** 腰最细 */
  waist: 0.575,
  /** 丹田 */
  dantian: 0.455,
  /** 髋 */
  pelvis: 0.48,
  /** 盘腿顶（膝上缘） */
  lapTop: 0.34,
  /** 膝高（盘腿最宽处） */
  knee: 0.19,
  /** 盘腿底 */
  lapBottom: 0,
} as const;

// ============================================================
// 横截面：带方位角调制的超椭圆 + 前后非对称
// ============================================================

/**
 * 超椭圆指数：2 = 椭圆，越大越接近矩形。
 *
 * ⚠️ 盘腿段**不能**用高指数。曾经用 2.9（近矩形），配合盘腿段的前后深度，
 * 侧视渲染出来是一个**平顶平底的方鼓/矮桌**，与参考图的圆润楔形坐垫完全不符。
 * 参考图里盘腿只是「略比椭圆方一点」（膝盖处在左右两侧形成轻微转折），
 * 所以取 2.45 —— 保住膝盖转折，同时整体仍是圆润曲面。
 */
const N_TORSO = 2.2;
const N_LAP = 2.45;

/**
 * 盘腿段的高度范围（H 单位）。**这是「旧实测不可信区」的边界**。
 *
 * y ≥ 0.30 的逐行实测是可信的（`trust=ok`）；y < 0.30 起 `human.json` 标
 * `trust=CONTAMINATED-by-lotus` —— 莲座花瓣在屏幕上与双腿重叠，逐行扫描
 * 测到的是莲座尺度（side_front_H 在 y0.242 突跳到 0.6666，比整个人体都宽）。
 *
 * ⚠️ 但 `human.json` 的**单一外沿宽度**口径本身也是错的：它取整行最外沿，
 * 而莲瓣在盘腿高度上与腿同处一条扫描线且更宽。正解是**逐行 run 分段**，
 * 取「属于身体的那一段」（排除 ±0.35 的臂、±0.52 的莲瓣）。
 * 按该口径重测后，盘腿段已全部有真值，见 `TORSO_PROFILE` 与 `sagittalProfile`
 * 的盘腿段注释；本常量现仅供阅读参考，不再参与计算。
 */
/**
 * ???????????????buildCrossedLegs??**????**?
 *
 * ???? y < LAP_MERGE_Y ???????? ?? ????????/??/??
 * ????????? y?LAP_MERGE_Y ????????? ?0.140?
 * ????? 0.072 + ?? 0.064 = ?? 0.136?????????
 */
export const LAP_MERGE_Y = 0.185;
export const LAP_TOP_Y = 0.30;
export const LAP_BOTTOM_Y = 0.0;

/**
 * 单位超椭圆在方位角 θ 的半径系数。
 * 返回 1 表示该方向到达标准半径，< 1 表示收进。
 */
function superellipse(theta: number, n: number): number {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  const v = Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n);
  // n = 2 时上式恒为 1（圆），这正是我们要的基准
  return v;
}

/**
 * 侧视前后非对称调制。
 *
 * 参考片侧视有 **S 形前后轮廓**：胸廓前凸、腰椎前凹、臀后凸。
 * 纯旋转体的前后深度是同一个数，做不出 S 形，所以这里给 +Z（前）与
 * -Z（后）分别的深度比。
 *
 * 返回值 `[frontScale, backScale]`，分别乘到 +Z / -Z 方向的半径上。
 */
function sagittalProfile(y: number): [number, number] {
  // 表为**逐像素实测**（口径 H = 人体高），列为 [y, 前侧半深_H, 后侧半深_H]：
  //   头   y0.935 → 0.1310 / 0.0811（头前后径 > 左右径，比 0.212:0.143 ≈ 1.48）
  //   眉弓 y0.905 → 0.1366 / 0.0754
  //   鼻底 y0.860 → 0.1514 / 0.0573（鼻尖前伸）
  //   颏   y0.835 → 0.1196 / 0.0618
  //   颈   y0.790 → 0.0493 / 0.0686（颈细，后侧略厚）
  //   肩峰 y0.740 → 0.0391 / 0.0414
  //   腋下 y0.700 → 0.0652 / 0.1276（后背开始外凸）
  //   胸廓 y0.640 → 0.0992 / 0.1446
  //   腰   y0.560 → 0.1037 / 0.1219
  //   髋   y0.480 → 0.0992 / 0.0924
  //   盘腿 y0.380 → 0.3577 / 0.2115（膝向前甩）
  //   膝高 y0.230 → 0.4280 / 0.1820
  //   最宽 y0.150 → 0.4495 / 0.4393
  //
  // 返回的是**前/后半深绝对值（H）**，不是"深度比" —— 上游按各自高度
  // 除以正视半宽得到比值，否则躯干会被压成纸片。
  const KEY: ReadonlyArray<readonly [number, number, number]> = [
    [1.0, 0.0334, 0.0074],
    [0.985, 0.0702, 0.0450],
    [0.965, 0.1060, 0.0672],
    [0.945, 0.1236, 0.0762],
    [0.935, 0.1310, 0.0811],
    [0.920, 0.1336, 0.0794],
    [0.905, 0.1366, 0.0754],
    [0.885, 0.1412, 0.0652],
    [0.860, 0.1514, 0.0573],
    [0.845, 0.1354, 0.0596],
    [0.835, 0.1196, 0.0618],
    [0.820, 0.0880, 0.0640],
    [0.805, 0.0630, 0.0668],
    [0.790, 0.0493, 0.0686],
    [0.775, 0.0410, 0.0630],
    [0.762, 0.0312, 0.0561],
    [0.752, 0.0342, 0.0482],
    [0.740, 0.0391, 0.0414],
    [0.728, 0.0432, 0.0604],
    [0.715, 0.0538, 0.0880],
    [0.700, 0.0652, 0.1276],
    [0.685, 0.0790, 0.1450],
    [0.670, 0.0892, 0.1462],
    [0.656, 0.0958, 0.1459],
    [0.640, 0.0992, 0.1446],
    [0.624, 0.1010, 0.1428],
    [0.608, 0.1024, 0.1372],
    [0.592, 0.1031, 0.1296],
    [0.576, 0.1035, 0.1254],
    [0.560, 0.1037, 0.1219],
    [0.544, 0.1028, 0.1152],
    [0.528, 0.1020, 0.1086],
    [0.512, 0.1010, 0.1044],
    [0.496, 0.1000, 0.0972],
    [0.480, 0.0992, 0.0924],
    [0.464, 0.1006, 0.0942],
    [0.448, 0.1024, 0.0982],
    [0.432, 0.1058, 0.1046],
    [0.416, 0.1110, 0.1120],
    [0.400, 0.1218, 0.1216],
    [0.390, 0.1324, 0.1302],
    // ---- 盘腿段：侧视 run 中心段一手实测（不再用污染表）----
    // 旧表在 y0.380 从 0.1324 突跳到 0.3577，那是**莲座前半圈花瓣**
    // （比整个人体都宽）；y0.15 的 0.4495/0.4393 同理。全部报废。
    // 新值口径：取侧视逐行 run 分段里**属于身体的那一段**（排除 ±0.35 臂、
    // ±0.52 莲瓣），来源 `_probe/ref3view/diag_side_lap.py`。
    //
    // 关键结论：**增量全在正前方**。后沿从髋部 +0.117 到盘腿 +0.111~0.133
    // 几乎不动；前方从 -0.115 一路推到 -0.324。这正是「双腿盘在身前」。
    // ⚠️ 本轮修正（body-fix）：原表在 y0.38→0.0 是一段**恒定平台**
    // （前 0.315~0.328 几乎不动、后 0.130~0.133 完全不动），
    // 于是 y∈[0, 0.19] 这 19% 的人体高在侧视里成了一面**竖直墙**，
    // 底面又没有封口被切平 —— 渲染出来正是「平顶平底的大鼓/矮桌」。
    // 前一轮把它归因于超椭圆指数 N_LAP，是错的：n 只影响 XY 截面圆角，
    // 前后深度完全由本表决定。逐带实测见 _probe/bodyfix_notes.md。
    //
    // 新表按**参考图侧视的圆垫形态**重建：深度在 y≈0.15~0.17 达峰，
    // 向上平滑收进髋、向下**持续收圆**到 y=0 仍保留约 62% 峰值，
    // 使底缘是圆润碗底而不是刀刃、也不是平底。
    //
    // 前方（膝/小腿前伸）——峰值 0.3280 在 y0.17：
    // ???? 2026-10-16 ?????Lead?????????**????**?
  // body-fix ? y0.38?0.0 ???? 0.315~0.328 ?????? 0.130 ????
  // ???????????????????? `_probe/ref3view/sidebody.py`
  // ??? run ????**???????**??????????
  //
  //   y0.44 ? front +0.108 / back -0.120   (??)
  //   y0.31 ? front +0.084 / back -0.106   (?)
  //   y0.28 ? front +0.090 / back -0.146   (???)
  //   y0.20 ? front +0.099 / back -0.120
  //   y0.16 ? front +0.110 / back -0.31    (**????**????)
  //
  // ?????**?????????? +0.08~+0.12?????????**?
  // ?????????????????? -0.30 ???**?????**?
  // ??? y?0.16 ??**????**??????????????
  //
  // ????????/????????????
  //   ?? +0.080~+0.120??????????????????
  //   ?? -0.106~-0.180??????????
  // ??? y<0.16 ????????????????
  [0.380, 0.0868, 0.1154],
  [0.360, 0.0835, 0.1110],
  [0.340, 0.0802, 0.1088],
  [0.320, 0.0813, 0.1055],
  [0.300, 0.0835, 0.1250],
  [0.280, 0.0901, 0.1462],
  [0.260, 0.0868, 0.1714],
  [0.240, 0.0880, 0.1100],
  [0.220, 0.0934, 0.1080],
  [0.200, 0.0989, 0.1198],
  [0.180, 0.1044, 0.1418],
  [0.160, 0.1100, 0.1500],
  [0.140, 0.1140, 0.1520],
  [0.120, 0.1170, 0.1500],
  [0.100, 0.1180, 0.1440],
  [0.080, 0.1160, 0.1360],
  [0.060, 0.1130, 0.1280],
  [0.040, 0.1100, 0.1200],
  [0.020, 0.1070, 0.1130],
  [0.0, 0.1040, 0.1080],  ];
  const k = KEY;
  if (y >= k[0][0]) return [k[0][1], k[0][2]];
  const last = k[k.length - 1];
  if (y <= last[0]) return [last[1], last[2]];
  for (let i = 0; i < k.length - 1; i++) {
    const [y0, f0, b0] = k[i];
    const [y1, f1, b1] = k[i + 1];
    if (y <= y0 && y >= y1) {
      const t = y0 === y1 ? 0 : (y0 - y) / (y0 - y1);
      const s = t * t * (3 - 2 * t); // smoothstep
      return [f0 + (f1 - f0) * s, b0 + (b1 - b0) * s];
    }
  }
  return [last[1], last[2]];
}

/**
 * 该高度的前后**深度比**（相对正视半宽）。
 * `sagittalProfile` 给的是绝对半深（H），但横截面生成需要的是
 * "该高度的 Z 半径 / X 半径"，所以这里除以正视半宽。
 */
function depthRatioAt(y: number): [number, number] {
  // 直接查两张表相除即可 —— 两张表都已换成一手实测：
  //   `TORSO_PROFILE`（正视逐行宽度）与 `sagittalProfile`（侧视 run 中心段）。
  //
  // 实测给出的 Z/X 比（盘腿段）：
  //   y0.196 → 前 0.326 / 半宽 0.376 = 0.867，后 0.111/0.376 = 0.295
  //   y0.120 → 前 0.320 / 0.376 = 0.851，后 0.132/0.376 = 0.351
  // 即盘腿是一个**前伸远大于后凸**的扁体块 —— 腿盘在身前。
  //
  // ⚠️ 钳位只做「防爆」，**绝不能压缩真实值**。
  // 曾经的下限 0.5 把盘腿后沿的真值 0.346 抬到 0.50，凭空吹鼓 45% ——
  // 当时加它是因为 `halfWidthAtY` 还被莲座污染、比值会算出极小值；
  // 现在两张表都干净了，钳位必须让开。下限放到 0.24，
  // 上限 2.4 兜住颈部等极扁截面。
  const hw = halfWidthAtY(y);
  if (hw <= 1e-6) return [1, 1];
  const [f, b] = sagittalProfile(y);
  const cf = Math.min(2.4, Math.max(0.24, f / hw));
  const cb = Math.min(2.4, Math.max(0.24, b / hw));
  return [cf, cb];
}

// ============================================================
// 半宽剖面 —— **逐像素实测**（不是解剖推断）
// ============================================================
//
// 数据来源：`_probe/ref3view/three-view.jpg` 的正视（左 1/3）经
// HSV 饱和度阈值（S > 18，背景近白故饱和度为 0）分割出主体连通域后，
// 逐行测左/右边缘。原始数据落在 `_probe/ref3view/profile.json`。
//
// 重要修正记录：早先本表按 spec.preSpecAssessment.anatomy.proportions
// 的 HU 口径填写（shoulderWidth 1.6 HU → 0.100 H 半宽），结果渲染出来
// 躯干像细管、盘腿像巨大钟形裙摆 —— 与参考图严重不符。逐像素实测后：
//
//   实测肩宽 0.364 H（半宽 0.182），anatomy 给 0.200 H —— 小 82%
//   实测颅宽 0.140 H（半宽 0.070），anatomy landmark 给 0.170 H
//   实测颈最细 0.100 H（半宽 0.050），解剖推断给 0.066 H
//
// 根因：anatomy.proportions 是目视判读的解剖估计，且躯干段未计入双臂；
// 下面的表是参考图本身的直接测量。两者冲突时以参考图为准 —— 本任务目标
// 是复刻参考图，不是复刻一份解剖教科书。
//
// 换算：实测 W 的分母是**含莲座总高**。人体占其中的 76.7%
// （t=0.767 处轮廓从盘腿 0.651 骤跳到莲座 0.734），故
//   W_H = W_measured / 0.729 ,  半宽_H = W_H / 2
//   y_H = 1 - t / 0.729   （0 = 盘腿底，1 = 颅顶）
// 反推含莲座总高 = 1/0.729 = 1.372 H，莲座高 = 0.372 H
// （规格写 0.26 H，实测 0.372 H —— 以实测为准）。
//
// 分界 t=0.729 的确定方式：在 t∈[0.70,0.98] 内找正视宽度剖面的局部极小
// （盘腿在底部收口，紧接着莲座外圈花瓣向外张开），唯一的显著极小在
// t=0.729（W=0.6236）。已用叠图 `_probe/ref3view/verify-figfrac.png` 目视确认
// 该线恰好落在盘腿底与莲座顶的接触处。
//
// ⚠️ **测量本身也曾走错三次，务必不要再犯**：
//   v1 硬切 1/3      → 侧视图一段被切进正视，正视右边界被截
//   v2 列低饱和谷    → 主体内部淡色区把谷底拉到人身上（x=1069/1809）
//   v3 顶部窄带段    → 只得到头顶的窄列（宽 160px），人像被横向截掉，
//                      half_W 从 t=0.24 起卡死在 0.078（= 那 160px 的一半）
//   v4 相邻中心中点  → 窗口过宽（0..997 / 997..1888），双膝串味
//   v5 列占用空隙    → 门槛 2% 太低，视图间仍有膝部零散像素
//   v6 定稿          → 头顶中心 + 固定半宽 420（间距 878，间隙 38px 足够）
//   → 窗口：front[125,965] side[1029,1869] back[1907,2747]
//
// 另一个血泪教训：**盘腿的最宽处曾被误算成 0.465 H 半宽**，那是把莲座
// 外圈花瓣算进了盘腿。正确口径下盘腿最宽 = 0.461 H 半宽（全宽 0.9218 H），
// 且它出现在 y_H≈0.15，而膝高（y_H≈0.23）只有 0.341 半宽。

/**
 * 头身半宽剖面（y → 左右半宽，单位 H）。按 y 递减。**逐像素实测**。
 *
 * 数据来自 `_probe/ref3view/dims.py` 输出的关键高度表（口径 H = 人体高）：
 *   颅最宽 y0.935 → 半宽 0.0714（全宽 0.1429）
 *   眉弓   y0.905 → 0.0760
 *   眼线   y0.885 → 0.0726
 *   颏     y0.835 → 0.0748
 * 注意实测中 y0.860「鼻底」给出 0.0873，**比眉弓还宽** —— 那不是鼻子，
 * 是颏颈交界的肩部起坡。所以头部有效区只到 y≈0.835，鼻子不进剖面表
 * （鼻梁/鼻尖由 `buildFaceGroup` 的独立几何表达）。
 */
const HEAD_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [1.0, 0.004],
  [0.995, 0.022],
  [0.985, 0.042],
  [0.975, 0.054],
  [0.965, 0.062],
  [0.955, 0.067],
  [0.945, 0.0702],
  [0.935, 0.0714], // 颅最宽（实测全宽 0.1429）
  [0.925, 0.0713],
  [0.915, 0.0745],
  [0.905, 0.076], // 眉弓（实测）
  [0.895, 0.0755],
  [0.885, 0.0726], // 眼线（实测）
  [0.875, 0.0735],
  [0.865, 0.0742],
  [0.855, 0.0746],
  [0.845, 0.0748],
  [0.835, 0.0748], // 颏（实测全宽 0.1497）
  [0.826, 0.072],
  [0.818, 0.068],
  [0.810, 0.064],
  [0.802, 0.060],
  [0.795, 0.0573], // 颈最细（实测全宽 0.1145）
];

/**
 * 躯干半宽剖面（y → 左右半宽，单位 H）。按 y 递减。**逐像素实测**。
 *
 * ## 口径（关键，此前搞错过）
 * 本表是**躯干本体**半宽，**不含双臂**。双臂是独立网格（`buildArmsGroup`），
 * 由 `front_torso_half_H`（多连通段时取中间段）测得。
 *
 * 若误用「外沿半宽」（含双臂）当躯干宽度，躯干旋转体就会把它自己两侧的
 * 手臂整个吞掉 —— 渲染出来正是一个**伞形/钟形**的巨块，手臂完全看不见。
 * 这正是此前多轮「像穿裙子」的根因，务必分清两套数：
 *
 *   外沿半宽（含双臂，仅作参考/校验用）：
 *     y0.655 → 0.172    y0.637 → 0.211    y0.600 → 0.229
 *     y0.555 → 0.235    y0.480 → 0.230    y0.419 → 0.239
 *   躯干本体半宽（**本表采用**）：
 *     y0.419 → 0.141    y0.392 → 0.135    y0.346 → 0.123    y0.301 → 0.116
 *
 * ## 关键实测高度（半宽/H）
 *   颈最细 y0.773 → 0.0539    肩峰 y0.740 → 0.0578（溜肩，非方肩）
 *   腋下   y0.700 → 0.0845    三角肌台阶 y0.655 → 0.1723
 *   外沿最宽 y0.560 → 0.2347  躯干/臂分离起点 y0.420（nseg 1→3）
 *   躯干本体 y0.420 → 0.1411  最后一个可信行 y0.306 → 0.1162
 *
 * ## ⚠️ 最重要的一条：y0.420 以上的「躯干本体」实测值是拿不到的
 * `human.json` 的 `front_torso_half_H` 在 **y ≥ 0.420 段恒等于 `front_outer_half_H`
 * （front_nseg = 1）** —— 参考图正视剪影里，上臂从腋下一直贴到 y0.420 都与躯干
 * **同属一个连通块**，逐行扫描在数学上无法把它们分开。y0.420 以上 nseg 变 3，
 * 是因为**手/腕已经离开躯干落到膝上**，此时中间那段才是躯干本体（0.1411）。
 *
 * 所以 y0.640 的 0.2103、y0.560 的 0.2347 是**躯干 + 两条上臂的外沿**，
 * 不是胸廓/腰的宽度。把它们当躯干宽度喂给「绕 y 轴的单旋转体」，躯干就会
 * 把它自己两侧的手臂整个包进去 —— 渲染出来正是一个**伞形/钟形**巨块，
 * 手臂完全不可见。这是此前多轮「像穿裙子」的根因。
 *
 * ## y0.420 以上躯干本体半宽的重建依据（解剖约束，非实测）
 * 取腋下（y0.700）作锚点：此时上臂刚从躯干分出、仍贴着，外沿半宽 0.0845，
 * 减去上臂半径 0.026 → 躯干本体 ≈ **0.058**。下锚点 y0.420 实测 0.1411。
 * 中间按胸廓（最宽在 y0.64 附近）→ 腰（略收）→ 髋（再放宽）的真实走向插值，
 * 并使**任意高度上 躯干半宽 + 上臂半径 < 外沿半宽**，保证手臂必然外露。
 */
const TORSO_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.795, 0.0573], // 颈最细（实测全宽 0.1145）
  [0.780, 0.0545],
  [0.773, 0.0539], // 实测最细处
  [0.764, 0.0539],
  [0.755, 0.0573],
  [0.746, 0.0578],
  [0.740, 0.0578], // 肩峰（实测全宽 0.1156）—— 溜肩，不是方肩
  [0.728, 0.0607],
  [0.710, 0.0700],
  [0.700, 0.0845], // 腋下（实测外沿全宽 0.1690）—— 此处臂刚从躯干分出
  // ---- y0.700 → y0.420：躯干本体，解剖推定（实测不可得，见上方说明）----
  [0.690, 0.0610],
  [0.680, 0.0672],
  [0.670, 0.0758],
  [0.660, 0.0862],
  [0.650, 0.0960], // 胸廓本体最宽（外沿此处 0.1876，臂占其余）
  [0.640, 0.1010],
  [0.628, 0.1032],
  [0.610, 0.1035],
  [0.592, 0.1022],
  [0.576, 0.0998], // 腰本体（外沿 0.2324，差值即双臂）
  [0.560, 0.0982],
  [0.544, 0.0988],
  [0.528, 0.1008],
  [0.512, 0.1042],
  [0.496, 0.1082],
  [0.480, 0.1128], // 髋本体
  [0.464, 0.1182],
  [0.448, 0.1244],
  [0.432, 0.1316],
  [0.420, 0.1411], // **回到实测**：躯干/臂分离点（nseg 1→3）
  // ---- y0.420 → y0.300：**单一口径的连续过渡**（与下方盘腿段同一测量定义）----
  //
  // 旧表这里用的是「躯干本体」半宽（到 y0.306 收到 0.1162），紧接下一行
  // 换成「躯干+大腿」的 0.277 —— 同一个 y 上两种口径不可比，于是渲染出
  // 一条刀切般的水平台沿（实测 y0.310→0.300 半宽跳 0.1178→0.2268）。
  //
  // 正解：从髋往下，体量本来就是**连续增宽**的（大腿自骨盆两侧展开），
  // 不存在「躯干忽然变宽」这回事。下表改为单一连续口径，
  // 从 y0.420 的 0.1411 平滑展开到盘腿起坡，不再有任何跳变。
  [0.410, 0.1389],
  [0.401, 0.1372],
  [0.392, 0.1355],
  [0.383, 0.1348],
  [0.374, 0.1352],
  [0.365, 0.1364],
  [0.356, 0.1382],
  [0.346, 0.1408],
  [0.337, 0.1440],
  [0.328, 0.1478],
  [0.319, 0.1522],
  [0.310, 0.1572],
  [0.300, 0.1560], // 口径统一后的 hip→lap 过渡
  // ⚠️ 盘腿纵向占比：参考图实测盘腿主体在 y<0.24，不是 0.30。
  // 下面这段把外扩**推后并加快** —— y0.30~0.24 只从 0.156 缓增到 0.205
  // （这是骨盆/大腿根，不是盘腿主体），y0.24 以下才真正长开。
  // 之前 y0.20 就给到 0.287，导致盘腿在视觉上高到腰际、躯干被压短。
  // ?? ??????? y0.30 = 0.119?y0.28 = 0.118?y0.19 = 0.138?
  // ???? 0.118~0.14 ?? ??**??????**??????????
  // ??????????????? 0.159?0.362 ????????????
  [0.290, 0.1180],
  [0.280, 0.1179],
  [0.270, 0.1185],
  [0.260, 0.1202],
  [0.250, 0.1224],
  [0.240, 0.1270],
  [0.230, 0.1293],
  [0.220, 0.1315],
  [0.210, 0.1338],
  [0.200, 0.1361],
  // ---- 盘腿段：**正视逐行宽度一手实测**（`_probe/ref3view/diag_final_width.py`）----
  // 人体底 = 头顶 230px + 882px = 1112px；此前把 1000px 当人体底，
  // 于是把 y_H<0 的**莲座行**读成了盘腿，得到「恒定 0.376」这个错误结论。
  //
  //   y0.15 → 0.442（最宽）   y0.13 → 0.440   y0.12 → 0.458
  //   y0.09 → 0.428           y0.07 → 0.378   y0.03 → 0.376
  //
  // 形态改为**三段式箱形坐垫**：起坡（0.19→0.15 急宽）→ 最宽平台
  // （y0.15~0.11，≈0.44）→ 向底面收到 0.376 的平底（不收成点）。
  // ⚠️ y_H < 0.13 的行有莲瓣抖扰（实测 0.62~0.92 间振荡），已按趋势取值。
  // ⚠️ 本轮修正（body-fix）：原表 y0.03~0.0 恒为 0.3760，是一个**平底平台**；
  // 配合「没有底面封口」，侧/正视图底缘都是一刀切。改为**持续收圆**：
  // y0.15 最宽 0.4447（与参考实测 0.442 吻合，保留），向下按圆弧收到 y=0
  // 的 0.3230 —— 约为最宽的 73%，使底缘成为圆润的碗底。
  // ???? 2026-10-16 ?????Lead ?????
  //
  // body-fix ??????????? y0.15 = 0.4447?? 0.4447 ??**????**?
  // ?**??????????**??????????????????????????
  //
  // ???**?? run ??**??? `_probe/ref3view/bodyonly.py`??
  // ???? y0.42 ???????? 3 ? ?? ?? / ?? / ???
  // ??????????????????
  //
  //   y0.42 ? 0.143     y0.30 ? 0.119     y0.19 ? 0.138????
  //   y0.15 ? 0.138     y0.10 ? 0.318     y0.08 ? 0.376?**??**?
  //
  // ??????????????**?????0.138????????0.376??**?
  // ?????????0.376 ?? = ???? LOTUS_RADIUS 0.4728 ????
  //
  // ???????? ?0.138~0.14?y0.10 ???**??**????
  // ????????????????????? lotus-base??
  //
  // ??????????????????? y0.26~0.14??? y0.30~0?
  [0.190, 0.1400], // ????????? 0.1383?
  [0.180, 0.1405],
  [0.170, 0.1408], // ?? ?0.141
  [0.160, 0.1400],
  [0.150, 0.1383], // ?? 0.1383
  [0.140, 0.1350],
  [0.130, 0.1300],
  [0.120, 0.1240],
  [0.110, 0.1160],
  // ---- y0.10 ?????**???????**????????? ----
  // ???? 0.075????????????????????
  // ???????????????????
  [0.100, 0.1060],
  [0.090, 0.0960],
  [0.080, 0.0880],
  [0.070, 0.0820],
  [0.060, 0.0770],
  [0.050, 0.0730],
  [0.040, 0.0700],
  [0.030, 0.0680],
  [0.020, 0.0660],
  [0.010, 0.0640],
  [0.0, 0.0600], // ??????????? 0.090????????
];

/** 在关键点表上做 Catmull–Rom 插值（张力 0.5）。表按 y 递减。 */
function interpProfile(
  table: ReadonlyArray<readonly [number, number]>,
  y: number,
): number {
  const n = table.length;
  if (y >= table[0][0]) return table[0][1];
  if (y <= table[n - 1][0]) return table[n - 1][1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid][0] >= y) lo = mid;
    else hi = mid;
  }
  const i = lo;
  const y0 = table[i][0];
  const y1 = table[i + 1][0];
  const t = y0 === y1 ? 0 : (y0 - y) / (y0 - y1);
  const p = (k: number): number =>
    table[Math.max(0, Math.min(n - 1, k))][1];
  const p0 = p(i - 1);
  const p1 = p(i);
  const p2 = p(i + 1);
  const p3 = p(i + 2);
  const t2 = t * t;
  const t3 = t2 * t;
  const v =
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  return Math.max(0, v);
}

/** 任意高度的左右半宽（H 单位）。头与躯干段自动拼接。 */
export function halfWidthAtY(y: number): number {
  if (y >= Y.chin) return interpProfile(HEAD_PROFILE, y);
  return interpProfile(TORSO_PROFILE, y);
}

// ============================================================
// 主体网格：方位角调制扫掠
// ============================================================

const RADIAL = 96;

/**
 * 构建人体主体（头 + 躯干 + 盘腿的一整块连续曲面）。
 *
 * 与旧实现的关键差别在于**截面不是椭圆**，而是：
 *   r(θ, y) = halfWidthAtY(y) · superellipse(θ, n(y)) · sagittal(y, θ)
 *
 * 其中 sagittal 只对 ±Z 方向起作用（前后非对称 S 形），
 * superellipse 的指数 n 随高度从 2.2（躯干椭圆）过渡到 2.9（盘腿近矩形），
 * 让盘腿的四个「角」自然落在左右两膝与前后腿肚上。
 */
export function buildFigureGeometry(o: { steps?: number } = {}): BufferGeometry {
  const steps = o.steps ?? 220;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // 从颅顶 y=1 向下到盘腿底 y=0
    const y = Y.crown - t * (Y.crown - LAP_MERGE_Y);
    const hw = halfWidthAtY(y);
    const [frontRatio, backRatio] = depthRatioAt(y);

    // 盘腿段用略高的超椭圆指数（保住膝盖处的轻微转折），躯干段用椭圆。
    // 过渡**只发生在盘腿下段**（y < 0.22）：上段（0.22~0.34）保持椭圆，
    // 这样盘腿顶面能圆润地接上躯干，不会在腰下方突然出现一圈方角。
    const LAP_SQUARE_TOP = 0.22;
    const kneeT = 1 - Math.min(1, Math.max(0, y / LAP_SQUARE_TOP));
    const n = N_TORSO + (N_LAP - N_TORSO) * kneeT * kneeT;

    for (let j = 0; j <= RADIAL; j++) {
      const theta = (j / RADIAL) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);

      // 基准：超椭圆半径系数 × 该高度的半宽
      const se = superellipse(theta, n);
      let rx = hw * se;
      let rz = hw * se;

      // 前后非对称：+Z（前，sin>0）与 -Z（后）各自缩放深度。
      // 比值来自侧视逐像素实测（sagittalProfile 的绝对半深 / 该高度正视半宽），
      // 这是侧视 S 形（胸廓前凸 / 腰椎前凹 / 臀后凸）的唯一表达途径。
      const zScale = sin >= 0 ? frontRatio : backRatio;
      rz *= zScale;

      positions.push(cos * rx, y, sin * rz);
    }
  }

  const stride = RADIAL + 1;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < RADIAL; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = (i + 1) * stride + j;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // ---- ??**????** ----
  //
  // ?? ???Lead????????? 7 ???????????????
  // LAP_MERGE_Y = 0.185 ?????**??????? y0.30 ??????**?
  // ??????????????????????????? y?0.19 ?????
  //
  // ?????????????????? ?0.140???????????
  // ???????????????????
  //
  // ??Geometry ??**???**????? LAP_MERGE_Y ???????
  // ???????????????????

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// ============================================================
// 莲花座：三层 22 片花瓣（外 9 / 中 8 / 内 5）
// ============================================================
//
// 规格 D20/D21/D22 与 repetitionSystems 锁定：
//   petalOuter 9 片，开张近 90°（扁平外翻下垂）
//   petalMid   8 片，开张约 45°
//   petalInner 5 片，紧贴花托直立含苞
//
// 每片花瓣是**一片带厚度的壳**，由 LatheGeometry 绕自身轴旋转一个
// 花瓣纵剖面而成。花瓣中央有一条纵向叶脉（D24），用一条细亮管表达。

/** 单层花瓣的参数 */
interface PetalLayer {
  id: string;
  count: number;
  /** 花瓣根部所在半径（H 单位） */
  rootRadius: number;
  /** 根部高程（H 单位，莲座顶端 y=0 起算） */
  rootY: number;
  /** 花瓣长度（H 单位） */
  length: number;
  /**
   * 开张角（弧度）。**语义：从竖直起算、向外倾倒的角度。**
   *   0    = 完全竖直向上（含苞，内层紧贴花托）
   *   π/4  = 斜向上外张约 45°
   *   π/2  = 完全平放、径向朝外（盛开摊平，外层）
   * 由 `rotateX(-tilt)` 实现：长轴在 +Y，绕 -X 把它倒向 +Z（径向外）。
   */
  tilt: number;
  /** 花瓣最大宽度（H 单位，沿切向） */
  width: number;
  /** 相位偏移（弧度），让层间花瓣错开 */
  phase: number;
  /** 相对亮度增益 */
  brightness: number;
}

const PETAL_LAYERS: readonly PetalLayer[] = [
  {
    id: 'petal-inner',
    count: 5,
    rootRadius: 0.045,
    rootY: -0.01,
    length: 0.115,
    tilt: 0.16, // 近乎直立、含苞
    width: 0.055,
    phase: 0,
    brightness: 1.12,
  },
  {
    id: 'petal-mid',
    count: 8,
    rootRadius: 0.085,
    rootY: -0.045,
    length: 0.135,
    tilt: 0.78, // 约 45°
    width: 0.062,
    phase: Math.PI / 8,
    brightness: 1.0,
  },
  {
    id: 'petal-outer',
    count: 9,
    rootRadius: 0.115,
    rootY: -0.085,
    length: 0.155,
    tilt: 1.42, // 约 81°，扁平外翻
    width: 0.07,
    phase: Math.PI / 9,
    brightness: 0.88,
  },
];

/**
 * 一片花瓣的几何。
 *
 * **局部坐标约定（关键，摆姿态时才不会错）**：
 *   - 长度方向 = **+Y**，从根部 y=0 长到 y=length（花瓣像树叶向上生长）
 *   - 宽度方向 = **X**（切向，决定花瓣的宽窄）
 *   - 厚度方向 = **Z**（径向厚薄；外拱 bow 也加在这里，是花瓣的"正面"）
 *
 * 为什么长轴必须在 +Y：摆姿态用的是 `rotateX`，它旋转的正是 Y-Z 平面。
 * 早期把长轴放在 +Z、厚度放在 Y，长轴与旋转平面耦合 —— 转任意角度都
 * 只是把花瓣立起或倒下，永远做不出"贴水平面径向外翻"的盛开形态，
 * 渲染成一簇细尖刺。现在长轴 +Y，`rotateX(-tilt)` 干净地把花瓣
 * 从竖直（含苞）倒向水平（盛开）。
 *
 * 花瓣纵剖面（沿长度方向）：
 *   - 横向半宽 w：根部窄、中部最宽、尖端收成尖
 *   - 厚度 thick：根部厚、尖端薄
 *   - 叶面外拱 bow：花瓣正面略带弧度（D24 叶脉那条亮线就落在拱顶）
 */
function buildPetalGeometry(layer: PetalLayer): BufferGeometry {
  const LEN_SEG = 18;
  const AROUND = 14; // 横向截面环的采样数

  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= LEN_SEG; i++) {
    const u = i / LEN_SEG; // 0 = 根部，1 = 尖端

    // 沿长度方向的位置（局部 +Z），叠加叶面外拱
    const bow = Math.sin(u * Math.PI) * layer.length * 0.09;
    const along = u * layer.length;

    // 横向半宽：根部窄、中部最宽、尖端收成尖
    const w = layer.width * Math.sin(Math.PI * Math.pow(u, 0.62));
    // 厚度：根部厚、尖端薄
    const thick = Math.max(1e-4, w * 0.16 * (1 - u * 0.55));

    for (let j = 0; j <= AROUND; j++) {
      const phi = (j / AROUND) * Math.PI * 2;
      // 截面是扁椭圆：宽在 X（切向），厚在 Z（径向厚薄）
      const px = Math.cos(phi) * w;
      const pz = Math.sin(phi) * thick;

      // 长轴在 +Y（花瓣像树叶一样沿 +Y 生长）。
      // 外拱 bow 加在 +Z —— 那是花瓣的"正面"方向（朝径向外），
      // 让叶面略带弧度，D24 那条叶脉亮线正好落在拱顶。
      positions.push(px, along, pz + bow);
    }
  }

  const stride = AROUND + 1;
  for (let i = 0; i < LEN_SEG; i++) {
    for (let j = 0; j < AROUND; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = (i + 1) * stride + j;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/**
 * 构建整座莲花座。
 *
 * 参考图的莲座是**碗形**：花瓣从中下部向上、向外翻卷，中央是饱满的
 * 水滴形花托（约莲座直径 0.38），花托正下方有极亮光心。
 *
 * 每个花瓣网格的变换顺序：
 *   1. `rotateX(-tilt)` —— 俯仰。长轴在局部 **+Y**，绕 -X 旋转把它倒向 +Z。
 *      `tilt` 语义：0 = 花瓣竖直向上（含苞），π/2 = 平放、径向朝外（盛开）。
 *      内层 tilt=0.16 近直立贴着花托，外层 tilt=1.42 摊平外翻。
 *   2. `rotateY(theta)` —— 转到该花瓣的方位角。
 *   3. 平移到根部半径上。tilt 越大（越外翻），根部越靠下、越向外，
 *      三层才能像真花瓣一样层层叠压而不是同心悬浮。
 */
export function buildLotusGroup(o: { material: Material }): Group {
  const group = new Group();
  group.name = 'lotus-base';

  // ---- 花托（中央圆顶，D19）----
  // 实测：直径约莲座直径 0.38 → 半径 0.4728*0.19 ≈ 0.090
  const calyxProfile: Vector2[] = [];
  const CALYX_SEG = 24;
  for (let i = 0; i <= CALYX_SEG; i++) {
    const t = i / CALYX_SEG;
    // 水滴形圆顶：根部饱满、向上收圆
    const r = 0.090 * Math.sin(Math.PI * Math.pow(t, 0.72));
    const y = -0.115 + t * 0.185;
    calyxProfile.push(new Vector2(Math.max(0.0005, r), y));
  }
  const calyx = new Mesh(new LatheGeometry(calyxProfile, 48), o.material);
  calyx.name = 'lotus-calyx';
  group.add(calyx);

  // ---- 三层花瓣 ----
  for (const layer of PETAL_LAYERS) {
    const geo = buildPetalGeometry(layer);
    for (let k = 0; k < layer.count; k++) {
      const theta = layer.phase + (k / layer.count) * Math.PI * 2;
      const m = new Mesh(geo, o.material);
      m.name = `${layer.id}-${String(k).padStart(2, '0')}`;

      // 1) 先俯仰：长轴在 +Y，绕 -X 旋转把它倒向 +Z（径向外）。
      //    tilt 语义：0 = 竖直含苞，π/2 = 水平外翻（见 PetalLayer.tilt）。
      //    右手系绕 +X 正角把 +Y 转向 +Z？—— 不，+X 正角把 +Y 转向 **+Z 的反面**，
      //    实测应为 **-tilt**：内层 0.16 几乎直立，外层 1.42 摊平外翻。
      m.rotateX(-layer.tilt);
      // 2) 再绕 Y 转到方位角
      m.rotateY(theta);

      // 3) 平移到根部半径。tilt 越大（越外翻），根部越向外、越靠下，
      //    这样三层才能像真花瓣一样层层叠压而不是同心悬浮。
      const outward = layer.rootRadius;
      const dx = Math.sin(theta) * outward;
      const dz = Math.cos(theta) * outward;
      m.position.set(dx, layer.rootY, dz);
      group.add(m);
    }
  }

  // ---- 花心亮团（D23：正下方极亮光心，半径约莲座半径的 0.2 倍）----
  const core = new Mesh(new SphereGeometry(0.02, 24, 16), o.material);
  core.name = 'lotus-core';
  core.position.set(0, -0.115, 0);
  group.add(core);

  return group;
}

// ============================================================
// 骨架：肋骨 12 对（三段式）+ 脊椎 24 节 + 骨盆
// ============================================================
//
// 规格 D09/D10/D11/D12 与 repetitionSystems 锁定：
//   ribArcs 12 对，三段式递变（上段短而陡 → 中段长而平 → 下段下垂成 V）
//   肋间有暗色缝隙 → 必须是**几何分件**，不得用贴图伪造
//   spineSegments 24 节，节段串珠，节间有深色缝隙
//
// 每根肋骨是一条 curve-sweep 管，从脊椎侧出发绕过体侧到胸骨。

/**
 * 单根肋骨在给定高度的参数化曲线。
 *
 * @param y       该肋骨所在高度（H 单位）
 * @param pairIdx 0..11（0 = 第 1 对，最上）
 * @param side    +1 = 人体左侧（+X），-1 = 右侧
 */
function ribCurve(y: number, pairIdx: number, side: 1 | -1): CatmullRomCurve3 {
  // 三段式：上段（0..3）短而陡，中段（4..8）长而平，下段（9..11）下垂成 V
  const seg = pairIdx < 4 ? 0 : pairIdx < 9 ? 1 : 2;
  // 前半周占比：中段绕得最远（几乎到胸骨正中）
  const around = seg === 0 ? 0.72 : seg === 1 ? 0.94 : 0.8;
  // 下垂量：下段明显向下掉
  const droop = seg === 2 ? 0.018 + (pairIdx - 9) * 0.011 : 0.0;

  const hw = halfWidthAtY(y);
  const [, backRatio] = depthRatioAt(y);
  const halfD = hw * backRatio * 0.86;

  const pts: Vector3[] = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    // 从背后脊椎（-Z 侧）出发，绕体侧，到胸骨前（+Z 侧）
    const ang = Math.PI + u * Math.PI * around;
    const rx = hw * 0.92;
    const rzx = halfD * 0.98;
    // 绕行时肋骨略向外撑（胸腔比体表略小，故乘 0.92 收在里面）
    const x = Math.sin(ang) * rx * side;
    const z = Math.cos(ang) * rzx;
    // 下垂：靠近体侧最低，两端回到该高度
    const dy = -droop * Math.sin(u * Math.PI);
    pts.push(new Vector3(x, y + dy, z));
  }
  return new CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
}

/** 12 对肋骨的纵向分布（H 单位，从胸廓顶到底） */
const RIB_HEIGHTS: readonly number[] = [
  0.756, 0.742, 0.727, 0.711, 0.694, 0.676, 0.657, 0.637, 0.616, 0.594, 0.571,
  0.547,
];

/** 肋骨管半径（越往下越细） */
function ribRadius(pairIdx: number): number {
  return 0.0052 - pairIdx * 0.00012;
}

/**
 * 构建骨架组。
 *
 * @param o.ribMaterial   肋骨/胸骨/骨盆材质
 * @param o.spineMaterial 脊椎材质（规格里与肋骨同为 skeleton，但可分层调亮）
 */
export function buildSkeletonGroup(o: {
  ribMaterial: Material;
  spineMaterial: Material;
}): Group {
  const group = new Group();
  group.name = 'figure-skeleton';

  // ---- 肋骨 12 对（左右各 12 = 24 根管）----
  for (let p = 0; p < RIB_HEIGHTS.length; p++) {
    const y = RIB_HEIGHTS[p];
    const r = ribRadius(p);
    for (const side of [1, -1] as const) {
      const curve = ribCurve(y, p, side);
      // 分段数越往下越小（下段短）
      const seg = 26;
      const tube = new TubeGeometry(curve, seg, r, 6, false);
      const m = new Mesh(tube, o.ribMaterial);
      m.name = `rib-${String(p).padStart(2, '0')}-${side > 0 ? 'l' : 'r'}`;
      group.add(m);
    }
  }

  // ---- 胸骨（正中一条亮带，D13）----
  const sternumPts: Vector3[] = [];
  const STERN_SEG = 12;
  for (let i = 0; i <= STERN_SEG; i++) {
    const u = i / STERN_SEG;
    const y = Y.sternumTop - u * (Y.sternumTop - Y.sternumBottom);
    const hw = halfWidthAtY(y);
    const [frontRatio] = depthRatioAt(y);
    // 胸骨贴在胸腔最前面，略微内收
    const z = hw * frontRatio * 0.74;
    sternumPts.push(new Vector3(0, y, z));
  }
  const sternum = new Mesh(
    new TubeGeometry(
      new CatmullRomCurve3(sternumPts, false, 'catmullrom', 0.5),
      30,
      0.009,
      6,
      false,
    ),
    o.ribMaterial,
  );
  sternum.name = 'sternum';
  group.add(sternum);

  // ---- 脊椎 24 节（颈椎 7 + 胸椎 12 + 腰椎 5），节段串珠 ----
  const SPINE_COUNT = 24;
  const spineCentres: Vector3[] = [];
  for (let i = 0; i < SPINE_COUNT; i++) {
    const u = i / (SPINE_COUNT - 1);
    // 颈椎 y 0.825 → 骶骨 y 0.455
    const y = 0.825 - u * 0.37;
    const hw = halfWidthAtY(y);
    const [, backRatio] = depthRatioAt(y);
    // 脊椎在体后侧，腰椎前凸、胸椎后凸 —— 这就是侧视 S 形的内因
    const z = -hw * backRatio * 0.6;
    spineCentres.push(new Vector3(0, y, z));
  }
  for (let i = 0; i < SPINE_COUNT; i++) {
    const c = spineCentres[i];
    // 颈段最细，腰段最粗
    const u = i / (SPINE_COUNT - 1);
    const r = 0.0085 + u * 0.0045;
    const seg = new Mesh(new SphereGeometry(r, 10, 8), o.spineMaterial);
    seg.name = `spine-seg-${String(i).padStart(2, '0')}`;
    seg.position.copy(c);
    // 略微压扁成椎体形状
    seg.scale.set(1, 0.78, 0.9);
    group.add(seg);
  }

  // ---- 骶骨 / 骨盆髂骨弧（D14）----
  for (const side of [1, -1] as const) {
    const iliacPts: Vector3[] = [];
    const ILIAC_SEG = 10;
    for (let i = 0; i <= ILIAC_SEG; i++) {
      const t = i / ILIAC_SEG;
      // 从骶骨中心向外上方扫出髂骨翼
      const x = side * t * 0.075;
      const y = 0.475 + Math.sin(t * Math.PI * 0.9) * 0.042;
      const z = -0.03 + t * 0.075;
      iliacPts.push(new Vector3(x, y, z));
    }
    const iliac = new Mesh(
      new TubeGeometry(
        new CatmullRomCurve3(iliacPts, false, 'catmullrom', 0.5),
        20,
        0.008,
        6,
        false,
      ),
      o.ribMaterial,
    );
    iliac.name = `ilium-${side > 0 ? 'l' : 'r'}`;
    group.add(iliac);
  }

  return group;
}

// ============================================================
// 关节亮点（10 处：双肩 / 双肘 / 双腕 / 双膝 / 双踝）
// ============================================================

export function buildJointGlowGroup(o: { material: Material }): Group {
  const group = new Group();
  group.name = 'figure-jointGlow';
  // 位置取自 spec.componentTree 的 transform.position
  const JOINTS: ReadonlyArray<readonly [string, number, number, number, number]> =
    [
      ['shoulder-l', 0.078, 0.762, 0, 0.016],
      ['shoulder-r', -0.078, 0.762, 0, 0.016],
      ['elbow-l', 0.098, 0.66, 0, 0.013],
      ['elbow-r', -0.098, 0.66, 0, 0.013],
      ['wrist-l', 0.075, 0.5, 0.055, 0.011],
      ['wrist-r', -0.075, 0.5, 0.055, 0.011],
      ['knee-l', 0.213, 0.19, 0.02, 0.019],
      ['knee-r', -0.213, 0.19, 0.02, 0.019],
      ['ankle-l', 0.13, 0.06, 0.06, 0.012],
      ['ankle-r', -0.13, 0.06, 0.06, 0.012],
    ];
  for (const [name, x, y, z, r] of JOINTS) {
    const m = new Mesh(new SphereGeometry(r, 14, 10), o.material);
    m.name = `joint-${name}`;
    m.position.set(x, y, z);
    group.add(m);
  }
  return group;
}

// ============================================================
// 丹田亮团 + 眉间亮斑（D23 / D29 —— 第 12 项身份特征）
// ============================================================

/** 丹田：腹前被双手托住的亮团 */
export function buildDantianGlow(o: { material: Material }): Mesh {
  const hw = halfWidthAtY(Y.dantian);
  const [frontRatio] = depthRatioAt(Y.dantian);
  const m = new Mesh(new SphereGeometry(0.032, 20, 14), o.material);
  m.name = 'figure-dantian';
  m.position.set(0, Y.dantian, hw * frontRatio * 0.86);
  m.scale.set(1, 0.86, 0.6);
  return m;
}

/**
 * 眉间亮斑（D29）：半径约 0.35 颅宽，亮度高于周围颜面。
 * 颅宽 0.17 H → 半径 0.35 × 0.17/2 ≈ 0.030 H。
 */
export function buildBrowPoint(o: { material: Material }): Mesh {
  const m = new Mesh(new SphereGeometry(0.015, 16, 12), o.material);
  m.name = 'figure-browPoint';
  m.position.set(0, Y.browPoint, 0.062);
  m.scale.set(1, 0.72, 0.6);
  return m;
}

// ============================================================
// 颜面（D02：颜面不是留白 —— 眉弓/眼窝/鼻梁/鼻尖/颧弓/下颌/颏）
// ============================================================
//
// 关键：**塑闭合眼睑的几何体量，但不画瞳孔/虹膜/睫毛**。
// 参考图 zone-r0c1 显示眉弓、眼窝、鼻梁、鼻尖、颧弓、下颌、颏全部存在，
// 且有闭合的眼睑弧线。

export function buildFaceGroup(o: { material: Material }): Group {
  const group = new Group();
  group.name = 'figure-face';

  // ---- 鼻：由鼻梁到鼻尖的一条逐渐变粗的脊 ----
  const nosePts: Vector3[] = [
    new Vector3(0, 0.878, 0.055),
    new Vector3(0, 0.862, 0.068),
    new Vector3(0, 0.85, 0.074),
    new Vector3(0, 0.842, 0.072),
  ];
  const nose = new Mesh(
    new TubeGeometry(
      new CatmullRomCurve3(nosePts, false, 'catmullrom', 0.5),
      12,
      0.011,
      8,
      false,
    ),
    o.material,
  );
  nose.name = 'nose';
  group.add(nose);

  // ---- 眉弓：左右各一条横向隆起 ----
  for (const side of [1, -1] as const) {
    const browPts: Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = side * (0.008 + t * 0.038);
      const y = 0.9 - t * 0.004;
      const z = 0.052 - t * t * 0.03;
      browPts.push(new Vector3(x, y, z));
    }
    const brow = new Mesh(
      new TubeGeometry(
        new CatmullRomCurve3(browPts, false, 'catmullrom', 0.5),
        10,
        0.0075,
        6,
        false,
      ),
      o.material,
    );
    brow.name = `brow-${side > 0 ? 'l' : 'r'}`;
    group.add(brow);

    // ---- 闭合眼睑：一条横向弧线（**闭合**，故只是一条缝，无瞳孔）----
    const lidPts: Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = side * (0.012 + t * 0.03);
      const y = 0.878 - Math.sin(t * Math.PI) * 0.008;
      const z = 0.055 - t * t * 0.022;
      lidPts.push(new Vector3(x, y, z));
    }
    const lid = new Mesh(
      new TubeGeometry(
        new CatmullRomCurve3(lidPts, false, 'catmullrom', 0.5),
        12,
        0.005,
        6,
        false,
      ),
      o.material,
    );
    lid.name = `eyelid-${side > 0 ? 'l' : 'r'}`;
    group.add(lid);

    // ---- 颧弓 ----
    const zygoPts: Vector3[] = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      zygoPts.push(
        new Vector3(
          side * (0.03 + t * 0.05),
          0.858 - t * 0.004,
          0.048 - t * t * 0.036,
        ),
      );
    }
    const zygo = new Mesh(
      new TubeGeometry(
        new CatmullRomCurve3(zygoPts, false, 'catmullrom', 0.5),
        10,
        0.006,
        6,
        false,
      ),
      o.material,
    );
    zygo.name = `zygomatic-${side > 0 ? 'l' : 'r'}`;
    group.add(zygo);

    // ---- 下颌线 ----
    const jawPts: Vector3[] = [];
    for (let i = 0; i <= 7; i++) {
      const t = i / 7;
      jawPts.push(
        new Vector3(
          side * (0.005 + t * 0.052),
          0.834 - t * t * 0.012,
          0.05 - t * t * 0.042,
        ),
      );
    }
    const jaw = new Mesh(
      new TubeGeometry(
        new CatmullRomCurve3(jawPts, false, 'catmullrom', 0.5),
        12,
        0.0065,
        6,
        false,
      ),
      o.material,
    );
    jaw.name = `jaw-${side > 0 ? 'l' : 'r'}`;
    group.add(jaw);

    // ---- 耳（简化为贴体的扁椭球）----
    const ear = new Mesh(new SphereGeometry(0.018, 12, 10), o.material);
    ear.name = `ear-${side > 0 ? 'l' : 'r'}`;
    ear.position.set(side * 0.082, 0.868, -0.004);
    ear.scale.set(0.42, 1.18, 0.86);
    group.add(ear);
  }

  // ---- 颏（下巴尖）----
  const chin = new Mesh(new SphereGeometry(0.019, 14, 10), o.material);
  chin.name = 'chin';
  chin.position.set(0, 0.828, 0.046);
  chin.scale.set(1.15, 0.72, 0.9);
  group.add(chin);

  return group;
}

// ============================================================
// 手臂 + 禅定印手（D17：双手腹前交叠、掌心向上、拇指相触、十指分离）
// ============================================================

/**
 * 构建双臂与结印的双手。
 *
 * 规格 D17 明确：**禅定印** = 双手腹前交叠、掌心向上、拇指相触、
 * 十指可见分离（不是莲花印的拇指食指尖相触成环）。
 */

/**
 * ??????? + ???? + ???????
 *
 * ?????? y0.42 ?????? 3 ????/??/?????????????
 * **??????**???????????????????????
 *   ? ??????????????????? 40??
 *   ? ????????
 *   ? ?????????? y?0.10 ?**????**
 *   ? ???????????????????????
 *
 * ??? CatmullRomCurve3 + ??????????????? `applyVaryingRadius`??
 * ??????????? 0.062 ? ? 0.048 ? ?? 0.040 ? ? 0.026?
 */
export function buildCrossedLegs(o: { material: Material }): Group {
  const group = new Group();
  group.name = 'figure-legs';

  const CROSS_Y = 0.095;  // ??????
  const CROSS_Z = 0.075;  // ???????

  for (const side of [1, -1] as const) {
    // ---- ????? ? ??????? 40??----
    const thighPts: Vector3[] = [
      new Vector3(side * 0.072, 0.300, -0.010), // ????????? 0.1128 ???
      new Vector3(side * 0.100, 0.256, -0.004), // ????
      new Vector3(side * 0.124, 0.208, 0.006),  // ????
      new Vector3(side * 0.138, 0.172, 0.018),  // ????
      new Vector3(side * 0.140, 0.150, 0.026),  // ????????? 0.140?
    ];
    const thighR = [0.064, 0.062, 0.058, 0.052, 0.046];
    const thigh = tubeFrom(thighPts, thighR, 0.056, 12, 48);
    thigh.material = o.material;
    thigh.name = `thigh-${side > 0 ? 'l' : 'r'}`;
    group.add(thigh);

    // ---- ???? ? ?? ? ????? ----
    const shinPts: Vector3[] = [
      new Vector3(side * 0.140, 0.150, 0.026),  // ?
      new Vector3(side * 0.118, 0.126, 0.052),  // ???????????
      new Vector3(side * 0.070, 0.104, 0.072),  // ????
      new Vector3(side * 0.018, CROSS_Y, CROSS_Z), // ????????
      new Vector3(-side * 0.048, 0.086, 0.074), // ??????????
    ];
    const shinR = [0.046, 0.042, 0.038, 0.032, 0.028];
    const shin = tubeFrom(shinPts, shinR, 0.038, 12, 48);
    shin.material = o.material;
    shin.name = `shin-${side > 0 ? 'l' : 'r'}`;
    group.add(shin);

    // ---- ?????????????? ----
    const footPts: Vector3[] = [
      new Vector3(-side * 0.048, 0.086, 0.074),  // ?
      new Vector3(-side * 0.082, 0.092, 0.062),  // ???
      new Vector3(-side * 0.112, 0.098, 0.048),  // ????
      new Vector3(-side * 0.130, 0.100, 0.032),  // ???
      new Vector3(-side * 0.138, 0.098, 0.018),  // ????????
    ];
    const footR = [0.028, 0.030, 0.026, 0.021, 0.015];
    const foot = tubeFrom(footPts, footR, 0.024, 12, 40);
    foot.material = o.material;
    foot.name = `foot-${side > 0 ? 'l' : 'r'}`;
    group.add(foot);
  }

  return group;
}

/** ???? + ?????????????? TubeGeometry + applyVaryingRadius ???? */
function tubeFrom(
  pts: Vector3[],
  radii: number[],
  baseRadius: number,
  radial: number,
  tubular: number,
): Mesh {
  const curve = new CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const geo = new TubeGeometry(curve, tubular, baseRadius, radial, false);
  applyVaryingRadius(geo, radii, baseRadius, radial, tubular);
  return new Mesh(geo, undefined as unknown as Material);
}

export function buildArmsGroup(o: {
  shellMaterial: Material;
  jointMaterial: Material;
}): Group {
  const group = new Group();
  group.name = 'figure-arms';

  for (const side of [1, -1] as const) {
    // ---- 三角肌 → 肱二头/三头 → 肘 → 前臂内收 ----
    //
    // ⚠️ 本轮修正（body-fix）：原控制点 |x| 最大只有 0.104，而同高度的
    // `TORSO_PROFILE` 半宽正好也是 0.098~0.104 —— 手臂**整个埋在躯干壳里**，
    // 所以侧视与正视都看不见手臂，只剩躯干侧面一道细缝。
    //
    // 参考图正视逐行实测的**外沿**半宽（含臂，口径同 diag_final_width.py）：
    //   y0.70 → 0.089（肩/三角肌，此时臂与躯干同块）
    //   y0.66 → 0.170   y0.64 → 0.204   y0.63 → 0.210
    //   y0.60 → 0.223   y0.58 → 0.227   y0.55 → 0.231
    //   y0.50 → 0.227   y0.46 → 0.231   y0.43 → 0.236
    // 即：三角肌在 y0.70 起从躯干外缘分出，**肘部在 y0.62~0.55 明显外凸**，
    // 前臂斜向前下、内收，手落到腹前 y≈0.44 结禅定印。
    // 下面按「外沿 = 中心 + 半径」反算中心，保证每层都比躯干壳外露 ≥0.03。
    // ?? ???????? y0.470?????????????? y?0.41?
    // ??????????**??? 0.07H**??????????????
    // ???????? y0.418 ????????????????
    const armPts: Vector3[] = [
      new Vector3(side * 0.088, 0.760, 0.004), // ??????????
      new Vector3(side * 0.122, 0.716, 0.016), // ?????
      new Vector3(side * 0.154, 0.664, 0.030), // ??
      new Vector3(side * 0.172, 0.612, 0.046), // ???????
      new Vector3(side * 0.166, 0.556, 0.074), // ????
      new Vector3(side * 0.138, 0.504, 0.104), // ????
      new Vector3(side * 0.102, 0.456, 0.128), // ????
      new Vector3(side * 0.068, 0.418, 0.140), // ??????????
    ];
    const radii = [0.031, 0.031, 0.029, 0.026, 0.023, 0.020, 0.017, 0.015];
    const curve = new CatmullRomCurve3(armPts, false, 'catmullrom', 0.5);
    const RADIAL_ARM = 12;
    const TUBULAR_ARM = 64;
    const tube = new TubeGeometry(curve, TUBULAR_ARM, 0.024, RADIAL_ARM, false);
    // TubeGeometry 只支持恒定半径，这里手工按弧长套上逐点半径
    applyVaryingRadius(tube, radii, 0.024, RADIAL_ARM, TUBULAR_ARM);
    const arm = new Mesh(tube, o.shellMaterial);
    arm.name = `arm-${side > 0 ? 'l' : 'r'}`;
    group.add(arm);

    // ---- 手：掌心向上的扁掌 + 四指并拢 + 拇指 ----
    const hand = buildHand(side, o.shellMaterial);
    group.add(hand);
  }

  return group;
}

/**
 * 给恒定半径的 TubeGeometry 按弧长套上「逐点半径」。
 *
 * TubeGeometry 的顶点按 `(tubular+1) × (radial+1)` 排列，第 i 圈顶点对应
 * 曲线参数 u = i / tubular。这里对每圈算一个半径 r(u)，再沿该顶点的
 * **法线方向**外推 `(r - baseRadius)` —— 法线在管壁上是径向的，所以
 * 外推即把该圈整体缩放，且保持中心线不动。
 */
function applyVaryingRadius(
  geo: BufferGeometry,
  radii: number[],
  baseRadius: number,
  radial: number,
  tubular: number,
): void {
  const pos = geo.getAttribute('position') as BufferAttribute;
  const norm = geo.getAttribute('normal') as BufferAttribute;
  const arr = pos.array as Float32Array;
  const narr = norm.array as Float32Array;

  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular;
    const f = u * (radii.length - 1);
    const i0 = Math.min(radii.length - 1, Math.floor(f));
    const i1 = Math.min(radii.length - 1, i0 + 1);
    const tt = f - i0;
    const r = radii[i0] * (1 - tt) + radii[i1] * tt;
    const push = r - baseRadius;

    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      if (idx * 3 + 2 >= arr.length) break;
      arr[idx * 3] += narr[idx * 3] * push;
      arr[idx * 3 + 1] += narr[idx * 3 + 1] * push;
      arr[idx * 3 + 2] += narr[idx * 3 + 2] * push;
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * 单手（禅定印姿态）：掌心向上的扁掌 + 四指并拢伸出 + 拇指。
 *
 * 局部坐标：掌心朝上（+Y），手指指向另一侧手（±X）。
 */
function buildHand(side: 1 | -1, material: Material): Group {
  const g = new Group();
  g.name = `hand-${side > 0 ? 'l' : 'r'}`;
  // 规格 transform.position：hand-l [0.035, 0.4, 0.115]
  // 与上面 arm 曲线末端（腕 x0.082 y0.470 z0.118）衔接，手再向内前收一点
  g.position.set(side * 0.052, 0.436, 0.130);

  // ---- 掌：扁椭球，掌心向上 ----
  const palm = new Mesh(new SphereGeometry(0.026, 18, 12), material);
  palm.name = 'palm';
  palm.scale.set(1.15, 0.42, 1.0);
  g.add(palm);

  // ---- 四指并拢：沿 -side 方向伸出，微微下垂 ----
  const FINGER = 4;
  for (let f = 0; f < FINGER; f++) {
    const spread = (f - (FINGER - 1) / 2) * 0.0115;
    const len = 0.036 - Math.abs(f - 1.2) * 0.0035;
    const pts: Vector3[] = [
      new Vector3(-side * 0.018, 0.002, spread),
      new Vector3(-side * (0.018 + len * 0.5), 0.001, spread * 1.15),
      new Vector3(-side * (0.018 + len), -0.004, spread * 1.28),
    ];
    const finger = new Mesh(
      new TubeGeometry(
        new CatmullRomCurve3(pts, false, 'catmullrom', 0.5),
        10,
        0.0058,
        7,
        false,
      ),
      material,
    );
    finger.name = `finger-${f}`;
    g.add(finger);
  }

  // ---- 拇指：与对侧拇指相触（禅定印特征）----
  const thumbPts: Vector3[] = [
    new Vector3(-side * 0.005, 0.001, 0.022),
    new Vector3(side * 0.008, 0.014, 0.012),
    new Vector3(side * 0.016, 0.026, 0.002),
  ];
  const thumb = new Mesh(
    new TubeGeometry(
      new CatmullRomCurve3(thumbPts, false, 'catmullrom', 0.5),
      12,
      0.0072,
      8,
      false,
    ),
    material,
  );
  thumb.name = 'thumb';
  g.add(thumb);

  return g;
}

// ============================================================
// 组装：完整模型
// ============================================================

export interface FigureMaterials {
  shell: Material;
  skeleton: Material;
  spine: Material;
  joints: Material;
  dantian: Material;
  browPoint: Material;
  lotus: Material;
  meridian: Material;
}

/**
 * 组装完整模型：人体主体 + 颜面 + 双臂 + 骨架 + 关节 + 莲座。
 *
 * 返回的 Group 以**人体总高的中点**为原点 —— 与 spec.coordinateFrame
 * 的 origin 定义一致（人体 y ∈ [-0.5, 0.5]），所以内部所有以 H 口径
 * （人体 y ∈ [0, 1]）写的坐标都要整体平移 -0.5。
 */
export function buildSeatedLotusFigure(mat: FigureMaterials): Group {
  const root = new Group();
  root.name = 'seated-lotus-figure';

  // —— 人体（H 口径 y∈[0,1]）——
  const body = new Group();
  body.name = 'figure';
  body.position.y = -0.5; // H 口径 → 以中点为原点

  const shell = new Mesh(buildFigureGeometry(), mat.shell);
  shell.name = 'figure-body';
  body.add(shell);

  // ---- ???**??????? + ?? + ????** ----
  // ???????????????????????????????
  // ?????????**????**?????????????? 40? ???
  // ???????????????????
  // ???????????????????????? halfWidthAtY ????
  body.add(buildCrossedLegs({ material: mat.shell }));

  body.add(buildFaceGroup({ material: mat.shell }));
  body.add(buildArmsGroup({ shellMaterial: mat.shell, jointMaterial: mat.joints }));
  body.add(buildSkeletonGroup({ ribMaterial: mat.skeleton, spineMaterial: mat.spine }));
  body.add(buildJointGlowGroup({ material: mat.joints }));
  body.add(buildDantianGlow({ material: mat.dantian }));
  body.add(buildBrowPoint({ material: mat.browPoint }));

  root.add(body);

  // —— 莲座（H 口径 y∈[-0.26, 0]）——
  const lotus = buildLotusGroup({ material: mat.lotus });
  lotus.position.y = -0.5;
  root.add(lotus);

  return root;
}

/** 便利：把材质色温调成一个统一的暖金（供未指定材质时兜底） */
export function warmGold(hex: string): Color {
  return new Color(hex);
}

/** 让 Object3D 便于遍历（导出以便测试脚本使用） */
export function forEachMesh(root: Object3D, fn: (m: Mesh) => void): void {
  root.traverse((o) => {
    if ((o as Mesh).isMesh) fn(o as Mesh);
  });
}

/** 未使用符号占位，避免 tree-shaking 掉类型引用 */
export const _unused = { CylinderGeometry, Euler, Vector2 };
