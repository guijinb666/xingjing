/**
 * 起境页窄视口验收：390×844（手机竖屏）与 834×1112（平板）。
 *
 * 除了截图，还会**实测盒模型**，避免只靠肉眼下结论：
 *   - 横向溢出：documentElement.scrollWidth > innerWidth
 *   - `.hero-col` 左缘是否落在 --margin 上
 *   - `.zodiac-ring` 的包围盒 / 出血量 / 是否盖住表单
 *   - 环的 pointer-events 与命中测试（点击落在输入框上的元素是谁）
 *   - H1 是否被裁（比较 scrollHeight 与 clientHeight、以及左右是否越界）
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.XJ_URL ?? 'http://127.0.0.1:5299/';
const OUT = 'C:/Users/30612/Desktop/dsh/xingjing/_shots';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'hero-390', width: 390, height: 844, label: '手机竖屏 390×844' },
  { name: 'hero-834', width: 834, height: 1112, label: '平板 834×1112' },
];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);

  const probe = await page.evaluate(() => {
    const de = document.documentElement;
    const marginPx = parseFloat(getComputedStyle(de).getPropertyValue('--margin')) || null;

    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: +r.x.toFixed(1), y: +r.y.toFixed(1),
        w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1),
        pointerEvents: cs.pointerEvents,
        overflowX: cs.overflowX, overflowY: cs.overflowY,
        position: cs.position,
        fontSize: cs.fontSize,
      };
    };

    // H1 是否被裁：自身 scroll 尺寸 vs 可视尺寸 + 左右是否越界
    const h1 = document.querySelector('.hero-statement');
    let h1Info = null;
    if (h1) {
      const r = h1.getBoundingClientRect();
      h1Info = {
        text: h1.textContent,
        x: +r.x.toFixed(1), right: +r.right.toFixed(1),
        w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        scrollW: h1.scrollWidth, clientW: h1.clientWidth,
        scrollH: h1.scrollHeight, clientH: h1.clientHeight,
        clippedLeft: r.left < 0,
        clippedRight: r.right > window.innerWidth + 0.5,
        clippedBottom: r.bottom > window.innerHeight + 0.5,
      };
    }

    // 环是否盖住表单：逐字段做 elementFromPoint 命中测试
    const hitTests = [];
    for (const inp of document.querySelectorAll('.field-input, .gender-chip, .primary-button')) {
      const r = inp.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      hitTests.push({
        target: inp.className || inp.tagName,
        point: [+cx.toFixed(1), +cy.toFixed(1)],
        topElement: top ? (top.className || top.tagName) : null,
        reachable: !!top && (top === inp || inp.contains(top) || top.contains(inp)),
      });
    }

    // 表单底部是否被挤出视口
    const col = document.querySelector('.hero-col');
    const colRect = col?.getBoundingClientRect();

    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      marginPx,
      overflow: {
        scrollW: de.scrollWidth, innerW: window.innerWidth,
        hasHorizontalScroll: de.scrollWidth > window.innerWidth,
        eh: de.scrollHeight, innerH: window.innerHeight,
        hasVerticalScroll: de.scrollHeight > window.innerHeight,
      },
      heroCol: rect('.hero-col'),
      zodiacRing: rect('.zodiac-ring'),
      heroStatement: h1Info,
      heroSupport: rect('.hero-support'),
      formBlock: rect('.form-block'),
      primaryButton: rect('.primary-button'),
      disclaimer: rect('.disclaimer'),
      colFitsViewport: colRect ? colRect.bottom <= window.innerHeight + 0.5 : null,
      colBottomOverflowPx: colRect ? +(colRect.bottom - window.innerHeight).toFixed(1) : null,
      hitTests,
      colLeftEqualsMargin: colRect && marginPx ? +(colRect.x - marginPx).toFixed(2) : null,
    };
  });

  console.log(`\n===== ${vp.label} =====`);
  console.log(JSON.stringify(probe, null, 1));

  await page.screenshot({ path: `${OUT}/${vp.name}.png` });
  // 再拍一张整页（若有纵向滚动，能看到全部内容）
  await page.screenshot({ path: `${OUT}/${vp.name}-full.png`, fullPage: true });

  console.log('运行时错误:', errors.length === 0 ? '无' : errors.join('\n'));
  await page.close();
}

await browser.close();
