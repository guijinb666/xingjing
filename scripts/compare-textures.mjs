/**
 * 目视核验：并排图 + 差异热力图。
 *
 * 教训（本脚本 v1 的 bug）：
 *   `page.$('#panel')` 返回的 elementHandle 在页面内容被 JS 重写后，
 *   `el.screenshot()` 有时会拿到**上一帧**的合成结果，
 *   导致 cmp-*.png 与 diff-*.png 字节完全相同（sha256 一样），
 *   于是「差异热力图」实际是把并排图又拍了一遍。
 *   修法：每次截图前显式 `page.waitForTimeout` + 用 `page.screenshot({clip})`
 *   而不是 element handle；并让页面把「当前显示的是哪张」写到 DOM 上，
 *   截图前 assert 一次，避免拍到陈旧帧。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, '_shots', 'verify');

/* 清掉旧图，避免把陈旧结果误当新结果 */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.XJ_URL ?? 'http://127.0.0.1:5200/';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1420, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(new URL('_probe/compare-textures.html', BASE).toString(), { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120_000 });

/*
 * 注意：必须在页面已经渲染出内容之后再量 #panel 的高度。
 * v2 的 bug 就是在只显示 "ready" 时量的，得到 62px 的窄条。
 */
const measure = async () =>
  page.evaluate(() => {
    const r = document.getElementById('panel').getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(r.x)),
      y: Math.max(0, Math.floor(r.y)),
      width: Math.ceil(r.width),
      height: Math.ceil(r.height),
    };
  });

const shot = async (name) => {
  /* 等两帧，确保 DOM 变更已合成 */
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const box = await measure();
  const p = path.join(OUT, name);
  await page.screenshot({ path: p, clip: box });
  return p;
};

const files = await page.evaluate(() => window.__cmpFiles);
for (const f of files) {
  /* 页面把当前文件写在 dataset 上，截图前核对，杜绝拍到陈旧帧 */
  await page.evaluate((file) => window.__show(file), f);
  await page.waitForFunction((file) => window.__curFile === file, f, { timeout: 20_000 });
  await shot(`cmp-${f.replace(/\.webp$/, '')}.png`);
  const d = await page.evaluate(() => window.__lastDiff);
  console.log(
    `cmp ${f.padEnd(20)} maxΔ=${String(d.maxD).padStart(3)}  ` +
      `diffPx=${(d.diffPct * 100).toFixed(2)}%  PSNR=${d.psnr}  ` +
      `>32=${d.over32}  >64=${d.over64}`,
  );
}

await browser.close();
console.log('\n输出目录', OUT);
console.log('（每张 cmp-*.png 右侧第三栏就是差异热力图）');
