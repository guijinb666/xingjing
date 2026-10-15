/**
 * 神煞：《星境复刻实施方案》4.7。
 *
 * 设计原则（任务硬要求）：**数据驱动规则表，不用 if/else 硬编码**。
 * 每条规则声明：名称、吉凶、依据基准（年支/月支/日支/时支/年干/日干/月支序…）、
 * 查表内容、以及是否需要「双基准」（任一基准命中即算命中）。
 *
 * 关于「双基准」：不同命理流派对某些神煞的起例基准不一致（有的以年支为主，
 * 有的以日支为主）。原片命盘同时命中这些神煞，说明其采用的是「年、日并用」
 * 的宽口径。为与原片对齐且不篡改任何单条规则本身的查表内容，这里把基准
 * 声明为集合（BASIS 数组），命中任一即成立 —— 这是流派口径差异，不是规则造假。
 */
import type { ChartNode, Gan, SiZhu, Zhi } from '../types';
import { ZHI } from '../constants/zhi';
import { ganZhiIndex } from '../constants/jiaZi';
import { naYinOf } from '../constants/relations';
import { pickIcon } from './iconGlyph';

/** 起例基准：用哪个柱的哪个字去查表 */
export type Basis =
  | '年支'
  | '月支'
  | '日支'
  | '时支'
  | '年干'
  | '月干'
  | '日干'
  | '时干'
  | '年支三合'
  | '日支三合'
  | '年支季节'
  | '月支季节'
  | '日干纳音'
  | '月支序数';

/** 单条神煞规则 */
export interface ShenShaRule {
  /** 神煞名 */
  readonly name: string;
  /** 吉 / 凶（用于着色与图例） */
  readonly luck: '吉' | '凶' | '中';
  /** 查表基准（多基准 = 任一命中即算） */
  readonly bases: readonly Basis[];
  /**
   * 查表内容：基准字 → 目标地支集合。
   * 用 `Record<string, readonly Zhi[]>` 表达，新增规则只需加一行数据。
   */
  readonly table: Readonly<Record<string, readonly Zhi[]>>;
  /**
   * 「整柱比对」型规则（如天赦）：基准 key 需与某一柱的完整干支两字相等才算命中。
   * 例：冬 -> ['甲子']，即冬季须逢「甲子」日柱方为天赦。
   * 与 table 互斥；两者都提供时先判 exactPillar。
   */
  readonly exactPillar?: Readonly<Record<string, readonly string[]>>;
  /** 命中后展示用的说明 */
  readonly note?: string;
}

/** 三合局：地支 → 局 */
const SAN_HE_OF: Readonly<Record<Zhi, '水' | '木' | '火' | '金'>> = {
  申: '水', 子: '水', 辰: '水',
  亥: '木', 卯: '木', 未: '木',
  寅: '火', 午: '火', 戌: '火',
  巳: '金', 酉: '金', 丑: '金',
};

/** 三合局的「帝旺」支（将星取此） */
const SAN_HE_WANG: Readonly<Record<'水' | '木' | '火' | '金', Zhi>> = {
  水: '子', 木: '卯', 火: '午', 金: '酉',
};

/** 三合局的「墓库」支（华盖取此） */
const SAN_HE_MU: Readonly<Record<'水' | '木' | '火' | '金', Zhi>> = {
  水: '辰', 木: '未', 火: '戌', 金: '丑',
};

/** 季节（用于童子煞等按季节取用的规则）：寅卯辰春、巳午未夏、申酉戌秋、亥子丑冬 */
const SEASON_OF: Readonly<Record<Zhi, '春' | '夏' | '秋' | '冬'>> = {
  寅: '春', 卯: '春', 辰: '春',
  巳: '夏', 午: '夏', 未: '夏',
  申: '秋', 酉: '秋', 戌: '秋',
  亥: '冬', 子: '冬', 丑: '冬',
};

/**
 * 神煞规则表（≥19 条）。
 *
 * 表内容来源：《实施方案》4.7 表。凡该表未列而主流命书通行者，
 * 按《三命通会》《渊海子平》通行本补齐，并在 note 标注。
 */
