/**
 * 3D 骨架定义（脊柱 / 肋骨 / 锁骨 / 四肢骨）。
 *
 * 参考片的人形是**半透明 X 光**：解剖结构从体表内部透出来，不是画在表面。
 * 因此骨架必须是**真三维曲线**（有 z 深度），才能在轨道旋转时表现出
 * 「转动时脊柱在体量内部移动」的透视感 —— 这正是旧 2D 方案做不到的。
 *
 * 坐标系与 bodyGeometry 一致：y 轴向上，原点在人体中心
 * （HEAD_TOP=0.98 与 LAP_BOTTOM=-0.46 的中点 = 0.26），
 * 所以传入的 y 都是**单位坐标**，由调用方减去 CENTRE_Y 再乘 scale。
 */

import { CatmullRomCurve3, Group, Mesh, TubeGeometry, Vector3 } from 'three';

/** 人体中心高度（单位坐标），与 bodyProfile 的 (HEAD_TOP + LAP_BOTTOM) / 2 一致 */
const CENTRE_Y = (0.98 + -0.46) / 2;

/** 骨骼定义：一条折线 + 管半径 */
export interface BoneDef {
  /** 骨骼名称（调试用） */
  name: string;
  /** 路径关键点，单位坐标 [x, y, z]；y 为人体坐标（未减去中心偏移） */
  points: Array<[number, number, number]>;
  /** 管半径（单位坐标） */
  radius: number;
}

/**
 * 生成完整骨架。
 *
 * 解剖参照（人体朝 +z 方向看，即相机在 +z 时看到正面）：
 *   · z>0 为腹侧（前），z<0 为背侧（后）
 *   · 脊柱在背侧，向后凸出一点（脊柱后凸），因此脊柱 z 取 -0.02 ~ -0.05
 *   · 胸骨在腹侧 z≈+0.09
 *   · 肋骨从脊柱向后外下环抱到胸骨
 */
