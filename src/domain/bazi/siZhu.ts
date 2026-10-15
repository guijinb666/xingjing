/**
 * 四柱排盘：《星境复刻实施方案》4.3–4.6。
 *
 * 铁律：
 *  1. 年柱以「立春」精确交节时刻为界（不是元旦、不是正月初一）。
 *  2. 月柱以十二「节」为界（立春→寅、惊蛰→卯…小寒→丑），用精确交节时刻判定。
 *  3. 日柱用干支纪日（儒略日算法），以当地钟表的「日」为单位。
 *  4. 时柱用五鼠遁，子时跨日（23:00–00:59）。
 *  5. 全程采用输入的当地钟表时间，**不做真太阳时校正**（与原片口径一致）。
 */
import type { Gan, GanZhi, NatalInput, PillarName, SiZhu, Zhi } from '../types';
import { GAN } from '../constants/gan';
import { ganZhiAt, ganZhiIndex, xunKongOf } from '../constants/jiaZi';
import { naYinOf, PILLARS } from '../constants/relations';
import { HOUR_TO_ZHI, ZHI, ZHI_META, ZHI_ZODIAC } from '../constants/zhi';
import {
  formatLocalDateTime,
  ganZhiYear,
  jieBounds,
  jieTime,
  JIE_BY_NAME,
} from '../constants/solarTerms';

/** 把「当地钟表时间 + 时区偏移」换算为 UTC 毫秒（不校正真太阳时） */
export function localToUtcMs(input: NatalInput): number {
  const [y, m, d] = input.date.split('-').map(Number);
  const [hh, mm] = input.time.split(':').map(Number);
  const ms = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
  return ms - input.tzOffset * 3600000;
}

/** 校验输入取值合法，非法直接抛错（由 computeBaziSafe 兜成 null） */
export function assertValidInput(input: NatalInput): void {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date);
  if (!m) throw new Error(`日期格式非法：${input.date}`);
  const y = Number(m[1]);
  if (y < 1900 || y > 2100) throw new Error(`年份超出支持范围 1900–2100：${y}`);
  if (!/^\d{2}:\d{2}$/.test(input.time)) throw new Error(`时间格式非法：${input.time}`);
  const hh = Number(input.time.slice(0, 2));
  const mi = Number(input.time.slice(3, 5));
  if (hh > 23 || mi > 59) throw new Error(`时间取值非法：${input.time}`);
  if (!Number.isFinite(input.tzOffset) || input.tzOffset < -12 || input.tzOffset > 14) {
    throw new Error(`时区偏移非法：${input.tzOffset}`);
  }
}

/**
 * 儒略日数（当地钟表的「日」，即 JDN，不含时刻小数）。
 *
 * 采用 Fliegel–Van Flandern 算法；此处只需整数日，
 * 且必须以「当地时间日期」为基准（出生地的日历日），
 * 故先把当地钟面字段直接当作 UTC 读出来再算。
 */
export function julianDayNumber(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const yy = year + 4800 - a;
  const mm = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * mm + 2) / 5) +
    365 * yy +
    Math.floor(yy / 4) -
    Math.floor(yy / 100) +
    Math.floor(yy / 400) -
    32045
  );
}

/**
 * 日柱：六十甲子纪日。
 *
 * 锚点：2000-01-07 为甲子日，其 Fliegel-Van Flandern JDN = 2451551
 * （注意：该算法在午夜返回 x.5 的整数部分，故 2000-01-07 得 2451551，
 *  不是天文儒略日 2451551.5 的四舍五入值 2451552 —— 这里差一位会让全盘日柱错一位）。
 * 校验：JDN(2001-01-01) = 2451911，与锚点相差 360 天，360 % 60 = 0，
 * 故 2001-01-01 亦为甲子日，与《星境复刻实施方案》黄金用例的「甲子」日柱一致。
 */
export const DAY_PILLAR_ANCHOR_JDN = 2451551;

export function dayPillarIndex(jdn: number): number {
  return ((jdn - DAY_PILLAR_ANCHOR_JDN) % 60 + 60) % 60;
}

/** 时辰干支：时支由钟点决定，时干用五鼠遁闭式公式 index = (日干index*2 + 时支index) % 10 */
export function hourGanZhi(dayGan: Gan, hour: number): GanZhi {
  const zhi = HOUR_TO_ZHI[hour];
  if (!zhi) throw new Error(`钟点非法：${hour}`);
  const ganIndex = ((GAN.indexOf(dayGan) * 2 + ZHI.indexOf(zhi)) % 10 + 10) % 10;
  return { gan: GAN[ganIndex] as Gan, zhi };
}

