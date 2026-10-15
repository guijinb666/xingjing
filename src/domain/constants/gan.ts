/**
 * 十天干基础常量：《星境复刻实施方案》4.1 表。
 * 序号 1 起于甲，索引 0 起于甲（index = 序 - 1），与六十甲子序号口径一致。
 */
import type { Gan, WuXing, YinYang } from '../types';

/** 十天干，顺序即六十甲子中的天干顺序 */
export const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;

export interface GanMeta {
  readonly gan: Gan;
  /** 0 起序号，甲 = 0 */
  readonly index: number;
  readonly yinYang: YinYang;
  readonly wuXing: WuXing;
}

export const GAN_META: Readonly<Record<Gan, GanMeta>> = {
  甲: { gan: '甲', index: 0, yinYang: '阳', wuXing: '木' },
  乙: { gan: '乙', index: 1, yinYang: '阴', wuXing: '木' },
  丙: { gan: '丙', index: 2, yinYang: '阳', wuXing: '火' },
  丁: { gan: '丁', index: 3, yinYang: '阴', wuXing: '火' },
  戊: { gan: '戊', index: 4, yinYang: '阳', wuXing: '土' },
  己: { gan: '己', index: 5, yinYang: '阴', wuXing: '土' },
  庚: { gan: '庚', index: 6, yinYang: '阳', wuXing: '金' },
  辛: { gan: '辛', index: 7, yinYang: '阴', wuXing: '金' },
  壬: { gan: '壬', index: 8, yinYang: '阳', wuXing: '水' },
  癸: { gan: '癸', index: 9, yinYang: '阴', wuXing: '水' },
} as const;

/** 天干 → 阴阳 */
export const GAN_YIN_YANG: Readonly<Record<Gan, YinYang>> = {
  甲: '阳', 乙: '阴', 丙: '阳', 丁: '阴', 戊: '阳',
  己: '阴', 庚: '阳', 辛: '阴', 壬: '阳', 癸: '阴',
} as const;

/** 天干 → 五行 */
export const GAN_WU_XING: Readonly<Record<Gan, WuXing>> = {
  甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土',
  己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水',
} as const;

/** 天干五合（4.2 表） */
export const GAN_HE: ReadonlyArray<readonly [Gan, Gan, WuXing]> = [
  ['甲', '己', '土'],
  ['乙', '庚', '金'],
  ['丙', '辛', '水'],
  ['丁', '壬', '木'],
  ['戊', '癸', '火'],
] as const;

/** 阴阳 → 索引偏移：阳干取偶数位（甲丙戊庚壬），阴干取奇数位 */
export const YIN_YANG_OFFSET: Readonly<Record<YinYang, 0 | 1>> = { 阳: 0, 阴: 1 } as const;
