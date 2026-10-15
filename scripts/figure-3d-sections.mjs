// 数值验证：把 buildFigureGeometry 的截面在若干高度打印出来，直观看清是不是「竖直墙」。
import { chromium } from 'playwright';

const URL = (process.env.XJ_URL || 'http://127.0.0.1:5199/') + '_probe/figure-3d.html?view=side';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });

const out = await page.evaluate(() => {
  const root = window.__root;
  let body = null;
  root.traverse((o) => { if (o.isMesh && o.name === 'figure-body') body = o; });
  if (!body) return { err: 'no body' };
  const g = body.geometry;
  const pos = g.attributes.position;
  // 按 y 分桶，统计每个高度带的 x 极值 / z 极值（注意 body group 已 translate y-0.5）
  const bands = new Map();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = Math.round(y * 100) / 100;
    let b = bands.get(key);
    if (!b) { b = { xmin: 1e9, xmax: -1e9, zmin: 1e9, zmax: -1e9, n: 0 }; bands.set(key, b); }
    b.xmin = Math.min(b.xmin, x); b.xmax = Math.max(b.xmax, x);
    b.zmin = Math.min(b.zmin, z); b.zmax = Math.max(b.zmax, z);
    b.n++;
  }
  const rows = [...bands.entries()].sort((a, b) => b[0] - a[0]).map(([y, b]) => ({
    y: +y, xh: +(((b.xmax - b.xmin) / 2).toFixed(4)),
    zf: +b.zmax.toFixed(4), zb: +b.zmin.toFixed(4),
    depth: +((b.zmax - b.zmin).toFixed(4)), n: b.n,
  }));
  g.computeBoundingBox();
  return { bboxSize: [g.boundingBox.max.x - g.boundingBox.min.x, g.boundingBox.max.y - g.boundingBox.min.y, g.boundingBox.max.z - g.boundingBox.min.z], rows };
});

console.log('rows=' + out.rows.length);
console.log('bboxSize=' + JSON.stringify(out.bboxSize));
console.log('y\txHalf\tzFront\tzBack\tdepth\tn');
for (const r of out.rows) {
  console.log(`${r.y.toFixed(2)}\t${r.xh}\t${r.zf}\t${r.zb}\t${r.depth}\t${r.n}`);
}
await browser.close();
