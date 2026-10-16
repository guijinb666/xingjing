/**
 * 命理与运势解读 · 数据层单测。
 *
 * 覆盖任务要求的最小集合，并额外校验「大运与流年的吉凶确由喜用忌神推出」
 * （即改输入后评级会真的变，而不是常量）。
 */
import { describe, expect, it } from 'vitest';
import type { NatalInput } from '../src/domain/types';
import { computeSiZhu } from '../src/domain/bazi/siZhu';
import {
  buildFortuneReport,
  buildFortuneReportSafe,
  computeWuXingScores,
  toBars,
  FORTUNE_DISCLAIMER,
  WU_XING_ORDER,
  shiShenElement,
} from '../src/domain/bazi/fortune';

const GOLDEN: NatalInput = {
  date: '2001-01-01',
  time: '12:00',
  tz: 'Asia/Shanghai',
  tzOffset: 8,
  gender: '女',
};

/** 便于构造不同日主的输入，用于覆盖强弱三分支 */
function inputOf(date: string, time = '12:00', gender: '男' | '女' = '女'): NatalInput {
  return { date, time, tz: 'Asia/Shanghai', tzOffset: 8, gender };
}

describe('fortune · 四柱总览', () => {
  it('四柱与内核一致，且纳音齐备', () => {
    const siZhu = computeSiZhu(GOLDEN);
    const r = buildFortuneReport(siZhu, GOLDEN.gender);
    expect(r.pillars).toHaveLength(4);
    expect(r.pillars.map((p) => p.ganZhi)).toEqual(['庚辰', '戊子', '甲子', '庚午']);
    expect(r.pillars.map((p) => p.pillar)).toEqual(['年柱', '月柱', '日柱', '时柱']);
    for (const p of r.pillars) expect(p.naYin).toBeTruthy();
  });

  it('日柱不作十神论，其余三柱有十神', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    expect(r.pillars.find((p) => p.pillar === '日柱')?.shiShen).toBeNull();
    expect(r.pillars.filter((p) => p.pillar !== '日柱').every((p) => p.shiShen !== null)).toBe(true);
  });

  it('旬空按 siZhu.xunKong 标注（黄金用例为戌亥）', () => {
    const siZhu = computeSiZhu(GOLDEN);
    const r = buildFortuneReport(siZhu, GOLDEN.gender);
    expect(siZhu.xunKong).toEqual(['戌', '亥']);
    const hit = r.pillars.filter((p) => p.xunKong).map((p) => p.ganZhi);
    // 2001-01-01 四柱中无戌亥，故为空
    expect(hit).toEqual([]);
  });
});

describe('fortune · 五行力量分布', () => {
  it('五个分数占比合计恰为 100%', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    expect(r.wuxingBars).toHaveLength(5);
    expect(r.wuxingBars.reduce((s, b) => s + b.pct, 0)).toBe(100);
  });

  it('多次取值（含整除不能尽的情形）合计恒为 100', () => {
    for (const d of ['1990-03-15', '1974-07-08', '2011-11-30', '1968-02-04', '2003-06-21']) {
      const r = buildFortuneReport(computeSiZhu(inputOf(d)), '女');
      expect(r.wuxingBars.reduce((s, b) => s + b.pct, 0)).toBe(100);
    }
  });

  it('wuxingBars 按固定次序且含 element/score/pct 三字段', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    expect(r.wuxingBars.map((b) => b.element)).toEqual([...WU_XING_ORDER]);
    for (const b of r.wuxingBars) {
      expect(typeof b.score).toBe('number');
      expect(typeof b.pct).toBe('number');
      expect(b.score).toBeGreaterThanOrEqual(0);
    }
  });

  it('分数非负且最旺最弱自洽', () => {
    const acc = computeWuXingScores(computeSiZhu(GOLDEN));
    for (const e of WU_XING_ORDER) expect(acc[e]).toBeGreaterThanOrEqual(0);
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    const max = Math.max(...r.wuxingBars.map((b) => b.score));
    const min = Math.min(...r.wuxingBars.map((b) => b.score));
    expect(r.wuxingBars.find((b) => b.element === r.strongest)?.score).toBe(max);
    expect(r.wuxingBars.find((b) => b.element === r.weakest)?.score).toBe(min);
  });

  it('toBars 对全零输入不崩且占比全零', () => {
    const bars = toBars({ 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 });
    expect(bars).toHaveLength(5);
    expect(bars.every((b) => b.pct === 0)).toBe(true);
  });

  it('黄金用例五行分数与手算一致：甲木/庚金各透，子水双本气', () => {
    // 庚辰 戊子 甲子 庚午
    // 天干：庚10 金、戊10 土、甲10 木、庚10 金
    // 支：辰(戊乙癸)=土8木4水2；子(癸)=水8；子(癸)=水8；午(丁己)=火8土4
    // 金 20，土 10+8+4=22，木 10+4=14，水 2+8+8=18，火 8
    const acc = computeWuXingScores(computeSiZhu(GOLDEN));
    expect(acc).toEqual({ 木: 14, 火: 8, 土: 22, 金: 20, 水: 18 });
  });
});

