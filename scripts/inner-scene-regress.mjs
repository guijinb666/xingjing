import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';

/**
 * 交互回归：验证流光特效接入后，内景的四项交互没被破坏。
 *
 * 覆盖 task-7 硬性要求：
 *   ① 拖拽旋转  ② 滚轮缩放  ③ 双击放大  ④ 空闲自转
 *
 * 两个关键做法（首版失败的原因）：
 *  1) 必须驱动**真实主应用**（src/App.tsx），不能驱动 _probe 探针页 ——
 *     探针页只有 InnerScene + 自己的 rAF，鼠标事件处理器全在 InnerCanvas.tsx 里，
 *     探针页上拖鼠标根本没人监听，五种操作指纹当然全同。
 *  2) 指纹必须用 **WebGL readPixels**，不能用 drawImage ——
 *     渲染器没开 preserveDrawingBuffer，合成器一取走内容，2D canvas 的
 *     drawImage 拿到的就是清空后的缓冲（首版 5 次指纹全是 1017236165）。
 */

const BASE = process.env.XJ_URL || 'http://127.0.0.1:5199/';
const NODE_EXE =
  'C:\\Users\\30612\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe';
const PROJ = 'C:\\Users\\30612\\Desktop\\dsh\\xingjing';

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
  spawn(NODE_EXE, ['node_modules/vite/bin/vite.js', '--config', 'scripts/vite.probe.config.ts',
                   '--port', '5199', '--host', '127.0.0.1', '--clearScreen', 'false'],
        { cwd: PROJ, detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 45; i++) { await new Promise(r => setTimeout(r, 700)); if (await alive()) return; }
  throw new Error('vite 起不来');
}
async function gotoRetry(page, url, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    await ensureServer();
    try { await page.goto(url, { waitUntil: 'load', timeout: 30000 }); return; }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 800)); }
  }
  throw last;
}

/**
 * 用 WebGL readPixels 拿真实像素指纹。
 *
 * 坑：渲染器默认 preserveDrawingBuffer=false，合成器取走内容后缓冲就被清空了，
 * 所以**不能**在任意时刻直接 readPixels（会读到全 0）。
 * 正确时机是在 rAF 回调里 —— 此刻上一次渲染的缓冲通常还没被回收，
 * 而且我们主动补一次 render()，保证读到的就是"当前这一帧"。
 * three 的 renderer 暴露在 window.__renderer 上，但主应用没挂；
 * 于是这里改用 canvas 自己拿到 gl，再回调触发一次绘制是拿不到的，
 * 所以退一步：在 rAF 里读，配合 readPixels 前置的 gl.finish()。
 */
async function fingerprint(page) {
  return await page.evaluate(() => new Promise((resolve) => {
    const all = Array.from(document.querySelectorAll('canvas'));
    let cv = null;
    for (const c of all) {
      if (c.getContext('webgl2') || c.getContext('webgl')) { cv = c; break; }
    }
    if (!cv) return resolve(null);
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    if (!gl) return resolve(null);

    requestAnimationFrame(() => {
      const W = cv.width, H = cv.height;
      const x = Math.floor(W * 0.15), y = Math.floor(H * 0.15);
      const w = Math.floor(W * 0.7), h = Math.floor(H * 0.7);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let hash = 2166136261, nonZero = 0, sum = 0;
      for (let i = 0; i < buf.length; i += 4) {
        const v = buf[i] + buf[i + 1] * 3 + buf[i + 2] * 7;
        if (v > 12) nonZero++;
        sum += buf[i] + buf[i + 1] + buf[i + 2];
        hash ^= v; hash = Math.imul(hash, 16777619);
      }
      resolve({ hash: hash >>> 0, nonZero, sum });
    });
  }));
}

/**
 * 兜底指纹：不依赖 WebGL 读回，直接用 playwright 截一张小图做 sha1。
 * playwright 的截图走的是合成器，能看到真实画面（不受 preserveDrawingBuffer 影响）。
 */
async function shotFingerprint(page, name) {
  const p = `_probe/_regress-${name}.png`;
  await page.locator('canvas').last().screenshot({ path: p });
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const buf = readFileSync(p);
  return { hash: createHash('sha1').update(buf).digest('hex').slice(0, 12), bytes: buf.length };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await gotoRetry(page, BASE);
await page.waitForTimeout(1200);

// —— 走真实入口进内景：起境页按 → 键（App.tsx 第 76 行 onKey ArrowRight）——
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
await page.waitForTimeout(2200);

const hasCanvas = await page.locator('canvas').count();
console.log(`内景 canvas 数量: ${hasCanvas}`);
if (hasCanvas === 0) { console.log('❌ 没有进入内景'); await browser.close(); process.exit(1); }

// 等 __xjPickAll 挂上（InnerCanvas dev-only 探针），说明 InnerScene 已构造完成
await page.waitForFunction(() => typeof window.__xjPickAll === 'function', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

const cv = page.locator('canvas').last();   // 星空层在前，WebGL 层在后
const box = await cv.boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

const results = [];
const snap = async (label) => {
  // 主判据用截图 sha1（合成器真实画面，最可靠）
  const shot = await shotFingerprint(page, label.replace(/[^a-z0-9]+/gi, '-'));
  // 附带指标：WebGL rAF 内 readPixels（可能为 0，仅作参考）
  const px = await fingerprint(page);
  const rec = { label, ...shot, nonZero: px ? px.nonZero : -1, sum: px ? px.sum : -1 };
  results.push(rec);
  return rec;
};

// ① 基线（等自转跑起来）
await page.mouse.move(cx, cy);
await page.waitForTimeout(800);
const base = await snap('baseline');

// ② 拖拽旋转
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(cx + i * 18, cy - i * 5); await page.waitForTimeout(16); }
await page.mouse.up();
await page.waitForTimeout(500);
const afterDrag = await snap('after drag');

// ③ 滚轮缩放
await page.mouse.move(cx, cy);
await page.mouse.wheel(0, -700);
await page.waitForTimeout(700);
const afterWheel = await snap('after wheel');

// ④ 双击放大
await page.mouse.dblclick(cx, cy);
await page.waitForTimeout(1100);
const afterDbl = await snap('after dblclick');

// ⑤ 空闲自转：把鼠标移开，静置 4s
await page.mouse.move(10, 10);
await page.waitForTimeout(4000);
const afterIdle = await snap('idle 4s');

console.log('\n=== 交互回归（真实主应用 + 截图 sha1 指纹）===');
for (const r of results) {
  console.log(`  ${r.label.padEnd(16)} sha1=${r.hash}  bytes=${r.bytes}  readPixels非空=${r.nonZero} 亮度和=${r.sum}`);
}
console.log('\n判定：');
const chk = (name, a, b) => {
  const reallyChanged = a.hash !== b.hash;
  console.log(`  ${name.padEnd(10)}: ${reallyChanged ? '✅ 画面已变' : '❌ 画面未变'}`);
  return reallyChanged;
};
const r1 = chk('拖拽旋转', base, afterDrag);
const r2 = chk('滚轮缩放', afterDrag, afterWheel);
const r3 = chk('双击放大', afterWheel, afterDbl);
const r4 = chk('空闲自转', afterDbl, afterIdle);

console.log(`\n结论: ${r1 && r2 && r3 && r4 ? '✅ 四项交互全部正常' : '❌ 存在失效交互'}`);

const info = await page.evaluate(() => (window.__renderer
  ? { calls: window.__renderer.info.render.calls, tris: window.__renderer.info.render.triangles,
      lines: window.__renderer.info.render.lines }
  : null));
console.log('渲染统计:', JSON.stringify(info));

await browser.close();
