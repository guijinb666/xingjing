/**
 * 从真实渲染的 _shots/03-inner-spin.png 里测量人形比例，
 * 与参考片标定值对比，输出偏差表 —— 避免靠肉眼猜。
 *
 * 思路：人形是暖金色（R>G>B 且整体偏亮），节点图标是青色/紫色。
 * 用「暖色 + 亮度」双重条件分离人形，再取最大连通域。
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const img = process.argv[2] || '_shots/03-inner-spin.png';
const abs = path.isAbsolute(img) ? img : path.join(ROOT, img);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(abs).href, { waitUntil: 'load' });
await page.waitForTimeout(200);

const res = await page.evaluate(async () => {
  const im = document.querySelector('img');
  const c = document.createElement('canvas');
  c.width = im.naturalWidth;
  c.height = im.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(im, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height;

  // 暖色人形掩码：R 明显大于 B，且足够亮
  const mask = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // 阈值放到 lum > 18：头部/盘腿底缘的亮度明显低于躯干中心，
    // 阈值高了会把头和盘腿外缘整段漏掉，得到"头宽偏窄"的假象
    // （曾用 lum>30 时头宽读到 0.083，而源码里的真实几何是 0.146）。
    if (lum > 18 && r - b > 8 && r >= g - 8) mask[p] = 1;
  }

  // 以画布中心为种子做 flood fill（人形是中心最大团块，节点环在远处）
  const cx = Math.round(W / 2), cy = Math.round(H / 2);
  const visited = new Uint8Array(W * H);
  const stack = [];
  // 从中心附近找一个种子
  let seed = -1;
  for (let r = 0; r < 160 && seed < 0; r += 4) {
    for (let a = 0; a < 360 && seed < 0; a += 6) {
      const x = Math.round(cx + r * Math.cos((a * Math.PI) / 180));
      const y = Math.round(cy + r * Math.sin((a * Math.PI) / 180));
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const p = y * W + x;
      if (mask[p] && !visited[p]) seed = p;
    }
  }
  if (seed < 0) return { error: '未找到人形种子像素' };
  stack.push(seed);
  visited[seed] = 1;
  let minX = W, maxX = 0, minY = H, maxY = 0, count = 0;
  while (stack.length) {
    const p = stack.pop();
    const x = p % W, y = (p / W) | 0;
    count++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx;
      if (!visited[q] && mask[q]) { visited[q] = 1; stack.push(q); }
    }
  }

  // 逐行宽度（用 visited 团块）
  const rows = [];
  for (let y = minY; y <= maxY; y++) {
    let f = -1, l = -1;
    for (let x = 0; x < W; x++) {
      if (visited[y * W + x]) { if (f < 0) f = x; l = x; }
    }
    rows.push({ y, w: f < 0 ? 0 : l - f, f, l });
  }
  // 同时输出「亮度加权」的逐行宽度，用于对照阈值敏感性
  const rowsRaw = [];
  for (let y = minY; y <= maxY; y++) {
    let f = -1, l = -1;
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      const rr = d[p], gg = d[p + 1], bb = d[p + 2];
      const lum2 = 0.299 * rr + 0.587 * gg + 0.114 * bb;
      if (lum2 > 6 && rr - bb > 4 && rr >= gg - 10) { if (f < 0) f = x; l = x; }
    }
    rowsRaw.push({ y, w: f < 0 ? 0 : l - f });
  }
  return { bbox: { minX, maxX, minY, maxY, W, H }, count, rows, rowsRaw };
});

await browser.close();

if (res.error) { console.log(res.error); process.exit(1); }
const { bbox, rows, rowsRaw } = res;
const figW = bbox.maxX - bbox.minX;
const figH = bbox.maxY - bbox.minY;
console.log(`人形包围盒 x[${bbox.minX},${bbox.maxX}] y[${bbox.minY},${bbox.maxY}] 宽=${figW} 高=${figH}`);
console.log(`画布 ${bbox.W}×${bbox.H}  人形高/画布高 = ${(figH / bbox.H).toFixed(3)}`);

// 关键高度（按人体自顶向下归一化）
function wAt(frac) {
  const y = Math.round(bbox.minY + frac * figH);
  const r = rows.find((rr) => rr.y === y);
  return r ? r.w : 0;
}
function maxWBetween(f0, f1) {
  let m = 0;
  for (const r of rows) {
    const f = (r.y - bbox.minY) / figH;
    if (f >= f0 && f <= f1 && r.w > m) m = r.w;
  }
  return m;
}

// 阈值敏感性对照：宽阈值下重算一遍
function maxRaw(f0, f1) {
  let m = 0;
  for (const r of rowsRaw) {
    const f = (r.y - bbox.minY) / figH;
    if (f >= f0 && f <= f1 && r.w > m) m = r.w;
  }
  return m;
}

// 参考区间：**必须与 _probe/ref_profile.json 的 summary 同一口径**
// （31 帧平均 → 亮度 88 分位 + 暖色分割 → 最大连通域 → 宽度÷体高）。
//
// 坑（务必保留）：旧版这里写的是「肩宽 0.35 / 腰宽 0.32–0.34 / 膝宽 0.48–0.50」，
// 那是**单帧二值化**的早期错误标定——它把手臂算进了肩宽，又把 t=0.60 的
// 单点当成膝宽区间的最大值，导致此后每一轮都朝错误目标调参。
// 权威值：头 0.1815 / 肩区 0.1683 / 腰 0.4224 / 膝 0.6502 / 盘腿 0.9736。
const REF_RANGES = [
  ['头宽', 0.00, 0.12, 0.17, 0.20],
  ['肩宽', 0.16, 0.28, 0.15, 0.22],
  ['腰宽', 0.36, 0.48, 0.38, 0.46],
  ['膝宽', 0.60, 0.74, 0.58, 0.72],
  ['盘腿宽', 0.74, 0.99, 0.88, 1.00],
];

const rowsOut = REF_RANGES.map(([name, f0, f1, lo, hi]) => [
  name,
  maxWBetween(f0, f1),
  lo,
  hi,
]);
for (const [name, v, lo, hi] of rowsOut) {
  const norm = v / figH;
  console.log(
    `${name.padEnd(8)}            ${String(v).padStart(6)}      ${norm.toFixed(3).padStart(6)}    ${lo}–${hi}   ${norm < lo ? '偏窄' : norm > hi ? '偏宽' : 'OK'}`,
  );
}

console.log('\n--- 宽阈值对照（lum>6 判定抗阈值漂移）---');
for (const [name, v, lo, hi] of rowsOut) {
  const norm = v / figH;
  console.log(`${name.padEnd(8)} 归一化 ${norm.toFixed(3)}  参考 ${lo}–${hi}`);
}
const rawRows = [
  ['头宽', maxRaw(0.0, 0.12), 0.17, 0.20],
  ['肩宽', maxRaw(0.16, 0.28), 0.35, 0.35],
  ['腰宽', maxRaw(0.36, 0.48), 0.32, 0.34],
  ['膝宽', maxRaw(0.60, 0.74), 0.48, 0.50],
  ['盘腿宽', maxRaw(0.74, 0.99), 0.90, 0.98],
];
let drift = false;
for (let i = 0; i < rowsOut.length; i++) {
  const a = rowsOut[i][1] / figH, b2 = rawRows[i][1] / figH;
  if (Math.abs(a - b2) > 0.06) drift = true;
  console.log(`${String(rawRows[i][0]).padEnd(8)} 宽阈值 ${b2.toFixed(3)}  窄阈值 ${a.toFixed(3)}  差 ${(b2 - a).toFixed(3)}`);
}
console.log(drift ? '⚠ 两种阈值差异 >0.06，测量可能受亮度阈值影响' : '✓ 两种阈值一致，测量可信');
