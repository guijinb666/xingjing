/**
 * 探针专用 vite 配置 —— 只给 orbit-dev 的截图脚本用。
 *
 * 为什么要单独一份：
 *   项目根的 `vite.config.ts` 用默认 FSWatcher。本项目有多个智能体在并发
 *   改写 `.tsx`，写入工具会在被写文件旁边生成
 *   `.<name>.<pid>.<uuid>.tmpdir/<name>.tmp` 临时目录。FSWatcher 会去
 *   watch 这些临时文件，而它们在 Windows 上常处于 EBUSY（被写入进程持有），
 *   于是 vite 进程**整个崩掉**：
 *     Error: EBUSY: resource busy or locked, watch '...\.InnerCanvas.tsx.….tmpdir\InnerCanvas.tsx.tmp'
 *
 *   本配置把 `ignored` 指向这些临时文件模式，并且 `usePolling: false`。
 *   同时用独立端口，避免和别的智能体抢 5199。
 *
 * 不影响生产构建（build 脚本仍用根配置）。
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 5231,
    strictPort: true,
    watch: {
      // 关键：忽略写入工具产生的临时目录/文件，否则 FSWatcher 会 EBUSY 崩溃
      ignored: [
        '**/.*.tmpdir/**',
        '**/*.tmp',
        '**/._*',
        '**/node_modules/**',
        '**/.git/**',
      ],
      // 明确关掉轮询（轮询在某些 Windows 环境下也会踩 EBUSY）
      usePolling: false,
    },
  },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
