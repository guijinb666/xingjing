/**
 * 十二「节」的精确交节时刻 —— 全部由 astronomy-engine 的 SearchSunLongitude 计算。
 *
 * 铁律（《星境复刻实施方案》4.3 / 9 风险表）：
 *   绝不使用近似日期表。节气当天必须按精确交节时分秒判定月柱/年柱。
 *   太阳视黄经到达 15° 整数倍的时刻即为节气时刻。
 *
 * 排盘只用「节」（立春、惊蛰…小寒），不用「气」（雨水、春分…冬至）。
 */
import { MakeTime, SearchSunLongitude } from 'astronomy-engine';
import type { Zhi } from '../types';

export interface JieDef {
  /** 节名 */
  readonly name: string;
  /** 太阳视黄经（度） */
  readonly lon: number;
  /** 该节起始后所在的月支 */
  readonly zhi: Zhi;
  /** 月名 */
  readonly monthName: string;
  /** 月建序数：从寅月 = 1 起算（寅1 卯2 辰3 巳4 午5 未6 申7 酉8 戌9 亥10 子11 丑12） */
  readonly ordinalFromYin: number;
}

/**
 * 十二节定义表（黄经 → 月支）。
 * 立春 315°、惊蛰 345°、清明 15°、立夏 45°、芒种 75°、小暑 105°、
 * 立秋 135°、白露 165°、寒露 195°、立冬 225°、大雪 255°、小寒 285°。
 */
export const JIE: readonly JieDef[] = [
  { name: '立春', lon: 315, zhi: '寅', monthName: '正月', ordinalFromYin: 1 },
  { name: '惊蛰', lon: 345, zhi: '卯', monthName: '二月', ordinalFromYin: 2 },
  { name: '清明', lon: 15, zhi: '辰', monthName: '三月', ordinalFromYin: 3 },
  { name: '立夏', lon: 45, zhi: '巳', monthName: '四月', ordinalFromYin: 4 },
  { name: '芒种', lon: 75, zhi: '午', monthName: '五月', ordinalFromYin: 5 },
  { name: '小暑', lon: 105, zhi: '未', monthName: '六月', ordinalFromYin: 6 },
  { name: '立秋', lon: 135, zhi: '申', monthName: '七月', ordinalFromYin: 7 },
  { name: '白露', lon: 165, zhi: '酉', monthName: '八月', ordinalFromYin: 8 },
  { name: '寒露', lon: 195, zhi: '戌', monthName: '九月', ordinalFromYin: 9 },
  { name: '立冬', lon: 225, zhi: '亥', monthName: '十月', ordinalFromYin: 10 },
  { name: '大雪', lon: 255, zhi: '子', monthName: '十一月', ordinalFromYin: 11 },
  { name: '小寒', lon: 285, zhi: '丑', monthName: '十二月', ordinalFromYin: 12 },
] as const;

/** 节名 → 定义 */
export const JIE_BY_NAME: Readonly<Record<string, JieDef>> = Object.freeze(
  JIE.reduce<Record<string, JieDef>>((acc, j) => {
    acc[j.name] = j;
    return acc;
  }, {}),
);

/**
 * 求某个黄经节气在某年附近的确切发生时刻（UTC）。
 *
 * 通过「取该黄经最接近 1 月 1 日的那一次发生」来消除年内歧义：
 * 以目标年 1 月 1 日为中心向前后各搜 200 天，取离中心最近的一次。
 * 这样每个 (年, 节) 组合都唯一对应一次交节。
 *
 * @param lon 目标视黄经（度）
 * @param year 公历年（用于定位搜索窗）
 * @returns 交节时刻（UTC Date），若搜索失败则抛错（节气不可静默缺失）
 */
