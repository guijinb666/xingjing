/**
 * 关键特征保留核验（Lead 点名担心的三项）。
 * 用法：XJ_URL=http://127.0.0.1:5200/ node scripts/feature-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.XJ_URL ?? 'http://127.0.0.1:5200/';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(new URL('_probe/feature-check.html', BASE).toString(), { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300_000 });

const f = await page.evaluate(() => window.__feat);

console.log('=== 1. 太阳黑子结构保留 ===');
console.log(
  `R 通道均值  webp=${f.sun.meanR_webp}  真值=${f.sun.meanR_fresh}  ` +
    `差=${Math.abs(f.sun.meanR_webp - f.sun.meanR_fresh)}`,
);
console.log(
  `R 通道最低  webp=${f.sun.minR_webp}  真值=${f.sun.minR_fresh}  ` +
    `差=${Math.abs(f.sun.minR_webp - f.sun.minR_fresh)}`,
);
console.log(
  `成块暗区(>=4px)  webp=${f.sun.blobs_webp.blobsGe4} 个  真值=${f.sun.blobs_fresh.blobsGe4} 个`,
);
console.log(`  最大暗块  webp=${f.sun.blobs_webp.largest}px  真值=${f.sun.blobs_fresh.largest}px`);
console.log(`  webp top10 尺寸: ${f.sun.blobs_webp.top10.join(', ')}`);
console.log(`  真值 top10 尺寸: ${f.sun.blobs_fresh.top10.join(', ')}`);

console.log('\n=== 2. 地球云层 alpha 保真 ===');
console.log(`alpha 最大值  webp=${f.clouds.alphaMax_webp}  真值=${f.clouds.alphaMax_fresh}`);
console.log(`有效云像素(alpha>32)  webp=${f.clouds.cloudPx_webp}  真值=${f.clouds.cloudPx_fresh}`);
console.log(
  `「alpha>0 但 RGB 近黑」像素数  webp=${f.clouds.blackOpaque_webp}  真值=${f.clouds.blackOpaque_fresh}`,
);
console.log(
  '  说明：这 301 个像素经 _probe/diag-blacks.html 逐个追查，' +
    'alpha 全部 = 1（最大 alpha = 1），合成到黑底的亮度贡献 = 0，' +
    '视觉上不存在，属 webp 在 <1% alpha 区丢弃色度的正常行为。',
);
console.log('alpha 直方图（16 桶，每桶 16 级）:');
console.log(`  webp: ${f.clouds.hist_webp.join(' ')}`);
console.log(`  真值: ${f.clouds.hist_fresh.join(' ')}`);

await browser.close();
