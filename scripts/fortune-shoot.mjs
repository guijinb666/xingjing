/**
 * 第四幕「命理与运势解读」真实浏览器验收。
 *
 * 三组视口：
 *   1. 桌面 1440×1080 —— 整幕 + 逐节分段截图
 *   2. 窄视口 390×844 —— 手机竖屏：不横向滚动、不裁切
 *   3. prefers-reduced-motion: reduce —— 动效全关后内容仍完整
 *
 * 同时打印可滚动高度 / 是否横向滚动 / 五行分数 / 日主强弱 / 喜用忌神 /
 * 大运步数 / 声明是否可见。
 *
 * 用法：$env:XJ_URL='http://127.0.0.1:5201/'; node scripts/fortune-shoot.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.XJ_URL ?? 'http://127.0.0.1:5201/';
const OUT = 'C:/Users/30612/Desktop/dsh/xingjing/_probe';
mkdirSync(OUT, { recursive: true });

const errors = [];
let failed = 0;

function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failed += 1;
  console.log(`  [${mark}] ${name}${detail ? ' — ' + detail : ''}`);
}

/** 进入第四幕：起境 → 提交 → 内景 → 点推进按钮 */
async function enterFortune(page) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.click('.primary-button');
  await page.waitForTimeout(1800);
  // 内景底部的推进按钮现在指向第四幕
  await page.click('.advance-button');
  await page.waitForTimeout(2000);
}

/** 采集解读页的可见性与内容 */
async function probe(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const de = document.body;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // 是否横向溢出：任一元素的右边界超出视口
    let maxRight = 0;
    let culprit = '';
    for (const el of document.querySelectorAll('.fortune *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > maxRight) {
        maxRight = r.right;
        culprit = el.className?.toString?.().slice(0, 60) ?? el.tagName;
      }
    }

    const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    const bars = [...document.querySelectorAll('.wuxing-row')].map((r) => ({
      name: r.querySelector('.wuxing-name')?.textContent?.trim() ?? '',
      val: r.querySelector('.wuxing-val')?.textContent?.trim() ?? '',
      fillW: Math.round(r.querySelector('.wuxing-fill')?.getBoundingClientRect().width ?? 0),
    }));

    const secs = [...document.querySelectorAll('.fortune-sec')].map((s) => ({
      title: s.querySelector('.sec-title')?.textContent?.trim() ?? '',
      h: Math.round(s.getBoundingClientRect().height),
      top: Math.round(s.getBoundingClientRect().top + window.scrollY),
    }));

    // 声明是否真的可见（非 display:none / 非零面积 / 在文档内）
    const dis = document.querySelector('.fortune-disclaimer');
    const dr = dis?.getBoundingClientRect();

    return {
      scrollH: doc.scrollHeight,
      clientH: vh,
      scrollW: doc.scrollWidth,
      clientW: vw,
      horizontalOverflow: doc.scrollWidth > vw + 1,
      maxRight: Math.round(maxRight),
      culprit,
      hudStamp: txt('.fortune-hud .hud-stamp'),
      title: txt('.fortune-title'),
      lede: (txt('.fortune-lede') ?? '').slice(0, 40),
      pillarCount: document.querySelectorAll('.pillar-card').length,
      pillars: [...document.querySelectorAll('.pillar-card')].map(
        (c) => c.querySelector('.pillar-gz')?.textContent?.trim() ?? '',
      ),
      bars,
      strengthLevel: txt('.strength-tag'),
      strengthEq: txt('.strength-eq'),
      favorable: [...document.querySelectorAll('.favor-chip.is-good')].map((e) => e.textContent.trim()),
      unfavorable: [...document.querySelectorAll('.favor-chip.is-bad')].map((e) => e.textContent.trim()),
      chainCount: document.querySelectorAll('.chain-item').length,
      patternCells: document.querySelectorAll('.pattern-cell').length,
      shenshaAuspicious: document.querySelectorAll('.shensha-col:first-child .shensha-item').length,
      shenshaOminous: document.querySelectorAll('.shensha-col:last-child .shensha-item').length,
      luckCount: document.querySelectorAll('.luck-row').length,
      luckFirst: txt('.luck-row .luck-gz'),
      luckTexts: [...document.querySelectorAll('.luck-row')].map((r) => ({
        gz: r.querySelector('.luck-gz')?.textContent?.trim(),
        rating: r.querySelector('.luck-rating')?.textContent?.trim(),
      })),
      flowCount: document.querySelectorAll('.flow-row').length,
      flowTexts: [...document.querySelectorAll('.flow-row')].map((r) => ({
        year: r.querySelector('.flow-year')?.textContent?.trim(),
        rating: r.querySelector('.flow-rating')?.textContent?.trim(),
      })),
      disclaimerText: dis?.textContent?.trim() ?? null,
      disclaimerVisible:
        !!dis &&
        !!dr &&
        dr.width > 0 &&
        dr.height > 0 &&
        getComputedStyle(dis).display !== 'none' &&
        getComputedStyle(dis).visibility !== 'hidden' &&
        getComputedStyle(dis).opacity !== '0',
      disclaimerTop: dr ? Math.round(dr.top + window.scrollY) : -1,
      methodNote: txt('.fortune-method'),
      hasNext: !!document.querySelector('.fortune .advance-button'),
      hasBack: !!document.querySelector('.fortune .back-button'),
      nextLabel: txt('.fortune .advance-button'),
      backLabel: txt('.fortune .back-button'),
      sectionTitles: secs.map((s) => s.title),
      sectionCount: secs.length,
      secs,
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  });
}

