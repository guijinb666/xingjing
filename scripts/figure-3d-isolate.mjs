// 用 playwright 打开 figure-3d.html，隐藏特定部件后再截图，定位「圆鼓」到底是哪个网格。
import { chromium } from 'playwright';

const URL = (process.env.XJ_URL || 'http://127.0.0.1:5199/') + '_probe/figure-3d.html?view=side&zoom=1';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1180 } });
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });

const names = await page.evaluate(() => {
  const out = [];
  const scene = window.__scene || null;
  const root = window.__root || null;
  const walk = (o) => {
    if (!o) return;
    if (o.isMesh) out.push((o.name || '(anon)') + ' | parent=' + (o.parent && o.parent.name));
    (o.children || []).forEach(walk);
  };
  walk(root || scene);
  return out;
});
console.log('--- meshes (' + names.length + ') ---');
console.log(names.join('\n'));

// 只留 figure-body 截图
await page.evaluate(() => {
  const root = window.__root;
  const keep = new Set(['figure-body', 'seated-lotus-figure', 'figure']);
  root.traverse((o) => {
    if (o.isMesh && !keep.has(o.name)) o.visible = false;
  });
});
await page.waitForTimeout(400);
await page.screenshot({ path: '_probe/fig3d-only-body.png' });
console.log('saved _probe/fig3d-only-body.png');

// 只留莲座
await page.evaluate(() => {
  const root = window.__root;
  root.traverse((o) => { if (o.isMesh) o.visible = true; });
  root.traverse((o) => {
    if (o.isMesh && !/lotus|petal|calyx|core/i.test(o.name)) o.visible = false;
  });
});
await page.waitForTimeout(400);
await page.screenshot({ path: '_probe/fig3d-only-lotus.png' });
console.log('saved _probe/fig3d-only-lotus.png');

await browser.close();
