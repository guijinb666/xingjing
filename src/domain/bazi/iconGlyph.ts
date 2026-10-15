/**
 * 节点图标分配：《星境复刻实施方案》4.10 / 1.4。
 *
 * IconKey 只有 14 个取值（见 types.ts）。这里给出一张「名称 → 图标」的
 * 确定性映射表，保证同一命盘每次渲染得到完全相同的图标（可截图比对）。
 */
import type { IconKey, NodeGroup } from '../types';

export const ICON_KEYS: readonly IconKey[] = [
  'star', 'sun', 'moon', 'cross', 'flag', 'flower', 'gem',
  'hex', 'tri', 'spark', 'diamond', 'ring', 'square', 'hourglass',
] as const;

export function isIconKey(v: string): v is IconKey {
  return (ICON_KEYS as readonly string[]).includes(v);
}

/** 十神 → 图标：按「关系类别」取形，视觉上成组可辨 */
const SHI_SHEN_ICON: Readonly<Record<string, IconKey>> = {
  比肩: 'hex',
  劫财: 'hex',
  食神: 'spark',
  伤官: 'spark',
  偏财: 'diamond',
  正财: 'square',
  七杀: 'tri',
  正官: 'tri',
  偏印: 'ring',
  正印: 'ring',
};

/** 神煞 → 图标：吉星取光/花/宝石，凶煞取叉/三角，形态区分明显 */
const SHEN_SHA_ICON: Readonly<Record<string, IconKey>> = {
  天乙贵人: 'star',
  福星贵人: 'sun',
  太极贵人: 'ring',
  国印贵人: 'flag',
  文昌贵人: 'gem',
  天德贵人: 'sun',
  月德贵人: 'moon',
  华盖: 'flower',
  将星: 'star',
  金舆: 'gem',
  驿马: 'flag',
  红艳煞: 'flower',
  咸池: 'flower',
  天赦: 'sun',
  丧门: 'cross',
  灾煞: 'cross',
  血刃: 'diamond',
  五鬼: 'hex',
  童子煞: 'hourglass',
  孤辰: 'moon',
  寡宿: 'moon',
  羊刃: 'tri',
  空亡: 'square',
};

/** 未知名称的兜底：按名称 hash 稳定落在一个图标上 */
const FALLBACK: readonly IconKey[] = ['star', 'gem', 'ring', 'flower', 'spark'];

export function pickIcon(name: string, group: NodeGroup): IconKey {
  if (group === '十神') {
    const hit = SHI_SHEN_ICON[name];
    if (hit) return hit;
  } else {
    const hit = SHEN_SHA_ICON[name];
    if (hit) return hit;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return FALLBACK[h % FALLBACK.length];
}
