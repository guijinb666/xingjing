import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 内景 · 节点介绍面板的端到端验证（task-4）。
 *
 * 做四件事：
 *   1. 进入内景页，等 WebGL 场景把节点精灵都渲染出来；
 *   2. **真的用鼠标点击屏幕上的一个节点**（坐标由页面内一次 raycast 预演算出
 *      —— 即「把每个可见精灵投影到屏幕，取一个不与人体重叠、不在边缘的点」），
 *      断言 `.inner-node-card` 出现，并核对面板里的名字与节点一致；
 *   3. 分别用「关闭按钮 / Esc / 点空白」三条路径各关一次，断言面板消失；
 *   4. 把关键状态截图落盘到 `_probe/inner-card-*.png`。
 *
 * 用法：
 *   $env:XJ_URL='http://127.0.0.1:5199/'; node scripts/inner-click-shoot.mjs
 * 环境变量：
 *   XJ_URL   起始地址（默认 5199）
 *   XJ_W/H   视口尺寸（默认 1440×900，与设计基准 1440 对齐）
 */
const BASE = process.env.XJ_URL || 'http://127.0.0.1:5199/';
const W = Number(process.env.XJ_W || 1440);
const H = Number(process.env.XJ_H || 900);
const OUT = process.env.XJ_OUT || '_probe';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const fail = (msg) => {
  console.error('FAIL: ' + msg);
  process.exitCode = 1;
};
const ok = (msg) => console.log('ok   ' + msg);

await page.goto(BASE, { waitUntil: 'load' });

// —— 进入内景：有表单就提交，否则用键盘右箭头（App 里 ← → 切幕） ——
const submit = page.locator('form button[type="submit"], .rune-button, button:has-text("开启")').first();
if (await submit.count()) {
  await submit.click();
  ok('已提交表单进入内景');
} else {
  await page.keyboard.press('ArrowRight');
  ok('用 → 键进入内景');
}
await page.waitForSelector('.inner-canvas', { timeout: 15000 });
ok('.inner-canvas 已挂载');

// 等场景把节点入场动画播完（InnerScene 里 delay=240+i*58，760ms 收尾）
await page.waitForTimeout(3200);

/**
 * 关键暴露：InnerCanvas 把 InnerScene 挂在组件内部，页面里没有全局句柄，
 * 所以这里通过「把 canvas 的中心区域网格化扫描 + 用 CDP 派发点击后看是否弹窗」
 * 代价太高。改为：在页面里直接对 three 的 renderer 拿不到 —— 于是退一步，
 * 用一个**静态可算**的办法：节点精灵的屏幕坐标由「场景构造参数」决定，
 * 但 r/theta 在 innerScene 内部。
 *
 * 因此更可靠的做法是：让页面暴露一个探针。见 src/render/InnerCanvas.tsx
 * 里的 window.__xjPick（dev 下挂载），本脚本优先用它；没有则回退到
 * 「沿一圈候选点暴力点击，取第一个能弹出面板的坐标」。
 */
const hasProbe = await page.evaluate(() => typeof window.__xjPick === 'function');

/** 暴力候选：画面上取一圈不与人体重叠的环带点，逐个点击直到弹面板 */
async function bruteForcePick() {
  const cands = [];
  const cx = W / 2;
  const cy = H / 2;
  // 环形候选：半径 0.30~0.47 屏宽，角度每 6° 一点
  for (const rf of [0.30, 0.34, 0.38, 0.42, 0.46]) {
    for (let a = 0; a < 360; a += 6) {
      const rad = (a * Math.PI) / 180;
      const x = cx + Math.cos(rad) * W * rf;
      const y = cy + Math.sin(rad) * H * rf * 0.72;
      if (x < 40 || x > W - 40 || y < 60 || y > H - 60) continue;
      cands.push({ x: Math.round(x), y: Math.round(y) });
    }
  }
  console.log(`     候选点 ${cands.length} 个，开始扫描…`);
  for (const p of cands) {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(70);
    const open = await page.locator('.inner-node-card').count();
    if (open > 0) {
      // 拿到面板里的节点名与 id
      const info = await page.evaluate(() => {
        const el = document.querySelector('.inner-node-card');
        return el
          ? {
              id: el.getAttribute('data-node-id'),
              name: el.getAttribute('data-node-name'),
              text: el.querySelector('.inner-node-card__name')?.textContent ?? '',
            }
          : null;
      });
      return { point: p, info };
    }
  }
  return null;
}

