/**
 * 真实像素自检：在 headless 浏览器里调用 drawSilhouette 渲染到离屏 canvas，
 * 然后逐行扫描 alpha > 阈值的像素，输出真实轮廓宽度表 + ASCII 剪影。
 *
 * 这个方法不依赖"复刻几何"，它测的是**真正被画出来的东西**。
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(process.cwd());
const URL = process.env.XJ_URL || 'http://127.0.0.1:5299/';
const OUT = path.join(ROOT, '_probe', 'sil-pixels.png');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'networkidle' });

// 在页面里直接 import 生产模块（vite preview 提供已构建的 chunk 不方便 import 源码），
// 因此改为：抓取内景 canvas 的中心区域像素 —— 那是真实渲染结果。
await page.evaluate(() => {
  const el = document.querySelector('.inner-canvas');
  if (el) el.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(2500);

const data = await page.evaluate(() => {
  const c = document.querySelector('.inner-canvas');
  if (!c) return null;
  const ctx = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  const img = ctx.getImageData(0, 0, w, h).data;
  // 只扫中心竖直窄带 —— 节点环在 ±20% 之外，用窄带把它排除掉。
  const x0 = Math.floor(w * 0.5 - Math.min(w * 0.18, h * 0.16));
  const x1 = Math.floor(w * 0.5 + Math.min(w * 0.18, h * 0.16));
  const y0 = Math.floor(h * 0.10);
  const y1 = Math.floor(h * 0.95);
  const rows = [];
  for (let y = y0; y < y1; y += 6) {
    let minX = 1e9;
    let maxX = -1e9;
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const a = img[i + 3];
      const lum = (img[i] * 0.3 + img[i + 1] * 0.59 + img[i + 2] * 0.11) * (a / 255);
      // 人形是暖金，亮度明显高于星点；阈值取 52
      if (lum > 62) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (maxX > minX) {
      rows.push({ y, minX, maxX, halfW: (maxX - minX) / 2 });
    }
  }
  return { w, h, rows, cx: (x0 + x1) / 2 };
});

if (!data) {
  console.log('未找到 .inner-canvas');
  await browser.close();
  process.exit(1);
}

const { rows, cx } = data;
console.log(`画布 ${data.w}x${data.h}, 参考中轴 x=${cx.toFixed(1)}`);
console.log('');
console.log('真实像素轮廓（每行 6px 采样，取亮度>52 的最左/最右）:');
console.log('   y(px)  半宽   相对中轴偏移');

const maxHW = Math.max(...rows.map((r) => r.halfW));
for (const r of rows) {
  const bar = '#'.repeat(Math.max(1, Math.round((r.halfW / maxHW) * 46)));
  const off = ((r.minX + r.maxX) / 2 - cx).toFixed(0);
  console.log(
    `${String(r.y).padStart(6)} ${String(r.halfW.toFixed(0)).padStart(5)} ${String(off).padStart(7)} |${bar}`,
  );
}

// 关键结论
const top = rows[0];
const bot = rows[rows.length - 1];
const widest = rows.reduce((a, b) => (b.halfW > a.halfW ? b : a));
console.log('');
console.log(`顶端 y=${top.y} 半宽=${top.halfW.toFixed(0)}`);
console.log(`底端 y=${bot.y} 半宽=${bot.halfW.toFixed(0)}`);
console.log(`最宽处 y=${widest.y} 半宽=${widest.halfW.toFixed(0)}  (占总高 ${(((widest.y - top.y) / (bot.y - top.y)) * 100).toFixed(0)}%)`);

await browser.close();
