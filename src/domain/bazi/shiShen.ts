/**
 * 十神：《星境复刻实施方案》4.6。
 *
 * 十神由「日干」对「目标天干」的五行生克 + 阴阳同异共同决定：
 *
 *              同五行        我生(泄)      我克(财)      克我(官杀)     生我(印)
 *   同阴阳      比肩          食神          偏财          七杀           偏印
 *   异阴阳      劫财          伤官          正财          正官           正印
 *
 * 节点展开（4.6）：
 *  - 四柱天干 → kind='透干'（日干本身不产生节点）
 *  - 四柱地支藏干 → kind='藏干'（含本气/中气/余气）
 */
import type {
  ChartNode,
  Gan,
  NodeKind,
  PillarName,
  ShiShenName,
  SiZhu,
  WuXing,
} from '../types';
import { GAN_META } from '../constants/gan';
import { CANG_GAN } from '../constants/cangGan';
import { SHENG, KE, SHENG_BY } from '../constants/relations';
import { PILLARS } from '../constants/relations';
import { pickIcon } from './iconGlyph';

/** 十神判定：日干 vs 目标天干 */
export function shiShen(dayGan: Gan, target: Gan): ShiShenName {
  const me = GAN_META[dayGan];
  const other = GAN_META[target];
  const sameYinYang = me.yinYang === other.yinYang;

  const rel = relationOf(me.wuXing, other.wuXing);

  switch (rel) {
    case '同':
      return sameYinYang ? '比肩' : '劫财';
    case '我生':
      return sameYinYang ? '食神' : '伤官';
    case '我克':
      return sameYinYang ? '偏财' : '正财';
    case '克我':
      return sameYinYang ? '七杀' : '正官';
    case '生我':
      return sameYinYang ? '偏印' : '正印';
    default:
      return '比肩';
  }
}

type Rel = '同' | '我生' | '我克' | '克我' | '生我';

function relationOf(me: WuXing, other: WuXing): Rel {
  if (me === other) return '同';
  if (SHENG[me] === other) return '我生';
  if (KE[me] === other) return '我克';
  if (KE[other] === me) return '克我';
  if (SHENG_BY[me] === other) return '生我';
  return '同';
}

/** 十神 → 五行（取目标天干五行，用于节点着色） */
export function wuXingOfGan(gan: Gan): WuXing {
  return GAN_META[gan].wuXing;
}

/**
 * 展开十神节点。
 *
 * 透干：四柱天干（跳过日干自身，日主不是「十神」）
 * 藏干：四柱地支的每一颗藏干
 *
 * 黄金用例应得恰好 10 个节点。
 */
export function buildTenGodNodes(siZhu: SiZhu): ChartNode[] {
  const dayGan = siZhu.dayMaster;
  const nodes: ChartNode[] = [];

  const pillarGanZhi: Array<{ pillar: PillarName; gan: Gan; zhi: import('../types').Zhi }> = [
    { pillar: '年柱', gan: siZhu.year.gan, zhi: siZhu.year.zhi },
    { pillar: '月柱', gan: siZhu.month.gan, zhi: siZhu.month.zhi },
    { pillar: '日柱', gan: siZhu.day.gan, zhi: siZhu.day.zhi },
    { pillar: '时柱', gan: siZhu.hour.gan, zhi: siZhu.hour.zhi },
  ];

  // ---- 透干 ----
  for (const p of pillarGanZhi) {
    if (p.pillar === '日柱') continue; // 日干为日主本体，不作为十神节点
    const name = shiShen(dayGan, p.gan);
    nodes.push({
      id: `tg-${pillarKey(p.pillar)}-${p.gan}`,
      name,
      group: '十神',
      kind: '透干' satisfies NodeKind,
      pillar: p.pillar,
      sourceStem: p.gan,
      icon: pickIcon(name, '十神'),
      wuXing: GAN_META[p.gan].wuXing,
    });
  }

  // ---- 藏干 ----
  for (const p of pillarGanZhi) {
    const hidden = CANG_GAN[p.zhi];
    hidden.forEach((g, i) => {
      const name = shiShen(dayGan, g);
      nodes.push({
        id: `cg-${pillarKey(p.pillar)}-${i}-${g}`,
        name,
        group: '十神',
        kind: '藏干' satisfies NodeKind,
        pillar: p.pillar,
        sourceStem: g,
        hitZhi: [p.zhi],
        icon: pickIcon(name, '十神'),
        wuXing: GAN_META[g].wuXing,
      });
    });
  }

  return nodes;
}

function pillarKey(p: PillarName): string {
  switch (p) {
    case '年柱':
      return 'y';
    case '月柱':
      return 'm';
    case '日柱':
      return 'd';
    default:
      return 'h';
  }
}

export { PILLARS };