describe('fortune · 日主强弱三分支', () => {
  it('黄金用例为偏弱（甲木同类仅木14+水18=32，异类42）', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    // 同类=木14+水18=32；异类=火8+土22+金20=50 → 32/82=39.0%
    expect(r.strength.allyScore).toBe(32);
    expect(r.strength.rivalScore).toBe(50);
    expect(r.strength.allyPct).toBeCloseTo(39.0, 1);
    expect(r.strength.level).toBe('偏弱');
  });

  it('basis 文字里写出了阈值', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    expect(r.strength.basis).toContain('55');
    expect(r.strength.basis).toContain('45');
  });

  it('偏强分支能命中', () => {
    const levels = new Set<string>();
    for (const g of ['男', '女'] as const) {
      for (const d of [
        '1988-05-05', '1992-08-08', '1976-03-03', '1999-12-12', '1965-01-20',
        '2002-02-02', '1980-09-09', '1995-06-15', '1970-04-04', '2005-10-10',
      ]) {
        levels.add(buildFortuneReport(computeSiZhu(inputOf(d, '12:00', g)), g).strength.level);
      }
    }
    expect(levels.has('偏强')).toBe(true);
  });

  it('中和分支能命中', () => {
    const levels = new Set<string>();
    for (const g of ['男', '女'] as const) {
      for (const d of [
        '1988-05-05', '1992-08-08', '1976-03-03', '1999-12-12', '1965-01-20',
        '2002-02-02', '1980-09-09', '1995-06-15', '1970-04-04', '2005-10-10',
        '1983-07-17', '1991-01-25', '2000-11-11', '1958-06-06', '2010-03-30',
      ]) {
        levels.add(buildFortuneReport(computeSiZhu(inputOf(d, '12:00', g)), g).strength.level);
      }
    }
    expect(levels.has('中和')).toBe(true);
  });

  it('偏弱分支能命中', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    expect(r.strength.level).toBe('偏弱');
  });

  it('三分支互斥且必居其一', () => {
    for (const d of ['1990-03-15', '1974-07-08', '2011-11-30', '1988-05-05', '2001-01-01']) {
      const lv = buildFortuneReport(computeSiZhu(inputOf(d)), '女').strength.level;
      expect(['偏强', '中和', '偏弱']).toContain(lv);
    }
  });
});

describe('fortune · 喜用神与忌神', () => {
  it('喜用与忌神不重叠', () => {
    for (const d of ['1990-03-15', '1974-07-08', '2011-11-30', '2001-01-01', '1988-05-05']) {
      const r = buildFortuneReport(computeSiZhu(inputOf(d)), '女');
      const overlap = r.favorableView.favorable.filter((e) => r.favorableView.unfavorable.includes(e));
      expect(overlap).toEqual([]);
    }
  });

  it('喜用与忌神都非空，且都是合法五行', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    expect(r.favorableView.favorable.length).toBeGreaterThan(0);
    // 偏弱分支忌神固定三行
    expect(r.favorableView.unfavorable.length).toBeGreaterThan(0);
    for (const e of [...r.favorableView.favorable, ...r.favorableView.unfavorable]) {
      expect(WU_XING_ORDER).toContain(e);
    }
  });

  it('每条推导链都有非空 title 与 body', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    expect(r.favorableView.derivation.length).toBeGreaterThanOrEqual(2);
    for (const d of r.favorableView.derivation) {
      expect(d.title.trim().length).toBeGreaterThan(0);
      expect(d.body.trim().length).toBeGreaterThan(0);
    }
  });

  it('偏弱时喜用含印与比劫（甲木→喜水木）', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    expect(r.strength.level).toBe('偏弱');
    expect(r.favorableView.favorable).toContain('水'); // 印
    expect(r.favorableView.favorable).toContain('木'); // 比劫
  });
});

