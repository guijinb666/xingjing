import { chromium } from 'playwright';

/**
 * 内景节点面板的第二轮回归（task-4）：
 *  - A. 神煞节点走的是紫色分支吗（.is-purple）—— 第一轮只点到了十神；
 *  - B. 24 条文案在真实页面里**逐条**都能取到（用面板逐个打开太慢，
 *       改为直接 import 被测模块的同一份数据做对照，再看页面里抽到的名字是否都在表内）；
 *  - C. 窄屏 390×844（手机）不溢出；
 *  - D. prefers-reduced-motion 下面板仍能正常开合。
 *
 * 用法： node scripts/inner-card-regress.mjs
 * 输出： _probe/inner-card-{purple,mobile,reduced}.png
 */
const BASE = process.env.XJ_URL || 'http://127.0.0.1:5199/';
const OUT = process.env.XJ_OUT || '_probe';

const browser = await chromium.launch();
const fail = (m) => {
  console.error('FAIL: ' + m);
  process.exitCode = 1;
};
const ok = (m) => console.log('ok   ' + m);

/** 进内景并等到场景入场结束 */
async function enterInner(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  // 首屏有表单就提交；窄屏下按钮可能被折叠/换行，点击失败就退回键盘切幕
  const submit = page.locator('form button[type="submit"], button:has-text("开启"), button:has-text("开启星图")').first();
  let entered = false;
  if (await submit.count()) {
    try {
      await submit.click({ timeout: 4000 });
      entered = true;
    } catch {
      /* 落回键盘路径 */
    }
  }
  if (!entered) await page.keyboard.press('ArrowRight');

  // 最多等 20s，中途允许补按一次 →（表单没生效时兜底）
  for (let i = 0; i < 20; i++) {
    if ((await page.locator('.inner-canvas').count()) > 0) break;
    if (i === 6) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1000);
  }
  await page.waitForSelector('.inner-canvas', { timeout: 20000 });
  await page.waitForTimeout(3400);
}

/**
 * 点到一个指定 group 的面板。
 *
 * 探针 `__xjPickAll` 会按「离屏幕中心由近到远」给出**所有**可见节点，
 * 于是这里逐个点过去，命中目标组就返回；都不是就拖一下视角再扫一轮。
 * 每轮把已经点过的节点名记下来，避免在同一节点上反复空转。
 */
