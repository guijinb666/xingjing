/**
 * 从 silhouette.ts 里**源码级**解析 POSE 常量与剖面函数的目标宽度，
 * 直接算出「每个参考指标在单位坐标里应该是多少半宽」，
 * 并给出当前 POSE 所需的修正系数。
 *
 * 这样就不用靠 build→截图→读数 的慢循环来定比例。
 */
import { readFileSync } from 'node:fs';

const SRC = 'src/render/silhouette.ts';
const src = readFileSync(SRC, 'utf8');

// —— 解析 POSE 字面量
const m = src.match(/const POSE: Pose = \{([\s\S]*?)\n\};/);
if (!m) throw new Error('未找到 POSE');
const POSE = {};
for (const line of m[1].split('\n')) {
  const mm = line.match(/^\s*([A-Za-z]+):\s*(-?[\d.]+)\s*,/);
  if (mm) POSE[mm[1]] = parseFloat(mm[2]);
}
console.log('POSE =', JSON.stringify(POSE));

// —— 解析 BODY_H（由 headTop / lapY 得出）
const BODY_H = POSE.headTop - POSE.lapY;
console.log('BODY_H =', BODY_H.toFixed(4));

// 参考片实测（宽度 ÷ 体高）
const REF = {
  headW: [0.17, 0.20],
  shoulderW: [0.35, 0.35],
  waistW: [0.32, 0.34],
  kneeW: [0.48, 0.50],
  lapW: [0.90, 0.98],
};

/** 目标归一化宽度 → 单位坐标半宽 */
const halfFor = (norm) => (norm * BODY_H) / 2;

console.log('\n=== 各指标在单位坐标里的目标半宽 ===');
for (const [k, [lo, hi]] of Object.entries(REF)) {
  console.log(
    `${k.padEnd(10)} 目标 ${lo}–${hi}  →  单位半宽 ${halfFor(lo).toFixed(3)}–${halfFor(hi).toFixed(3)}`,
  );
}

// —— 当前代码里这些量实际是多少
const cur = {
  headW: POSE.headW,
  shoulderW: POSE.shoulderX,
  // 腰：剖面函数 profileTorso 的 torso 基数 0.238 - 0.052*bump(waistY) ≈ 0.186
  waistW: 0.186,
  kneeW: POSE.kneeX + 0.086, // 膝隆起叠加后的外侧
  lapW: 0.691, // profileLap 的 base 峰值
};

console.log('\n=== 当前值 vs 目标 ===');
for (const [k, [lo, hi]] of Object.entries(REF)) {
  const curNorm = (cur[k] * 2) / BODY_H;
  const tgt = (lo + hi) / 2;
  const fix = tgt / curNorm;
  const ok = curNorm >= lo * 0.97 && curNorm <= hi * 1.03;
  console.log(
    `${k.padEnd(10)} 当前 ${curNorm.toFixed(3)}  目标 ${lo}–${hi}  修正系数 ×${fix.toFixed(3)}  ${ok ? 'OK' : '需改'}`,
  );
}

// —— 反推：要让各指标达标，POSE 应该取什么值
console.log('\n=== 反推建议值 ===');
const TGT = {
  headW: halfFor(0.185),
  shoulderX: halfFor(0.35),
  waistHalf: halfFor(0.33),
  kneeOuter: halfFor(0.49),
  lapHalf: halfFor(0.94),
};
for (const [k, v] of Object.entries(TGT)) {
  console.log(`${k.padEnd(12)} = ${v.toFixed(4)}`);
}
console.log(`\n膝中心 kneeX 应 ≈ ${(TGT.kneeOuter - 0.086).toFixed(4)}（扣掉膝隆起 0.086）`);
console.log(`腰部剖面基数应 ≈ ${TGT.waistHalf.toFixed(4)}（当前 0.186）`);
