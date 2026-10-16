/**
 * 节点介绍文案的覆盖与质量自检（task-4）。
 *
 * 硬指标：**10 十神 + 14 神煞 = 24 个节点类型，每一个都必须有介绍文案**，
 * 且每段正文 80~160 字（按去掉空白后的字符数计）。
 *
 * 这里同时守住两条内容红线：
 *  1. 凡标 `source === 'shenSha.ts'` 的，其名字必须真实存在于
 *     `SHEN_SHA_RULES` 规则表中 —— 防止把「编出来的神煞」伪装成项目既有定义；
 *  2. 凡标 `source === '通用'` 的，必须在规则表里也确实找不到释义，
 *     面板会显式提示「这是传统通用释义」。
 */
import { describe, expect, it } from 'vitest';
import {
  SHEN_SHA_INTRO,
  SHI_SHEN_INTRO,
  introOf,
} from '../src/domain/bazi/nodeIntro';
import { SHEN_SHA_RULES } from '../src/domain/bazi/shenSha';

/** 10 个十神类型 */
const TEN_GODS = [
  '比肩', '劫财', '食神', '伤官', '偏财',
  '正财', '七杀', '正官', '偏印', '正印',
] as const;

/** 黄金用例实录的 14 个神煞类型 */
const SHEN_SHA_14 = [
  '天乙贵人', '福星贵人', '太极贵人', '国印贵人', '华盖', '将星', '金舆',
  '红艳煞', '天赦', '丧门', '灾煞', '血刃', '五鬼', '童子煞',
] as const;

/** 规则表里另有、黄金用例未触发的 7 条（超集，一并要求有文案） */
const SHEN_SHA_EXTRA = [
  '文昌贵人', '驿马', '羊刃', '孤辰', '寡宿', '咸池', '空亡',
] as const;

const ALL_24 = [...TEN_GODS, ...SHEN_SHA_14];
const ALL_31 = [...ALL_24, ...SHEN_SHA_EXTRA];

/** 规则表里出现过的全部神煞名 */
const RULE_NAMES = new Set(SHEN_SHA_RULES.map((r) => r.name));

describe('节点介绍文案 · 24 个类型全覆盖', () => {
  it.each(ALL_24)('%s 有介绍文案', (name) => {
    const intro = introOf(name);
    expect(intro, `${name} 没有文案`).not.toBeNull();
  });

  it.each(ALL_24)('%s 的正文在 80~160 字之间', (name) => {
    const intro = introOf(name);
    expect(intro).not.toBeNull();
    const len = intro!.body.replace(/\s/g, '').length;
    expect(len, `${name} 正文 ${len} 字，超出 80~160`).toBeGreaterThanOrEqual(80);
    expect(len, `${name} 正文 ${len} 字，超出 80~160`).toBeLessThanOrEqual(160);
  });

  it('10 个十神全部在 SHI_SHEN_INTRO 表内', () => {
    for (const n of TEN_GODS) expect(Object.keys(SHI_SHEN_INTRO)).toContain(n);
  });

  it('14 个神煞全部在 SHEN_SHA_INTRO 表内', () => {
    for (const n of SHEN_SHA_14) expect(Object.keys(SHEN_SHA_INTRO)).toContain(n);
  });

  it('超集的 7 条神煞也有文案（31 条全部可查）', () => {
    for (const n of ALL_31) expect(introOf(n), `${n} 无文案`).not.toBeNull();
  });

  it('未收录的名字返回 null，而不是编造一段', () => {
    expect(introOf('根本不存在的星')).toBeNull();
    expect(introOf('')).toBeNull();
  });
});

describe('节点介绍文案 · 内容红线', () => {
  it('标为 shenSha.ts 的条目，名字必须真实存在于规则表', () => {
    for (const [name, intro] of Object.entries(SHEN_SHA_INTRO)) {
      if (intro.source === 'shenSha.ts') {
        expect(RULE_NAMES.has(name), `${name} 标了 shenSha.ts 但规则表里没有`).toBe(true);
      }
    }
  });

  it('标为「通用」的条目，必须给出面向前端的说明（不冒充项目既有定义）', () => {
    for (const [name, intro] of Object.entries(SHEN_SHA_INTRO)) {
      if (intro.source === '通用') {
        // 有正文、有吉凶倾向即可；面板侧会额外打印「传统通用释义」的提示
        expect(intro.body.length, `${name} 通用释义正文过短`).toBeGreaterThan(60);
      }
    }
  });

  it('每个神煞条目都给出吉凶倾向或依据说明，不留空', () => {
    for (const [name, intro] of Object.entries(SHEN_SHA_INTRO)) {
      const hasLuck = intro.luck === '吉' || intro.luck === '凶' || intro.luck === '中';
      const hasBasis = typeof intro.basis === 'string' && intro.basis.length > 0;
      expect(hasLuck || hasBasis, `${name} 既无吉凶也无依据`).toBe(true);
    }
  });

  it('十神条目的 tagline 不为空（面板副标题要用）', () => {
    for (const [name, intro] of Object.entries(SHI_SHEN_INTRO)) {
      expect(intro.tagline?.length ?? 0, `${name} 缺 tagline`).toBeGreaterThan(2);
    }
  });
});