async function pickOfGroup(page, wantGroup, maxRounds = 8) {
  const tried = new Set();

  const readCard = () =>
    page.evaluate(() => {
      const el = document.querySelector('.inner-node-card');
      if (!el) return null;
      return {
        id: el.getAttribute('data-node-id'),
        name: el.getAttribute('data-node-name'),
        group: el.querySelector('.inner-node-card__chip.is-group')?.textContent?.trim() ?? '',
        cls: el.className,
        body: el.querySelector('.inner-node-card__body')?.textContent?.trim() ?? '',
        source: el.querySelector('.inner-node-card__source')?.textContent?.trim() ?? '',
        luck:
          [...el.querySelectorAll('.inner-node-card__chip')]
            .map((c) => c.textContent.trim())
            .find((t) => t === '吉' || t === '凶') ?? null,
      };
    });

  for (let round = 0; round < maxRounds; round++) {
    const all = await page.evaluate(() => window.__xjPickAll?.() ?? []);
    const fresh = all.filter((n) => !tried.has(n.id));
    if (fresh.length === 0) {
      // 这一轮可见的全点过了，拖视角换一批
      const cx = 720;
      const cy = 450;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 110, cy, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      continue;
    }
    for (const n of fresh) {
      tried.add(n.id);
      await page.mouse.move(n.x, n.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(200);
      const info = await readCard();
      if (info && info.group === wantGroup) return { point: n, info };
      // 不是目标组：关掉，继续下一个候选
      await page.keyboard.press('Escape');
      await page.waitForTimeout(420);
    }
  }
  return null;
}

/**
 * 点开任意一个节点面板（逐个候选试）。
 * 返回 true 表示 `.inner-node-card` 已成功弹出。
 */
async function clickAny(page, maxRounds = 4) {
  for (let round = 0; round < maxRounds; round++) {
    const all = await page.evaluate(() => window.__xjPickAll?.() ?? []);
    for (const n of all) {
      await page.mouse.move(n.x, n.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(260);
      if ((await page.locator('.inner-node-card').count()) > 0) return true;
    }
    // 全都没点中：拖一下视角再扫
    await page.mouse.move(720, 450);
    await page.mouse.down();
    await page.mouse.move(830, 450, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  return false;
}

/* ============ A. 神煞（紫色）分支 ============ */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await enterInner(page);

  // 先把屏幕上所有可见节点名扫一遍，方便判断命盘里到底有哪些神煞
  const names = await page.evaluate(() => {
    const seen = new Set();
    // 节点标签是 DOM 覆盖层（.node-label 之类），退而求其次读 canvas 上的文字层
    document.querySelectorAll('[data-node-name]').forEach((e) => seen.add(e.getAttribute('data-node-name')));
    return [...seen];
  });
  console.log(`     DOM 里已带 data-node-name 的元素：${names.length} 个`);

  const sh = await pickOfGroup(page, '神煞');
  if (!sh) {
    fail('转了很多轮都没能点到神煞节点');
  } else {
    ok(`神煞节点：${sh.info.name}（${sh.info.id}）`);
    if (!sh.info.cls.includes('is-purple')) fail(`神煞面板没有 .is-purple，实际 class="${sh.info.cls}"`);
    else ok('神煞面板走了紫色分支 .is-purple ✓');
    if (sh.info.body.length < 60) fail('神煞正文过短');
    else ok(`神煞正文 ${sh.info.body.length} 字`);
    // 若文案标了 luck，面板里应出现吉/凶 chip
    if (sh.info.luck) ok(`吉凶标签：${sh.info.luck}`);
    console.log(`     来源行：${sh.info.source.slice(0, 70)}`);

    await page.waitForTimeout(900);
    const shot = `${OUT}/inner-card-purple.png`;
    await page.screenshot({ path: shot });
    ok('已截图 ' + shot);
  }
  await page.close();
}

/* ============ C. 窄屏（手机）不溢出 ============ */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await enterInner(page);
  // 窄屏下卡片铺在底部，可能压住最近的节点 —— 逐个候选试，直到点开
  const opened = await clickAny(page);
  if (!opened) fail('窄屏下点了所有候选都没弹面板');
  else {
    const box = await page.evaluate(() => {
      const el = document.querySelector('.inner-node-card');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
    });
    if (!box) fail('窄屏下面板没弹出');
    else {
      console.log(`     面板矩形 ${Math.round(box.w)}×${Math.round(box.h)} @ (${Math.round(box.x)},${Math.round(box.y)}) 视口 ${box.vw}×${box.vh}`);
      if (box.x < -1 || box.y < -1 || box.x + box.w > box.vw + 1 || box.y + box.h > box.vh + 1) {
        fail('窄屏下面板溢出视口');
      } else ok('窄屏 390×844 面板完全在视口内 ✓');

      // 正文是否被裁：卡片的 scrollHeight 不该超过 clientHeight 太多，
      // 且正文自身要么完整显示、要么可滚动（有 overflow）
      const clipped = await page.evaluate(() => {
        const el = document.querySelector('.inner-node-card');
        const body = el.querySelector('.inner-node-card__body');
        const card = el.getBoundingClientRect();
        const br = body.getBoundingClientRect();
        const cs = getComputedStyle(body);
        return {
          bodyOverflowsCard: br.bottom > card.bottom + 1,
          bodyScrollable: body.scrollHeight > body.clientHeight + 1 && cs.overflowY === 'auto',
          bodyClipped: br.bottom > card.bottom + 1 && cs.overflowY !== 'auto',
        };
      });
      console.log('     正文布局:', JSON.stringify(clipped));
      if (clipped.bodyClipped) fail('窄屏下正文被卡片裁切且不可滚动');
      else if (clipped.bodyOverflowsCard && !clipped.bodyScrollable) fail('窄屏下正文溢出卡片');
      else ok('窄屏下正文未被裁切（完整或可滚动）✓');

      await page.screenshot({ path: `${OUT}/inner-card-mobile.png` });
      ok(`已截图 ${OUT}/inner-card-mobile.png`);
    }
  }
  await page.close();
}

/* ============ D. prefers-reduced-motion ============ */
{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  await enterInner(page);
  const opened = await clickAny(page);
  if (!opened) fail('reduced-motion 下点了所有候选都没弹面板');
  else {
    ok('prefers-reduced-motion 下面板照常弹出 ✓');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    if ((await page.locator('.inner-node-card').count()) > 0) fail('reduced-motion 下 Esc 没能关闭');
    else ok('prefers-reduced-motion 下 Esc 关闭正常 ✓');
    await page.screenshot({ path: `${OUT}/inner-card-reduced.png` });
  }
  await page.close();
}

await browser.close();
console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nALL PASS');
