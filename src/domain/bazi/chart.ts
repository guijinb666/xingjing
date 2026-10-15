/**
 * 命盘汇总：《星境复刻实施方案》4.9 / 1.4。
 *
 * computeBazi 把四柱、十神、神煞合成一个 BaziChart，供 UI 直接消费。
 */
import type { BaziChart, ChartNode, NatalInput } from '../types';
import { computeSiZhu } from './siZhu';
import { buildTenGodNodes } from './shiShen';
import { buildShenShaNodes } from './shenSha';

/** summary 形如 '2001.01.01 · 午时'（原片右上角戳记的格式） */
export function makeSummary(input: NatalInput, shiChen: string): string {
  return `${input.date.replace(/-/g, '.')} · ${shiChen}`;
}

/**
 * 计算完整命盘。
 *
 * 节点顺序：先十神（透干 → 藏干），再神煞；
 * 布局层会按 group/kind 分圈，顺序只影响同圈内的角序。
 */
export function computeBazi(input: NatalInput): BaziChart {
  const siZhu = computeSiZhu(input);
  const tenGods = buildTenGodNodes(siZhu);
  const shenSha = buildShenShaNodes(siZhu);
  const nodes: ChartNode[] = [...tenGods, ...shenSha];

  return {
    input,
    siZhu,
    nodes,
    summary: makeSummary(input, siZhu.shiChen),
  };
}

/**
 * 容错版：任何异常都吞成 null，保证 UI 永远不会因排盘失败而白屏。
 * 内景组件在 chart 为 null 时会退回内置占位节点。
 */
export function computeBaziSafe(input: NatalInput): BaziChart | null {
  try {
    return computeBazi(input);
  } catch {
    return null;
  }
}
