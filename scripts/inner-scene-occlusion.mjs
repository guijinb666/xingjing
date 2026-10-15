import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

/**
 * task-13 精确验证：把被遮挡节点连同它的**屏幕坐标**一起取回来，
 * 然后在同一张截图里裁剪该坐标处，做"遮挡 vs 未遮挡"的同位置对照。
 *
 * 上一版脚本的错：从诊断数据里硬编码屏幕坐标去裁图 ——
 * 但节点随相机公转**会移动**，az=3.14 的坐标拿去裁 az=0.4 的图，
 * 裁到的是完全不同的东西（所以出现"被挡的反而更亮"的荒谬结果）。
 * 正确做法：每次渲染后**当场**读回该节点投影后的屏幕坐标，再裁。
 */

const NODE_EXE =
  'C:\\Users\\30612\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe';
const PROJ = 'C:\\Users\\30612\\Desktop\\dsh\\xingjing';
const BASE = process.env.XJ_URL || 'http://127.0.0.1:5199/';

async function alive() {
  try { const r = await fetch(BASE, { signal: AbortSignal.timeout(4000) }); return r.status === 200; }
  catch { return false; }
}
async function ensureServer() {
  if (await alive()) return;
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | ` +
      `Where-Object { $_.CommandLine -like '*vite*5199*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
      { stdio: 'ignore' });
  } catch {}
  spawn(NODE_EXE, ['node_modules/vite/bin/vite.js', '--port', '5199', '--host', '127.0.0.1', '--strictPort'],
        { cwd: PROJ, detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 45; i++) { await new Promise(r => setTimeout(r, 700)); if (await alive()) return; }
  throw new Error('vite 起不来');
}

async function gotoRetry(page, url, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    await ensureServer();
    try { await page.goto(url, { waitUntil: 'load', timeout: 30000 }); return; }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 900)); }
  }
  throw last;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
await gotoRetry(page, `${BASE}_probe/inner-scene.html?w=1000&h=1000`);
await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
await page.waitForTimeout(500);

/** 渲染指定视角，返回被挡节点 + 全部节点的屏幕坐标 */
async function renderAt(az, dist) {
  return await page.evaluate(([az, dist]) => {
    const s = window.__scene;
    s.autoSpin = false;
    s.azimuth = az;
    s.distance = dist;
    window.__step(300, 1 / 60);
    const cam = s.camera;
    cam.updateMatrixWorld();
    const rows = s.orbiting.map((n) => {
      const wp = n.sprite.getWorldPosition(new n.sprite.position.constructor());
      const ndc = wp.clone().project(cam);
      return {
        id: n.src.id,
        name: n.src.name,
        opacity: +n.sprite.material.opacity.toFixed(3),
        sx: Math.round(((ndc.x + 1) / 2) * 1000),
        sy: Math.round(((1 - ndc.y) / 2) * 1000),
        viewZ: +wp.clone().applyMatrix4(cam.matrixWorld.clone().invert()).z.toFixed(3),
      };
    });
    return { rows, occ: s.lastOccluded.map((o) => ({ ...o })), figZ: -s.distance };
  }, [az, dist]);
}

const SHOTS = [
  { tag: 'a', az: 0.4, file: 'occl-a-front.png' },
  { tag: 'b', az: Math.PI, file: 'occl-b-behind.png' },
  { tag: 'c', az: Math.PI * 2, file: 'occl-c-rotated.png' },
];

const out = {};
for (const s of SHOTS) {
  const r = await renderAt(s.az, 6.4);
  await page.locator('#c').screenshot({ path: `_probe/${s.file}` });
  out[s.tag] = { ...s, ...r };
  console.log(`\n【${s.tag}】az=${s.az.toFixed(3)}  被挡 ${r.occ.length} 个: ` +
    r.occ.map((o) => `${o.name}(${o.factor.toFixed(3)})`).join(', ') || '无');
  for (const row of r.rows) {
    if (r.occ.some((o) => o.id === row.id)) {
      console.log(`    · ${row.name.padEnd(5)} id=${row.id.padEnd(11)} opacity=${row.opacity}  ` +
        `屏幕=(${row.sx},${row.sy})  viewZ=${row.viewZ} (人体平面 ${r.figZ})`);
    }
  }
}

// —— 同位置对照：同一个节点，在 b（被挡）与 c（恢复）中的屏幕坐标 ——
console.log(`\n${'='.repeat(72)}`);
console.log('【同节点跨视角对照】b 里被挡的节点，在 c 里的坐标与不透明度');
const cmp = {};
for (const o of out.b.occ) {
  const inB = out.b.rows.find((r) => r.id === o.id);
  const inC = out.c.rows.find((r) => r.id === o.id);
  cmp[o.id] = { name: o.name, b: inB, c: inC };
  console.log(`  · ${o.name} (${o.id})`);
  console.log(`      b: 不透明=${inB.opacity} 屏幕=(${inB.sx},${inB.sy}) viewZ=${inB.viewZ}  ← 在人体后方，应减淡`);
  console.log(`      c: 不透明=${inC.opacity} 屏幕=(${inC.sx},${inC.sy}) viewZ=${inC.viewZ}  ← 已转到前方，应满亮`);
}

writeFileSync('_probe/_occl-precise.json', JSON.stringify({ shots: out, compare: cmp }, null, 2), 'utf8');
console.log('\n精确数据已写入 _probe/_occl-precise.json');
await browser.close();