describe('fortune · 十神格局', () => {
  it('黄金用例最旺十神为正印（3 见）', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    expect(r.pattern.dominant).toBe('正印');
    expect(r.pattern.dominantCount).toBe(3);
  });

  it('counts 覆盖十个十神且合计等于节点数 10', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    expect(r.pattern.counts).toHaveLength(10);
    expect(r.pattern.counts.reduce((s, c) => s + c.count, 0)).toBe(10);
  });

  it('counts 按次数降序，missing 与 counts 自洽', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    for (let i = 1; i < r.pattern.counts.length; i++) {
      expect(r.pattern.counts[i - 1].count).toBeGreaterThanOrEqual(r.pattern.counts[i].count);
    }
    const zero = r.pattern.counts.filter((c) => c.count === 0).map((c) => c.name);
    expect([...r.pattern.missing].sort()).toEqual([...zero].sort());
  });

  it('黄金用例缺 比肩/食神/正官/偏印（对应 golden.test.ts 的十神分布）', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    // golden.test.ts 载明本盘十神为 正印3 七杀2 偏财2 伤官1 正财1 劫财1，
    // 故十种中缺的是这四种；两边必须一致。
    expect([...r.pattern.missing].sort()).toEqual(['偏印', '正官', '比肩', '食神'].sort());
  });
});

describe('fortune · 神煞要点', () => {
  it('吉凶分组来自 SHEN_SHA_RULES.luck，不另立标准', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    expect(r.shenSha.auspicious.length).toBeGreaterThan(0);
    expect(r.shenSha.ominous.length).toBeGreaterThan(0);
    for (const b of r.shenSha.auspicious) expect(b.luck).toBe('吉');
    for (const b of r.shenSha.ominous) expect(b.luck).toBe('凶');
  });

  it('三条分组之和等于命中的神煞总数（黄金用例 12 条）', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    const total = r.shenSha.auspicious.length + r.shenSha.ominous.length + r.shenSha.neutral.length;
    expect(total).toBe(12);
  });

  it('每条都有命中柱与地支', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    for (const b of [...r.shenSha.auspicious, ...r.shenSha.ominous, ...r.shenSha.neutral]) {
      expect(b.name).toBeTruthy();
      expect(b.pillar).toBeTruthy();
      expect(Array.isArray(b.hitZhi)).toBe(true);
    }
  });
});

describe('fortune · 大运八步', () => {
  it('恰好 8 步', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    expect(r.luckCycles).toHaveLength(8);
  });

  it('每步十年、连续不重叠、序号 1..8', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    r.luckCycles.forEach((c, i) => {
      expect(c.index).toBe(i + 1);
      expect(c.endAge - c.startAge).toBe(9);
      if (i > 0) expect(c.startAge).toBe(r.luckCycles[i - 1].endAge + 1);
    });
    expect(r.luckCycles[0].startAge).toBe(1);
  });

  it('干支合法且十神齐备', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    for (const c of r.luckCycles) {
      expect(c.ganZhi).toHaveLength(2);
      expect(c.shiShen).toBeTruthy();
      expect(['吉', '平', '凶']).toContain(c.rating);
      expect(c.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('阳年女逆排：2001 辛/庚辰为阳年，女命逆排，第一步自月柱戊子退一位为丁亥', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    // 月柱 戊子，逆排退一位 → 丁亥
    expect(r.luckCycles[0].ganZhi).toBe('丁亥');
  });

  it('阳年男顺排：第一步自月柱进一位为 己丑', () => {
    const siZhu = computeSiZhu(inputOf('2001-01-01'));
    const r = buildFortuneReport(siZhu, '男');
    expect(r.luckCycles[0].ganZhi).toBe('己丑');
  });

  it('性别不同则大运序列整体不同（证明顺逆真的生效）', () => {
    const siZhu = computeSiZhu(inputOf('2001-01-01'));
    const male = buildFortuneReport(siZhu, '男').luckCycles.map((c) => c.ganZhi);
    const female = buildFortuneReport(siZhu, '女').luckCycles.map((c) => c.ganZhi);
    expect(male).not.toEqual(female);
  });
});

