/**
 * 内景区块：three.js 3D 打坐人体 + 星曜球面环绕，并叠加 HUD。
 *
 * HUD 元素（复刻原片）：
 *  - 左上「● 内景已显化」绿点
 *  - 右上「2001.01.01 · 午时」
 *  - 左下 十神/神煞 图例 + 操作提示
 *  - 右下 四柱与日主读数
 *  - 底部「查看命理解读」按钮（分屏推进，不是滚动）
 *
 * 数据未就绪时（bazi 内核还未产出）使用一份与黄金用例一致的内置占位节点，
 * 保证内景区在联调期也能看到完整视觉；真实数据到达后自动替换。
 *
 * —— 节点介绍面板（task-4）——
 * 单击画面上的某个星曜节点 → `InnerCanvas` 用 Raycaster 命中并把 `ChartNode`
 * 回传到这里 → 本组件从 `nodeIntro.ts` 取对应文案，弹出一张 `.inner-node-card`。
 * 关闭途径有三：点面板上的关闭按钮、按 Esc、点面板之外的空白处。
 * 同一节点再次单击即收起（切换语义）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BaziChart, ChartNode, NatalInput } from '@/domain/types';
import InnerCanvas from '@/render/InnerCanvas';
import { introOf } from '@/domain/bazi/nodeIntro';
import '@/styles/node-card.css';

interface Props {
  /** 命盘结果，null 表示内核尚未产出 */
  chart: BaziChart | null;
  /** 已提交的输入（用于 HUD 展示日期与时辰） */
  input: NatalInput | null;
  /** 本屏是否处于激活状态（切走后停掉 WebGL 渲染循环） */
  active?: boolean;
  /** 点「查看命理解读」（下一幕；回调名沿用 onEnterOrbit 以免影响调用方） */
  onEnterOrbit?: () => void;
}

/** 面板关闭动效时长（ms），与 node-card.css 的 fadeOut 保持一致 */
const CARD_FADE = 420;