/**
 * 月柱：先定位所处「节」区间，再用五虎遁闭式公式定月干。
 *
 * 月干 index = (年干index * 2 + 从寅起算的月支序数 + 1) % 10
 * 该式已对五虎遁真值表逐项验算（10 年干 × 12 月建 = 120 项，零偏差）：
 *   甲己之年丙作首、乙庚之岁戊为头、丙辛必定寻庚起、
 *   丁壬壬位顺行流、戊癸之年甲寅求。
 * 例：庚年子月 -> (6*2 + 11 + 1) % 10 = 4 -> 戊，得「戊子」。
 *
 * 月支 index = (序数 + 1) % 12：因 ZHI[0]=子、ZHI[1]=丑、ZHI[2]=寅，
 * 而序数自寅起算为 1，故寅(1)->ZHI[2]、丑(12)->ZHI[13%12]=ZHI[1] 均正确。
 *
 * 注意：月支按月建（节气）取，与「农历月」无关。
 */
export function monthPillar(ganZhiYearValue: number, ordinalFromYin: number): GanZhi {
  const yearGanIndex = ((ganZhiYearValue - 4) % 10 + 10) % 10;
  const zhi = ZHI[(ordinalFromYin + 1) % 12] as Zhi;
  const ganIndex = ((yearGanIndex * 2 + ordinalFromYin + 1) % 10 + 10) % 10;
  return { gan: GAN[ganIndex] as Gan, zhi };
}

/** 年柱：干支纪年，以立春为界（干支年序号 → 甲子序号） */
export function yearPillar(ganZhiYearValue: number): GanZhi {
  // 公元 4 年为甲子年：甲子序号 = (年份 - 4) mod 60
  return ganZhiAt(ganZhiYearValue - 4);
}

/**
 * 汇总排盘。
 *
 * @param input 出生信息（当地钟表时间 + 时区偏移）
 */
export function computeSiZhu(input: NatalInput): SiZhu {
  assertValidInput(input);

  const utcMs = localToUtcMs(input);
  const [y, mo, d] = input.date.split('-').map(Number);
  const hour = Number(input.time.slice(0, 2));

  // ---- 年柱：以立春精确交节时刻为界 ----
  const gzYear = ganZhiYear(utcMs, input.tzOffset);
  const year = yearPillar(gzYear);

  // ---- 月柱：以所处「节」区间决定 ----
  const bounds = jieBounds(utcMs, input.tzOffset);
  const month = monthPillar(gzYear, bounds.prev.ordinalFromYin);

  // ---- 日柱：当地日期的干支纪日；23:00 后属次日子时（晚子时）----
  const dayJdn = julianDayNumber(y, mo, d);
  const dayIndex = dayPillarIndex(dayJdn);
  const day = ganZhiAt(dayIndex);

  // ---- 时柱：五鼠遁 ----
  const hourPillar = hourGanZhi(day.gan, hour);

  // ---- 旬空：以日柱所在旬为准 ----
  const kong = xunKongOf(dayIndex);

  // ---- 纳音：四柱各取 ----
  const naYin: Record<PillarName, string> = {
    年柱: naYinOf(year.gan, year.zhi),
    月柱: naYinOf(month.gan, month.zhi),
    日柱: naYinOf(day.gan, day.zhi),
    时柱: naYinOf(hourPillar.gan, hourPillar.zhi),
  };

  const shiChen = ZHI_META[hourPillar.zhi].shiChen;
  const zodiac = ZHI_ZODIAC[year.zhi];

  return {
    year,
    month,
    day,
    hour: hourPillar,
    dayMaster: day.gan,
    shiChen,
    zodiac,
    boundary: {
      prevJieName: bounds.prev.name,
      prevJieTime: formatLocalDateTime(bounds.prev.time, input.tzOffset),
      nextJieName: bounds.next.name,
      nextJieTime: formatLocalDateTime(bounds.next.time, input.tzOffset),
    },
    xunKong: [kong[0], kong[1]],
    naYin,
  };
}

/** 便于外部（如 summary 生成）复用的四柱起止节名 */
export function jieNameOfMonthZhi(zhi: Zhi): string {
  const found = Object.values(JIE_BY_NAME).find((j) => j.zhi === zhi);
  return found ? found.name : '';
}

/** 该年立春时刻（用于测试与调试） */
export function liChunTime(year: number): Date {
  return jieTime('立春', year);
}

/** 干支序号工具透出，便于测试 */
export { ganZhiIndex };

/** 四柱顺序常量透出 */
export { PILLARS };