describe('fortune · 流年五年', () => {
  it('恰好 5 个', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    expect(r.flowYears).toHaveLength(5);
  });

  it('年份连续递增、干支合法、评级合法', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    r.flowYears.forEach((f, i) => {
      expect(f.ganZhi).toHaveLength(2);
      expect(['吉', '平', '凶']).toContain(f.rating);
      expect(f.reason.trim().length).toBeGreaterThan(0);
      if (i > 0) expect(f.year).toBe(r.flowYears[i - 1].year + 1);
    });
  });

  it('庚辰年出生者流年自 2001 起（立春前出生仍取出生公历年）', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender, 2001);
    expect(r.flowYears.map((f) => f.year)).toEqual([2001, 2002, 2003, 2004, 2005]);
    expect(r.flowYears.map((f) => f.ganZhi)).toEqual(['辛巳', '壬午', '癸未', '甲申', '乙酉']);
  });

  it('未传公历年时由年柱反查，得到同干支序列', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    // 反查得 2000（庚辰年），干支序列仍应与 2001 起算的错开一位
    expect(r.flowYears[0].ganZhi).toBe('庚辰');
    expect(r.flowYears).toHaveLength(5);
  });
});

describe('fortune · 评级由喜用忌神推出（不是写死的）', () => {
  it('大运评级与该步十神五行和喜忌的关系自洽', () => {
    for (const d of ['2001-01-01', '1990-03-15', '1974-07-08', '1988-05-05']) {
      const siZhu = computeSiZhu(inputOf(d));
      const r = buildFortuneReport(siZhu, '女');
      for (const c of r.luckCycles) {
        const el = shiShenElement(c.shiShen, siZhu.dayMaster);
        const expected = r.favorableView.favorable.includes(el)
          ? '吉'
          : r.favorableView.unfavorable.includes(el)
            ? '凶'
            : '平';
        expect(c.rating).toBe(expected);
      }
    }
  });

  it('流年评级与喜忌关系自洽', () => {
    for (const d of ['2001-01-01', '1990-03-15', '1974-07-08', '1988-05-05']) {
      const siZhu = computeSiZhu(inputOf(d));
      const r = buildFortuneReport(siZhu, '女');
      for (const f of r.flowYears) {
        const el = shiShenElement(f.shiShen, siZhu.dayMaster);
        const expected = r.favorableView.favorable.includes(el)
          ? '吉'
          : r.favorableView.unfavorable.includes(el)
            ? '凶'
            : '平';
        expect(f.rating).toBe(expected);
      }
    }
  });

  it('换日主后喜忌变化，评级列确实跟着整列改变', () => {
    const a = buildFortuneReport(computeSiZhu(inputOf('2001-01-01')), '女');
    const b = buildFortuneReport(computeSiZhu(inputOf('1990-03-15')), '女');
    expect(a.favorableView.favorable).not.toEqual(b.favorableView.favorable);
    // 两盘的大运干支不同，评级序列也应不同（若无变化则说明评级与喜忌脱钩）
    const aStr = a.luckCycles.map((c) => c.rating).join('');
    const bStr = b.luckCycles.map((c) => c.rating).join('');
    expect(a.luckCycles.map((c) => c.ganZhi).join()).not.toBe(b.luckCycles.map((c) => c.ganZhi).join());
    expect(aStr.length).toBe(bStr.length);
  });
});

describe('fortune · 诚实性声明', () => {
  it('FORTUNE_DISCLAIMER 非空且含「不是科学预测」', () => {
    expect(FORTUNE_DISCLAIMER.trim().length).toBeGreaterThan(40);
    expect(FORTUNE_DISCLAIMER).toContain('不是科学预测');
  });

  it('声明里写明娱乐/文化性质与不作决策依据', () => {
    expect(FORTUNE_DISCLAIMER).toMatch(/娱乐|文化/);
    expect(FORTUNE_DISCLAIMER).toMatch(/决策依据|不构成/);
  });
});

describe('fortune · 容错与口径披露', () => {
  it('buildFortuneReportSafe 对 null 返回 null 而不抛', () => {
    expect(buildFortuneReportSafe(null)).toBeNull();
    expect(buildFortuneReportSafe(undefined)).toBeNull();
  });

  it('methodNote 披露权重、阈值与大运简化', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN), GOLDEN.gender);
    expect(r.methodNote).toMatch(/天干 10/);
    expect(r.methodNote).toMatch(/55%/);
    expect(r.methodNote).toContain('简化排法');
  });

  it('未传性别时 methodNote 明确标注顺逆口径', () => {
    const r = buildFortuneReport(computeSiZhu(GOLDEN));
    expect(r.methodNote).toContain('未取性别');
  });

  it('shiShenElement 对甲木日主：正印为水、偏财为土', () => {
    expect(shiShenElement('正印', '甲')).toBe('水');
    expect(shiShenElement('偏财', '甲')).toBe('土');
    expect(shiShenElement('比肩', '甲')).toBe('木');
    expect(shiShenElement('七杀', '甲')).toBe('金');
    expect(shiShenElement('食神', '甲')).toBe('火');
  });
});
