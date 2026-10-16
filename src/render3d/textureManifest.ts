/**
 * 预烘焙贴图清单。
 *
 * ★ 存在理由（根因记录，实测数据）：
 *   行星外观原先全部由 `planetMaterials.ts` 在浏览器里**逐像素同步**生成。
 *   `_probe/tex-bench.html` 实测：8 颗行星各约 950ms、太阳 220ms、云层 64ms、
 *   日冕 0.1ms，**首次合计 7876ms**。浏览器里这表现为进入星轨瞬间的
 *   **10905ms 主线程长任务** —— 页面冻结 11 秒，用户报障「星轨加载不出来」。
 *
 *   现在这些画布在**构建期**由 `scripts/bake-textures.mjs` 烘焙成
 *   `public/textures/*.webp`，运行时只做异步图片解码，主线程不再被占用。
 *
 * 本文件是**唯一**的「key → 文件名」真相源，运行时与烘焙脚本都读它，
 * 避免两边文件名各写一份而漂移。
 */
import type { BodyKey } from '@/domain/types';

/** 贴图 key：8 颗行星 + 太阳 + 日冕 + 地球云层 */
export type TexKey = BodyKey | 'Sun' | 'SunGlow' | 'EarthClouds';

/** 静态资源根路径（Vite `public/` 下的目录，按站点根绝对路径引用） */
export const TEX_BASE = '/textures/';

export interface TexFileSpec {
  /** 文件名（相对 TEX_BASE） */
  file: string;
  width: number;
  height: number;
}

/**
 * 11 张预烘焙贴图。
 *
 * 尺寸与程序化版本的 `TEX_W`/`TEX_H`（1024×512）一致；日冕是 256×256 的
 * 径向渐变。`EarthClouds` **必须带 alpha 通道**（透明处不能变成黑底，
 * 否则云层壳会变成一层不透明的白/黑壳盖住地球）。
 */
export const TEX_FILES: Record<TexKey, TexFileSpec> = {
  Mercury: { file: 'mercury.webp', width: 1024, height: 512 },
  Venus: { file: 'venus.webp', width: 1024, height: 512 },
  Earth: { file: 'earth.webp', width: 1024, height: 512 },
  Mars: { file: 'mars.webp', width: 1024, height: 512 },
  Jupiter: { file: 'jupiter.webp', width: 1024, height: 512 },
  Saturn: { file: 'saturn.webp', width: 1024, height: 512 },
  Uranus: { file: 'uranus.webp', width: 1024, height: 512 },
  Neptune: { file: 'neptune.webp', width: 1024, height: 512 },
  Sun: { file: 'sun.webp', width: 1024, height: 512 },
  SunGlow: { file: 'sun-glow.webp', width: 256, height: 256 },
  EarthClouds: { file: 'earth-clouds.webp', width: 1024, height: 512 },
};

/** 全部 key（顺序固定，便于诊断输出对齐） */
export const TEX_KEYS: TexKey[] = [
  'Mercury',
  'Venus',
  'Earth',
  'Mars',
  'Jupiter',
  'Saturn',
  'Uranus',
  'Neptune',
  'Sun',
  'SunGlow',
  'EarthClouds',
];
