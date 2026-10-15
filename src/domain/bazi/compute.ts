/**
 * 命理内核对外入口。
 *
 * App.tsx 只依赖这里：
 *   import { computeBaziSafe } from '@/domain/bazi/compute';
 */
export { computeBazi, computeBaziSafe, makeSummary } from './chart';
export { computeSiZhu, localToUtcMs, assertValidInput, julianDayNumber, dayPillarIndex } from './siZhu';
export { buildTenGodNodes, shiShen } from './shiShen';
export { buildShenShaNodes, SHEN_SHA_RULES } from './shenSha';
export { pickIcon, ICON_KEYS, isIconKey } from './iconGlyph';
export type { ShenShaRule, Basis } from './shenSha';
