/**
 * 把 _probe/figure-lab*.html 渲染成 PNG，用于直接目视比较候选造型。
 * 用法：node scripts/figure-lab-shoot.mjs [lab3] [outName]
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const which = process.argv[2] || 'figure-lab';
const outName = process.argv[3] || `${which}.png`;
const src = path.join(ROOT, '_probe', `${which}.html`);
const out = path.join(ROOT, '_probe', outName);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 780 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(pathToFileURL(src).href, { waitUntil: 'load' });
await page.waitForTimeout(400);
await page.locator('#c').screenshot({ path: out });
await browser.close();
console.log('已输出 ' + out + (errs.length ? ' | 页面错误: ' + errs.join('; ') : ' | 页面错误: 无'));
