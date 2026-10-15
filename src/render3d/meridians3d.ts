/**
 * 3D 经脉（经络）定义。
 *
 * 参考片里人形体表下有一层极淡的**线状流光**——那不是装饰，是经脉。
 * 关键是要做成**真三维曲线**：经脉贴着体表曲面前后绕行
 * （任脉在前、督脉在后、手三阴从前臂内侧走上胸、足三阳沿腿外侧下行），
 * 于是轨道旋转时能看出「线在身体里面绕」，而不是贴在平面上。
 *
 * 走行是**程式化**的：按中医经络大致走向布置，不严格取穴
 * （参考片本身也只是表现性的细线，没有可辨认的穴位标记）。
 *
 * 坐标系与 bodyGeometry 一致：y 轴向上，原点在人体中心。
 * 传入的点用「单位坐标」y（调用方减去 CENTRE_Y 再乘 scale）。
 */

/** 一条经脉：名称 + 折线 + 线宽 */
export interface MeridianDef {
  name: string;
  /** 路径关键点，单位坐标 [x, y, z]（y 为人体坐标，未减中心偏移） */
  points: Array<[number, number, number]>;
  /** 管半径（单位坐标） */
  radius: number;
  /** 发光强度倍率（任督二脉最亮） */
  glow: number;
}

export function buildMeridians(): MeridianDef[] {
  return bodyMeridians();
}

/**
 * 生成完整经脉系统。
 *
 * 朝向约定：**+z 为腹侧（前），-z 为背侧（后）**。
 */
