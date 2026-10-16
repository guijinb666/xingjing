/**
 * 命理与运势解读 · 数据层。
 *
 * ============================ 诚实性总声明 ============================
 * 本文件的所有输出**都是传统子平命理规则推演的结果**，不是科学预测。
 * 详见文件末尾导出的 `FORTUNE_DISCLAIMER`，该常量必须在页面上可见。
 * ====================================================================
 *
 * ## 一、数据从哪来（不重算，只消费内核）
 *
 * | 本文件产出            | 来源                                   |
 * |-----------------------|----------------------------------------|
 * | 四柱 / 纳音 / 旬空    | `siZhu.computeSiZhu` 的 `SiZhu`（直取） |
 * | 十神统计              | `shiShen.buildTenGodNodes`（不重新判定）|
 * | 神煞吉凶              | `shenSha.buildShenShaNodes` + `SHEN_SHA_RULES.luck` |
 *
 * 唯一的二次加工是**五行力量加权**与**大运/流年排布**，两者的口径都在下面对应
 * 位置逐条写明理由。
 *
 * ## 二、五行力量权重取值理由（第 2 节）
 *
 * 计分对象是八个字：四个**天干** + 四个**地支**。地支不自带五行，其力量由
 * 「藏干」体现（见 `constants/cangGan.ts`）。传统口径里，藏干有本气（主气）、
 * 中气、余气之别，**本气力量最大，余气最小**。本项目取：
 *
 *   · 天干：**10 分**。天干透出、直接发生生克，是命局里最「显」的一层。
 *   · 地支本气：**8 分**。地支之力量由藏干承载，本气即该支的主导五行。
 *     取 8 而非 10，是因为地支终归是「承载者」，其力须经藏干透出方才显发；
 *     取 8 而非更低，是因为在地支**无**透干可倚时，本气仍是该支的实际主导。
 *   · 地支中气：**4 分**（本气的一半）。
 *   · 地支余气：**2 分**（本气的四分之一）。
 *
 * 中气/余气按 **1/2、1/4 等比递减**，不是随手取的两个数：藏干表本身就是按
 * 「旺 → 相 → 余」的力量下降次序排列的（见 `cangGan.ts` 文件头注释与
 * 「辰藏戊乙癸、午藏丁己」两条被原片画面直接验证的基准），等比折半是这一
 * 次序最简的数值化表达。故只出现 8/4/2 三档，不引入第四档。
 *
 * 单支三藏（如寅藏甲丙戊）时合计 8+4+2=14 分 > 单干 10 分，这是**刻意的**：
 * 杂气支所包者多，其综合承载力理应高于一个天干。
 *
 * 日主（日干）本身**计入木火土金水中其所属的一行**（不特殊排除）——
 * 传统上「日主」是论命原点，但它同时也是这八个字之一，其自身五行的存在
 * 不应被抹掉；强弱之分在下一节用「同类/异类」处理，不靠在这里剔除。
 *
 * ## 三、日主强弱阈值（第 3 节）
 *
 * 以日干五行为我，把五行按十神关系分成两阵营：
 *   · **同类** = 比劫（同我）+ 印（生我）  —— 帮身
 *   · **异类** = 食伤（我生）+ 财（我克）+ 官杀（克我）—— 耗身
 *
 * 判据为同类占**双方之和**的百分比：
 *   · `>= 55%` → 偏强
 *   · `45% ~ 55%`（不含两端）→ 中和
 *   · `< 45%` → 偏弱
 *
 * **阈值取值理由**：55/45 是「五五开 ± 一成」的表述。一方要超过一半才算
 * 「占了上风」，只比一半多一点（如 51%）不足以称强弱 —— 那还在「中和」的
 * 正常浮动范围内；但若超过六成（如 65%），命局就明显一边倒了，因此也不能把
 * 阈值放得太宽。取一成（10 个百分点）作为中和带宽，是传统命理实务里常见
 * 的「略强/略弱仍作中和论」的量化表达。此处是**本项目的量化口径**，并非
 * 某家经典的既定数字，故显式标注。
 *
 * ## 四、大运排法（第 7 节）—— 简化排法声明
 *
 * **本文件采用的是简化排法，不是完整的传统大运排法。** 逐条声明如下：
 *
 *  1. **顺逆**：阳年男 / 阴年女 → 顺排；阴年男 / 阳年女 → 逆排。
 *     这里「阳年/阴年」取**年干阴阳**（甲丙戊庚壬为阳）。这是传统口径。
 *  2. **起点**：自**月柱**干支起步，顺排则月柱 +1、逆排则月柱 −1，逐位递进。
 *  3. **起运岁数：本文件简化为「固定 1 岁起运」**。传统排法须计算从出生到
 *     下一个（顺排）或上一个（逆排）**节**的天数，按「三日折一年」换算成
 *     若干年零若干月起运，是个连续值。本项目**不做这个换算**，直接以 1 岁
 *     起运、每步整十年。**这是本文件最主要的简化点**，会使起运年份比传统
 *     排法有 ±1~2 年的偏差。
 *  4. **大运干支只取「干」定十神**：一步大运的十神按该步**天干**相对日主判定
 *     （`shiShen.dayGan, step.gan`），因为天干是该步的主导、最直观。传统上
 *     大运需干支合看，此处简化为只看干。
 *  5. **每步十年**（10 岁一步），共八步，覆盖 1~80 岁。
 *
 * ## 五、旺衰评级（大运 / 流年）如何得出
 *
 * 评级**不是写死的**，也**不是**查表：由第 4 步产出的 `favorable`（喜用）/
 * `unfavorable`（忌神）与该项的十神所属五行比对得出 ——
 *
 *   · 该十神的五行 ∈ 喜用 → `吉`
 *   · 该十神的五行 ∈ 忌神 → `凶`
 *   · 两者都不是（即中神）→ `平`
 *
 * 于是「改一个输入 → 日主强弱变 → 喜忌变 → 大运与流年的吉凶整列跟着变」，
 * 全链路可复算，没有任何一处是硬编码的结论。
 */
