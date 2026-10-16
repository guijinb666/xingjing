/**
 * 把 _probe/bake-textures.html 烘焙出的 11 张贴图落盘到 public/textures/，
 * 并写入 manifest.json。
 *
 * 用法：
 *   node scripts/bake-textures.mjs
 *   XJ_URL=http://127.0.0.1:5200/ node scripts/bake-textures.mjs
 *
 * 设计说明：
 *   - 不在页面里读像素做判据（WebGL/canvas 的 getImageData 在合成后被清），
 *     而是让页面把 RGBA 交回来，在 node 侧比对/统计。
 *   - 落盘字节数由本脚本最终 fs.statSync 决定，不采信页面自报的 base64 换算值
 *     （任务书要求报告数字必须与磁盘一致）。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, 'public', 'textures');

const BASE = process.env.XJ_URL ?? 'http://127.0.0.1:5200/';

/** 顺带的编码质量，必须与页面里的 QUALITY 一致 */
const QUALITY = 0.92;

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu',
  ],
});
const page = await browser.newPage({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 1,
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text());
});

const url = new URL('_probe/bake-textures.html', BASE).toString();
console.log('[bake] page =', url);

await page.goto(url, { waitUntil: 'load' });

/*
 * 首帧要同步烘焙 11 张 1024x512 贴图，实测约 7.9s，
 * 加上 webp 编码，给足 300s 上限。
 */
await page.waitForFunction(() => window.__ready === true, null, {
  timeout: 300_000,
});

/* 触发烘焙（页面加载时只挂函数，真正的生成在这里发生） */
console.log('[bake] 开始烘焙…');
const t0 = Date.now();
const baked = await page.evaluate(async () => {
  const r = await window.__bakeAll();
  // dataUrl 体积大（11 张 1024x512 webp base64 约 1~2MB），
  // 直接一次返回即可；分两段拿会重复传输。
  return r;
});
const wallMs = Date.now() - t0;
console.log(`[bake] 页面内完成，挂钟 ${wallMs}ms`);

/* 逐张落盘 */
fs.mkdirSync(OUT_DIR, { recursive: true });

const rows = [];
for (const a of baked.assets) {
  const m = /^data:image\/([a-z]+);base64,(.*)$/s.exec(a.dataUrl);
  if (!m) throw new Error('非法 dataURL：' + a.file);
  const buf = Buffer.from(m[2], 'base64');
  const dest = path.join(OUT_DIR, a.file);
  fs.writeFileSync(dest, buf);

  const st = fs.statSync(dest);
  rows.push({
    file: a.file,
    key: a.key,
    width: a.width,
    height: a.height,
    bytesDisk: st.size,
    bytesPage: a.bytes,
    genMs: a.genMs,
    encMs: a.encMs,
    ms: a.ms,
    alpha: a.alpha,
    mtime: st.mtime.toISOString(),
  });
}

/*
 * manifest.json
 *
 * ★ 结构由 Lead 的 src/render3d/textureManifest.ts 定死：
 *   扁平 key + PascalCase，与程序化版本的 module 级缓存 key 完全一致
 *   （Mercury/Venus/.../Sun/SunGlow/EarthClouds）。
 *   不是我最初以为的 "planet":{ "mercury":{...} } 嵌套小写结构。
 *
 * 注意：运行时是直接 fetch /textures/<file>，**不读这个文件**；
 *   它只作为人类可读元数据 / 校验用。真正的契约是「文件名必须精确、大小写敏感」。
 */
const ASSET_ORDER = [
  'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune',
  'Sun', 'SunGlow', 'EarthClouds',
];

/** 把内部小写 key 映射到契约里的 PascalCase key */
const PASCAL = {
  mercury: 'Mercury', venus: 'Venus', earth: 'Earth', mars: 'Mars',
  jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune',
  sun: 'Sun', sunGlow: 'SunGlow', earthClouds: 'EarthClouds',
};

const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

/* 权威结构：扁平 PascalCase key */
const manifest = {};
for (const k of ASSET_ORDER) {
  const lower = Object.keys(PASCAL).find((x) => PASCAL[x] === k);
  const r = byKey[lower];
  if (!r) throw new Error('缺少资产：' + k);
  manifest[k] = { file: r.file, width: r.width, height: r.height };
}
manifest.meta = {
  quality: QUALITY,
  format: 'webp',
  generatedBy: 'scripts/bake-textures.mjs',
  generatedAt: new Date().toISOString(),
};

const mfPath = path.join(OUT_DIR, 'manifest.json');
fs.writeFileSync(mfPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

/* ---------------- 报告（全部为磁盘实测值） ---------------- */

console.log('\n=== 页面内耗时账单（_probe/tex-bench.html 同口径） ===');
let pageTotal = 0;
for (const r of baked.bill.rows) {
  console.log(
    `${String(r.ms).padStart(9)}ms  ${r.file.padEnd(20)} ${r.w}x${r.h}  ` +
      `(gen ${r.genMs} + enc ${r.encMs})`,
  );
  pageTotal += r.ms;
}
console.log('-'.repeat(60));
console.log(`合计 ${Math.round(pageTotal)}ms（页面内 ${baked.bill.count} 张）`);

console.log('\n=== 磁盘实测 ===');
let total = 0;
for (const r of rows) {
  total += r.bytesDisk;
  const al = r.alpha ? `  alpha<255=${r.alpha.lt255}` : '';
  console.log(
    `${r.file.padEnd(20)} ${String(r.width).padStart(5)}x${String(r.height).padEnd(5)} ` +
      `${String(r.bytesDisk).padStart(9)} B  mtime=${r.mtime}${al}`,
  );
}
const mfSize = fs.statSync(mfPath).size;
console.log(`${'manifest.json'.padEnd(20)} ${''.padStart(11)} ${String(mfSize).padStart(9)} B`);
console.log('-'.repeat(60));
console.log(`11 个贴图合计 ${total} B = ${(total / 1024 / 1024).toFixed(3)} MB`);
console.log(`含 manifest 合计 ${total + mfSize} B = ${((total + mfSize) / 1024 / 1024).toFixed(3)} MB`);
console.log(`预算 2.5MB（2621440 B）→ ${total <= 2621440 ? '通过' : '超限'}`);

console.log('\n=== alpha 专项（任务书要求实测 > 0） ===');
for (const r of rows) {
  if (!r.alpha) continue;
  console.log(
    `${r.file}: total=${r.alpha.total}  alpha<255=${r.alpha.lt255} ` +
      `(${(r.alpha.fracLt255 * 100).toFixed(2)}%)  alpha<128=${r.alpha.lt128}  ` +
      `alpha==0=${r.alpha.zero}  minA=${r.alpha.minA}  maxA=${r.alpha.maxA}`,
  );
}

/* 把机器可读结果落盘给后续核对脚本用 */
const summaryPath = path.join(ROOT, '_shots', 'bake-summary.json');
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(
  summaryPath,
  JSON.stringify(
    {
      base: BASE,
      quality: QUALITY,
      wallMs,
      pageTotalMs: Math.round(pageTotal),
      assetBytesDiskTotal: total,
      manifestBytes: mfSize,
      rows,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
console.log(`\n[bake] 明细已写入 ${summaryPath}`);

await browser.close();