export default function InnerSection({ chart, input, active = true, onEnterOrbit }: Props) {
  const [replayKey, setReplayKey] = useState(0);

  /** 当前选中的节点；null = 面板关闭 */
  const [picked, setPicked] = useState<ChartNode | null>(null);
  /** 入场动画：挂载后下一帧置 true，触发 CSS 的 opacity/translate 过渡 */
  const [entered, setEntered] = useState(false);
  /** 关闭动画进行中（先播 fadeOut，再从 DOM 摘掉） */
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);

  // 每次命盘变化重播入场动画
  useEffect(() => {
    setReplayKey((k) => k + 1);
  }, [chart]);

  // 换命盘时把旧面板收掉，避免残留上一盘的节点信息
  useEffect(() => {
    setPicked(null);
    setClosing(false);
    setEntered(false);
  }, [chart]);

  /** 卸载时清掉未完成的关闭定时器 */
  useEffect(
    () => () => {
      if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  // 面板打开后，下一帧再加 .is-open，让过渡真正跑起来
  useEffect(() => {
    if (picked === null) {
      setEntered(false);
      return;
    }
    setClosing(false);
    setEntered(false);
    const id = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(id);
  }, [picked]);

  /** 带淡出地关闭面板 */
  const close = useCallback(() => {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    setClosing(true);
    setEntered(false);
    closeTimer.current = window.setTimeout(() => {
      setPicked(null);
      setClosing(false);
    }, CARD_FADE);
  }, []);

  /**
   * 画布回传的单击结果。
   *
   * - 命中节点：与当前相同 → 收起（切换）；不同 → 换内容。
   * - 命中空白（null）：有点开的就在，则收起；否则不动。
   */
  const handlePick = useCallback(
    (node: ChartNode | null) => {
      // 点空白：面板开着就收起，没开则不动
      if (node === null) {
        if (picked !== null) close();
        return;
      }
      // 同一节点再次单击 → 切换收起
      if (picked !== null && picked.id === node.id) {
        close();
        return;
      }
      // 换一个节点：先停掉可能正在跑的关闭定时器，再换内容重播入场
      if (closeTimer.current !== undefined) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
      }
      setClosing(false);
      setPicked(node);
    },
    [picked, close],
  );

  // Esc 关闭
  useEffect(() => {
    if (picked === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked, close]);

  const nodes: ChartNode[] = chart?.nodes ?? FALLBACK_NODES;
  const stamp = chart?.summary ?? '2001.01.01 · 午时';
  const siZhu = chart
    ? `${chart.siZhu.year.gan}${chart.siZhu.year.zhi} ${chart.siZhu.month.gan}${chart.siZhu.month.zhi} ${chart.siZhu.day.gan}${chart.siZhu.day.zhi} ${chart.siZhu.hour.gan}${chart.siZhu.hour.zhi}`
    : '庚辰 戊子 甲子 庚午';
  const dayMaster = chart?.siZhu.dayMaster ?? '甲';
  const zodiac = chart?.siZhu.zodiac ?? '龙';
  const shiChen = chart?.siZhu.shiChen ?? '午时';

  return (
    <>
      <InnerCanvas
        nodes={nodes}
        active={active}
        replayKey={replayKey}
        onPickNode={handlePick}
      />

      <div className="inner-hud">
        <span className="hud-live">
          <i className="hud-dot" aria-hidden />
          内景已显化
        </span>
        <span className="hud-stamp">{stamp}</span>
      </div>

      <div className="inner-legend">
        <span className="legend-row">
          <i className="legend-swatch is-teal" aria-hidden />
          十神 · 透干与藏干
        </span>
        <span className="legend-row">
          <i className="legend-swatch is-purple" aria-hidden />
          神煞 · 吉凶星曜
        </span>
        <span className="legend-hint" aria-hidden>
          拖拽环绕 · 滚轮缩放 · 单击节点查看释义
        </span>
      </div>

      <div className="inner-readout">
        <span className="readout-siZhu">{siZhu}</span>
        <span className="readout-line">
          日主 <b>{dayMaster}</b> · {shiChen} · 属<b>{zodiac}</b>
        </span>
        {input !== null && (
          <span className="readout-line">
            {input.date.replace(/-/g, '.')} · {input.tz} · {input.gender}
          </span>
        )}
        <span className="readout-line">共 {nodes.length} 个星曜节点</span>
      </div>

      {onEnterOrbit && (
        <div className="stage-advance">
          <button type="button" className="advance-button" onClick={onEnterOrbit}>
            查看命理解读
            <span className="advance-arrow" aria-hidden>
              ↓
            </span>
          </button>
        </div>
      )}

      {picked !== null && (
        <NodeCard node={picked} open={entered && !closing} closing={closing} onClose={close} />
      )}
    </>
  );
}

/* ================= 节点介绍面板 ================= */

interface CardProps {
  node: ChartNode;
  /** 是否已进入静止态（驱动 .is-open） */
  open: boolean;
  /** 是否正在播关闭动画（驱动 .is-closing） */
  closing: boolean;
  onClose: () => void;
}

function NodeCard({ node, open, closing, onClose }: CardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const isShiShen = node.group === '十神';
  const intro = introOf(node.name);

  // 面板一出现就把焦点移进去，键盘用户可直接 Esc 关闭
  useEffect(() => {
    cardRef.current?.focus();
  }, [node.id]);

  const cls = [
    'inner-node-card',
    isShiShen ? 'is-teal' : 'is-purple',
    open ? 'is-open' : '',
    closing ? 'is-closing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  /** 吉凶标签的样式类 */
  const luckCls =
    intro?.luck === '吉' ? 'is-ji' : intro?.luck === '凶' ? 'is-xiong' : 'is-zhong';

  return (
    <aside
      ref={cardRef}
      className={cls}
      role="dialog"
      aria-modal="false"
      aria-label={`${node.name}（${node.group}）介绍`}
      tabIndex={-1}
      data-node-id={node.id}
      data-node-name={node.name}
    >
      <div className="inner-node-card__head">
        <span className="inner-node-card__glyph" aria-hidden>
          <NodeGlyph icon={node.icon} />
        </span>
        <div className="inner-node-card__title">
          <h2 className="inner-node-card__name">{node.name}</h2>
          <span className="inner-node-card__tagline">
            {intro?.tagline ?? (isShiShen ? '十神 · 日主为我' : '神煞 · 吉凶星曜')}
          </span>
        </div>
        <button
          type="button"
          className="inner-node-card__close"
          onClick={onClose}
          aria-label="关闭介绍面板"
          title="关闭（Esc）"
        >
          ✕
        </button>
      </div>

      <div className="inner-node-card__meta">
        <span className="inner-node-card__chip is-group">{node.group}</span>
        <span className="inner-node-card__chip">{node.pillar}</span>
        <span className="inner-node-card__chip">{node.kind}</span>
        {node.wuXing && (
          <span className="inner-node-card__chip">
            <i className="inner-node-card__dot" aria-hidden />
            五行 · {node.wuXing}
          </span>
        )}
        {node.sourceStem && (
          <span className="inner-node-card__chip">天干 · {node.sourceStem}</span>
        )}
        {node.hitZhi && node.hitZhi.length > 0 && (
          <span className="inner-node-card__chip">地支 · {node.hitZhi.join('、')}</span>
        )}
        {intro?.luck && <span className={`inner-node-card__chip ${luckCls}`}>{intro.luck}</span>}
        {intro?.basis && <span className="inner-node-card__chip">依据 · {intro.basis}</span>}
      </div>

      <div className="inner-node-card__body">
        {intro !== null ? (
          intro.body
        ) : (
          <>
            本条星曜在 `src/domain/bazi/**` 的现有数据表中**尚无释义文案**，
            故此处不作杜撰。仅从命盘结构看：它是{node.group}，落于{node.pillar}，
            类型为{node.kind}
            {node.wuXing ? `，五行属${node.wuXing}` : ''}
            {node.sourceStem ? `，源出天干${node.sourceStem}` : ''}
            {node.hitZhi && node.hitZhi.length > 0 ? `，命中地支${node.hitZhi.join('、')}` : ''}
            。
          </>
        )}
      </div>

      {intro?.verse && <blockquote className="inner-node-card__verse">{intro.verse}</blockquote>}

      <p className="inner-node-card__source">
        {isShiShen ? (
          <>
            <b>释义依据</b> · <code>src/domain/bazi/shiShen.ts</code> 的判定表
            （以日主为我，按五行生克 × 阴阳同异定名）；位置含义为传统命理通说。
          </>
        ) : intro?.source === 'shenSha.ts' ? (
          <>
            <b>释义依据</b> · <code>src/domain/bazi/shenSha.ts</code> 规则表中的起例
            {intro.basis ? `（${intro.basis}）` : ''}；吉凶倾向为传统命理通说。
          </>
        ) : intro?.source === '通用' ? (
          <>
            <b>释义依据</b> · 本条在 <code>shenSha.ts</code> 规则表中<b>只有查表内容、无释义</b>，
            此处为<b>传统通用释义</b>，非本项目既有定义。
          </>
        ) : (
          <>
            <b>释义依据</b> · 本文件未收录该名称的释义，仅呈现命盘结构字段。
          </>
        )}
      </p>
    </aside>
  );
}

/** 面板顶部的小图标：把 ChartNode.icon 的图标键画成内联 SVG */
function NodeGlyph({ icon }: { icon: ChartNode['icon'] }) {
  const c = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 } as const;
  switch (icon) {
    case 'star':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3l2.6 6.1 6.4.6-4.9 4.2 1.5 6.3L12 16.6 6.4 20.2l1.5-6.3L3 9.7l6.4-.6z" {...c} />
        </svg>
      );
    case 'sun':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="4.2" {...c} />
          <path d="M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" {...c} />
        </svg>
      );
    case 'moon':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M20 14.4A8.4 8.4 0 019.6 4a8.4 8.4 0 1010.4 10.4z" {...c} />
        </svg>
      );
    case 'cross':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3v18M4.5 8.5h15" {...c} />
        </svg>
      );
    case 'flag':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M6 3v18M6 4.2h11l-2.2 3.6L17 11.4H6" {...c} />
        </svg>
      );
    case 'flower':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="2.2" {...c} />
          <path d="M12 9.8V5.4M12 14.2v4.4M9.8 12H5.4M14.2 12h4.4M10.5 10.5L7.4 7.4M13.5 13.5l3.1 3.1M13.5 10.5l3.1-3.1M10.5 13.5l-3.1 3.1" {...c} />
        </svg>
      );
    case 'gem':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M7 4h10l4 5.4-9 10.6L3 9.4z" {...c} />
          <path d="M3 9.4h18M9.6 4L8 9.4l4 10.6M14.4 4L16 9.4l-4 10.6" {...c} />
        </svg>
      );
    case 'hex':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" {...c} />
        </svg>
      );
    case 'tri':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3.6L21 19.4H3z" {...c} />
        </svg>
      );
    case 'spark':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 2.6l1.9 6.3 6.5 1.9-6.5 1.9L12 19.4l-1.9-6.7-6.5-1.9 6.5-1.9z" {...c} />
        </svg>
      );
    case 'diamond':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 2.8l8.6 9.2L12 21.2 3.4 12z" {...c} />
        </svg>
      );
    case 'ring':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="8.4" {...c} />
          <circle cx="12" cy="12" r="3.1" {...c} />
        </svg>
      );
    case 'square':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="4" y="4" width="16" height="16" rx="1.6" {...c} />
        </svg>
      );
    case 'hourglass':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M7 3h10M7 21h10M8 3c0 4.6 8 5.2 8 9.4S8 16.6 8 21M16 3c0 4.6-8 5.2-8 9.4S16 16.6 16 21" {...c} />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="8" {...c} />
        </svg>
      );
  }
}

