/**
 * 十二地支基础常量：《星境复刻实施方案》4.1 表。
 * 索引 0 起于子，与六十甲子中地支顺序一致。
 * 时辰边界为整点划分（4.9 决策：不做分钟级真太阳时修正）——午 = 11:00–12:59。
 */
import type { WuXing, YinYang, Zhi } from '../types';

/** 十二地支，顺序即六十甲子中的地支顺序 */
export const ZHI = [
  '子', '丑', '寅', '卯', '辰', '巳',
  '午', '未', '申', '酉', '戌', '亥',
] as const;

export interface ZhiMeta {
  readonly zhi: Zhi;
  /** 0 起序号，子 = 0 */
  readonly index: number;
  readonly yinYang: YinYang;
  readonly wuXing: WuXing;
  /** 生肖 */
  readonly zodiac: string;
  /** 时辰名，如 '午时' */
  readonly shiChen: string;
  /**
   * 时辰覆盖的钟表小时（24 小时制，可能跨日）。
   * 子时为 [23, 0]（23:00–23:59 与 00:00–00:59），其余为无跨日的两小时区间。
   */
  readonly hours: readonly [number, number];
}

export const ZHI_META: Readonly<Record<Zhi, ZhiMeta>> = {
  子: { zhi: '子', index: 0, yinYang: '阳', wuXing: '水', zodiac: '鼠', shiChen: '子时', hours: [23, 0] },
  丑: { zhi: '丑', index: 1, yinYang: '阴', wuXing: '土', zodiac: '牛', shiChen: '丑时', hours: [1, 2] },
  寅: { zhi: '寅', index: 2, yinYang: '阳', wuXing: '木', zodiac: '虎', shiChen: '寅时', hours: [3, 4] },
  卯: { zhi: '卯', index: 3, yinYang: '阴', wuXing: '木', zodiac: '兔', shiChen: '卯时', hours: [5, 6] },
  辰: { zhi: '辰', index: 4, yinYang: '阳', wuXing: '土', zodiac: '龙', shiChen: '辰时', hours: [7, 8] },
  巳: { zhi: '巳', index: 5, yinYang: '阴', wuXing: '火', zodiac: '蛇', shiChen: '巳时', hours: [9, 10] },
  午: { zhi: '午', index: 6, yinYang: '阳', wuXing: '火', zodiac: '马', shiChen: '午时', hours: [11, 12] },
  未: { zhi: '未', index: 7, yinYang: '阴', wuXing: '土', zodiac: '羊', shiChen: '未时', hours: [13, 14] },
  申: { zhi: '申', index: 8, yinYang: '阳', wuXing: '金', zodiac: '猴', shiChen: '申时', hours: [15, 16] },
  酉: { zhi: '酉', index: 9, yinYang: '阴', wuXing: '金', zodiac: '鸡', shiChen: '酉时', hours: [17, 18] },
  戌: { zhi: '戌', index: 10, yinYang: '阳', wuXing: '土', zodiac: '狗', shiChen: '戌时', hours: [19, 20] },
  亥: { zhi: '亥', index: 11, yinYang: '阴', wuXing: '水', zodiac: '猪', shiChen: '亥时', hours: [21, 22] },
} as const;

/** 地支 → 生肖 */
export const ZHI_ZODIAC: Readonly<Record<Zhi, string>> = {
  子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龙', 巳: '蛇',
  午: '马', 未: '羊', 申: '猴', 酉: '鸡', 戌: '狗', 亥: '猪',
} as const;

/** 地支 → 五行 */
export const ZHI_WU_XING: Readonly<Record<Zhi, WuXing>> = {
  子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火',
  午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水',
} as const;

/** 地支 → 时辰名 */
export const ZHI_SHI_CHEN: Readonly<Record<Zhi, string>> = {
  子: '子时', 丑: '丑时', 寅: '寅时', 卯: '卯时', 辰: '辰时', 巳: '巳时',
  午: '午时', 未: '未时', 申: '申时', 酉: '酉时', 戌: '戌时', 亥: '亥时',
} as const;

/**
 * 24 个钟点 → 时支。11:00–12:59 为午时；23:00–23:59 与 00:00–00:59 同为子时。
 * 晚子时归当日、日柱不换（4.9 建议默认），此处仅负责时支归属。
 */
export const HOUR_TO_ZHI: Readonly<Record<number, Zhi>> = {
  0: '子', 1: '丑', 2: '丑',
  3: '寅', 4: '寅',
  5: '卯', 6: '卯',
  7: '辰', 8: '辰',
  9: '巳', 10: '巳',
  11: '午', 12: '午',
  13: '未', 14: '未',
  15: '申', 16: '申',
  17: '酉', 18: '酉',
  19: '戌', 20: '戌',
  21: '亥', 22: '亥',
  23: '子',
} as const;

/** 地支六合（4.2 表） */
export const ZHI_LIU_HE: ReadonlyArray<readonly [Zhi, Zhi, WuXing]> = [
  ['子', '丑', '土'],
  ['寅', '亥', '木'],
  ['卯', '戌', '火'],
  ['辰', '酉', '金'],
  ['巳', '申', '水'],
  ['午', '未', '土'],
] as const;

/** 地支六冲（4.2 表） */
export const ZHI_LIU_CHONG: ReadonlyArray<readonly [Zhi, Zhi]> = [
  ['子', '午'], ['丑', '未'], ['寅', '申'],
  ['卯', '酉'], ['辰', '戌'], ['巳', '亥'],
] as const;

/** 地支六害（4.2 表） */
export const ZHI_LIU_HAI: ReadonlyArray<readonly [Zhi, Zhi]> = [
  ['子', '未'], ['丑', '午'], ['寅', '巳'],
  ['卯', '辰'], ['申', '亥'], ['酉', '戌'],
] as const;

/** 三合局：局名 → 三支（用于神煞三合局规则） */
export const SAN_HE: Readonly<Record<'水' | '木' | '火' | '金', readonly [Zhi, Zhi, Zhi]>> = {
  水: ['申', '子', '辰'],
  木: ['亥', '卯', '未'],
  火: ['寅', '午', '戌'],
  金: ['巳', '酉', '丑'],
} as const;

/** 三会方（4.2 表） */
export const SAN_HUI: ReadonlyArray<readonly [Zhi, Zhi, Zhi]> = [
  ['寅', '卯', '辰'],
  ['巳', '午', '未'],
  ['申', '酉', '戌'],
  ['亥', '子', '丑'],
] as const;

/** 三刑（4.2 表） */
export const SAN_XING: ReadonlyArray<readonly [Zhi, Zhi, Zhi]> = [
  ['寅', '巳', '申'],
  ['丑', '戌', '未'],
] as const;

/** 自刑（4.2 表） */
export const ZI_XING: readonly Zhi[] = ['辰', '午', '酉', '亥'] as const;

/** 取模到 0–11 */
export function zhiIndex(zhi: Zhi): number {
  return ZHI_META[zhi].index;
}

/** 由 0 起序号取地支 */
export function zhiAt(index: number): Zhi {
  return ZHI[((index % 12) + 12) % 12] as Zhi;
}

/** 地支顺推 n 位（n 可为负） */
export function zhiAdd(zhi: Zhi, n: number): Zhi {
  return zhiAt(zhiIndex(zhi) + n);
}