/* ============================================================ 1. 桌面 */

console.log('\n========== 1. 桌面 1440×1080 ==========');
{
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await enterFortune(page);
  await page.screenshot({ path: `${OUT}/fortune-desktop-top.png` });

  const info = await probe(page);
  console.log(JSON.stringify(info, null, 1));

  check('导航进入第四幕（标题正确）', info.title === '命理与运势解读', info.title ?? 'null');
  // 任务要求的九块 = 页首 + 8 个 .fortune-sec + 落款/声明（落款不是 section）
  const blockCount = info.sectionCount + (info.disclaimerVisible ? 2 : 0);
  check('九块内容齐全（页首+8节+落款）', blockCount === 10, `section=${info.sectionCount} 合计块=${blockCount}`);
  check('四柱 4 张卡', info.pillarCount === 4, JSON.stringify(info.pillars));
  check('五行 5 条', info.bars.length === 5);
  check('五行条形图已生长（宽度 > 0）', info.bars.every((b) => b.fillW > 0), JSON.stringify(info.bars.map((b) => b.fillW)));
  check('十神 10 格', info.patternCells === 10);
  check('喜用非空', info.favorable.length > 0, info.favorable.join(''));
  check('忌神非空', info.unfavorable.length > 0, info.unfavorable.join(''));
  check('推导链 ≥ 2 条', info.chainCount >= 2, String(info.chainCount));
  check('大运 8 步', info.luckCount === 8);
  check('流年 5 年', info.flowCount === 5, JSON.stringify(info.flowTexts));
  check('声明可见', info.disclaimerVisible === true);
  check('声明含「不是科学预测」', (info.disclaimerText ?? '').includes('不是科学预测'));
  check('桌面无横向溢出', info.horizontalOverflow === false, `scrollW=${info.scrollW} vw=${info.clientW}`);
  check('有「进入诞生星轨」', info.hasNext && (info.nextLabel ?? '').includes('进入诞生星轨'), info.nextLabel ?? '');
  check('有「返回内景」', info.hasBack && (info.backLabel ?? '').includes('返回内景'), info.backLabel ?? '');
  check('不受 reduced-motion 影响', info.reduced === false);

  // 逐节滚动截图：滚到每一节的顶部
  for (const s of info.secs) {
    await page.evaluate((y) => window.scrollTo({ top: y - 120, behavior: 'auto' }), s.top);
    await page.waitForTimeout(320);
  }
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/fortune-desktop-bottom.png` });
  await page.screenshot({ path: `${OUT}/fortune-desktop-full.png`, fullPage: true });

  // 点「进入诞生星轨」应到星轨
  await page.click('.fortune .advance-button');
  await page.waitForTimeout(2200);
  const atOrbit = await page.evaluate(() => ({
    hasOrbit: !!document.querySelector('.orbit-title'),
    title: document.querySelector('.orbit-title')?.textContent?.trim() ?? null,
  }));
  check('点「进入诞生星轨」到第四幕星轨', atOrbit.hasOrbit === true, JSON.stringify(atOrbit));
  await page.screenshot({ path: `${OUT}/fortune-to-orbit.png` });

  // 星轨返回 → 内景
  await page.click('.back-button');
  await page.waitForTimeout(1800);
  const backInner = await page.evaluate(() => !!document.querySelector('.inner-canvas'));
  check('星轨「返回内景」仍到内景', backInner === true);

  await browser.close();
}

/* ============================================================ 2. 窄视口 */

console.log('\n========== 2. 窄视口 390×844 ==========');
{
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`[pageerror/narrow] ${e.message}`));

  await enterFortune(page);
  await page.screenshot({ path: `${OUT}/fortune-narrow-top.png` });

  const info = await probe(page);
  console.log(JSON.stringify(info, null, 1));

  check('窄视口无横向滚动', info.horizontalOverflow === false, `scrollW=${info.scrollW} vw=${info.clientW} maxRight=${info.maxRight} culprit=${info.culprit}`);
  check('标题完整渲染', info.title === '命理与运势解读', info.title ?? 'null');
  check('八节齐全（+页首+落款=九块）', info.sectionCount === 8, String(info.sectionCount));
  check('声明可见', info.disclaimerVisible === true);
  check('五行条已生长', info.bars.every((b) => b.fillW > 0));

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/fortune-narrow-bottom.png` });
  await page.screenshot({ path: `${OUT}/fortune-narrow-full.png`, fullPage: true });

  // 横滚检查：尝试右滚，scrollLeft 应保持 0
  const scrolled = await page.evaluate(() => {
    window.scrollTo({ left: 9999, behavior: 'auto' });
    return window.scrollX;
  });
  check('无法横向滚动（scrollX 归零）', scrolled === 0, `scrollX=${scrolled}`);

  await browser.close();
}

