/**
 * 真实浏览器视觉验收：对「星境」四幕逐一截图，并抓取运行时错误。
 *
 * 四幕现在是**分屏 + 按钮推进**（不是滚动）：
 *   01 起境 → 点「开启我的星境」→ 02 内景 → 点「查看命理解读」→
 *   03 命理与运势解读 → 点「进入诞生星轨」→ 04 星轨
 *
 * 用 1440×1080 —— 与原片参考画布完全一致，便于逐帧比对构图。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.XJ_URL ?? 'http://127.0.0.1:5199/';
const OUT = 'C:/Users/30612/Desktop/dsh/xingjing/_shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1080 },
  deviceScaleFactor: 1,
});

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);

// ---------- 第一幕：起境 ----------
await page.screenshot({ path: `${OUT}/01-hero.png` });

const formState = await page.evaluate(() => {
  const g = (sel) => document.querySelector(sel)?.value ?? null;
  return {
    date: g('input[type="date"]'),
    time: g('input[type="time"]'),
    genderActive: document.querySelector('.gender-chip.is-active')?.textContent?.trim() ?? null,
  };
});
console.log('起境表单状态:', JSON.stringify(formState));

// ---------- 第二幕：内景 ----------
await page.click('.primary-button');
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/02-inner-enter.png` });

const innerInfo = await page.evaluate(() => {
  const cv = document.querySelector('.inner-canvas');
  const gl = cv?.getContext?.('webgl2') ?? cv?.getContext?.('webgl');
  return {
    hasCanvas: !!cv,
    cssW: cv?.clientWidth,
    cssH: cv?.clientHeight,
    bufW: cv?.width,
    bufH: cv?.height,
    /** WebGL 上下文存在 = 3D 真的在跑，而不是空画布 */
    hasGL: !!gl,
    readout: document.querySelector('.inner-readout')?.innerText ?? '',
    stamp: document.querySelector('.hud-stamp')?.textContent ?? '',
    live: document.querySelector('.hud-live')?.textContent ?? '',
    hasAdvance: !!document.querySelector('.advance-button'),
  };
});
console.log('内景:', JSON.stringify(innerInfo, null, 1));

// 内景自转：等两秒再拍，画面应已变化（3D 环绕）
await page.waitForTimeout(2200);
await page.screenshot({ path: `${OUT}/03-inner-spin.png` });

// ---------- 3D 交互实测：拖拽 / 滚轮 / 双击 ----------
const box = await page.locator('.inner-canvas').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

/** 用像素差判断画面是否真的动了 */
async function frameHash(tag) {
  const p = `${OUT}/_tmp-${tag}.png`;
  await page.screenshot({ path: p });
  return p;
}

const beforeDrag = await frameHash('before-drag');
// 拖拽：水平扫过 240px，应改变方位角
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 240, cy - 60, { steps: 18 });
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/07-inner-dragged.png` });
const afterDrag = await frameHash('after-drag');
console.log('拖拽前后帧:', beforeDrag.split('/').pop(), '->', afterDrag.split('/').pop());

// 滚轮缩放：记录画布尺寸不变，但视觉焦距改变
await page.mouse.move(cx, cy);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/08-inner-zoomed.png` });

// 双击放大
await page.mouse.dblclick(cx, cy);
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/09-inner-dblclick.png` });

// ---------- 第三幕：命理与运势解读（点按钮推进，不是滚动） ----------
await page.click('.advance-button');
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/11-fortune-top.png` });

const fortuneInfo = await page.evaluate(() => {
  const secs = document.querySelectorAll('.fortune-sec');
  return {
    hasTitle: !!document.querySelector('.fortune-title'),
    title: document.querySelector('.fortune-title')?.textContent?.trim() ?? '',
    sections: secs.length,
    hasDisclaimer: !!document.querySelector('.fortune-disclaimer'),
    disclaimer: (document.querySelector('.fortune-disclaimer')?.textContent ?? '').slice(0, 24),
    hasNext: !!document.querySelector('.advance-button'),
    hasBack: !!document.querySelector('.back-button'),
  };
});
console.log('解读页:', JSON.stringify(fortuneInfo));

// 滚到底拍整页下半部分
// 滚动：.stage-root 自身会随内容长高（scrollHeight === clientHeight），
// 真正滚动的是文档滚动元素。两者都试，取真正生效的那个。
const scrollFortune = (to) =>
  page.evaluate((target) => {
    const cands = [document.scrollingElement, document.documentElement, document.body, document.querySelector('.stage-root')];
    const moved = [];
    for (const el of cands) {
      if (!el) continue;
      const before = el.scrollTop;
      el.scrollTop = target === 'bottom' ? el.scrollHeight : 0;
      if (el.scrollTop !== before) moved.push(`${el.tagName || el.className}:${el.scrollTop}`);
    }
    window.scrollTo(0, target === 'bottom' ? 99999 : 0);
    return { moved, winY: window.scrollY };
  }, to);

const scrolled = await scrollFortune('bottom');
console.log('解读页滚动:', JSON.stringify(scrolled));
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/12-fortune-bottom.png` });
await scrollFortune('top');
await page.waitForTimeout(500);

// ---------- 第四幕：诞生星轨（从解读页推进） ----------
await page.click('.advance-button');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/04-orbit-idle.png` });

const subIdle = await page.locator('.orbit-sub').textContent();
console.log('星轨副标题(刚进入):', subIdle);

await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/05-orbit-running.png` });
const subRun = await page.locator('.orbit-sub').textContent();
console.log('星轨副标题(运行中):', subRun);

// 星符按钮暂停/继续
await page.click('.rune-button');
const subPaused = await page.locator('.orbit-sub').textContent();
await page.waitForTimeout(1200);
const subPaused2 = await page.locator('.orbit-sub').textContent();
console.log('暂停后两次读数:', subPaused, '|', subPaused2, '（应相同=已冻结）');
await page.click('.rune-button');
await page.waitForTimeout(1400);
const subResumed = await page.locator('.orbit-sub').textContent();
console.log('继续后读数:', subResumed);

const orbitInfo = await page.evaluate(() => {
  const cv = document.querySelector('.orbit-canvas');
  return { hasCanvas: !!cv, w: cv?.width, h: cv?.height, hasBack: !!document.querySelector('.back-button') };
});
console.log('星轨画布:', JSON.stringify(orbitInfo));

// 返回内景
await page.click('.back-button');
await page.waitForTimeout(1200);
const backOk = await page.evaluate(() => !!document.querySelector('.inner-canvas'));
console.log('返回内景成功:', backOk);
await page.screenshot({ path: `${OUT}/10-back-to-inner.png` });

console.log('\n=== 运行时错误 ===');
if (errors.length === 0) console.log('无');
else for (const e of errors) console.log(e);

await browser.close();