import type { Gan, GanZhi, PillarName, ShiShenName, SiZhu, WuXing, Zhi } from '../types';
import { GAN } from '../constants/gan';
import { ZHI } from '../constants/zhi';
import { CANG_GAN } from '../constants/cangGan';
import { SHENG, SHENG_BY, KE, isYangGan } from '../constants/relations';
import { buildTenGodNodes, shiShen, wuXingOfGan } from './shiShen';
import { buildShenShaNodes, SHEN_SHA_RULES } from './shenSha';

// ============================================================ 常量与口径

/** 喜用/忌神推导链里的每一环 */
export interface Derivation {
  /** 该行推导的标题，如「日主甲木」 */
  readonly title: string;
  /** 该行的依据文字 */
  readonly body: string;
}

/**
 * 诚实性声明。
 *
 * **必须在页面上可见**（`FortuneSection` 的落款处渲染），不能只写在代码里。
 * 措辞刻意直白、不软化：这里没有「仅供参考」这种含糊词，而是明确写出
 * 「不是科学预测」，避免读者把它当成任何一种预测工具。
 */
export const FORTUNE_DISCLAIMER =
  '本站的命理与运势解读，是以传统子平命理的规则（四柱、十神、神煞、五行生克）' +
  '对输入生辰所做的推演，属于文化与娱乐性质的内容，不是科学预测，' +
  '不构成任何形式的命运判断、医疗建议、投资建议或人生决策依据。' +
  '请把它当作一面镜子，而不是一张地图。';

/** 五行固定次序，全文件只用这一个顺序，保证前后端展示一致 */
export const WU_XING_ORDER: readonly WuXing[] = ['木', '火', '土', '金', '水'] as const;

/** 天干分值：透出、直接生克，最「显」的一层 */
const GAN_SCORE = 10;
/** 地支本气（藏干首项）分值 */
const BEN_QI_SCORE = 8;
/** 中气折半 */
const ZHONG_QI_SCORE = 4;
/** 余气再折半 */
const YU_QI_SCORE = 2;

/** 日主强弱阈值：同类占比 >= 此值 → 偏强 */
const STRONG_THRESHOLD = 55;
/** 日主强弱阈值：同类占比 < 此值 → 偏弱；两者之间为中和 */
const WEAK_THRESHOLD = 45;

/** 大运步数与每步年数（见文件头「四、大运排法」） */
const LUCK_CYCLES = 8;
const YEARS_PER_CYCLE = 10;
/** 简化起运岁数：固定 1 岁（见文件头第 3 条） */
const START_AGE = 1;

/** 流年个数 */
const FLOW_YEARS = 5;

// ============================================================ 产出类型
// 按任务边界要求：新类型一律定义并 export 在本文件内，不改 types.ts

/** 一柱的展示信息 */
export interface PillarView {
  readonly pillar: PillarName;
  readonly ganZhi: string;
  readonly gan: Gan;
  readonly zhi: Zhi;
  /** 纳音，取自 siZhu.naYin（不重算） */
  readonly naYin: string;
  /** 该柱天干相对日主的十神；日柱为日主本体，为 null */
  readonly shiShen: ShiShenName | null;
  /** 该支是否落旬空 */
  readonly xunKong: boolean;
}

/** 五行力量的一档 */
export interface WuXingScore {
  readonly element: WuXing;
  /** 加权原始分 */
  readonly score: number;
  /** 占比，0~100，全体四舍五入后保证合计恰为 100 */
  readonly pct: number;
}

/** 日主强弱 */
export type StrengthLevel = '偏强' | '中和' | '偏弱';