export function bodyMeridians(): MeridianDef[] {
  const out: MeridianDef[] = [];

  // ================= 一、任脉（前正中线）=================
  // 会阴 → 沿腹胸正中上行 → 咽喉 → 下颌
  out.push({
    name: 'ren',
    glow: 1.0,
    radius: 0.0058,
    points: [
      [0, -0.30, 0.052],
      [0, -0.12, 0.066],
      [0, 0.06, 0.070],
      [0, 0.24, 0.072],
      [0, 0.42, 0.078],
      [0, 0.56, 0.082],
      [0, 0.63, 0.066],
      [0, 0.70, 0.040],
      [0, 0.75, 0.018],
    ],
  });

  // ================= 二、督脉（后正中线）=================
  // 尾闾 → 沿脊柱上行 → 头顶 → 上唇
  out.push({
    name: 'du',
    glow: 1.0,
    radius: 0.0058,
    points: [
      [0, -0.32, -0.046],
      [0, -0.14, -0.062],
      [0, 0.06, -0.074],
      [0, 0.26, -0.078],
      [0, 0.44, -0.075],
      [0, 0.58, -0.062],
      [0, 0.66, -0.038],
      [0, 0.74, -0.030],
      [0, 0.83, -0.020],
      [0, 0.90, -0.006],
      [0, 0.94, 0.020],
      [0, 0.90, 0.052],
      [0, 0.84, 0.070],
    ],
  });

  // ================= 三、手三阴（胸 → 臂内侧 → 手）=================
  // 肺经 / 心包经 / 心经：从前胸出来，沿上臂前内侧下行到手掌
  const ARM_IN: Array<[number, number, number]> = [
    [0.086, 0.318],
    [0.014, 0.248],
    [-0.008, 0.176],
  ] as unknown as Array<[number, number, number]>;
  void ARM_IN;

  const handYinOffsets: Array<{ name: string; z0: number; x0: number }> = [
    { name: 'lung', z0: 0.072, x0: 0.10 },
    { name: 'pericardium', z0: 0.066, x0: 0.062 },
    { name: 'heart', z0: 0.058, x0: 0.028 },
  ];
  for (const [i, cfg] of handYinOffsets.entries()) {
    for (const s of [-1, 1] as const) {
      out.push({
        name: `${cfg.name}-${s > 0 ? 'r' : 'l'}`,
        glow: 0.72,
        radius: 0.0036,
        points: [
          [s * cfg.x0, 0.50 - i * 0.045, cfg.z0],
          [s * 0.155, 0.50 - i * 0.05, cfg.z0 + 0.022],
          [s * 0.212, 0.43, cfg.z0 + 0.020],
          [s * 0.226, 0.25, cfg.z0 + 0.014],
          [s * 0.216, 0.03, cfg.z0 + 0.008],
          [s * 0.206, -0.01, cfg.z0 - 0.004],
        ],
      });
    }
  }

  // ================= 四、手三阳（手 → 臂外侧 → 肩背 → 头面）=================
  const handYang: Array<{ name: string; z0: number; tilt: number }> = [
    { name: 'large-intestine', z0: -0.020, tilt: 0.10 },
    { name: 'triple-burner', z0: -0.010, tilt: 0.06 },
    { name: 'small-intestine', z0: 0.004, tilt: 0.02 },
  ];
  for (const [i, cfg] of handYang.entries()) {
    for (const s of [-1, 1] as const) {
      out.push({
        name: `${cfg.name}-${s > 0 ? 'r' : 'l'}`,
        glow: 0.66,
        radius: 0.0034,
        points: [
          [s * 0.206, -0.01, cfg.z0],
          [s * 0.226, 0.14, cfg.z0 - 0.014],
          [s * 0.228, 0.30, cfg.z0 - 0.020],
          [s * 0.216, 0.42, cfg.z0 - 0.022],
          [s * (0.19 - i * 0.01), 0.55 - i * 0.03, -0.046],
          [s * (0.10 - i * 0.01), 0.62 - i * 0.04, -0.048],
          [s * (0.05 - i * 0.01), 0.72 - i * 0.04, -0.030 + cfg.tilt],
          [s * (0.03 - i * 0.01), 0.82 - i * 0.03, -0.010 + cfg.tilt],
        ],
      });
    }
  }

  // ================= 五、足三阳（头面 → 躯干 → 腿外侧 → 足）=================
  const footYang: Array<{ name: string; spread: number; zAtTrunk: number }> = [
    { name: 'stomach', spread: 0.085, zAtTrunk: 0.058 },
    { name: 'gallbladder', spread: 0.135, zAtTrunk: 0.0 },
    { name: 'bladder', spread: 0.10, zAtTrunk: -0.062 },
  ];
  for (const [i, cfg] of footYang.entries()) {
    for (const s of [-1, 1] as const) {
      out.push({
        name: `${cfg.name}-${s > 0 ? 'r' : 'l'}`,
        glow: 0.62,
        radius: 0.0034,
        points: [
          [s * (0.03 + i * 0.012), 0.80 - i * 0.03, cfg.zAtTrunk + 0.02],
          [s * (0.06 + i * 0.02), 0.68, cfg.zAtTrunk + 0.01],
          [s * cfg.spread, 0.52, cfg.zAtTrunk],
          [s * (cfg.spread + 0.028), 0.30, cfg.zAtTrunk],
          [s * (cfg.spread + 0.040), 0.08, cfg.zAtTrunk + 0.006],
          [s * (cfg.spread + 0.060), -0.06, cfg.zAtTrunk + 0.012],
          [s * (0.30 + i * 0.03), -0.17, cfg.zAtTrunk + 0.028],
          [s * (0.44 + i * 0.012), -0.26, cfg.zAtTrunk + 0.030],
          [s * (0.34 + i * 0.02), -0.36, cfg.zAtTrunk + 0.018],
        ],
      });
    }
  }

  // ================= 六、足三阴（足 → 腿内侧 → 腹胸）=================
  const footYin: Array<{ name: string; x: number }> = [
    { name: 'spleen', x: 0.10 },
    { name: 'liver', x: 0.055 },
    { name: 'kidney', x: 0.018 },
  ];
  for (const [i, cfg] of footYin.entries()) {
    for (const s of [-1, 1] as const) {
      out.push({
        name: `${cfg.name}-${s > 0 ? 'r' : 'l'}`,
        glow: 0.62,
        radius: 0.0034,
        points: [
          [s * (0.16 + i * 0.02), -0.40, 0.010],
          [s * (0.28 - i * 0.02), -0.34, 0.004],
          [s * (0.40 - i * 0.03), -0.25, 0.010],
          [s * (0.30 - i * 0.02), -0.16, 0.036],
          [s * (cfg.x + 0.06), -0.04, 0.058],
          [s * cfg.x, 0.10, 0.066],
          [s * (cfg.x - 0.010), 0.30, 0.068],
          [s * (cfg.x - 0.020), 0.48, 0.062],
        ],
      });
    }
  }

  // ================= 七、带脉（环绕腰腹一圈）=================
  const belt: Array<[number, number, number]> = [];
  const BELT_N = 24;
  for (let i = 0; i <= BELT_N; i++) {
    const a = (i / BELT_N) * Math.PI * 2;
    belt.push([
      Math.sin(a) * 0.335,
      0.115 + Math.cos(a * 2) * 0.012,
      Math.cos(a) * 0.232,
    ]);
  }
  out.push({ name: 'belt', glow: 0.58, radius: 0.0032, points: belt });

  return out;
}
