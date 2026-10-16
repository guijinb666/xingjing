/**
 * 跑 _probe/diag-earth.html，定位「同一个 webp 用不同解码路径取 RGBA」是否会产生差异。
 */
import { chromium } from 'playwright';

const BASE = process.env.XJ_URL ?? 'http://127.0.0.1:5200/';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(new URL('_probe/diag-earth.html', BASE).toString(), { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120_000 });

const rows = await page.evaluate(() => window.__rows);
console.log('=== earth.webp 不同解码路径的 RGBA 差异 ===');
for (const r of rows) {
  console.log(
    `${r.name.padEnd(28)} maxΔ=${String(r.maxD).padStart(4)}  ` +
      `diff=${(r.diffPct * 100).toFixed(2)}%  PSNR=${r.psnr}`,
  );
}

await browser.close();