export function findTermTime(lon: number, year: number): Date {
  // 以 1 月 1 日 00:00 UTC 为搜索窗中心，向前 200 天开始，窗口 400 天
  const centerMs = Date.UTC(year, 0, 1, 0, 0, 0);
  const startMs = centerMs - 200 * 86400000;

  // SearchSunLongitude 返回 >= start 的第一次发生；分两次探测以保证覆盖中心两侧
  const candidates: number[] = [];
  const first = SearchSunLongitude(lon, new Date(startMs), 400);
  if (first) candidates.push(first.date.getTime());

  // 再从中心开始搜一次，覆盖「第一次发生在中心之后」的情形
  const second = SearchSunLongitude(lon, new Date(centerMs), 200);
  if (second) candidates.push(second.date.getTime());

  if (candidates.length === 0) {
    throw new Error(`无法计算节气时刻：黄经 ${lon}°，年份 ${year}`);
  }

  // 取离 1 月 1 日最近的一次
  let best = candidates[0];
  for (const t of candidates) {
    if (Math.abs(t - centerMs) < Math.abs(best - centerMs)) best = t;
  }
  return new Date(best);
}

/** 求某个「节」在指定年份（该节所在节年）的交节时刻 */
export function jieTime(jieName: string, year: number): Date {
  const def = JIE_BY_NAME[jieName];
  if (!def) throw new Error(`未知的节：${jieName}`);
  return findTermTime(def.lon, year);
}

/**
 * 干支历「节年」归属：以立春为界的年序号。
 * 立春前 → 上一年；立春（含）后 → 本年。
 */
export function ganZhiYear(utcMs: number, tzOffset: number): number {
  // 该时刻的当地历年
  const local = new Date(utcMs + tzOffset * 3600000);
  const y = local.getUTCFullYear();

  // 与当年及上一年立春比较，取「含立春的节年」
  const lichunThis = jieTime('立春', y).getTime();
  const lichunPrev = jieTime('立春', y - 1).getTime();
  if (utcMs >= lichunThis) return y;
  if (utcMs >= lichunPrev) return y - 1;
  return y - 1;
}

/**
 * 定位某时刻所处的「节」区间：返回其后的那个节（prev）与其前的那个节（next）。
 * 供 SiZhu.boundary 展示使用。
 */
export function jieBounds(utcMs: number, tzOffset: number): {
  prev: { name: string; time: Date; zhi: Zhi; ordinalFromYin: number };
  next: { name: string; time: Date; zhi: Zhi; ordinalFromYin: number };
} {
  const localYear = new Date(utcMs + tzOffset * 3600000).getUTCFullYear();

  // 收集 localYear-1 到 localYear+1 三年的全部节时刻，排序后定位区间
  const all: Array<{ def: JieDef; time: Date }> = [];
  for (let y = localYear - 1; y <= localYear + 1; y += 1) {
    for (const def of JIE) {
      all.push({ def, time: findTermTime(def.lon, y) });
    }
  }
  all.sort((a, b) => a.time.getTime() - b.time.getTime());

  let prevIdx = -1;
  for (let i = 0; i < all.length; i += 1) {
    if (all[i].time.getTime() <= utcMs) prevIdx = i;
    else break;
  }
  if (prevIdx < 0 || prevIdx + 1 >= all.length) {
    throw new Error(`无法定位节气区间：utcMs=${utcMs}`);
  }
  const prev = all[prevIdx];
  const next = all[prevIdx + 1];
  return {
    prev: { name: prev.def.name, time: prev.time, zhi: prev.def.zhi, ordinalFromYin: prev.def.ordinalFromYin },
    next: { name: next.def.name, time: next.time, zhi: next.def.zhi, ordinalFromYin: next.def.ordinalFromYin },
  };
}

/**
 * 把 UTC 时刻格式化为当地钟表时间字符串 `YYYY-MM-DD HH:mm`。
 * SiZhu.boundary 的 prevJieTime / nextJieTime 即用此格式。
 */
export function formatLocalDateTime(utc: Date, tzOffset: number): string {
  const ms = utc.getTime() + tzOffset * 3600000;
  return formatUtcMs(ms);
}

/** 将「当地时钟毫秒」格式化为 `YYYY-MM-DD HH:mm`（按 UTC 读字段，因为已加过偏移） */
export function formatUtcMs(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 便于单测：MakeTime 包装（保持对 astronomy-engine 的显式引用） */
export function makeAstroTime(date: Date) {
  return MakeTime(date);
}
