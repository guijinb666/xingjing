/**
 * 人形几何自检脚本（不依赖浏览器）。
 *
 * 用 node-canvas 太麻烦，这里直接**复刻** silhouette.ts 的路径构造逻辑，
 * 用采样法测量每个高度的左右边界，输出一个 ASCII 剪影。
 * 这样能在改代码前先确认"形状到底长什么样"，而不是靠反复截图猜。
 */
import { readFileSync } from 'node:fs';

// ---- 从源码里解析出 POSE 常量，保证自检与真实实现同源 ----
const src = readFileSync(
  'C:/Users/30612/Desktop/dsh/xingjing/src/render/silhouette.ts',
  'utf8',
);

function num(name) {
  const m = src.match(new RegExp(`${name}:\\s*(-?[\\d.]+)`));
  if (!m) throw new Error(`未找到常量 ${name}`);
  return parseFloat(m[1]);
}
function topNum(name) {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*(-?[\\d.]+)`));
  if (!m) throw new Error(`未找到顶层常量 ${name}`);
  return parseFloat(m[1]);
}

const P = {
  headR: num('headR'), headY: num('headY'), neckY: num('neckY'),
  shoulderY: num('shoulderY'), shoulderX: num('shoulderX'),
  chestY: num('chestY'), waistY: num('waistY'), hipY: num('hipY'),
  kneeX: num('kneeX'), kneeY: num('kneeY'), footX: num('footX'), footY: num('footY'),
  elbowX: num('elbowX'), elbowY: num('elbowY'), handX: num('handX'), handY: num('handY'),
};
const LAP_X = topNum('LAP_X');
const LAP_Y = topNum('LAP_Y');
const HEAD_TOP = topNum('HEAD_TOP');

// ---- 复刻 bodyPath 的贝塞尔段（与源码逐句对应） ----
// 每段: [x0,y0, c1x,c1y, c2x,c2y, x1,y1]
const segs = [
  // 头顶 → 头侧
  [0, HEAD_TOP, 0.042, HEAD_TOP, P.headR + 0.012, P.headY + 0.030, P.headR + 0.004, P.headY],
  // 头侧 → 下颌 → 颈
  [P.headR + 0.004, P.headY, P.headR, P.headY - 0.030, 0.082, P.headY - 0.062, 0.076, P.neckY],
  // 颈 → 肩
  [0.076, P.neckY, 0.092, P.shoulderY + 0.030, 0.180, P.shoulderY + 0.014, P.shoulderX, P.shoulderY],
  // 肩 → 肘
  [P.shoulderX, P.shoulderY, P.shoulderX + 0.008, P.shoulderY - 0.115, P.elbowX + 0.012, P.elbowY + 0.125, P.elbowX, P.elbowY],
  // 肘 → 手
  [P.elbowX, P.elbowY, P.elbowX - 0.004, P.elbowY - 0.085, P.handX - 0.006, P.handY + 0.075, P.handX - 0.014, P.handY],
  // 手 → 腰
  [P.handX - 0.014, P.handY, P.handX - 0.026, P.handY - 0.055, 0.250, -0.215, 0.232, -0.268],
  // 腰 → 膝
  [0.232, -0.268, 0.238, -0.310, 0.258, -0.352, LAP_X, LAP_Y + 0.012],
  // 外侧下拐角
  [LAP_X, LAP_Y + 0.012, LAP_X + 0.006, LAP_Y - 0.020, LAP_X - 0.016, LAP_Y - 0.044, LAP_X - 0.052, LAP_Y - 0.050],
  // 底面到中轴
  [LAP_X - 0.052, LAP_Y - 0.050, 0.180, LAP_Y - 0.068, -0.180, LAP_Y - 0.068, -LAP_X + 0.052, LAP_Y - 0.050],
];

function bez(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

// 采样右半侧轮廓（只取 x>=0 的段）
const right = [];
for (const s of segs) {
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const x = bez(t, s[0], s[2], s[4], s[6]);
    const y = bez(t, s[1], s[3], s[5], s[7]);
    if (x >= 0) right.push({ x, y });
  }
}

// 按 y 分桶取最大 x
const TOP = HEAD_TOP, BOT = LAP_Y - 0.09;
const ROWS = 46;
const grid = [];
for (let r = 0; r < ROWS; r++) {
  const y = TOP - (r / (ROWS - 1)) * (TOP - BOT);
  let maxX = 0;
  for (const p of right) {
    if (Math.abs(p.y - y) < (TOP - BOT) / (ROWS - 1) / 2) maxX = Math.max(maxX, p.x);
  }
  grid.push({ y, maxX });
}

console.log('POSE:', JSON.stringify(P));
console.log('LAP_X =', LAP_X, ' HEAD_TOP =', HEAD_TOP, ' LAP_Y =', LAP_Y);
console.log('');
console.log('y(上)→ 半宽   ASCII 剪影（每列 = 0.02 单位）');
const COLS = 46;
for (const g of grid) {
  const n = Math.round(g.maxX / 0.02);
  const left = ' '.repeat(COLS - n);
  const rightStr = '#'.repeat(n * 2 + 1);
  console.log(
    `${g.y.toFixed(2).padStart(6)} ${g.maxX.toFixed(3).padStart(5)} |${left}${rightStr}`,
  );
}

console.log('\n关键宽度对比：');
const at = (y) => {
  let best = 0;
  for (const p of right) if (Math.abs(p.y - y) < 0.02) best = Math.max(best, p.x);
  return best;
};
console.log(`  头顶区 y=${HEAD_TOP}        半宽 ${at(HEAD_TOP).toFixed(3)}`);
console.log(`  颈部   y=${P.neckY}        半宽 ${at(P.neckY).toFixed(3)}`);
console.log(`  肩部   y=${P.shoulderY}    半宽 ${at(P.shoulderY).toFixed(3)}`);
console.log(`  肘部   y=${P.elbowY}       半宽 ${at(P.elbowY).toFixed(3)}`);
console.log(`  手部   y=${P.handY}        半宽 ${at(P.handY).toFixed(3)}`);
console.log(`  腰部   y=-0.195             半宽 ${at(-0.195).toFixed(3)}`);
console.log(`  膝部   y=${P.kneeY}        半宽 ${at(P.kneeY).toFixed(3)}`);
console.log(`  盘腿   y=${LAP_Y}          半宽 ${at(LAP_Y).toFixed(3)}`);
console.log(`\n  肩宽/盘腿宽 = ${(at(P.shoulderY) / at(LAP_Y)).toFixed(2)}  (应 ≈0.95–1.05)`);
console.log(`  头是否露出（肩线上方最大半宽） = ${Math.max(at(HEAD_TOP), at(0.9), at(0.8)).toFixed(3)}`);