export const SHEN_SHA_RULES: readonly ShenShaRule[] = [
  // ---------------- 贵人类（吉） ----------------
  {
    name: '天乙贵人',
    luck: '吉',
    bases: ['年干', '日干'],
    // 甲戊庚牛羊、乙己鼠猴乡、丙丁猪鸡位、壬癸兔蛇藏、六辛逢马虎
    table: {
      甲: ['丑', '未'], 戊: ['丑', '未'], 庚: ['丑', '未'],
      乙: ['子', '申'], 己: ['子', '申'],
      丙: ['亥', '酉'], 丁: ['亥', '酉'],
      壬: ['卯', '巳'], 癸: ['卯', '巳'],
      辛: ['午', '寅'],
    },
    note: '4.7 表口径',
  },
  {
    name: '福星贵人',
    luck: '吉',
    bases: ['年干', '日干'],
    // 甲丙相邀入虎乡、更游鼠穴、戊申己未、乙癸卯、丁亥、庚午、辛巳、壬辰
    table: {
      甲: ['寅'], 丙: ['寅', '子'],
      乙: ['卯'], 癸: ['卯'],
      戊: ['申'], 己: ['未'],
      丁: ['亥'], 庚: ['午'],
      辛: ['巳'], 壬: ['辰'],
    },
    note: '4.7 表口径',
  },
  {
    name: '太极贵人',
    luck: '吉',
    bases: ['年干', '日干'],
    // 甲乙生人子午中、丙丁鸡兔定亨通、戊己两干临四季、庚辛寅亥禄丰隆、壬癸巳申偏喜美
    table: {
      甲: ['子', '午'], 乙: ['子', '午'],
      丙: ['卯', '酉'], 丁: ['卯', '酉'],
      戊: ['辰', '戌', '丑', '未'], 己: ['辰', '戌', '丑', '未'],
      庚: ['寅', '亥'], 辛: ['寅', '亥'],
      壬: ['巳', '申'], 癸: ['巳', '申'],
    },
    note: '4.7 表口径',
  },
  {
    name: '国印贵人',
    luck: '吉',
    bases: ['年干', '日干'],
    // 甲见戌、乙见亥、丙见丑、丁见寅、戊见丑、己见寅、庚见辰、辛见巳、壬见未、癸见申
    table: {
      甲: ['戌'], 乙: ['亥'],
      丙: ['丑'], 丁: ['寅'],
      戊: ['丑'], 己: ['寅'],
      庚: ['辰'], 辛: ['巳'],
      壬: ['未'], 癸: ['申'],
    },
    note: '4.7 表口径',
  },
  {
    name: '文昌贵人',
    luck: '吉',
    bases: ['年干', '日干'],
    // 甲巳乙午丙戊申、丁己酉、庚亥辛子、壬寅癸卯
    table: {
      甲: ['巳'], 乙: ['午'],
      丙: ['申'], 戊: ['申'],
      丁: ['酉'], 己: ['酉'],
      庚: ['亥'], 辛: ['子'],
      壬: ['寅'], 癸: ['卯'],
    },
    note: '主流补充',
  },

  // ---------------- 三合类（吉） ----------------
  {
    name: '华盖',
    luck: '吉',
    bases: ['年支三合', '日支三合'],
    // 三合局的墓库支
    table: {
      水: [SAN_HE_MU['水']],
      木: [SAN_HE_MU['木']],
      火: [SAN_HE_MU['火']],
      金: [SAN_HE_MU['金']],
    },
    note: '申子辰见辰、亥卯未见未、寅午戌见戌、巳酉丑见丑',
  },
  {
    name: '将星',
    luck: '吉',
    bases: ['年支三合', '日支三合'],
    // 三合局的帝旺支
    table: {
      水: [SAN_HE_WANG['水']],
      木: [SAN_HE_WANG['木']],
      火: [SAN_HE_WANG['火']],
      金: [SAN_HE_WANG['金']],
    },
    note: '申子辰见子、亥卯未见卯、寅午戌见午、巳酉丑见酉',
  },
  {
    name: '驿马',
    luck: '中',
    bases: ['年支三合', '日支三合'],
    // 三合局的「冲」支：申子辰马在寅、亥卯未马在巳、寅午戌马在申、巳酉丑马在亥
    table: {
      水: ['寅'], 木: ['巳'], 火: ['申'], 金: ['亥'],
    },
    note: '主流补充',
  },

  // ---------------- 干支查表类 ----------------
  {
    name: '金舆',
    luck: '吉',
    bases: ['年干', '日干'],
    // 甲龙乙蛇丙戊羊、丁己猴、庚犬辛猪、壬牛癸虎
    table: {
      甲: ['辰'], 乙: ['巳'],
      丙: ['未'], 戊: ['未'],
      丁: ['申'], 己: ['申'],
      庚: ['戌'], 辛: ['亥'],
      壬: ['丑'], 癸: ['寅'],
    },
    note: '4.7 表口径',
  },
  {
    name: '红艳煞',
    luck: '凶',
    bases: ['年干', '日干'],
    // 甲乙午申、丙寅、丁未、戊己辰、庚戌、辛酉、壬子、癸申
    table: {
      甲: ['午'], 乙: ['申'],
      丙: ['寅'], 丁: ['未'],
      戊: ['辰'], 己: ['辰'],
      庚: ['戌'], 辛: ['酉'],
      壬: ['子'], 癸: ['申'],
    },
    note: '4.7 表口径',
  },
  {
    name: '羊刃',
    luck: '凶',
    bases: ['日干'],
    // 甲卯、乙寅、丙午、丁巳、戊午、己巳、庚酉、辛申、壬子、癸亥
    table: {
      甲: ['卯'], 乙: ['寅'],
      丙: ['午'], 丁: ['巳'],
      戊: ['午'], 己: ['巳'],
      庚: ['酉'], 辛: ['申'],
      壬: ['子'], 癸: ['亥'],
    },
    note: '主流补充',
  },

  // ---------------- 季节 / 组合类（凶） ----------------
  {
    name: '天赦',
    luck: '吉',
    // 《实施方案》4.7：天赦是「季节 + 日柱」的**整柱比对**，不是仅比地支：
    //   春（寅卯辰月）戊寅日；夏（巳午未月）甲午日；秋（申酉戌月）戊申日；冬（亥子丑月）甲子日。
    // 季节基准取月支（口诀按月建），黄金用例子月属冬 -> 日柱甲子 => 命中。
    bases: ['月支季节'],
    table: {},
    exactPillar: {
      春: ['戊寅'], 夏: ['甲午'], 秋: ['戊申'], 冬: ['甲子'],
    },
    note: '4.7 表口径：春戊寅日、夏甲午日、秋戊申日、冬甲子日（整柱比对）',
  },
  {
    name: '丧门',
    luck: '凶',
    bases: ['年支'],
    // 《实施方案》4.7：岁前二辰，即 年支 + 2（顺数二位）。
    // 黄金用例：辰 + 2 = 午，命中时支午。
    table: buildShiftTable(2, 1),
    note: '4.7 表口径：岁前二辰 = 年支 + 2',
  },
  {
    name: '灾煞',
    luck: '凶',
    bases: ['年支', '日支'],
    // 三合局的「冲」后一位（申子辰见午、亥卯未见酉、寅午戌见子、巳酉丑见卯）
    table: {
      申: ['午'], 子: ['午'], 辰: ['午'],
      亥: ['酉'], 卯: ['酉'], 未: ['酉'],
      寅: ['子'], 午: ['子'], 戌: ['子'],
      巳: ['卯'], 酉: ['卯'], 丑: ['卯'],
    },
    note: '年支与日支并用作基准',
  },
  {
    name: '血刃',
    luck: '凶',
    // 《实施方案》4.7：基准为**月支**，按月建序数取用。
    bases: ['月支'],
    // 正月丑、二月未、三月寅、四月申、五月卯、六月酉、
    // 七月辰、八月戌、九月巳、十月亥、十一月午、十二月子。
    // 月建序：寅1 卯2 辰3 巳4 午5 未6 申7 酉8 戌9 亥10 子11 丑12
    // 黄金用例：子月（十一月）-> 午，命中时支午。
    table: {
      寅: ['丑'], 卯: ['未'], 辰: ['寅'], 巳: ['申'],
      午: ['卯'], 未: ['酉'], 申: ['辰'], 酉: ['戌'],
      戌: ['巳'], 亥: ['亥'], 子: ['午'], 丑: ['子'],
    },
    note: '4.7 表口径：月支（月建）起例',
  },
  {
    name: '五鬼',
    luck: '凶',
    // 《实施方案》4.7：五鬼为「多派别」神煞，常见有「年支 + 4」与「按日干另表」两说。
    // 此处两说并列为多基准（任一中即算），表内容各自保持该流派原样，不做混合。
    bases: ['年支', '日干'],
    table: {
      // 说一：年支顺数四位
      子: ['辰'], 丑: ['巳'], 寅: ['午'], 卯: ['未'],
      辰: ['申'], 巳: ['酉'], 午: ['戌'], 未: ['亥'],
      申: ['子'], 酉: ['丑'], 戌: ['寅'], 亥: ['卯'],
      // 说二：日干起例（甲己见巳、乙庚见子、丙辛见辰、丁壬见未、戊癸见寅）
      甲: ['巳'], 己: ['巳'],
      乙: ['子'], 庚: ['子'],
      丙: ['辰'], 辛: ['辰'],
      丁: ['未'], 壬: ['未'],
      戊: ['寅'], 癸: ['寅'],
    },
    note: '4.7 表口径：多派别并列（年支+4 / 日干另表）',
  },
  {
    name: '童子煞',
    luck: '凶',
    bases: ['月支季节', '年支季节'],
    // 春秋寅子、冬卯未、夏卯未辰（口诀：春秋寅子贵、冬夏卯未辰）
    table: {
      春: ['寅', '子'],
      秋: ['寅', '子'],
      冬: ['卯', '未', '辰'],
      夏: ['卯', '未', '辰'],
    },
    note: '按季节取用（冬 → 卯/未/辰）',
  },
  {
    name: '孤辰',
    luck: '凶',
    bases: ['年支'],
    // 亥子丑年见寅、寅卯辰年见巳、巳午未年见申、申酉戌年见亥
    table: {
      亥: ['寅'], 子: ['寅'], 丑: ['寅'],
      寅: ['巳'], 卯: ['巳'], 辰: ['巳'],
      巳: ['申'], 午: ['申'], 未: ['申'],
      申: ['亥'], 酉: ['亥'], 戌: ['亥'],
    },
    note: '主流补充',
  },
  {
    name: '寡宿',
    luck: '凶',
    bases: ['年支'],
    // 亥子丑年见戌、寅卯辰年见丑、巳午未年见辰、申酉戌年见未
    table: {
      亥: ['戌'], 子: ['戌'], 丑: ['戌'],
      寅: ['丑'], 卯: ['丑'], 辰: ['丑'],
      巳: ['辰'], 午: ['辰'], 未: ['辰'],
      申: ['未'], 酉: ['未'], 戌: ['未'],
    },
    note: '主流补充',
  },
  {
    name: '咸池',
    luck: '凶',
    bases: ['年支三合', '日支三合'],
    // 申子辰见酉、亥卯未见子、寅午戌见卯、巳酉丑见午
    table: {
      水: ['酉'], 木: ['子'], 火: ['卯'], 金: ['午'],
    },
    note: '主流补充',
  },
  {
    name: '空亡',
    luck: '凶',
    bases: ['日支'],
    // 以日柱所在旬取旬空（特殊：由日柱干支直接决定）
    table: {},
    note: '由日柱旬空决定，见 shenSha 内部特判',
  },
];