export interface StrengthView {
  readonly level: StrengthLevel;
  readonly dayMaster: Gan;
  readonly dayMasterElement: WuXing;
  /** 同类（比劫+印）加权分 */
  readonly allyScore: number;
  /** 异类（食伤+财+官杀）加权分 */
  readonly rivalScore: number;
  /** 同类占比，保留一位小数 */
  readonly allyPct: number;
  /** 判定依据文字（含实际阈值，页面上要显示出来） */
  readonly basis: string;
}

/** 喜用神 / 忌神 */
export interface FavorableView {
  readonly favorable: readonly WuXing[];
  readonly unfavorable: readonly WuXing[];
  readonly derivation: readonly Derivation[];
}

/** 十神格局 */
export interface PatternView {
  /** 出现次数最多的十神，并列时取十神表次序靠前者 */
  readonly dominant: ShiShenName;
  readonly dominantCount: number;
  /** 全部十神按次数降序 */
  readonly counts: ReadonlyArray<{ name: ShiShenName; count: number }>;
  /** 命盘中一次都没出现的十神 */
  readonly missing: readonly ShiShenName[];
  readonly reading: string;
}

/** 神煞要点的一条 */
export interface ShenShaBrief {
  readonly name: string;
  readonly luck: '吉' | '凶' | '中';
  /** 命中的柱 */
  readonly pillar: PillarName;
  /** 命中的地支 */
  readonly hitZhi: readonly Zhi[];
  /** 规则表里的说明（`ShenShaRule.note`），可能为空 */
  readonly note: string;
}

export interface ShenShaView {
  readonly auspicious: readonly ShenShaBrief[];
  readonly ominous: readonly ShenShaBrief[];
  readonly neutral: readonly ShenShaBrief[];
  /** 吉神 / 凶煞的条数摘要 */
  readonly tally: string;
}

/** 大运一步 */
export interface LuckCycle {
  /** 第几步，1 起 */
  readonly index: number;
  readonly ganZhi: string;
  readonly gan: Gan;
  readonly zhi: Zhi;
  /** 相对日主的十神（按本步天干判定，见文件头第 4 条） */
  readonly shiShen: ShiShenName;
  readonly startAge: number;
  readonly endAge: number;
  /** 该步十神五行的旺衰评级，由喜用忌神推出 */
  readonly rating: '吉' | '平' | '凶';
  /** 评级理由 */
  readonly reason: string;
}

/** 流年一年 */
export interface FlowYear {
  readonly year: number;
  readonly ganZhi: string;
  readonly gan: Gan;
  readonly zhi: Zhi;
  readonly shiShen: ShiShenName;
  readonly rating: '吉' | '平' | '凶';
  readonly reason: string;
}

/** 完整解读报告 */
export interface FortuneReport {
  readonly pillars: readonly PillarView[];
  readonly wuxingBars: readonly WuXingScore[];
  readonly strongest: WuXing;
  readonly weakest: WuXing;
  readonly strength: StrengthView;
  readonly favorableView: FavorableView;
  readonly pattern: PatternView;
  readonly shenSha: ShenShaView;
  readonly luckCycles: readonly LuckCycle[];
  readonly flowYears: readonly FlowYear[];
  /** 排法口径摘要，页面落款处展示（诚实性要求） */
  readonly methodNote: string;
}

// ============================================================ 主入口

/**
 * 由四柱推演出完整解读报告。纯函数，无副作用，可重复调用。
 *
 * @param siZhu   命理内核算出的四柱（唯一数值来源）
 * @param gender  性别，用于大运顺逆（阳年男/阴年女顺排）。缺省时退化为按年干阴阳
 * @param birthYear 出生公历年（一般取 `NatalInput.date` 前四位）。缺省时由年柱反查，
 *                 **生于立春前会偏早一年**，故调用方应尽量传入
 */
export function buildFortuneReport(
  siZhu: SiZhu,
  gender?: '男' | '女',
  birthYear?: number,
): FortuneReport {
  const scores = computeWuXingScores(siZhu);
  const bars = toBars(scores);
  const strongest = pickExtreme(bars, 'max');
  const weakest = pickExtreme(bars, 'min');
  const strength = judgeStrength(siZhu, bars);
  const favorableView = deriveFavorable(strength, bars);
  const pattern = readPattern(siZhu);
  const shenSha = summarizeShenSha(siZhu);
  const luckCycles = buildLuckCycles(siZhu, favorableView, gender);
  const flowYears = buildFlowYears(siZhu, favorableView, birthYearOf(siZhu, birthYear));

  return {
    pillars: buildPillars(siZhu),
    wuxingBars: bars,
    strongest,
    weakest,
    strength,
    favorableView,
    pattern,
    shenSha,
    luckCycles,
    flowYears,
    methodNote:
      `五行权重：天干 ${GAN_SCORE} · 本气 ${BEN_QI_SCORE} · 中气 ${ZHONG_QI_SCORE} · 余气 ${YU_QI_SCORE}；` +
      `强弱阈值：同类占比 ≥ ${STRONG_THRESHOLD}% 偏强、< ${WEAK_THRESHOLD}% 偏弱；` +
      `大运为简化排法（${START_AGE} 岁起运、每步 ${YEARS_PER_CYCLE} 年，未作交节折年换算）` +
      (gender === undefined ? '，且未取性别，顺逆按年干阴阳定。' : '。'),
  };
}

