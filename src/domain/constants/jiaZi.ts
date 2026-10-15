/**
 * 六十甲子：《星境复刻实施方案》4.4。
 * 序号 0 = 甲子，序号 59 = 癸亥。
 * 天干 = 序号 mod 10，地支 = 序号 mod 12（模 12 的余数 ≤ 9 时与模 10 同，
 * 余数 10/11 时天干再减 10，即余 0/1 —— 因为二者同奇偶，恒自洽）。
 */
import type { Gan, GanZhi, Zhi } from '../types';
import { GAN } from './gan';
import { ZHI } from './zhi';

/** 六十甲子表，索引即甲子序号 */
export const JIA_ZI: readonly GanZhi[] = Array.from({ length: 60 }, (_, i) => {
  let ganIndex = i % 10;
  if (i % 12 >= 10) ganIndex -= 10;
  // 上式得到的是「阴阳同奇偶」的合法组合；用统一取模兜底，保证落在 0–9
  ganIndex = ((ganIndex % 10) + 10) % 10;
  return { gan: GAN[ganIndex] as Gan, zhi: ZHI[i % 12] as Zhi };
});

/** 甲子序号（0–59）→ 干支 */
export function ganZhiAt(index: number): GanZhi {
  return JIA_ZI[((index % 60) + 60) % 60];
}

/** 干支 → 甲子序号（0–59）；非法组合抛错 */
export function ganZhiIndex(gan: Gan, zhi: Zhi): number {
  const gi = GAN.indexOf(gan);
  const zi = ZHI.indexOf(zhi);
  if (gi < 0 || zi < 0 || gi % 2 !== zi % 2) {
    throw new Error(`非法干支组合：${gan}${zhi}（天干地支阴阳不同，不在六十甲子中）`);
  }
  // 解 x ≡ gi (mod 10), x ≡ zi (mod 12)，在 [0,60) 内唯一
  for (let x = 0; x < 60; x += 1) {
    if (x % 10 === gi && x % 12 === zi) return x;
  }
  throw new Error(`unreachable: ${gan}${zhi}`);
}

/** 干支字符串，如 '甲子' */
export function ganZhiText(gz: GanZhi): string {
  return `${gz.gan}${gz.zhi}`;
}

/**
 * 六旬表：旬首干支 → 旬空两地支（4.8 空亡）。
 * 甲子旬空戌亥、甲戌旬空申酉、甲申旬空午未、
 * 甲午旬空辰巳、甲辰旬空寅卯、甲寅旬空子丑。
 */
export const XUN_KONG: Readonly<Record<string, readonly [Zhi, Zhi]>> = {
  甲子: ['戌', '亥'],
  甲戌: ['申', '酉'],
  甲申: ['午', '未'],
  甲午: ['辰', '巳'],
  甲辰: ['寅', '卯'],
  甲寅: ['子', '丑'],
} as const;

/** 由干支序号求所属旬首（0 / 10 / 20 / 30 / 40 / 50 六旬之一） */
export function xunStartIndex(index: number): number {
  const i = ((index % 60) + 60) % 60;
  return Math.floor(i / 10) * 10;
}

/** 求两地支（旬空） */
export function xunKongOf(index: number): readonly [Zhi, Zhi] {
  const head = JIA_ZI[xunStartIndex(index)];
  const key = `${head.gan}${head.zhi}`;
  const kong = XUN_KONG[key];
  if (!kong) throw new Error(`unreachable: 旬首 ${key} 未在六旬表中`);
  return kong;
}
