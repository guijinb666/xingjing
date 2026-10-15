/**
 * 地支藏干表：《星境复刻实施方案》4.5。
 * 顺序为「本气 → 中气 → 余气」，决定节点在同一柱内的排列次序。
 *
 * 加粗两项（辰藏 戊乙癸、午藏 丁己）已在原片中被画面标签直接验证，
 * 作为本表的正确性基准。
 */
import type { Gan, Zhi } from '../types';

export const CANG_GAN: Readonly<Record<Zhi, readonly Gan[]>> = {
  子: ['癸'],
  丑: ['己', '癸', '辛'],
  寅: ['甲', '丙', '戊'],
  卯: ['乙'],
  辰: ['戊', '乙', '癸'],
  巳: ['丙', '戊', '庚'],
  午: ['丁', '己'],
  未: ['己', '丁', '乙'],
  申: ['庚', '壬', '戊'],
  酉: ['辛'],
  戌: ['戊', '辛', '丁'],
  亥: ['壬', '甲'],
} as const;

/** 是否为「本气」（藏干列表首项） */
export function isBenQi(zhi: Zhi, gan: Gan): boolean {
  const list = CANG_GAN[zhi];
  return list.length > 0 && list[0] === gan;
}

/** 某柱藏干展开总数（十二地支合计 28 个藏干位） */
export function cangGanCount(zhi: Zhi): number {
  return CANG_GAN[zhi].length;
}