/** 容错版：任何异常都吞成 null，页面退回「内核尚未产出」态，绝不白屏 */
export function buildFortuneReportSafe(
  siZhu: SiZhu | null | undefined,
  gender?: '男' | '女',
  birthYear?: number,
): FortuneReport | null {
  if (!siZhu) return null;
  try {
    return buildFortuneReport(siZhu, gender, birthYear);
  } catch {
    return null;
  }
}

// ============================================================ 1. 四柱总览

function buildPillars(siZhu: SiZhu): PillarView[] {
  const dayGan = siZhu.dayMaster;
  const list: Array<{ pillar: PillarName; gz: GanZhi }> = [
    { pillar: '年柱', gz: siZhu.year },
    { pillar: '月柱', gz: siZhu.month },
    { pillar: '日柱', gz: siZhu.day },
    { pillar: '时柱', gz: siZhu.hour },
  ];

  return list.map(({ pillar, gz }) => ({
    pillar,
    ganZhi: `${gz.gan}${gz.zhi}`,
    gan: gz.gan,
    zhi: gz.zhi,
    naYin: siZhu.naYin[pillar] ?? '',
    // 日柱天干即日主本体，不作十神论
    shiShen: pillar === '日柱' ? null : shiShen(dayGan, gz.gan),
    xunKong: siZhu.xunKong.includes(gz.zhi),
  }));
}

// ============================================================ 2. 五行力量

/**
 * 加权统计五行力量。口径见文件头「二、五行力量权重取值理由」。
 *
 * 遍历八个字：4 天干各 GAN_SCORE；4 地支按其藏干表，第 0 项本气、
 * 第 1 项中气、第 2 项余气，分别按 BEN_QI_SCORE / ZHONG_QI_SCORE / YU_QI_SCORE 计。
 */
export function computeWuXingScores(siZhu: SiZhu): Record<WuXing, number> {
  const acc: Record<WuXing, number> = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };

  const gans: Gan[] = [siZhu.year.gan, siZhu.month.gan, siZhu.day.gan, siZhu.hour.gan];
  const zhis: Zhi[] = [siZhu.year.zhi, siZhu.month.zhi, siZhu.day.zhi, siZhu.hour.zhi];

  for (const gan of gans) acc[wuXingOfGan(gan)] += GAN_SCORE;

  for (const zhi of zhis) {
    const hidden = CANG_GAN[zhi];
    hidden.forEach((gan, i) => {
      const w = i === 0 ? BEN_QI_SCORE : i === 1 ? ZHONG_QI_SCORE : YU_QI_SCORE;
      acc[wuXingOfGan(gan)] += w;
    });
  }

  return acc;
}

/**
 * 转成条形图用的 [{element, score, pct}]。
 *
 * 占比用「最大余数法」取整，保证五档**合计恰为 100**（四舍五入会让合计变成
 * 99 或 101，页面上五个百分数加起来不等于 100 是硬伤）。
 */
export function toBars(acc: Record<WuXing, number>): WuXingScore[] {
  const total = WU_XING_ORDER.reduce((s, e) => s + acc[e], 0);
  if (total <= 0) {
    return WU_XING_ORDER.map((element) => ({ element, score: 0, pct: 0 }));
  }

  const raw = WU_XING_ORDER.map((element) => ({ element, score: acc[element], pct: (acc[element] / total) * 100 }));
  const floor = raw.map((r) => ({ ...r, base: Math.floor(r.pct), rem: r.pct - Math.floor(r.pct) }));
  let rest = 100 - floor.reduce((s, r) => s + r.base, 0);

  // 余数从大到小依次补 1，直到凑满 100
  const order = [...floor].sort((a, b) => b.rem - a.rem);
  for (const item of order) {
    if (rest <= 0) break;
    item.base += 1;
    rest -= 1;
  }

  return floor.map((r) => ({ element: r.element, score: r.score, pct: r.base }));
}

function pickExtreme(bars: readonly WuXingScore[], mode: 'max' | 'min'): WuXing {
  // 并列时取 WU_XING_ORDER 中靠前者（木火土金水），保证结果确定
  return bars.reduce((best, cur) => {
    if (mode === 'max') return cur.score > best.score ? cur : best;
    return cur.score < best.score ? cur : best;
  }, bars[0]).element;
}