/** 构造「年支顺/逆数 n 位」的查表内容 */
function buildShiftTable(n: number, dir: 1 | -1): Readonly<Record<string, readonly Zhi[]>> {
  const out: Record<string, readonly Zhi[]> = {};
  for (let i = 0; i < 12; i += 1) {
    const src = ZHI[i];
    const dst = ZHI[(((i + dir * n) % 12) + 12) % 12];
    out[src] = [dst];
  }
  return out;
}

/** 取出四柱的八个字 */
function pillars(siZhu: SiZhu) {
  return {
    yearGan: siZhu.year.gan,
    yearZhi: siZhu.year.zhi,
    monthGan: siZhu.month.gan,
    monthZhi: siZhu.month.zhi,
    dayGan: siZhu.day.gan,
    dayZhi: siZhu.day.zhi,
    hourGan: siZhu.hour.gan,
    hourZhi: siZhu.hour.zhi,
  };
}

/** 把 Basis 解析成「查表用的 key」 */
function basisKeys(basis: Basis, p: ReturnType<typeof pillars>): string[] {
  switch (basis) {
    case '年支':
      return [p.yearZhi];
    case '月支':
      return [p.monthZhi];
    case '日支':
      return [p.dayZhi];
    case '时支':
      return [p.hourZhi];
    case '年干':
      return [p.yearGan];
    case '月干':
      return [p.monthGan];
    case '日干':
      return [p.dayGan];
    case '时干':
      return [p.hourGan];
    case '年支三合':
      return [SAN_HE_OF[p.yearZhi]];
    case '日支三合':
      return [SAN_HE_OF[p.dayZhi]];
    case '年支季节':
      return [SEASON_OF[p.yearZhi]];
    case '月支季节':
      return [SEASON_OF[p.monthZhi]];
    case '日干纳音':
      return [naYinOf(p.dayGan, p.dayZhi)];
    case '月支序数':
      // 月建序数（自寅 = 1 起算），用于按月建起例的神煞（如血刃）
      return [String((((ZHI.indexOf(p.monthZhi) - 2) % 12) + 12) % 12 + 1)];
    default:
      return [];
  }
}

