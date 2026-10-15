/**
 * 干支生克关系与遁法口诀表：《星境复刻实施方案》4.2 / 4.4 / 4.8。
 *
 * 本文件只放「关系表」，不放判定逻辑 —— 判定逻辑在 src/domain/bazi/ 下。
 */
import type { Gan, GanZhi, PillarName, WuXing, Zhi } from '../types';
import { GAN, GAN_YIN_YANG } from './gan';
import { ganZhiIndex } from './jiaZi';
import { ZHI } from './zhi';

/** 五行相生：我生 */
export const SHENG: Readonly<Record<WuXing, WuXing>> = {
  木: '火', 火: '土', 土: '金', 金: '水', 水: '木',
} as const;

/** 五行相克：我克 */
export const KE: Readonly<Record<WuXing, WuXing>> = {
  木: '土', 土: '水', 水: '火', 火: '金', 金: '木',
} as const;

/** 五行相泄：谁生我 */
export const SHENG_BY: Readonly<Record<WuXing, WuXing>> = {
  木: '水', 火: '木', 土: '火', 金: '土', 水: '金',
} as const;

/**
 * 五虎遁：年干 → 正月（寅月）月干。
 * 口诀：甲己之年丙作首，乙庚之岁戊为头，丙辛必定寻庚起，丁壬壬位顺行流，若言戊癸何方发，甲寅之上好追求。
 */
export const WU_HU_DUN: Readonly<Record<Gan, Gan>> = {
  甲: '丙', 己: '丙',
  乙: '戊', 庚: '戊',
  丙: '庚', 辛: '庚',
  丁: '壬', 壬: '壬',
  戊: '甲', 癸: '甲',
} as const;

/**
 * 五鼠遁：日干 → 子时时干。
 * 口诀：甲己还加甲，乙庚丙作初，丙辛从戊起，丁壬庚子居，戊癸何方发，壬子是真途。
 */
export const WU_SHU_DUN: Readonly<Record<Gan, Gan>> = {
  甲: '甲', 己: '甲',
  乙: '丙', 庚: '丙',
  丙: '戊', 辛: '戊',
  丁: '庚', 壬: '庚',
  戊: '壬', 癸: '壬',
} as const;

/**
 * 纳音五行表（4.8）：六十甲子每两个一组配一个纳音。
 * 顺序对应甲子旬起连续 30 组，即索引 floor(甲子序号 / 2)。
 */
export const NA_YIN_NAMES: readonly string[] = [
  '海中金', '炉中火', '大林木', '路旁土', '剑锋金',
  '山头火', '涧下水', '城头土', '白蜡金', '杨柳木',
  '泉中水', '屋上土', '霹雳火', '松柏木', '长流水',
  '沙中金', '山下火', '平地木', '壁上土', '金箔金',
  '覆灯火', '天河水', '大驿土', '钗钏金', '桑柘木',
  '大溪水', '沙中土', '天上火', '石榴木', '大海水',
] as const;

/** 纳音名 → 所属五行（用于童子煞等按纳音取用的规则） */
export const NA_YIN_WU_XING: Readonly<Record<string, WuXing>> = Object.freeze(
  NA_YIN_NAMES.reduce<Record<string, WuXing>>((acc, name) => {
    acc[name] = name.slice(-1) as WuXing;
    return acc;
  }, {}),
);

/** 由甲子序号（0–59）取纳音名 */
export function naYinByIndex(index: number): string {
  const i = ((index % 60) + 60) % 60;
  return NA_YIN_NAMES[Math.floor(i / 2)];
}

/** 由干支取纳音名 */
export function naYinOf(gan: Gan, zhi: Zhi): string {
  return naYinByIndex(ganZhiIndex(gan, zhi));
}

/** 四柱名，用于 SiZhu.naYin / ChartNode.pillar */
export const PILLARS: readonly PillarName[] = ['年柱', '月柱', '日柱', '时柱'] as const;

/** 天干 → 是否为阳干 */
export function isYangGan(gan: Gan): boolean {
  return GAN_YIN_YANG[gan] === '阳';
}

/** 该干支是否属于同一甲子序号（用于校验） */
export function sameParity(gan: Gan, zhi: Zhi): boolean {
  return GAN.indexOf(gan) % 2 === ZHI.indexOf(zhi) % 2;
}

/** 便于外部构造干支对象 */
export function gz(gan: Gan, zhi: Zhi): GanZhi {
  return { gan, zhi };
}