// ============================================================ 3. 日主强弱

/**
 * 同类 = 比劫（同我五行）+ 印（生我五行）；异类 = 其余三行。
 * 阈值见文件头「三、日主强弱阈值」。
 */
function judgeStrength(siZhu: SiZhu, bars: readonly WuXingScore[]): StrengthView {
  const me = wuXingOfGan(siZhu.dayMaster);
  // 印 = 生我；比劫 = 同我
  const yin = SHENG_BY[me];
  const allyElements = new Set<WuXing>([me, yin]);

  let ally = 0;
  let rival = 0;
  for (const b of bars) {
    if (allyElements.has(b.element)) ally += b.score;
    else rival += b.score;
  }

  const total = ally + rival;
  const allyPct = total > 0 ? Math.round((ally / total) * 1000) / 10 : 0;

  let level: StrengthLevel;
  if (allyPct >= STRONG_THRESHOLD) level = '偏强';
  else if (allyPct < WEAK_THRESHOLD) level = '偏弱';
  else level = '中和';

  const basis =
    `以日主${siZhu.dayMaster}${me}为我：同类为${me}（比劫）与${yin}（印）；` +
    `异类为${rivalElementText(me)}。` +
    `同类 ${ally} 分 / 异类 ${rival} 分，同类占比 ${allyPct}%。` +
    `口径：≥ ${STRONG_THRESHOLD}% 为偏强、< ${WEAK_THRESHOLD}% 为偏弱，其间为中和，故判为${level}。`;

  return { level, dayMaster: siZhu.dayMaster, dayMasterElement: me, allyScore: ally, rivalScore: rival, allyPct, basis };
}

function rivalElementText(me: WuXing): string {
  const shiShang = SHENG[me]; // 我生 → 食伤
  const cai = KE[me]; // 我克 → 财
  // 克我 → 官杀：即 KE 表中以「我」为结果的那一项
  const guanSha = (Object.keys(KE) as WuXing[]).find((k) => KE[k] === me) as WuXing;
  return `${shiShang}（食伤）、${cai}（财）、${guanSha}（官杀）`;
}

// ============================================================ 4. 喜用 / 忌神

/**
 * 由强弱 + 分布推喜忌，并给出逐条推导链。
 *
 * 基本法度（传统「扶抑」一路，本文件采用）：
 *   · 日主偏弱 → 宜**生扶**：喜「印」（生我）与「比劫」（同我）；忌「官杀」（克我）、
 *     「财」（我克，耗身）、「食伤」（我生，泄身）。
 *   · 日主偏强 → 宜**克泄耗**：喜「食伤」（泄我之秀）、「财」（我克而用）、
 *     「官杀」（克我而制）；忌「印」（再生则太过）与「比劫」（再帮则愈旺）。
 *   · 中和 → 喜「流通」：取全局最弱的一行来补，使之不偏枯；忌最旺的一行。
 *     这是最温和的取法 —— 命局本身已平衡，不宜再大补大泄。
 *
 * 额外一条：若某行**占比为 0**（完全不见），在偏弱时它若是印/比劫则优先列入喜用
 * （有明确的缺口要补），在偏强时它若是食伤/财/官杀则优先列入喜用（有明确的出口）。
 */
