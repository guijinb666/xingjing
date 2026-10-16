/**
 * 核验 public/textures/ 下已烘焙的资产。
 *
 * 五件事：
 *   1. 11 个文件 + manifest 存在，报字节数（fs 实测）与总字节数。
 *   2. 每个文件重新载入核对 naturalWidth/naturalHeight 与 manifest 一致。
 *   3. alpha 通道实测（含 earth-clouds 必须 non-opaque）。
 *   4. 像素级一致性：烘焙回来的图 vs 现场新生成的 canvas。
 *      ★ 分「不透明区域 / 预乘后 / alpha 通道」三套口径，避免 alpha=0 处
 *        RGB 无意义导致的假阳性（v1 曾因此误报 maxΔ=255）。
 *   5. longtask 实测：在一个**只加载资源、不生成贴图**的页面上量，
 *      否则量到的是核验页自己重新生成贴图的耗时，与运行时无关。
 *
 * 用法：XJ_URL=http://127.0.0.1:5200/ node scripts/verify-textures.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TEX_DIR = path.join(ROOT, 'public', 'textures');
const BASE = process.env.XJ_URL ?? 'http://127.0.0.1:5200/';

const FILES = [
  'mercury.webp', 'venus.webp', 'earth.webp', 'mars.webp',
  'jupiter.webp', 'saturn.webp', 'uranus.webp', 'neptune.webp',
  'sun.webp', 'sun-glow.webp', 'earth-clouds.webp', 'manifest.json',
];

console.log('=== 1. 存在性与磁盘字节数（fs 实测） ===');
let sumTex = 0;
let sumAll = 0;
const missing = [];
for (const f of FILES) {
  const p = path.join(TEX_DIR, f);
  if (!fs.existsSync(p)) {
    missing.push(f);
    console.log(`${f.padEnd(20)} MISSING`);
    continue;
  }
  const st = fs.statSync(p);
  sumAll += st.size;
  if (f.endsWith('.webp')) sumTex += st.size;
  console.log(`${f.padEnd(20)} ${String(st.size).padStart(9)} B  mtime=${st.mtime.toISOString()}`);
}
console.log('-'.repeat(64));
console.log(`11 个贴图合计 ${sumTex} B = ${(sumTex / 1048576).toFixed(3)} MB`);
console.log(`含 manifest 合计 ${sumAll} B = ${(sumAll / 1048576).toFixed(3)} MB`);
console.log(`预算 2.5MB = 2621440 B -> ${sumTex <= 2621440 ? 'PASS' : 'FAIL'}`);
console.log(`缺失文件：${missing.length === 0 ? '无' : missing.join(', ')}`);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

/* 提前声明，供后面落盘与汇总使用 */
let longTaskMax = 0;
let loadRes = [];

/* ---------------- 5. longtask：独立页面，只加载资源 ---------------- */
console.log('\n=== 5. longtask（只加载 public/textures，不生成任何贴图） ===');
{
  const p2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  p2.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await p2.addInitScript(() => {
    window.__longTasks = [];
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__longTasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
        }
      });
      po.observe({ entryTypes: ['longtask'] });
    } catch (e) {
      window.__longTaskError = String(e);
    }
    /* 资源加载计时 */
    window.__resTimes = [];
  });

  await p2.goto(new URL('_probe/tex-loadonly.html', BASE).toString(), { waitUntil: 'load' });
  await p2.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  /* 多等一会，让 PerformanceObserver 把 longtask 都投递完 */
  await p2.waitForTimeout(1500);

  const lt = await p2.evaluate(() => window.__longTasks ?? []);
  const res = await p2.evaluate(() => window.__resTimed ?? []);

  console.log(`加载 ${res.length} 个资源：`);
  for (const r of res) {
    console.log(
      `  ${r.file.padEnd(20)} decode=${String(r.decodeMs).padStart(7)}ms  ` +
        `${r.w}x${r.h}  transferSize=${r.transferSize} B  dur=${r.dur}ms`,
    );
  }
  const decodeSum = res.reduce((s, r) => s + r.decodeMs, 0);
  console.log(`解码合计 ${Math.round(decodeSum)}ms（最慢 ${Math.round(Math.max(...res.map((r) => r.decodeMs)))}ms）`);

  if (lt.length === 0) {
    console.log('未观测到 longtask（最大长任务 0ms）');
  } else {
    for (const t of lt) console.log(`  start=${t.start}ms  dur=${t.dur}ms`);
  }
  console.log(`最大长任务 = ${lt.length ? Math.max(...lt.map((t) => t.dur)) : 0}ms`);

  fs.mkdirSync(path.join(ROOT, '_shots'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, '_shots', 'tex-loadonly.json'),
    JSON.stringify({ base: BASE, res, longTasks: lt }, null, 2) + '\n',
    'utf8',
  );
  await p2.close();

  longTaskMax = lt.length ? Math.max(...lt.map((t) => t.dur)) : 0;
  loadRes = res;
}

