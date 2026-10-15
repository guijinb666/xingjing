/**
 * 内景星图的极坐标布局。
 *
 * 设计依据（来自录屏逐帧测量）：
 * - 节点分三圈：神煞在外圈、藏干/透干在内圈，混排但半径不同
 * - 中心是打坐人形，所有节点与自己所属的「柱位」通过细线连接到中心
 * - 整圈随时间自转（globalTheta），节点本身还做半径呼吸
 *
 * 关键约束：布局必须**稳定** —— 同一份命盘每次渲染得到完全相同的角度，
 * 否则刷新页面节点就会乱跳。因此抖动只用名称 hash，不用 Math.random()。
 */
import type { ChartNode, LayoutNode } from '@/domain/types';
import { hashStr } from '@/render/iconRender';

/** 三圈基准半径（相对 1440×1080 参考画布中 中心到边缘的比例） */
export interface InnerLayoutOptions {
  cx: number;
  cy: number;
  /** 画布逻辑宽度，用于按比例缩放半径 */
  width: number;
  height: number;
  /** 内圈（透干）半径系数 */
  rTransparent?: number;
  /** 中圈（藏干）半径系数 */
  rHidden?: number;
  /** 外圈（神煞）半径系数 */
  rGod?: number;
}

export interface InnerLayoutResult {
  nodes: LayoutNode[];
  /** 用于绘制中心到节点连线的半径参考 */
  cx: number;
  cy: number;
  /** 三圈参考半径，渲染层用来画淡环 */
  rings: { transparent: number; hidden: number; god: number };
}

const TAU = Math.PI * 2;

/**
 * 极坐标分层布局。
 *
 * 半径策略：以外圈（神煞）半径 R 为基准
 *   - 神煞：R        （最外，数量最多，构成整圈骨架）
 *   - 藏干：R × 0.62
 *   - 透干：R × 0.40
 * 这样即使节点数变化，视觉层次也稳定。
 */
export function layoutInner(
  nodes: ChartNode[],
  opts: InnerLayoutOptions,
): InnerLayoutResult {
  const { cx, cy, width, height } = opts;

  // 外圈半径取短边的比例，保证椭圆形容器下也不出界
  const base = Math.min(width * 0.46, height * 0.46);
  const R_GOD = opts.rGod ?? base;
  const R_HID = opts.rHidden ?? R_GOD * 0.62;
  const R_TRA = opts.rTransparent ?? R_GOD * 0.4;

  const buckets: { nodes: ChartNode[]; r: number; offset: number }[] = [
    { nodes: nodes.filter((n) => n.group === '十神' && n.kind === '透干'), r: R_TRA, offset: -Math.PI / 3 },
    { nodes: nodes.filter((n) => n.group === '十神' && n.kind === '藏干'), r: R_HID, offset: 0 },
    { nodes: nodes.filter((n) => n.group === '神煞'), r: R_GOD, offset: Math.PI / 7 },
  ];

  const out: LayoutNode[] = [];

  for (const bucket of buckets) {
    const list = bucket.nodes;
    const n = list.length;
    if (n === 0) continue;

    // 数量多时步进变小，但抖动幅度保持不变（±5°）
    for (let i = 0; i < n; i++) {
      const node = list[i];
      const t = (i / n) * TAU + bucket.offset;
      const h = hashStr(node.id || node.name);
      // 固定抖动 ±5°，由名称 hash 决定 —— 同一命盘永远一致
      const jitter = ((h % 1000) / 1000 - 0.5) * (Math.PI / 18);
      // 半径上再做一点固定散开，避免同圈节点挤在一个环上
      const rJitter = 1 + (((h >> 10) % 1000) / 1000 - 0.5) * 0.12;
      const theta = t + jitter;
      const r = bucket.r * rJitter;

      node.r = r;
      node.theta = theta;
      node.phase = ((h >> 7) % 628) / 100;

      out.push({
        id: node.id,
        x: cx + Math.cos(theta) * r,
        y: cy + Math.sin(theta) * r,
        r,
        theta,
        alpha: 1,
        iconR: 14,
      });
    }
  }

  return {
    nodes: out,
    cx,
    cy,
    rings: { transparent: R_TRA, hidden: R_HID, god: R_GOD },
  };
}

/**
 * 单帧位置解算：叠加整圈自转 + 呼吸。
 * 渲染层每帧调用，不改变布局本身。
 */
export function nodePositionAt(
  layout: LayoutNode,
  cx: number,
  cy: number,
  globalTheta: number,
  breathe: number,
): { x: number; y: number; r: number } {
  const phase = (layout.r * 0.017) % TAU; // 由半径推出的稳定相位
  const r = layout.r + Math.sin(breathe * 0.001 + phase) * 6;
  const theta = layout.theta + globalTheta;
  return { x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r, r };
}
