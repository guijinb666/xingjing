import { chromium } from 'playwright';

/**
 * 截取 three.js 打坐人形的多视角图。
 *
 * 用法：node scripts/figure-3d-shoot.mjs [baseUrl] [outPrefix]
 * 环境变量 XJ_URL 优先。
 */
const BASE = process.env.XJ_URL || process.argv[2] || 'http://127.0.0.1:5299/';
const PREFIX = process.argv[3] || 'fig3d';

const VIEWS = [
  ['front', 1000, 1180, 1.0],
  ['side', 1000, 1180, 1.0],
  ['back', 1000, 1180, 1.0],
  ['q34', 1000, 1180, 1.05],
  ['head', 1000, 1000, 1.0],
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1000, height: 1180 },
  deviceScaleFactor: 1,
});

for (const [view, w, h, zoom] of VIEWS) {
  const url = `${BASE}_probe/figure-3d.html?view=${view}&zoom=${zoom}&w=${w}&h=${h}`;
  await page.setViewportSize({ width: w, height: h });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
  // 等两帧，确保首次渲染完成
  await page.waitForTimeout(420);
  const out = `_probe/${PREFIX}-${view}.png`;
  await page.locator('#c').screenshot({ path: out });
  const n = await page.evaluate(() => window.__meshCount);
  console.log(`saved ${out}  meshes=${n}`);
}

await browser.close();