/** 兜底节点：与《实施方案》1.4 黄金用例完全一致（10 十神 + 14 神煞） */
const FALLBACK_NODES: ChartNode[] = [
  { id: 'tg-y', name: '七杀', group: '十神', kind: '透干', pillar: '年柱', icon: 'tri', wuXing: '金' },
  { id: 'tg-m', name: '偏财', group: '十神', kind: '透干', pillar: '月柱', icon: 'diamond', wuXing: '土' },
  { id: 'tg-h', name: '七杀', group: '十神', kind: '透干', pillar: '时柱', icon: 'tri', wuXing: '金' },
  { id: 'cg-y1', name: '偏财', group: '十神', kind: '藏干', pillar: '年柱', icon: 'diamond', wuXing: '土' },
  { id: 'cg-y2', name: '劫财', group: '十神', kind: '藏干', pillar: '年柱', icon: 'hex', wuXing: '木' },
  { id: 'cg-y3', name: '正印', group: '十神', kind: '藏干', pillar: '年柱', icon: 'ring', wuXing: '水' },
  { id: 'cg-m1', name: '正印', group: '十神', kind: '藏干', pillar: '月柱', icon: 'ring', wuXing: '水' },
  { id: 'cg-d1', name: '正印', group: '十神', kind: '藏干', pillar: '日柱', icon: 'ring', wuXing: '水' },
  { id: 'cg-h1', name: '伤官', group: '十神', kind: '藏干', pillar: '时柱', icon: 'spark', wuXing: '火' },
  { id: 'cg-h2', name: '正财', group: '十神', kind: '藏干', pillar: '时柱', icon: 'square', wuXing: '土' },
  { id: 'ss-ty', name: '天乙贵人', group: '神煞', kind: '神煞', pillar: '年柱', icon: 'star' },
  { id: 'ss-fx', name: '福星贵人', group: '神煞', kind: '神煞', pillar: '年柱', icon: 'sun' },
  { id: 'ss-tj', name: '太极贵人', group: '神煞', kind: '神煞', pillar: '月柱', icon: 'ring' },
  { id: 'ss-gy', name: '国印贵人', group: '神煞', kind: '神煞', pillar: '年柱', icon: 'flag' },
  { id: 'ss-hg', name: '华盖', group: '神煞', kind: '神煞', pillar: '年柱', icon: 'flower' },
  { id: 'ss-jx', name: '将星', group: '神煞', kind: '神煞', pillar: '月柱', icon: 'star' },
  { id: 'ss-jy', name: '金舆', group: '神煞', kind: '神煞', pillar: '年柱', icon: 'gem' },
  { id: 'ss-hy', name: '红艳煞', group: '神煞', kind: '神煞', pillar: '时柱', icon: 'flower' },
  { id: 'ss-ts', name: '天赦', group: '神煞', kind: '神煞', pillar: '日柱', icon: 'sun' },
  { id: 'ss-sm', name: '丧门', group: '神煞', kind: '神煞', pillar: '时柱', icon: 'cross' },
  { id: 'ss-zs', name: '灾煞', group: '神煞', kind: '神煞', pillar: '时柱', icon: 'cross' },
  { id: 'ss-xr', name: '血刃', group: '神煞', kind: '神煞', pillar: '时柱', icon: 'diamond' },
  { id: 'ss-wg', name: '五鬼', group: '神煞', kind: '神煞', pillar: '月柱', icon: 'hex' },
  { id: 'ss-tz', name: '童子煞', group: '神煞', kind: '神煞', pillar: '年柱', icon: 'hourglass' },
];
