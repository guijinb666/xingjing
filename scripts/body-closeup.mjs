/**
 * 内景人体特写：进入内景后把相机拉到最近，拍人体大图，供逐项目视校对。
 *
 * 用法：XJ_URL=http://127.0.0.1:5299/ node scripts/body-closeup.mjs [倍率]
 * 输出：_shots/body-closeup.png（原始视口）、_probe/body-closeup-zoom.png（裁切放大）
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.XJ_URL ?? 'http://127.0.0.1:5199/';
const SHOTS = 'C:/Users/30612/Desktop/dsh/xingjing/_shots';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1080 },
  deviceScaleFactor: 2, // 2× 采样，人体细节看得清
});

const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.click('.primary-button');
await page.waitForTimeout(2600);

// 拉近：滚轮反复上滚到限位，让相机贴到人体跟前
const box = await page.locator('.inner-canvas').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
for (let i = 0; i < 12; i++) {
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(90);
}
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOTS}/body-closeup.png` });

// 旋转两个角度各拍一张，便于判断纵深与对称性
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 300, cy + 40, { steps: 22 });
await page.mouse.up();
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOTS}/body-closeup-side.png` });

console.log('运行时错误:', errors.length ? errors.join('\n') : '无');
await browser.close();
