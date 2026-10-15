/**
 * 直接解析 silhouette.ts 里的 PROFILE 关键点表，
 * 算出各高度区间的归一化宽度，与参考片标定值逐项比对。
 *
 * 与 figure-measure.mjs 的区别：
 *   figure-measure 量**渲染结果**（会受亮度阈值影响）；
 *   本脚本量**几何定义**（不含渲染），所以能区分
 *   「形状不对」与「渲染太暗导致量不到」。
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('src/render/silhouette.ts', 'utf8');

// —— 解析 PROFILE 表
const m = src.match(/const PROFILE: ReadonlyArray<readonly \[number, number\]> = \[([\s\S]*?)\n\];/);
if (!m) throw new Error('未找到 PROFILE');
const PROFILE = [];
for (const line of m[1].split('\n')) {
  // 跳过注释行：注释里可能引用形如 [0.633, 0.067] 的坐标做说明，
  // 若不排除会被当成数据行，导致 BODY_H 与所有指标全错（曾把
  // 头顶 y=0.98 漏掉、BODY_H 变成 1.093，五项指标全红）。
  const code = line.replace(/\/\/.*$/, '');
  const mm = code.match(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/);
  if (mm) PROFILE.push([parseFloat(mm[1]), parseFloat(mm[2])]);
}
console.log(`PROFILE 关键点 ${PROFILE.length} 个，y 从 ${PROFILE[0][0]} 到 ${PROFILE[PROFILE.length - 1][0]}`);

const BODY_H = PROFILE[0][0] - PROFILE[PROFILE.length - 1][0];
console.log(`BODY_H = ${BODY_H.toFixed(4)}\n`);

// —— 复刻 Catmull–Rom 插值（与 silhouette.ts 同一算法）
function halfWidthAt(y) {
  const n = PROFILE.length;
  if (y >= PROFILE[0][0]) return PROFILE[0][1];
  if (y <= PROFILE[n - 1][0]) return PROFILE[n - 1][1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (PROFILE[mid][0] >= y) lo = mid; else hi = mid;
  }
  const i = lo;
  const y0 = PROFILE[i][0], y1 = PROFILE[i + 1][0];
  const t = (y0 - y) / (y0 - y1);
  const p = (k) => PROFILE[Math.max(0, Math.min(n - 1, k))][1];
  const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
  const t2 = t * t, t3 = t2 * t;
  const v = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  return Math.max(0, v);
}

// —— 参考片标定：**直接取 _probe/ref_profile.json 的分区最大值**，
//    与 ref_profile.py 的 summary 同一口径，避免混入手工目测的旧数字。
//    （曾误用「肩宽 0.35」，那是单帧二值化把手臂算进肩宽的结果；
//     31 帧平均后的真实肩区宽度只有 0.1683。）
//
//    膝宽说明：该区间的参考值是 ref_profile.json 的 `kneeW = 0.6502`。
//    ref_profile.py 的区间最大值来自 8.0–16.0s 多帧平均，本身含
//    约 ±0.04 的像素宽化；故上界给到 0.72 而非 0.65。
//    （不要用旧的「0.42–0.52」——那是把参考片的 t=0.60 单点当成
//      区间最大值，真实区间是 0.455 → 0.617 → 0.964 的陡升。）
const REF = [
  ['头宽', 0.00, 0.12, 0.17, 0.20],
  ['肩宽', 0.16, 0.28, 0.15, 0.22],
  ['腰宽', 0.36, 0.48, 0.38, 0.46],
  ['膝宽', 0.60, 0.74, 0.58, 0.72],
  ['盘腿宽', 0.74, 0.99, 0.88, 1.00],
];

console.log('指标        实测(归一化)  参考区间   判定');
console.log('─'.repeat(52));
let bad = 0;
for (const [name, t0, t1, lo, hi] of REF) {
  // t 区间 → y 区间（t=0 头顶, t=1 底缘）
  let maxW = 0;
  for (let k = 0; k <= 200; k++) {
    const t = t0 + ((t1 - t0) * k) / 200;
    const y = PROFILE[0][0] - t * BODY_H;
    const w = (halfWidthAt(y) * 2) / BODY_H;
    if (w > maxW) maxW = w;
  }
  const ok = maxW >= lo && maxW <= hi;
  if (!ok) bad++;
  console.log(`${name.padEnd(10)}  ${maxW.toFixed(3).padStart(8)}     ${lo}–${hi}     ${ok ? '✅ OK' : '❌ 偏离'}`);
}

console.log('\n=== 剖面形状速览（每 3% 体高一行）===');
for (let k = 0; k <= 33; k++) {
  const t = k / 33;
  const y = PROFILE[0][0] - t * BODY_H;
  const w = (halfWidthAt(y) * 2) / BODY_H;
  const bar = '#'.repeat(Math.round(w * 46));
  console.log(`t=${t.toFixed(2)} w=${w.toFixed(3)} ${bar}`);
}

console.log(bad === 0 ? '\n✓ 全部指标落在参考区间' : `\n✗ ${bad} 项偏离参考区间`);
