/**
 * 渲染 _probe/figure-live.html（它通过 HTTP 直接 import 线上同一份
 * src/render/silhouette.ts），用于对**当前实现**做目视 + 数值检查。
 * 前提：`vite preview --port 5299` 或 dev server 存活（用 XJ_URL 覆盖）。
 *
 * 用法：node scripts/figure-live-shoot.mjs [outName]
 */
import { chromium } from 'playwright';
import path from 'node:path';

const BASE = process.env.XJ_URL || 'http://127.0.0.1:5199/';
const out = path.join(process.cwd(), '_probe', process.argv[2] || 'figure-live.png');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(BASE + '_probe/figure-live.html', { waitUntil: 'load' });
await page.waitForTimeout(600);
const has = await page.locator('#c').count();
if (!has) {
  console.log('未找到 canvas —— 该地址可能不提供 _probe 目录（vite preview 只服务 dist）。');
  console.log('请改用 dev server，或把 _probe/figure-live.html 复制进 public/。');
  await browser.close();
  process.exit(2);
}
await page.locator('#c').screenshot({ path: out });
await browser.close();
console.log('已输出 ' + out + (errs.length ? ' | 页面错误: ' + errs.join('; ') : ' | 页面错误: 无'));