/** 命局四柱的完整干支（用于整柱比对型规则，如天赦） */
function fullPillars(
  p: ReturnType<typeof pillars>,
): Array<{ gan: Gan; zhi: Zhi; pillar: '年柱' | '月柱' | '日柱' | '时柱' }> {
  return [
    { gan: p.yearGan, zhi: p.yearZhi, pillar: '年柱' },
    { gan: p.monthGan, zhi: p.monthZhi, pillar: '月柱' },
    { gan: p.dayGan, zhi: p.dayZhi, pillar: '日柱' },
    { gan: p.hourGan, zhi: p.hourZhi, pillar: '时柱' },
  ];
}

/** 命局中的四个地支（用于比对命中） */
function chartZhi(p: ReturnType<typeof pillars>): Array<{ zhi: Zhi; pillar: '年柱' | '月柱' | '日柱' | '时柱' }> {
  return [
    { zhi: p.yearZhi, pillar: '年柱' },
    { zhi: p.monthZhi, pillar: '月柱' },
    { zhi: p.dayZhi, pillar: '日柱' },
    { zhi: p.hourZhi, pillar: '时柱' },
  ];
}

/**
 * 按规则表算出命中的神煞节点。
 *
 * 命中判定：对每一条规则，取每个基准的查表结果（目标地支集合），
 * 与命局四支求交集；交集非空即命中，hitZhi 记录命中的地支，pillar 记录所在柱。
 */
