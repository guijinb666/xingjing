/**
 * 全局共享类型契约。
 * 所有模块（domain / layout / render / components）都必须只依赖本文件中的类型，
 * 以保证计算层与渲染层彻底解耦。
 */

// ============ 基础命理类型 ============

/** 十天干 */
export type Gan = '甲' | '乙' | '丙' | '丁' | '戊' | '己' | '庚' | '辛' | '壬' | '癸';
/** 十二地支 */
export type Zhi =
  | '子' | '丑' | '寅' | '卯' | '辰' | '巳'
  | '午' | '未' | '申' | '酉' | '戌' | '亥';
/** 五行 */
export type WuXing = '木' | '火' | '土' | '金' | '水';
/** 阴阳 */
export type YinYang = '阳' | '阴';
/** 十神 */
export type ShiShenName =
  | '比肩' | '劫财' | '食神' | '伤官' | '偏财'
  | '正财' | '七杀' | '正官' | '偏印' | '正印';
/** 柱位 */
export type PillarName = '年柱' | '月柱' | '日柱' | '时柱';

export interface GanZhi {
  gan: Gan;
  zhi: Zhi;
}

/** 四柱排盘结果 */
export interface SiZhu {
  year: GanZhi;
  month: GanZhi;
  day: GanZhi;
  hour: GanZhi;
  /** 日主天干（日干） */
  dayMaster: Gan;
  /** 时辰名，如 '午时' */
  shiChen: string;
  /** 生肖，如 '龙' */
  zodiac: string;
  /** 用于调试与边界展示的交节信息 */
  boundary: {
    /** 生于其后的那个「节」 */
    prevJieName: string;
    prevJieTime: string;
    /** 生于其前的那个「节」 */
    nextJieName: string;
    nextJieTime: string;
  };
  /** 旬空（空亡）两地支 */
  xunKong: Zhi[];
  /** 纳音 */
  naYin: Record<PillarName, string>;
}

// ============ 星图节点 ============

export type NodeGroup = '十神' | '神煞';
export type NodeKind = '透干' | '藏干' | '神煞';

/** 内景星图上的一个节点（布局层会回填 r/theta/phase） */
export interface ChartNode {
  id: string;
  /** 节点名，如 '正印' / '华盖' */
  name: string;
  group: NodeGroup;
  kind: NodeKind;
  pillar: PillarName;
  /** 藏干来源天干，如 '癸'；透干节点为其本身 */
  sourceStem?: Gan;
  /** 命中该神煞的地支（若有） */
  hitZhi?: Zhi[];
  /** 图标键，见 iconGlyph.ts */
  icon: IconKey;
  /** 归属五行，用于配色 */
  wuXing?: WuXing;
  // —— 以下由 layout 层回填 ——
  r?: number;
  theta?: number;
  phase?: number;
}

export type IconKey =
  | 'star' | 'sun' | 'moon' | 'cross' | 'flag' | 'flower' | 'gem'
  | 'hex' | 'tri' | 'spark' | 'diamond' | 'ring' | 'square' | 'hourglass';

/** 命盘完整结果 */
export interface BaziChart {
  input: NatalInput;
  siZhu: SiZhu;
  /** 十神 + 神煞 全量节点 */
  nodes: ChartNode[];
  /** 顶部摘要，如 '2001.01.01 · 午时' */
  summary: string;
}

// ============ 输入 ============

export interface NatalInput {
  /** 公历日期 'YYYY-MM-DD' */
  date: string;
  /** 当地钟表时间 'HH:mm'（不校正真太阳时） */
  time: string;
  /** IANA 时区，如 'Asia/Shanghai' */
  tz: string;
  /** UTC 偏移小时数（用于不依赖 Intl 时区库的确定性计算） */
  tzOffset: number;
  gender: '男' | '女';
}

// ============ 星轨 ============

/** 八大天体键（不含太阳） */
export type BodyKey =
  | 'Mercury' | 'Venus' | 'Earth' | 'Mars'
  | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune';

export interface BodyDef {
  key: BodyKey;
  cn: string;
  color: string;
  /** 半长轴，单位 AU */
  a: number;
  /** 公转周期，单位年 */
  period: number;
  /** 绘制半径像素（视觉尺寸） */
  size: number;
  hasRing?: boolean;
}

export interface OrbitBody extends BodyDef {
  /** 压缩后的绘制半长轴（px @ 参考画布） */
  rDraw: number;
  /** 出生时刻日心黄经（弧度，0 = 春分点方向） */
  phase0: number;
  /** 当前角度（由时间轴驱动，渲染层写入） */
  angle: number;
}

/** 时间轴状态机 */
export type OrbitStatus = 'IDLE' | 'RUNNING' | 'PAUSED';

// ============ 视觉令牌 ============

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  r: number;
  theta: number;
  alpha: number;
  iconR: number;
}
