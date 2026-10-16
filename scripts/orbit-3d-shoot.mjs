/**
 * 星轨 three.js 探针截图。
 *
 * 用法：
 *   node scripts/orbit-3d-shoot.mjs [baseUrl]
 *
 * baseUrl 默认 `http://127.0.0.1:5199/`（可用环境变量 XJ_URL 覆盖）。
 * 输出目录：`_shots/`（与 scripts 同级项目根下）。
 *
 * 覆盖三类取景：
 *   · 远景 wide        —— 全轨道系统 + 太阳 + 标签
 *   · 中景 mid         —— 内行星详细、外行星仍可见
 *   · 近景 close-*     —— 逐颗行星占屏（木星条带+大红斑、土星环缝隙…
 *                        这些细节必须在这个距离才看得见）
 * 另外用 playwright 真实模拟滚轮，验证「缩放确实改变相机距离」并打印前后数值。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', '_shots');
mkdirSync(OUT, { recursive: true });

const BASE = process.env.XJ_URL || process.argv[2] || 'http://127.0.0.1:5199/';
const PAGE = new URL('_probe/orbit-3d.html', BASE).toString();

/** 远景 / 中景 / 近景全部取景 */
const SHOTS = [
  { name: '01-wide', view: 'wide', days: 0 },
  { name: '02-mid', view: 'mid', days: 40 },
  { name: '03-close-sun', view: 'close-sun', days: 0 },
  { name: '04-close-mercury', view: 'close-mercury', days: 0 },
  { name: '05-close-venus', view: 'close-venus', days: 0 },
  { name: '06-close-earth', view: 'close-earth', days: 0 },
  { name: '07-close-mars', view: 'close-mars', days: 0 },
  { name: '08-close-jupiter', view: 'close-jupiter', days: 0 },
  { name: '09-close-saturn', view: 'close-saturn', days: 0 },
  { name: '10-close-uranus', view: 'close-uranus', days: 0 },
  { name: '11-close-neptune', view: 'close-neptune', days: 0 },
];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const report = [];

for (const s of SHOTS) {
  const url = `${PAGE}?view=${s.view}&days=${s.days}&shoot=1`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
  // 等入场动画走完 + 纹理稳定
  await page.waitForFunction(() => window.__frames > 30, { timeout: 30000 });
  await page.waitForTimeout(500);

  const file = resolve(OUT, `orbit-3d-${s.name}.png`);
  await page.locator('#c').screenshot({ path: file });

  const info = await page.evaluate(() => ({
    distance: window.__distance,
    meshCount: window.__meshCount,
    ringBands: window.__ringBands,
    cameraPos: [
      window.__camera.position.x,
      window.__camera.position.y,
      window.__camera.position.z,
    ].map((v) => Number(v.toFixed(1))),
  }));

  report.push({ shot: s.name, view: s.view, days: s.days, ...info });
  console.log(
    `${s.name.padEnd(18)} dist=${String(Math.round(info.distance)).padStart(5)}` +
      `  mesh=${String(info.meshCount).padStart(3)}  ringBands=${info.ringBands}` +
      `  cam=[${info.cameraPos.join(', ')}]`,
  );
}

/* ================================================================
 * 缩放验证：真实滚轮事件 → 相机距离必须变化
 * ================================================================ */
console.log('\n=== 缩放验证（真实滚轮事件） ===');

async function readDist() {
  return page.evaluate(() => window.__distance);
}

await page.goto(`${PAGE}?view=wide&days=0&shoot=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
await page.waitForFunction(() => window.__frames > 30, { timeout: 30000 });
await page.waitForTimeout(300);

const box = await page.locator('#c').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

const d0 = await readDist();
console.log(`初始相机距离            = ${d0.toFixed(1)}`);

// 向下滚 12 格 = 推远
await page.mouse.move(cx, cy);
for (let i = 0; i < 12; i++) {
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(45);
}
await page.waitForTimeout(900); // 等惯性滑完
const d1 = await readDist();
console.log(`滚轮推远 12 格后距离     = ${d1.toFixed(1)}   (Δ=${(d1 - d0).toFixed(1)})`);

// 向上滚 30 格 = 拉近
for (let i = 0; i < 30; i++) {
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(45);
}
await page.waitForTimeout(900);
const d2 = await readDist();
console.log(`滚轮拉近 30 格后距离     = ${d2.toFixed(1)}   (Δ=${(d2 - d1).toFixed(1)})`);

// 一路拉到底，确认能到 MIN_DISTANCE（单颗行星占满屏幕）
for (let i = 0; i < 60; i++) {
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(18);
}
await page.waitForTimeout(700);
const dMin = await readDist();
const minDist = await page.evaluate(() => window.__MIN_DISTANCE);
const maxDist = await page.evaluate(() => window.__MAX_DISTANCE);
console.log(`连续拉近到底后距离       = ${dMin.toFixed(1)}   (MIN_DISTANCE=${minDist})`);

await page.locator('#c').screenshot({ path: resolve(OUT, 'orbit-3d-12-zoomed-in.png') });

// 一路推到底
for (let i = 0; i < 80; i++) {
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(18);
}
await page.waitForTimeout(900);
const dMax = await readDist();
console.log(`连续推远到底后距离       = ${dMax.toFixed(1)}   (MAX_DISTANCE=${maxDist})`);

/* —— 双击聚焦验证 —— */
console.log('\n=== 双击聚焦验证 ===');
await page.goto(`${PAGE}?view=wide&days=0&shoot=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
await page.waitForFunction(() => window.__frames > 30, { timeout: 30000 });
await page.waitForTimeout(300);

const dBefore = await readDist();
// 找到木星在屏幕上的位置并双击
const jup = await page.evaluate(() => {
  const s = window.__orbit;
  const p = s.planetRestPosition('Jupiter');
  const w = window.innerWidth;
  const h = window.innerHeight;
  const proj = s.projectToScreen(p, w, h);
  return proj;
});
console.log(`木星屏幕坐标            = (${jup.x.toFixed(0)}, ${jup.y.toFixed(0)})`);
await page.mouse.click(jup.x, jup.y);
await page.waitForTimeout(90);
await page.mouse.click(jup.x, jup.y);
await page.waitForTimeout(1600);
const dAfter = await readDist();
console.log(`双击木星前相机距离       = ${dBefore.toFixed(1)}`);
console.log(`双击木星后相机距离       = ${dAfter.toFixed(1)}   (Δ=${(dAfter - dBefore).toFixed(1)})`);
await page.locator('#c').screenshot({ path: resolve(OUT, 'orbit-3d-13-dblclick-jupiter.png') });

console.log('\n=== 汇总 ===');
console.log(JSON.stringify(report, null, 2));

await browser.close();
