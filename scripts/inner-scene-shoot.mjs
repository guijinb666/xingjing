import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * 截取「内景 · 流光连线」的多个**时间点**，用来证明流光在动。
 *
 * 用法：node scripts/inner-scene-shoot.mjs
 *       环境变量 XJ_URL 覆盖 base url（默认 5199）。
 *
 * 核心手法：探针页把 rAF 的自动推进关掉，改由 `window.__step(n, dt)`
 * 精确推帧。于是「t=0 / t=1.1s / t=2.3s / t=3.6s」是同一场景的四个真相位，
 * 不会因为加载抖动或 rAF 调度差异而互相污染 —— 这是能拿来做
 * "流光在动"证据的前提。
 *
 * ⚠️ 本项目 dev server 有个**已知顽疾**：每次被 playwright 连续加载
 * 4~5 个模块图后就会**静默退出**（无 stderr、无异常，就是没了）。
 * 所以这个脚本自己在每张图之前 `ensureServer()`：
 * 探活 → 死了就按 TEAM-GUIDE 的命令重启 → 等 200 再继续。
 * 不这么做的话，第 5 张图必挂在这个项目上。
 */

const BASE = process.env.XJ_URL || 'http://127.0.0.1:5199/';
const W = 1000;
const H = 1000;

const NODE_EXE =
  'C:\\Users\\30612\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe';
const PROJ = 'C:\\Users\\30612\\Desktop\\dsh\\xingjing';

const proxied = /^(127\.0\.0\.1|localhost)/.test(new URL(BASE).hostname);

async function alive() {
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(4000) });
    return r.status === 200;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await alive()) return;
  if (!proxied) throw new Error(`dev server 不在 ${BASE}，且非本机地址，无法自愈`);
  console.log('  [dev server 掉了 → 重启]');
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | ` +
        `Where-Object { $_.CommandLine -like '*vite*5199*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
      { stdio: 'ignore' },
    );
  } catch {
    /* 没有旧进程也无所谓 */
  }
  // 用 `scripts/_devserver.mjs`（队友写的健壮启动器）而不是裸 vite：
  // 裸 vite 的 FSWatcher 会被 DSH 文件守卫产生的瞬时 tmpdir 触发 EBUSY
  // 导致整个进程猝死 —— 这正是本项目 dev server "频繁死掉"的根因。
  // `vite.probe.config.ts` 关掉了 watch/hmr，探针页每次 goto 重新转译，
  // 不依赖 HMR，所以关掉 watcher 不影响截图正确性。
  // 这里为了能等待它、并复用同一份日志，直接 spwawn 包装器的等价命令。
  spawn(
    NODE_EXE,
    [
      'node_modules/vite/bin/vite.js',
      '--config', 'scripts/vite.probe.config.ts',
      '--port', '5199',
      '--host', '127.0.0.1',
      '--clearScreen', 'false',
    ],
    { cwd: PROJ, detached: true, stdio: 'ignore' },
  ).unref();
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 700));
    if (await alive()) return;
  }
  throw new Error('重启 vite 后仍然连不上');
}

if (!existsSync(PROJ)) throw new Error('项目目录不存在: ' + PROJ);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
});

/**
 * 带自愈的 page.goto。
 *
 * dev server 有个更恶心的失败模式：它不是在两次加载**之间**死，
 * 而是在**加载途中**死（模块图请求到一半进程就没了）。
 * 所以光在 goto 之前探活不够 —— 必须把 goto 本身放进重试里。
 */
async function gotoWithRetry(page, url, tries = 5) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    await ensureServer();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForFunction(() => window.__ready === true, { timeout: 25000 });
      return;
    } catch (e) {
      lastErr = e;
      console.log(`  [goto 第 ${i + 1} 次失败，重试] ${String(e.message).split('\n')[0]}`);
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

const shoot = async (name, { dist = 6.4, az = 0.4, only = null, steps }) => {
  const url = `${BASE}_probe/inner-scene.html?w=${W}&h=${H}&dist=${dist}&az=${az}` +
    (only ? `&only=${only}` : '');
  await gotoWithRetry(page, url);
  // 先跑满入场动画（节点 delay 最大 240+24*58 ≈ 1632ms）
  const calls = await page.evaluate(async () => {
    // 用固定步长把入场跑完：2.5s / (1/60) = 150 帧
    window.__step(150, 1 / 60);
    return window.__renderer.info.render.calls;
  });
  const out = `_probe/inner-flow-${name}.png`;
  await page.locator('#c').screenshot({ path: out });
  console.log(`saved ${out}  drawCalls=${calls}  (entry done)`);
  return { out, calls, steps };
};

// —— 1) 时间序列：同一视角，4 个不同相位 ——
const TIMES = [0, 1.1, 2.3, 3.6];
const url0 = `${BASE}_probe/inner-scene.html?w=${W}&h=${H}&dist=6.4&az=0.4`;
await gotoWithRetry(page, url0);
await page.evaluate(() => window.__step(150, 1 / 60));

let prev = 0;
for (const t of TIMES) {
  const n = Math.round((t - prev) / (1 / 60));
  if (n > 0) await page.evaluate((k) => window.__step(k, 1 / 60), n);
  prev = t;
  const out = `_probe/inner-flow-t${String(t).replace('.', 'p')}.png`;
  await page.locator('#c').screenshot({ path: out });
  const calls = await page.evaluate(() => window.__renderer.info.render.calls);
  console.log(`saved ${out}  t=${t}s  drawCalls=${calls}`);
}

// —— 2) 拉近：验证流光收敛（不是糊成一团）——
await shoot('close-dist4', { dist: 4.2, az: 0.9 });
// —— 3) 拉远：验证流光变细、不抢人体 ——
await shoot('far-dist9', { dist: 9.0, az: 1.6 });
// —— 4) 只留流光：证明结构清晰、无 z-fighting 斑块 ——
await shoot('flowonly', { dist: 6.4, az: 0.4, only: 'flow' });

await browser.close();