function deriveFavorable(strength: StrengthView, bars: readonly WuXingScore[]): FavorableView {
  const me = strength.dayMasterElement;
  const yin = SHENG_BY[me];
  const biJie = me;
  const shiShang = SHENG[me];
  const cai = KE[me];
  const guanSha = (Object.keys(KE) as WuXing[]).find((k) => KE[k] === me) as WuXing;

  const derivation: Derivation[] = [
    {
      title: `日主${strength.dayMaster}${me}`,
      body: `同类占比 ${strength.allyPct}%，判为${strength.level}。`,
    },
  ];

  let favorable: WuXing[];
  let unfavorable: WuXing[];

  if (strength.level === '偏弱') {
    favorable = [yin, biJie];
    unfavorable = [guanSha, cai, shiShang];
    derivation.push({
      title: '偏弱则宜生扶',
      body:
        `${me}弱，须先有源头再有同伴：${yin}生${me}，为印，是第一位的补；` +
        `${me}为比劫，同类相扶，是第二位的补。二者先立，日主方能任事。`,
    });
    derivation.push({
      title: '忌耗身',
      body:
        `${guanSha}克${me}（官杀）为最忌，弱身不宜再受制；` +
        `${cai}为${me}所克（财），克则耗力；` +
        `${shiShang}为${me}所生（食伤），生则泄气。三者皆耗身，宜少不宜多。`,
    });
  } else if (strength.level === '偏强') {
    favorable = [shiShang, cai, guanSha];
    unfavorable = [yin, biJie];
    derivation.push({
      title: '偏强则宜克泄耗',
      body:
        `${me}旺，须给出路：${shiShang}为${me}所生，泄其秀气，是最顺的一路；` +
        `${cai}为${me}所克，旺者有余力去取，是可用之财；` +
        `${guanSha}克${me}，能为旺身立规矩。三者皆是这一局的用武之地。`,
    });
    derivation.push({
      title: '忌再助',
      body:
        `${yin}生${me}、${me}（比劫）同${me}，本已过旺，再补则壅塞不通，` +
        `反成「旺极无依」，故列为忌。`,
    });
  } else {
    // 中和：以「补最弱、抑最旺」为流通之法。
    // 注意忌神先于喜用定下，且二者**不得重叠** —— 最旺的一行既是壅滞之处，
    // 就不该同时是补益之方。若全局五行竟然均等（最弱 == 最旺不可能发生时），
    // 则只取最弱为喜、不设忌。
    const weakestEl = pickExtreme(bars, 'min');
    const strongestEl = pickExtreme(bars, 'max');
    unfavorable = weakestEl === strongestEl ? [] : [strongestEl];
    favorable = [weakestEl];
    derivation.push({
      title: '中和则论流通',
      body:
        `同类与异类相去不远（同类 ${strength.allyPct}%），命局本已平衡，` +
        `不宜大补大泄，只取全局最弱的一行调理，使五行周转不偏枯。`,
    });
    derivation.push({
      title: '取最弱与最旺',
      body:
        `全局最弱为${weakestEl}（${bars.find((b) => b.element === weakestEl)?.pct ?? 0}%），` +
        `最旺为${strongestEl}（${bars.find((b) => b.element === strongestEl)?.pct ?? 0}%）。` +
        `弱者为缺口，旺者为壅滞，一补一泄，气机自通。`,
    });
  }

  // 完全不见的一行（占比 0%），在定义上就是最明确的缺口，提到喜用最前。
  // 但若该行本已被判为忌神（如偏强时的印/比劫），则不因「缺」而翻案 ——
  // 「缺」是提示，不覆盖扶抑大法。
  const absent = bars.filter((b) => b.score === 0).map((b) => b.element);
  const promoted = absent.filter((e) => !unfavorable.includes(e));
  if (promoted.length > 0) {
    favorable = uniq([...promoted, ...favorable]);
    derivation.push({
      title: '缺者先补',
      body:
        `全局不见${promoted.join('、')}（占比 0%），此为该命局最明确的缺口，故置于喜用之首。`,
    });
  }

  return {
    favorable: WU_XING_ORDER.filter((e) => favorable.includes(e)),
    unfavorable: WU_XING_ORDER.filter((e) => unfavorable.includes(e) && !favorable.includes(e)),
    derivation,
  };
}

function uniq<T>(list: readonly T[]): T[] {
  return [...new Set(list)];
}

// ============================================================ 5. 十神格局

/** 复用 buildTenGodNodes 的结果做统计，不重新判定十神 */
function readPattern(siZhu: SiZhu): PatternView {
  const nodes = buildTenGodNodes(siZhu);
  const tally = new Map<ShiShenName, number>();
  for (const n of nodes) {
    const name = n.name as ShiShenName;
    tally.set(name, (tally.get(name) ?? 0) + 1);
  }

  // 按次序枚举十个十神，保证并列时结果确定
  const TEN_GOD_ORDER: readonly ShiShenName[] = [
    '比肩', '劫财', '食神', '伤官', '偏财', '正财', '七杀', '正官', '偏印', '正印',
  ];

  const counts = TEN_GOD_ORDER.map((name) => ({ name, count: tally.get(name) ?? 0 }));
  const sorted = [...counts].sort((a, b) => b.count - a.count || TEN_GOD_ORDER.indexOf(a.name) - TEN_GOD_ORDER.indexOf(b.name));
  const dominant = sorted[0];
  const missing = counts.filter((c) => c.count === 0).map((c) => c.name);

  const reading =
    `命盘共 ${nodes.length} 个十神（含透干与藏干），以${dominant.name}为最旺（${dominant.count} 见）。` +
    (missing.length > 0
      ? `另有${missing.join('、')}未见于本局。`
      : '十神十种俱全，气象较为驳杂。') +
    '此节只作格局轻重之参考，不作断语。';

  return {
    dominant: dominant.name,
    dominantCount: dominant.count,
    counts: sorted,
    missing,
    reading,
  };
}

// ============================================================ 6. 神煞要点

