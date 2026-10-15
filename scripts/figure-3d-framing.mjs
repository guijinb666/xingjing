// 验证取景：对五个视角逐一检查「主体是否完整落在画面内」+「占画面高比例」。
// 判据全部是数值，不靠看图感觉。
import { chromium } from 'playwright';

const BASE = process.env.XJ_URL || 'http://127.0.0.1:5199/';
const VIEWS = [
  ['front', 1000, 1180, 1.0],
  ['side', 1000, 1180, 1.0],
  ['back', 1000, 1180, 1.0],
  ['q34', 1000, 1180, 1.05],
  ['head', 1000, 1000, 1.0],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1180 } });

console.log('view    coverY  coverX  NDC_y        NDC_x        fits  D');
for (const [view, w, h, zoom] of VIEWS) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE}_probe/figure-3d.html?view=${view}&zoom=${zoom}&w=${w}&h=${h}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
  const r = await page.evaluate(() => {
    const THREE_NS = window.__scene.constructor;
    const root = window.__root;
    const cam = window.__camera;
    root.updateWorldMatrix(true, true);
    // 逐 mesh 世界包围盒角点投影到 NDC，求极值 —— 这是「有没有裁切」的唯一判据
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    const V = new (cam.position.constructor)();
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      for (const cx of [bb.min.x, bb.max.x])
        for (const cy of [bb.min.y, bb.max.y])
          for (const cz of [bb.min.z, bb.max.z]) {
            V.set(cx, cy, cz).applyMatrix4(o.matrixWorld).project(cam);
            minx = Math.min(minx, V.x); maxx = Math.max(maxx, V.x);
            miny = Math.min(miny, V.y); maxy = Math.max(maxy, V.y);
          }
    });
    return { minx, maxx, miny, maxy, camPos: cam.position.toArray(), target: null };
  });
  const coverY = (r.maxy - r.miny) / 2;
  const coverX = (r.maxx - r.minx) / 2;
  const fits = (r.minx >= -1 && r.maxx <= 1 && r.miny >= -1 && r.maxy <= 1) ? 'YES' : 'NO  <-- 裁切';
  console.log(
    `${view.padEnd(7)} ${coverY.toFixed(3)}   ${coverX.toFixed(3)}   ` +
    `[${r.miny.toFixed(3)},${r.maxy.toFixed(3)}] [${r.minx.toFixed(3)},${r.maxx.toFixed(3)}] ` +
    `${fits}  cam=[${r.camPos.map((v) => v.toFixed(2)).join(',')}]`
  );
}
console.log('\nNDC 范围须在 [-1,1] 内；coverY 目标 0.78~0.85');
await browser.close();