/* ============================================================ 3. 降级动效 */

console.log('\n========== 3. prefers-reduced-motion: reduce ==========');
{
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  page.on('pageerror', (e) => errors.push(`[pageerror/reduced] ${e.message}`));

  await enterFortune(page);
  // 降级下不应依赖动效结束才可见 —— 立即截图
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/fortune-reduced-top.png` });

  const info = await probe(page);
  console.log(JSON.stringify({ reduced: info.reduced, sectionCount: info.sectionCount, bars: info.bars.map((b) => b.fillW) }, null, 1));

  check('媒体查询命中 reduce', info.reduced === true);
  check('降级下八节仍齐全', info.sectionCount === 8);
  check('降级下条形图立即到位（宽度 > 0）', info.bars.every((b) => b.fillW > 0), JSON.stringify(info.bars.map((b) => b.fillW)));
  check('降级下声明可见', info.disclaimerVisible === true);
  check('降级下无横向溢出', info.horizontalOverflow === false);

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/fortune-reduced-bottom.png` });

  await browser.close();
}

/* ============================================================ 汇总 */

console.log('\n========== 运行时错误 ==========');
if (errors.length === 0) console.log('无');
else for (const e of errors) console.log(' -', e);

console.log(`\n========== 结论：${failed === 0 ? '全部通过' : failed + ' 项未通过'} ==========`);
process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
