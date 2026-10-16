/**
 * 视觉令牌：色板 / 字体 / 字号节奏 / 间距 / 圆角 / 动效。
 *
 * 色板来自对参考录屏 1440×1080 逐帧取色，是「星境」不可更改的识别：
 *   - 深色星空底 #07080b
 *   - 暖金 #d9b877 为主体色（标题、按钮、太阳、轨道线、手写释文）
 *   - 青绿 #6ee7b7 = 十神节点，紫 #a78bfa = 神煞节点
 *
 * 字号节奏只有级：一个字幕级巨字、一级读数值、一级正文、一级小注。
 * 不设中间档 —— 中间档是让页面变成「文档」的原因。
 */

export const tokens = {
  color: {
    /** 整站唯一底色：近黑的冷调 */
    bg: '#07080b',
    /** 抬升一档的平面（卡片 / 面板），靠**色调差**而非描边或阴影分面 */
    bgCard: '#12151c',
    /** 抬升两档（输入框 / 内嵌块） */
    bgInput: '#0d0f14',
    /** 比卡片再亮一点点的顶面，用于文字块与画布容器 */
    bgLift: '#171b23',
    border: '#242a36',
    borderSoft: 'rgba(255,255,255,0.07)',

    text: '#dfe4ec',
    /** 正文就走这个亮度，不要更淡 —— 灰色的正文读起来像没写完 */
    textSoft: '#c3c9d4',
    textDim: '#8b93a5',
    textDim2: '#5e6678',

    /** 主色：按钮 / 人形 / 落款 / 轨道线 */
    gold: '#d9b877',
    goldBright: '#efd9a4',
    goldDeep: '#a8823f',
    /** 十神节点：青绿 */
    teal: '#6ee7b7',
    tealDeep: '#2f8f6d',
    /** 神煞节点：紫（只用于节点与图例点，不做大面积色场） */
    purple: '#a78bfa',
    purpleDeep: '#6d4fc4',
    /** 状态点绿 */
    live: '#6ee7b7',
    /** 出错 */
    danger: '#e08a7a',

    /** 行星 */
    mercury: '#c8c8c8',
    venus: '#e8d9a8',
    earth: '#5b9bd5',
    mars: '#d98c6a',
    jupiter: '#d8b48c',
    saturn: '#c9b98a',
    uranus: '#9fd8d8',
    neptune: '#8a9be0',
  },

  font: {
    serif: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", serif',
    sans: '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", system-ui, sans-serif',
  },

  radius: { sm: 4, md: 8, lg: 12, xl: 16 },

  /**
   * 字号节奏（桌面 px，clamp 由 CSS 侧落地）。
   * display 只允许在「整屏只有这一句话」的地方用。
   */
  type: {
    display: 112,
    h1: 44,
    h2: 34,
    readout: 22,
    body: 16,
    small: 13,
    micro: 11,
  },

  /** 版心与栏距 */
  space: {
    /** 手机 / 桌面的左右页边距，全站只有这一对 */
    marginSm: 20,
    marginLg: 52,
    /** 区块之间的间距，必须明显大于区块内部任何间距 */
    section: 160,
  },

  /** 动效时长（毫秒） */
  motion: {
    /** 签名动作：标题逐行从基线后升起 */
    headline: 900,
    /** 行与行之间的 stagger（60–90ms 是甜区） */
    stagger: 78,
    reveal: 620,
    fadeOut: 380,
    orbitIntro: 1400,
  },

  /** 星轨推进速率（天/秒），录屏逐秒实测 ≈ 14.5 天/秒（21s=17天 → 23s=46天） */
  daysPerSecond: 15,
} as const;

export const orbits = {
  /** 参考画布宽度（设计基准，所有星轨半径以此比例缩放） */
  designW: 1440,
  designH: 1080,
  /** 太阳圆心（参考画布坐标） */
  cx: 693,
  cy: 531,
  /** 纵向压扁比：录屏实测雪王星轨道 722×310 → ≈0.43 */
  squash: 0.43,
  /** 八条轨道在参考画布上的半长轴（px），由录屏测量校正 */
  radii: {
    Mercury: 106,
    Venus: 133,
    Earth: 179,
    Mars: 229,
    Jupiter: 287,
    Saturn: 342,
    Uranus: 408,
    Neptune: 722,
  } as const,
} as const;
