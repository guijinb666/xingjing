// 纵向比例核对：把渲染体的关键 y 位置与参考图口径对齐，找出「矮胖」的量化来源。
import { chromium } from 'playwright';

const URL = (process.env.XJ_URL || 'http://127.0.0.1:5199/') + '_probe/figure-3d.html?view=front';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1180 } });
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });

const info = await page.evaluate(() => {
  const root = window.__root;
  const out = {};
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    if (!out[o.name]) out[o.name] = [];
    out[o.name].push({
      y: [+bb.min.y.toFixed(4), +bb.max.y.toFixed(4)],
      x: [+bb.min.x.toFixed(4), +bb.max.x.toFixed(4)],
      z: [+bb.min.z.toFixed(4), +bb.max.z.toFixed(4)],
    });
  });
  const rootBB = new (window.__root.constructor)();
  // 直接遍历求全局包围盒（用 Object3D 的 updateWorldMatrix）
  root.updateWorldMatrix(true, true);
  return { out, note: 'local bboxes; group translate y-0.5 not applied' };
});

for (const k of ['figure-body', 'sternum', 'rib-00-l', 'rib-11-l', 'spine-seg-00', 'spine-seg-23', 'nose', 'chin', 'palm', 'thumb', 'arm-l', 'finger-0']) {
  if (info.out[k]) console.log(k.padEnd(14), JSON.stringify(info.out[k][0]));
}
await browser.close();
