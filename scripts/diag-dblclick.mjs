// 判定 09-inner-dblclick 里的巨大青色块到底是「节点弹窗卡片」（task-8 正常功能）
// 还是「节点标牌被异常放大」（缺陷）。直接查 DOM，不看像素猜。
import { chromium } from 'playwright';

const URL = process.env.XJ_URL || 'http://127.0.0.1:5299/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  const d = document.querySelector('input[type="date"]');
  if (d) { d.value = '2001-01-01'; d.dispatchEvent(new Event('input', { bubbles: true })); }
  const t = document.querySelector('input[type="time"]');
  if (t) { t.value = '12:00'; t.dispatchEvent(new Event('input', { bubbles: true })); }
});
await page.click('.primary-button');
await page.waitForTimeout(1600);

const cx = 720, cy = 540;
await page.mouse.dblclick(cx, cy);
await page.waitForTimeout(800);

const state = await page.evaluate(() => {
  const card = document.querySelector('.inner-node-card');
  const cr = card ? card.getBoundingClientRect() : null;
  const wrap = document.querySelector('.inner-canvas-wrap');
  const wr = wrap ? wrap.getBoundingClientRect() : null;
  return {
    cardExists: !!card,
    cardText: card ? (card.textContent || '').trim().slice(0, 80) : null,
    cardBox: cr ? { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) } : null,
    cardClass: card ? card.className : null,
    wrapBox: wr ? { x: Math.round(wr.x), y: Math.round(wr.y), w: Math.round(wr.width), h: Math.round(wr.height) } : null,
    legend: !!document.querySelector('.inner-legend'),
    hud: !!document.querySelector('.inner-hud'),
  };
});
console.log('dblclick 后 DOM 状态:', JSON.stringify(state, null, 2));

// 关掉卡片（若有），再量一次，看巨大色块是否随之消失
if (state.cardExists) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => !!document.querySelector('.inner-node-card'));
  console.log('按 Esc 后卡片还在吗:', after);
  await page.screenshot({ path: '_shots/diag-dblclick-nocard.png' });
}

console.log('运行时错误:', errors.length ? errors : '无');
await browser.close();