/** 复用 buildShenShaNodes 与 SHEN_SHA_RULES.luck，不另立吉凶 */
function summarizeShenSha(siZhu: SiZhu): ShenShaView {
  const nodes = buildShenShaNodes(siZhu);
  const briefs: ShenShaBrief[] = nodes.map((n) => {
    const rule = SHEN_SHA_RULES.find((r) => r.name === n.name);
    return {
      name: n.name,
      luck: rule?.luck ?? '中',
      pillar: n.pillar,
      hitZhi: n.hitZhi ?? [],
      note: rule?.note ?? '',
    };
  });

  const by = (luck: '吉' | '凶' | '中') => briefs.filter((b) => b.luck === luck);
  const auspicious = by('吉');
  const ominous = by('凶');
  const neutral = by('中');

  return {
    auspicious,
    ominous,
    neutral,
    tally: `吉神 ${auspicious.length} 条 · 凶煞 ${ominous.length} 条` + (neutral.length > 0 ? ` · 中 ${neutral.length} 条` : ''),
  };
}

// ============================================================ 7. 大运八步

/**
 * 排八步大运。口径见文件头「四、大运排法」——**简化排法**，
 * 起运固定 1 岁，未作交节折年换算。
 */
function buildLuckCycles(siZhu: SiZhu, fav: FavorableView, gender?: '男' | '女'): LuckCycle[] {
  const forward = isForwardLuck(siZhu, gender);
  const me = wuXingOfGan(siZhu.dayMaster);
  const monthIdx = ganZhiIndexOf(siZhu.month.gan, siZhu.month.zhi);
  const steps: LuckCycle[] = [];

  for (let i = 0; i < LUCK_CYCLES; i++) {
    // 顺排自月柱 +1 起；逆排自月柱 −1 起。步内以 60 甲子循环。
    const offset = forward ? i + 1 : -(i + 1);
    const idx = (((monthIdx + offset) % 60) + 60) % 60;
    const gan = GAN[idx % 10];
    const zhi = ZHI[idx % 12];
    const name = shiShen(siZhu.dayMaster, gan);
    const rated = rateShiShen(name, me, fav);

    steps.push({
      index: i + 1,
      ganZhi: `${gan}${zhi}`,
      gan,
      zhi,
      shiShen: name,
      startAge: START_AGE + i * YEARS_PER_CYCLE,
      endAge: START_AGE + (i + 1) * YEARS_PER_CYCLE - 1,
      rating: rated.rating,
      reason: rated.reason,
    });
  }

  return steps;
}

/**
 * 顺逆判定：阳年男 / 阴年女 顺排；阴年男 / 阳年女 逆排。
 * 「阳年」取年干阴阳（甲丙戊庚壬为阳），与 `relations.isYangGan` 同口径。
 *
 * 性别必须由调用方提供 —— `SiZhu` 里没有性别字段。若拿不到性别（例如
 * 直接由四柱推演的场合），按传统「以年论」的简化口径退化为「阳年顺、阴年逆」，
 * 并在 `genderKnown=false` 时由页面在排法说明里标注这一点。
 */
function isForwardLuck(siZhu: SiZhu, gender: '男' | '女' | undefined): boolean {
  const yearYang = isYangGan(siZhu.year.gan);
  if (gender === undefined) return yearYang;
  return yearYang ? gender === '男' : gender === '女';
}

/** 干支在六十甲子中的序号 */
function ganZhiIndexOf(gan: Gan, zhi: Zhi): number {
  const g = GAN.indexOf(gan);
  const z = ZHI.indexOf(zhi);
  // 解同余：idx ≡ g (mod 10), idx ≡ z (mod 12)
  for (let i = 0; i < 60; i++) {
    if (i % 10 === g && i % 12 === z) return i;
  }
  return 0;
}

/**
 * 由喜用忌神给一个十神评级。
 *
 * 该十神的五行 ∈ 喜用 → 吉；∈ 忌神 → 凶；两者皆非 → 平。
 * 完全不查表、不写死。
 */
function rateShiShen(
  name: ShiShenName,
  dayMasterElement: WuXing,
  fav: FavorableView,
): { rating: '吉' | '平' | '凶'; reason: string } {
  const el = resolveShiShenElement(dayMasterElement, name);
  if (fav.favorable.includes(el)) {
    return { rating: '吉', reason: `${name}属${el}，为喜用，故吉。` };
  }
  if (fav.unfavorable.includes(el)) {
    return { rating: '凶', reason: `${name}属${el}，为忌神，故凶。` };
  }
  return { rating: '平', reason: `${name}属${el}，不在喜忌之列，故平。` };
}

/**
 * 十神名 → 相对日主的「关系」。
 * 由关系可以在已知日主五行时算出绝对五行：
 *   同 → me；我生 → SHENG[me]；我克 → KE[me]；克我 → 克我者；生我 → SHENG_BY[me]
 *
 * 本表是 `shiShen.ts` 里 `shiShen()` 判定表的逆推，二者必须同构：
 * 那边由「五行关系 × 阴阳同异」定名，这边由名回推关系。
 */