export function bodySkeleton(): BoneDef[] {
  const bones: BoneDef[] = [];

  // ============ 一、脊柱：14 节椎骨沿一条后凸的曲线 ============
  // 颈椎 7 节（0.688 → 0.560）+ 胸椎 5 节（0.560 → 0.200）+ 腰椎 2 节（0.200 → 0.060）
  const spine: Array<[number, number, number]> = [];
  const SPINE_N = 14;
  for (let i = 0; i < SPINE_N; i++) {
    const t = i / (SPINE_N - 1);
    // 高度：颈根 0.688 → 骶骨 -0.030
    const y = 0.688 - t * 0.718;
    // 后凸：颈椎略前、胸椎最靠后、腰椎回到中间
    const bulge = Math.sin(t * Math.PI) * 0.055 - 0.018;
    spine.push([0, y, -(bulge + 0.014)]);
  }
  bones.push({ name: 'spine', points: spine, radius: 0.017 });

  // ============ 二、肋骨：8 对，从脊柱向腹侧环抱 ============
  const RIB_N = 8;
  for (let i = 0; i < RIB_N; i++) {
    const t = i / (RIB_N - 1);
    const y0 = 0.58 - t * 0.44; // 第 1 肋 0.58 → 第 8 肋 0.14
    // 半宽随高度先增后减（胸廓最宽在第 4-5 肋）
    const w = 0.135 * (1 - Math.pow(Math.abs(t - 0.42) / 0.62, 1.7));
    // 肋骨从背侧（z 负）绕到腹侧（z 正）
    const rib: Array<[number, number, number]> = [];
    const SEG = 9;
    for (let k = 0; k <= SEG; k++) {
      const u = k / SEG;
      for (const s of k === 0 ? [0] : [1]) void s;
      const ang = Math.PI * u; // 0 → π，从背到腹
      // 侧向展开：x = w * sin(ang)，前后：z = -0.5*cos(ang) 方向
      const x = w * Math.sin(ang);
      const z = 0.075 * -Math.cos(ang) + 0.006;
      // 肋骨向下倾斜
      const y = y0 - u * 0.055;
      rib.push([x, y, z]);
    }
    // 左半（右侧镜像由调用方复制，或这里直接正负各一条）
    bones.push({ name: `rib-${i}-r`, points: rib, radius: 0.0075 });
    bones.push({
      name: `rib-${i}-l`,
      points: rib.map(([x, y, z]) => [-x, y, z] as [number, number, number]),
      radius: 0.0075,
    });
  }

  // ============ 三、胸骨：腹侧正中纵线 ============
  const sternum: Array<[number, number, number]> = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    sternum.push([0, 0.565 - t * 0.44, 0.086 - t * 0.008]);
  }
  bones.push({ name: 'sternum', points: sternum, radius: 0.009 });

  // ============ 四、锁骨：从胸骨上窝斜向两肩 ============
  for (const s of [-1, 1] as const) {
    bones.push({
      name: `clavicle-${s > 0 ? 'r' : 'l'}`,
      points: [
        [s * 0.018, 0.578, 0.082],
        [s * 0.098, 0.596, 0.052],
        [s * 0.172, 0.612, 0.006],
      ],
      radius: 0.0095,
    });
  }

  // ============ 五、四肢骨 ============
  for (const s of [-1, 1] as const) {
    // 肱骨：肩 → 肘
    bones.push({
      name: `humerus-${s > 0 ? 'r' : 'l'}`,
      points: [
        [s * 0.196, 0.596, 0.0],
        [s * 0.216, 0.43, 0.012],
        [s * 0.222, 0.252, 0.016],
      ],
      radius: 0.016,
    });
    // 尺骨 + 桡骨：肘 → 腕（两条平行细骨）
    bones.push({
      name: `ulna-${s > 0 ? 'r' : 'l'}`,
      points: [
        [s * 0.222, 0.246, 0.010],
        [s * 0.216, 0.028, 0.016],
      ],
      radius: 0.008,
    });
    bones.push({
      name: `radius-${s > 0 ? 'r' : 'l'}`,
      points: [
        [s * 0.208, 0.246, 0.026],
        [s * 0.202, 0.028, 0.030],
      ],
      radius: 0.0075,
    });
    // 股骨：髋 → 膝（盘腿姿态，向外下方）
    //
    // 半径从 0.021 收到 0.0115：参考片里盘腿是一坨**圆润土丘**，腿骨几乎
    // 看不见，只有大腿的隐约走向。原值 0.021 让股骨变成一根又粗又直的白棍，
    // 从侧面直接穿出体表悬空在盘腿外面（特写里最刺眼的硬伤）。
    //
    // ⚠️ 端点 x 必须**留在体表以内**。原末端 0.442（y=-0.230）落在盘腿体表
    //    半宽 ≈0.50 的边缘上，加上骨骼整体只缩到 0.88，管壁一出来就穿模。
    //    收到 0.395 并在 y 上略降，让整根股骨躺在土丘内部。
    bones.push({
      name: `femur-${s > 0 ? 'r' : 'l'}`,
      points: [
        [s * 0.068, -0.030, 0.004],
        [s * 0.245, -0.128, 0.014],
        [s * 0.395, -0.226, 0.010],
      ],
      radius: 0.0115,
    });
    // 胫腓骨：膝 → 踝（交叉盘到对侧）
    // 同理收细（0.015 → 0.0085），并整体后移贴进土丘内部，避免侧面穿出。
    bones.push({
      name: `tibia-${s > 0 ? 'r' : 'l'}`,
      points: [
        [s * 0.395, -0.248, 0.008],
        [s * 0.270, -0.340, 0.002],
        [-s * 0.095, -0.396, -0.004],
      ],
      radius: 0.0085,
    });
  }

  // ============ 六、骨盆：一对髂骨弧 ============
  for (const s of [-1, 1] as const) {
    const ilium: Array<[number, number, number]> = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      ilium.push([
        s * (0.055 + t * 0.115),
        -0.010 - t * 0.075,
        -0.010 + Math.sin(t * Math.PI) * 0.045,
      ]);
    }
    bones.push({
      name: `ilium-${s > 0 ? 'r' : 'l'}`,
      points: ilium,
      radius: 0.013,
    });
  }

  return bones;
}


/**
 * 把骨架定义变成 three.js 网格组。
 *
 * y 由「人体坐标」换算到「以人体中心为原点」的世界坐标：
 *   worldY = (yUnit - CENTRE_Y) * scale
 * 这样骨架、体表、经脉共用同一套坐标，旋转时三者始终对齐。
 */
export function buildSkeletonGeometry(scale = 1): Group {
  const g = new Group();
  for (const b of bodySkeleton()) {
    const pts = b.points.map(
      (p) => new Vector3(p[0] * scale, (p[1] - CENTRE_Y) * scale, p[2] * scale),
    );
    if (pts.length < 2) continue;
    let curve: CatmullRomCurve3;
    try {
      curve = new CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
    } catch {
      continue;
    }
    const geo = new TubeGeometry(curve, Math.max(8, pts.length * 4), b.radius * scale, 7, false);
    g.add(new Mesh(geo));
  }
  return g;
}