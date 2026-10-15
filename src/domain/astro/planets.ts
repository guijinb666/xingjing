/**
 * 八大天体（不含太阳）的静态定义。
 *
 * 数据来源：
 * - a（半长轴, AU）与 period（公转周期, 年）：JPL 行星轨道要素表
 * - color：tokens.color 中对应行星色（录屏逐帧取色）
 * - size（绘制半径 px @ 参考画布 1440×1080）：录屏实测
 */
import type { BodyDef, BodyKey } from '../types';
import { tokens } from '../../styles/tokens';

export const BODIES: BodyDef[] = [
  { key: 'Mercury', cn: '水星', color: tokens.color.mercury, a: 0.387, period: 0.241, size: 5 },
  { key: 'Venus', cn: '金星', color: tokens.color.venus, a: 0.723, period: 0.615, size: 7 },
  { key: 'Earth', cn: '地球', color: tokens.color.earth, a: 1.0, period: 1.0, size: 7 },
  { key: 'Mars', cn: '火星', color: tokens.color.mars, a: 1.524, period: 1.881, size: 6 },
  { key: 'Jupiter', cn: '木星', color: tokens.color.jupiter, a: 5.203, period: 11.86, size: 11 },
  { key: 'Saturn', cn: '土星', color: tokens.color.saturn, a: 9.537, period: 29.45, size: 10, hasRing: true },
  { key: 'Uranus', cn: '天王星', color: tokens.color.uranus, a: 19.19, period: 84.02, size: 8 },
  { key: 'Neptune', cn: '海王星', color: tokens.color.neptune, a: 30.07, period: 164.8, size: 8 },
];

/** key → BodyDef 的查表，用于渲染层按 key 取色/取名 */
export const BODY_BY_KEY: Record<BodyKey, BodyDef> = BODIES.reduce(
  (acc, b) => {
    acc[b.key] = b;
    return acc;
  },
  {} as Record<BodyKey, BodyDef>,
);