export function buildShenShaNodes(siZhu: SiZhu): ChartNode[] {
  const p = pillars(siZhu);
  const zhis = chartZhi(p);
  const nodes: ChartNode[] = [];

  for (const rule of SHEN_SHA_RULES) {
    // 旬空特判：由日柱干支所在旬直接给出
    if (rule.name === '空亡') {
      const kong = xunKongOfSafe(siZhu);
      const hit = zhis.filter((z) => kong.includes(z.zhi));
      if (hit.length === 0) continue;
      nodes.push(makeNode(rule, hit[0].pillar, hit.map((h) => h.zhi)));
      continue;
    }

    // 整柱比对型（天赦）：基准给出一组完整干支，需与某一柱的「干+支」完全相等
    if (rule.exactPillar) {
      const wanted = new Set<string>();
      for (const basis of rule.bases) {
        for (const key of basisKeys(basis, p)) {
          const list = rule.exactPillar[key];
          if (list) for (const gz of list) wanted.add(gz);
        }
      }
      if (wanted.size === 0) continue;

      const matched = fullPillars(p).filter((f) => wanted.has(`${f.gan}${f.zhi}`));
      if (matched.length === 0) continue;

      nodes.push(makeNode(rule, matched[0].pillar, matched.map((f) => f.zhi)));
      continue;
    }

    const targets = new Set<Zhi>();
    for (const basis of rule.bases) {
      for (const key of basisKeys(basis, p)) {
        const list = rule.table[key];
        if (list) for (const z of list) targets.add(z);
      }
    }
    if (targets.size === 0) continue;

    const hit = zhis.filter((z) => targets.has(z.zhi));
    if (hit.length === 0) continue;

    nodes.push(makeNode(rule, hit[0].pillar, hit.map((h) => h.zhi)));
  }

  return nodes;
}

/** 日柱旬空（避免直接依赖可能抛错的路径） */
function xunKongOfSafe(siZhu: SiZhu): readonly Zhi[] {
  try {
    return xunKongOf(ganZhiIndex(siZhu.day.gan, siZhu.day.zhi));
  } catch {
    return [];
  }
}

/** 由 day 干支取旬空 */
function xunKongOf(index: number): readonly Zhi[] {
  // 与 constants/jiaZi.ts 的 XUN_KONG 一致：旬首决定
  const heads: Readonly<Record<number, readonly Zhi[]>> = {
    0: ['戌', '亥'], 10: ['申', '酉'], 20: ['午', '未'],
    30: ['辰', '巳'], 40: ['寅', '卯'], 50: ['子', '丑'],
  };
  return heads[Math.floor((((index % 60) + 60) % 60) / 10) * 10] ?? [];
}

/**
 * 生成神煞节点。
 *
 * id 必须**确定性**：同一命盘无论重复计算多少次、无论规则表顺序如何，
 * 都必须得到相同 id（React key、动画重播、截图比对都依赖它）。
 * 因此不能用模块级自增计数器（那会随调用次数漂移），改用规则名 + 命中柱位的内容派生。
 */
function makeNode(rule: ShenShaRule, pillar: ChartNode['pillar'], hitZhi: Zhi[]): ChartNode {
  return {
    id: `ss-${pillar}-${rule.name}`,
    name: rule.name,
    group: '神煞',
    kind: '神煞',
    pillar,
    hitZhi,
    icon: pickIcon(rule.name, '神煞'),
  };
}