/* ---------------- 2/3/4. 核验页 ---------------- */
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const url = new URL('_probe/verify-textures.html', BASE).toString();
console.log('\n[verify] page =', url);
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });

console.log('[verify] 逐张核验（含与现场生成 canvas 的逐像素比对）…');
const t0 = Date.now();
const results = await page.evaluate(() => window.__verify2());
console.log(`[verify] 完成，挂钟 ${Date.now() - t0}ms`);

console.log('\n=== 2. 尺寸核对 ===');
let allSizeOk = true;
for (const r of results) {
  if (!r.sizeOk) allSizeOk = false;
  console.log(
    `${r.file.padEnd(20)} natural=${r.naturalWidth}x${r.naturalHeight}  ` +
      `manifest=${r.wantW}x${r.wantH}  ${r.sizeOk ? 'OK' : 'BAD'}`,
  );
}
console.log(`尺寸全部一致：${allSizeOk ? '是' : '否'}`);

console.log('\n=== 3/4. alpha 通道 + 像素级一致性（三套口径） ===');
console.log(
  'file'.padEnd(20) +
    'opaquePx'.padStart(10) +
    '  opaqueMaxΔ  opaquePSNR'.padStart(24) +
    '  premulMaxΔ  premulPSNR'.padStart(24) +
    '  alphaMaxΔ'.padStart(11),
);
console.log('-'.repeat(112));
const r3 = (v) => Math.round(v * 1000) / 1000;
for (const r of results) {
  const c = r.cmp;
  console.log(
    r.file.padEnd(20) +
      String(c.opaqueN).padStart(10) +
      `  ${String(c.opaque.maxD).padStart(10)}  ${String(c.opaque.psnr).padStart(10)}` +
      `  ${String(r3(c.premul.maxD)).padStart(10)}  ${String(c.premul.psnr).padStart(10)}` +
      `  ${String(c.alphaOnly.maxD).padStart(10)}`,
  );
}
console.log('-'.repeat(112));

console.log('\n（对照）原始 RGBA 逐通道口径 —— v1 误报的来源，不透明处才是真差异：');
for (const r of results) {
  console.log(
    `${r.file.padEnd(20)} rawMaxΔ=${String(r.cmp.raw.maxD).padStart(3)}  ` +
      `rawDiffPx=${(r.cmp.raw.diffPct * 100).toFixed(2)}%  ` +
      `alpha==0 像素=${r.cmp.bothTransN}`,
  );
}

console.log('\n=== alpha 通道实测（webp 解码后） ===');
/* 单独再取一次 alpha 统计 */
for (const r of results) {
  const c = r.cmp;
  console.log(
    `${r.file.padEnd(20)} alphaMaxΔ=${String(c.alphaOnly.maxD).padStart(3)}  ` +
      `alphaPSNR=${String(c.alphaOnly.psnr).padStart(9)}`,
  );
}

console.log('\n=== 一致性结论 ===');
const worstPremul = results.reduce((a, b) =>
  (a.cmp.premul.psnr === 'Infinity' ? Infinity : a.cmp.premul.psnr) <=
  (b.cmp.premul.psnr === 'Infinity' ? Infinity : b.cmp.premul.psnr)
    ? a
    : b,
);
console.log(
  `预乘口径最低 PSNR = ${worstPremul.cmp.premul.psnr} dB（${worstPremul.file}）`,
);
const worstOpaque = results.reduce((a, b) =>
  (a.cmp.opaque.psnr === 'Infinity' ? Infinity : a.cmp.opaque.psnr) <=
  (b.cmp.opaque.psnr === 'Infinity' ? Infinity : b.cmp.opaque.psnr)
    ? a
    : b,
);
console.log(
  `不透明区域最低 PSNR = ${worstOpaque.cmp.opaque.psnr} dB（${worstOpaque.file}）` +
    `，最大通道差 = ${worstOpaque.cmp.opaque.maxD}`,
);
const alphaWorst = results.reduce((a, b) =>
  a.cmp.alphaOnly.maxD >= b.cmp.alphaOnly.maxD ? a : b,
);
console.log(
  `alpha 通道最大差 = ${alphaWorst.cmp.alphaOnly.maxD}（${alphaWorst.file}）`,
);

const outPath = path.join(ROOT, '_shots', 'verify-textures.json');
fs.writeFileSync(
  outPath,
  JSON.stringify(
    { base: BASE, diskBytesTotal: sumTex, diskBytesWithManifest: sumAll,
      results, longTaskMax, loadRes, missing },
    null,
    2,
  ) + '\n',
  'utf8',
);
console.log(`\n[verify] 明细已写入 ${outPath}`);
console.log(`[verify] longtask 最大 = ${longTaskMax}ms`);

await browser.close();
