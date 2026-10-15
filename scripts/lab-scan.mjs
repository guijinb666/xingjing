/**
 * 逐行扫描实验台渲染出的 PNG，输出每个 y 行的亮度分布，
 * 用来判定：头部是否为暗心、腿部是否为空心菱形。
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const which = process.argv[2] || 'figure-lab4';
const src = path.join(ROOT, '_probe', `${which}.html`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 860 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(src).href, { waitUntil: 'load' });
await page.waitForTimeout(300);

const data = await page.evaluate(() => {
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  const img = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height;
  // 找到人体包围盒（亮度 > 阈值）
  let minX = W, maxX = 0, minY = H, maxY = 0;
  const rows = [];
  for (let y = 0; y < H; y++) {
    let sum = 0, peak = 0, cnt = 0, firstX = -1, lastX = -1;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const lum = (img[i] * 0.3 + img[i + 1] * 0.6 + img[i + 2] * 0.1);
      if (lum > 12) { cnt++; if (firstX < 0) firstX = x; lastX = x; }
      sum += lum; if (lum > peak) peak = lum;
    }
    if (cnt > 0) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    rows.push({ y, mean: sum / W, peak, cnt, firstX, lastX });
  }
  for (const r of rows) { if (r.firstX >= 0) { if (r.firstX < minX) minX = r.firstX; if (r.lastX > maxX) maxX = r.lastX; } }
  // 只保留人体范围内的行，每隔若干行取样
  const body = rows.filter(r => r.cnt > 0);
  const sampled = [];
  for (let i = 0; i < body.length; i += Math.max(1, Math.floor(body.length / 34))) sampled.push(body[i]);
  return { bbox: { minX, maxX, minY, maxY, W, H }, sampled, bodyLen: body.length };
});

await browser.close();

const { bbox, sampled } = data;
console.log(`包围盒 x[${bbox.minX},${bbox.maxX}] y[${bbox.minY},${bbox.maxY}]  宽${bbox.maxX - bbox.minX} 高${bbox.maxY - bbox.minY}`);
console.log('y     行宽   亮像素数  峰值   行内第一/最后x');
for (const r of sampled) {
  console.log(
    String(r.y).padStart(4),
    String(r.lastX - r.firstX).padStart(6),
    String(r.cnt).padStart(9),
    r.peak.toFixed(0).padStart(6),
    `  ${r.firstX}..${r.lastX}`,
  );
}
