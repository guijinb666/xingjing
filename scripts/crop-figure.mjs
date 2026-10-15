/**
 * 从 _shots/03-inner-spin.png 里裁出人形区域并放大，用于目视细节。
 * 用法：node scripts/crop-figure.mjs [scale] [outName]
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const scale = Number(process.argv[2] || 3);
const outName = process.argv[3] || 'figure-zoom.png';
const src = path.join(ROOT, '_shots', '03-inner-spin.png');
const out = path.join(ROOT, '_probe', outName);

// 人形包围盒（由 figure-measure.mjs 报出）留些余量
const BOX = { x: 540, y: 270, w: 370, h: 425 };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(src).href, { waitUntil: 'load' });
await page.waitForTimeout(200);
await page.evaluate(
  ({ box, scale }) => {
    const im = document.querySelector('img');
    document.body.innerHTML = '';
    document.body.style.margin = '0';
    document.body.style.background = '#07080b';
    const c = document.createElement('canvas');
    c.id = 'z';
    c.width = Math.round(box.w * scale);
    c.height = Math.round(box.h * scale);
    c.style.display = 'block';
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(im, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
    document.body.appendChild(c);
  },
  { box: BOX, scale },
);
await page.locator('#z').screenshot({ path: out });
await browser.close();
console.log('已输出 ' + out);
