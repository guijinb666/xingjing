/**
 * 诊断：直接读 src/render3d/bodyProfile.ts 的 PROFILE 表，
 * 复刻 halfWidthAt 的二分 + Catmull–Rom，打印头颈段的半宽曲线。
 *
 * 目的：确认「改了表但渲染不变」到底是表没生效，还是插值把它抹掉了。
 */
import fs from 'node:fs';

const src = fs.readFileSync('src/render3d/bodyProfile.ts', 'utf8');
// 只取 PROFILE 数组内部（从 `export const PROFILE` 到第一个 `];`）
const start = src.indexOf('export const PROFILE');
const end = src.indexOf('\n];', start);
const block = src.slice(start, end);

const PROFILE = [];
for (const raw of block.split(/\r?\n/)) {
  const code = raw.replace(/\/\/.*$/, '');
  const m = code.match(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/);
  if (m) PROFILE.push([parseFloat(m[1]), parseFloat(m[2])]);
}

console.log('解析到关键点', PROFILE.length, '个，y 从', PROFILE[0][0], '到', PROFILE[PROFILE.length - 1][0]);

function halfWidthAt(y) {
  const n = PROFILE.length;
  if (y >= PROFILE[0][0]) return PROFILE[0][1];
  if (y <= PROFILE[n - 1][0]) return PROFILE[n - 1][1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (PROFILE[mid][0] >= y) lo = mid;
    else hi = mid;
  }
  const i = lo;
  const y0 = PROFILE[i][0];
  const y1 = PROFILE[i + 1][0];
  const t = (y0 - y) / (y0 - y1);
  const p = (k) => PROFILE[Math.max(0, Math.min(n - 1, k))][1];
  const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
  const t2 = t * t, t3 = t2 * t;
  const v = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  return Math.max(0, v);
}

console.log('\n=== 头颈段逐点（y=0.98 → 0.46）===');
console.log('y        halfW    比值halfW/颈halfW');
const neckHW = halfWidthAt(0.66);
for (let y = 0.98; y >= 0.46; y -= 0.02) {
  const hw = halfWidthAt(y);
  const bar = '█'.repeat(Math.round(hw * 120));
  console.log(`${y.toFixed(3)}   ${hw.toFixed(4)}   ${(hw / neckHW).toFixed(2).padStart(5)}  ${bar}`);
}
console.log('\n颈半宽(0.66) =', neckHW.toFixed(4), ' 头半宽峰值 =', Math.max(...[0.98,0.94,0.90,0.86,0.85,0.84,0.82,0.80,0.78,0.76,0.74,0.72,0.70].map(halfWidthAt)).toFixed(4));
