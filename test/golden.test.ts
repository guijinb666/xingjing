/**
 * 黄金用例回归：《星境复刻实施方案》1.4 + 4.x。
 *
 * 这是整个项目的正确性锚点 —— 输入与预期全部来自实施方案，不得为了「跑绿」而调整。
 */
import { describe, expect, it } from 'vitest';
import type { NatalInput } from '../src/domain/types';
import { computeBazi, computeBaziSafe } from '../src/domain/bazi/compute';
import { computeSiZhu } from '../src/domain/bazi/siZhu';
import { shiShen } from '../src/domain/bazi/shiShen';

const GOLDEN: NatalInput = {
  date: '2001-01-01',
  time: '12:00',
  tz: 'Asia/Shanghai',
  tzOffset: 8,
  gender: '女',
};

/** 原片实录的 14 条神煞 */
const ORIGINAL_SHEN_SHA = [
  '天乙贵人', '福星贵人', '太极贵人', '国印贵人', '华盖', '将星', '金舆',
  '红艳煞', '天赦', '丧门', '灾煞', '血刃', '五鬼', '童子煞',
];

describe('黄金用例 2001-01-01 12:00 UTC+8 女', () => {
  it('四柱为 庚辰 / 戊子 / 甲子 / 庚午', () => {
    const siZhu = computeSiZhu(GOLDEN);
    expect(`${siZhu.year.gan}${siZhu.year.zhi}`).toBe('庚辰');
    expect(`${siZhu.month.gan}${siZhu.month.zhi}`).toBe('戊子');
    expect(`${siZhu.day.gan}${siZhu.day.zhi}`).toBe('甲子');
    expect(`${siZhu.hour.gan}${siZhu.hour.zhi}`).toBe('庚午');
  });

  it('日主为甲木、时辰为午时、生肖为龙', () => {
    const siZhu = computeSiZhu(GOLDEN);
    expect(siZhu.dayMaster).toBe('甲');
    expect(siZhu.shiChen).toBe('午时');
    expect(siZhu.zodiac).toBe('龙');
  });

  it('旬空为戌亥、纳音四柱齐备', () => {
    const siZhu = computeSiZhu(GOLDEN);
    expect(siZhu.xunKong).toEqual(['戌', '亥']);
    expect(Object.keys(siZhu.naYin).sort()).toEqual(['年柱', '月柱', '日柱', '时柱'].sort());
    expect(siZhu.naYin['年柱']).toBeTruthy();
  });

  it('节气边界字段齐备', () => {
    const siZhu = computeSiZhu(GOLDEN);
    expect(siZhu.boundary.prevJieName).toBeTruthy();
    expect(siZhu.boundary.nextJieName).toBeTruthy();
    expect(siZhu.boundary.prevJieTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(siZhu.boundary.nextJieTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('十神节点恰好 10 个，分布为 正印×3 七杀×2 偏财×2 伤官×1 正财×1 劫财×1', () => {
    const chart = computeBazi(GOLDEN);
    const tenGods = chart.nodes.filter((n) => n.group === '十神');
    expect(tenGods).toHaveLength(10);

    const dist: Record<string, number> = {};
    for (const n of tenGods) dist[n.name] = (dist[n.name] ?? 0) + 1;

    expect(dist).toEqual({
      正印: 3,
      七杀: 2,
      偏财: 2,
      伤官: 1,
      正财: 1,
      劫财: 1,
    });
  });

  it('十神节点同时覆盖透干与藏干两种类型', () => {
    const chart = computeBazi(GOLDEN);
    const kinds = new Set(chart.nodes.filter((n) => n.group === '十神').map((n) => n.kind));
    expect(kinds.has('透干')).toBe(true);
    expect(kinds.has('藏干')).toBe(true);
    // 日主本身不产生节点：透干应为 3 个（年月时）
    expect(chart.nodes.filter((n) => n.kind === '透干')).toHaveLength(3);
  });

  it('神煞与原片 14 条比对，命中率 ≥ 85%', () => {
    const chart = computeBazi(GOLDEN);
    const got = new Set(chart.nodes.filter((n) => n.group === '神煞').map((n) => n.name));
    const hit = ORIGINAL_SHEN_SHA.filter((name) => got.has(name));

    const rate = hit.length / ORIGINAL_SHEN_SHA.length;
    // 把实际命中情况打印出来，便于人工核对差异
    const missed = ORIGINAL_SHEN_SHA.filter((name) => !got.has(name));
    console.log(`神煞命中 ${hit.length}/${ORIGINAL_SHEN_SHA.length} = ${(rate * 100).toFixed(1)}%`);
    console.log(`命中：${hit.join(' ')}`);
    console.log(`未命中：${missed.join(' ')}`);
    console.log(`额外命中：${[...got].filter((n) => !ORIGINAL_SHEN_SHA.includes(n)).join(' ')}`);

    expect(rate).toBeGreaterThanOrEqual(0.85);
  });

  it('summary 形如 2001.01.01 · 午时', () => {
    const chart = computeBazi(GOLDEN);
    expect(chart.summary).toBe('2001.01.01 · 午时');
  });

  it('十神判定抽查：甲日见庚为七杀、见癸为正印、见戊为偏财', () => {
    expect(shiShen('甲', '庚')).toBe('七杀');
    expect(shiShen('甲', '癸')).toBe('正印');
    expect(shiShen('甲', '戊')).toBe('偏财');
    expect(shiShen('甲', '甲')).toBe('比肩');
    expect(shiShen('甲', '乙')).toBe('劫财');
  });
});

describe('边界用例', () => {
  it('立春当天：交节前后年柱应切换', () => {
    // 2024 立春约在 2 月 4 日 16:27（北京时间）
    const before: NatalInput = { ...GOLDEN, date: '2024-02-04', time: '00:00' };
    const after: NatalInput = { ...GOLDEN, date: '2024-02-05', time: '00:00' };
    const a = computeSiZhu(before);
    const b = computeSiZhu(after);
    // 立春前仍属癸卯年，立春后为甲辰年
    expect(`${a.year.gan}${a.year.zhi}`).toBe('癸卯');
    expect(`${b.year.gan}${b.year.zhi}`).toBe('甲辰');
  });

  it('小寒当天：月支应切换为丑', () => {
    const before: NatalInput = { ...GOLDEN, date: '2024-01-05', time: '00:00' };
    const after: NatalInput = { ...GOLDEN, date: '2024-01-07', time: '00:00' };
    expect(computeSiZhu(before).month.zhi).toBe('子');
    expect(computeSiZhu(after).month.zhi).toBe('丑');
  });

  it('23:30 晚子时：时支为子，且不抛错', () => {
    const late: NatalInput = { ...GOLDEN, date: '2001-01-01', time: '23:30' };
    const siZhu = computeSiZhu(late);
    expect(siZhu.hour.zhi).toBe('子');
    expect(siZhu.shiChen).toBe('子时');
  });

  it('computeBaziSafe 对非法输入返回 null 而不抛错', () => {
    expect(computeBaziSafe({ ...GOLDEN, date: '1800-01-01' })).toBeNull();
    expect(computeBaziSafe({ ...GOLDEN, date: 'not-a-date' })).toBeNull();
  });
});