const SHI_SHEN_RELATION: Readonly<Record<ShiShenName, '同' | '我生' | '我克' | '克我' | '生我'>> = {
  比肩: '同', 劫财: '同',
  食神: '我生', 伤官: '我生',
  偏财: '我克', 正财: '我克',
  七杀: '克我', 正官: '克我',
  偏印: '生我', 正印: '生我',
};

/** 由日主五行 + 十神名，真算出该十神所属五行 */
function resolveShiShenElement(dayMasterElement: WuXing, name: ShiShenName): WuXing {
  switch (SHI_SHEN_RELATION[name]) {
    case '同':
      return dayMasterElement;
    case '我生':
      return SHENG[dayMasterElement];
    case '我克':
      return KE[dayMasterElement];
    case '生我':
      return SHENG_BY[dayMasterElement];
    default:
      return (Object.keys(KE) as WuXing[]).find((k) => KE[k] === dayMasterElement) as WuXing;
  }
}

// ============================================================ 8. 流年五年

/**
 * 近五个流年。
 *
 * 取值口径：**自出生公历年起算的前五年**（出生年即第 1 个流年）。
 *
 * 注意年柱与公历年的错位：年柱以**立春**为界。2001-01-01 出生者立春未过，
 * 年柱仍是庚辰（庚辰年），但公历出生于 2001 年。故这里以**公历年份**现算每年的
 * 干支（1984 为甲子年，逐 60 年循环），而不是从年柱序号往后数 —— 后者会把
 * 首个流年算成 2000，比实际出生年早一年。
 *
 * 选「出生年起算」而非「系统当前年份」，是因为整站的其余部分都是**围绕出生
 * 时刻**展开的静态推演（星轨也停在出生时刻起算）；若这里接上系统当前时间，
 * 页面会随打开日期漂移、截图不可复现。
 */
function buildFlowYears(siZhu: SiZhu, fav: FavorableView, birthYear: number): FlowYear[] {
  const me = wuXingOfGan(siZhu.dayMaster);
  const out: FlowYear[] = [];

  for (let i = 0; i < FLOW_YEARS; i++) {
    const y = birthYear + i;
    const idx = (((y - 1984) % 60) + 60) % 60;
    const gan = GAN[idx % 10];
    const zhi = ZHI[idx % 12];
    const name = shiShen(siZhu.dayMaster, gan);
    const el = resolveShiShenElement(me, name);
    const rating: '吉' | '平' | '凶' = fav.favorable.includes(el)
      ? '吉'
      : fav.unfavorable.includes(el)
        ? '凶'
        : '平';

    out.push({
      year: y,
      ganZhi: `${gan}${zhi}`,
      gan,
      zhi,
      shiShen: name,
      rating,
      reason:
        rating === '吉'
          ? `流年${gan}属${el}，为喜用，故吉。`
          : rating === '凶'
            ? `流年${gan}属${el}，为忌神，故凶。`
            : `流年${gan}属${el}，不在喜忌之列，故平。`,
    });
  }

  return out;
}

/**
 * 出生公历年。
 *
 * 优先用调用方传入的真实公历年份（`NatalInput.date` 的前四位，最可靠）；
 * 拿不到时再由年柱干支反查 —— 取落在 [1900,2100) 内、与年柱同干支、
 * 且离锚点 1984 最近的年份。**该反查对「生于立春前」的日期会偏早一年**
 * （年柱尚属上一干支年），此时调用方应传 `knownYear`。
 */
function birthYearOf(siZhu: SiZhu, knownYear?: number): number {
  if (typeof knownYear === 'number' && Number.isFinite(knownYear)) return Math.trunc(knownYear);
  const idx = ganZhiIndexOf(siZhu.year.gan, siZhu.year.zhi);
  const anchor = 1984;
  let best = anchor;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let y = 1900; y < 2100; y++) {
    if ((((y - anchor) % 60) + 60) % 60 !== idx) continue;
    const dist = Math.abs(y - anchor);
    if (dist < bestDist) {
      bestDist = dist;
      best = y;
    }
  }
  return best;
}

// ============================================================ 供 UI 复用的插值

/** 十神 → 归属五行（对外暴露，页面着色用） */
export function shiShenElement(name: ShiShenName, dayMaster: Gan): WuXing {
  return resolveShiShenElement(wuXingOfGan(dayMaster), name);
}

/** 五行 → 十神关系的中文名，用于推导链展示 */
export function relationOfElement(dayMasterElement: WuXing, target: WuXing): string {
  if (target === dayMasterElement) return '比劫';
  if (SHENG[dayMasterElement] === target) return '食伤';
  if (KE[dayMasterElement] === target) return '财';
  if (SHENG_BY[dayMasterElement] === target) return '印';
  return '官杀';
}

export { resolveShiShenElement };