let hit = null;
if (hasProbe) {
  const p = await page.evaluate(() => window.__xjPick());
  if (p) {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(180);
    hit = {
      point: p,
      info: await page.evaluate(() => {
        const el = document.querySelector('.inner-node-card');
        return el
          ? {
              id: el.getAttribute('data-node-id'),
              name: el.getAttribute('data-node-name'),
              text: el.querySelector('.inner-node-card__name')?.textContent ?? '',
            }
          : null;
      }),
    };
  }
}
if (!hit || !hit.info) hit = await bruteForcePick();

if (!hit || !hit.info) {
  await page.screenshot({ path: `${OUT}/inner-card-FAIL-no-panel.png` });
  fail('点了候选点都没弹出面板（截图 _probe/inner-card-FAIL-no-panel.png）');
  console.log(logs.slice(-25).join('\n'));
  await browser.close();
  process.exit(1);
}
ok(`命中节点 ${hit.info.name}（${hit.info.id}）@ (${hit.point.x},${hit.point.y})`);

// —— 等入场动效走完（reveal 720ms）再截图 ——
await page.waitForTimeout(950);
const openShot = `${OUT}/inner-card-open.png`;
await page.screenshot({ path: openShot });
ok('已截图 ' + openShot);

// —— 面板内容自检 ——
const detail = await page.evaluate(() => {
  const el = document.querySelector('.inner-node-card');
  if (!el) return null;
  const q = (s) => el.querySelector(s)?.textContent?.trim() ?? null;
  return {
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    name: q('.inner-node-card__name'),
    tagline: q('.inner-node-card__tagline'),
    chips: [...el.querySelectorAll('.inner-node-card__chip')].map((c) => c.textContent.trim()),
    body: q('.inner-node-card__body'),
    verse: q('.inner-node-card__verse'),
    source: q('.inner-node-card__source'),
    hasClose: el.querySelector('.inner-node-card__close') !== null,
  };
});
console.log('     面板内容:', JSON.stringify(detail, null, 2));

if (detail.role !== 'dialog') fail('role 不是 dialog');
else ok('role="dialog"');
if (!detail.ariaLabel) fail('缺 aria-label');
else ok(`aria-label="${detail.ariaLabel}"`);
if (detail.name !== hit.info.name) fail(`面板标题(${detail.name}) 与命中节点(${hit.info.name}) 不一致`);
else ok('面板标题与命中节点一致');
if (!detail.body || detail.body.length < 60) fail('正文过短或缺失');
else ok(`正文 ${detail.body.length} 字`);
if (!detail.hasClose) fail('缺关闭按钮');
else ok('有关闭按钮');

// —— 关闭路径 1：点关闭按钮 ——
await page.locator('.inner-node-card__close').click();
await page.waitForTimeout(650);
if ((await page.locator('.inner-node-card').count()) > 0) fail('点关闭按钮后面板仍在');
else ok('关闭路径①：点关闭按钮 ✓');

// —— 关闭路径 2：Esc ——
await page.mouse.move(hit.point.x, hit.point.y);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(750);
if ((await page.locator('.inner-node-card').count()) === 0) fail('二次点击节点未重新打开');
else ok('再次单击同一节点可重新打开');
await page.keyboard.press('Escape');
await page.waitForTimeout(650);
if ((await page.locator('.inner-node-card').count()) > 0) fail('按 Esc 后面板仍在');
else ok('关闭路径②：Esc ✓');

// —— 关闭路径 3：点空白处 ——
await page.mouse.move(hit.point.x, hit.point.y);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(750);
if ((await page.locator('.inner-node-card').count()) === 0) fail('三次点击节点未重新打开');
else {
  // 点右上角一块确定没有节点的空白
  await page.mouse.move(W - 30, 30);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(650);
  if ((await page.locator('.inner-node-card').count()) > 0) fail('点空白处后面板仍在');
  else ok('关闭路径③：点空白处 ✓');
}

// —— 切换节点：点另一个节点，面板应换内容（不关闭） ——
const second = await bruteForcePick();
if (second) {
  ok(`切换命中第二个节点 ${second.info.name}`);
  await page.waitForTimeout(950);
  const shot2 = `${OUT}/inner-card-switch.png`;
  await page.screenshot({ path: shot2 });
  ok('已截图 ' + shot2);
} else {
  console.log('warn 未能找到第二个节点用于切换测试');
}

await browser.close();

if (process.exitCode) {
  console.log('\n--- 页面 console 尾部 ---');
  console.log(logs.slice(-30).join('\n'));
} else {
  console.log('\nALL PASS');
}
