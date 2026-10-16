/**
 * Act 03 · 命理与运势解读。
 *
 * 版式意图：这一幕是**阅读页**，与前三幕的「画面」不同，所以它不靠出血构图，
 * 而是回到一条**版心**上（与起境的左栏同一条左边线），靠留白与色阶分区。
 * 但它的四角仍然贴着内景那套 HUD —— 左上状态点、右上戳记 —— 使四幕看上去
 * 是同一次旅程的四个段落，而不是四个不同的站。
 *
 * 视觉纪律（继承 global.css 的六条）：
 *   1. 不用渐变；面与面靠色调差分层，不靠 1px 线也不靠阴影。
 *   2. 静置元素无发光、无毛玻璃。
 *   3. 不用等宽字体、不做小字号大间距的全大写标签。
 *   4. 字号只用四级：h2 / 读数 / 正文 / 小注。
 *
 * 动效节奏全部取自 tokens.motion：reveal 620ms + stagger 78ms。
 * 条形图从 0 生长到目标宽度；条目 stagger 入场；标签淡入。
 * `prefers-reduced-motion: reduce` 下全部瞬时到位，内容完整可见。
 */
import { useEffect, useMemo, useState } from 'react';
import type { BaziChart, NatalInput } from '@/domain/types';
import {
  FORTUNE_DISCLAIMER,
  buildFortuneReportSafe,
  type FortuneReport,
  type WuXingScore,
} from '@/domain/bazi/fortune';
import { tokens } from '@/styles/tokens';
import '@/styles/fortune.css';

interface Props {
  /** 命盘结果，null 表示内核尚未产出 */
  chart: BaziChart | null;
  /** 已提交的输入（用于戳记与出生年） */
  input: NatalInput | null;
  /** 该幕是否在场（与内景同名的活性标记；本幕为静态文档，仅用于将来扩展） */
  active?: boolean;
  /** 点「进入诞生星轨」 */
  onNext?: () => void;
  /** 点「返回内景」 */
  onBack?: () => void;
}

/** tokens.motion 的镜像，供内联 transition-delay 使用 */
const REVEAL = tokens.motion.reveal;
const STAGGER = tokens.motion.stagger;

export default function FortuneSection({ chart, input, onNext, onBack }: Props) {  const report = useMemo<FortuneReport | null>(() => {
    if (!chart) return null;
    const year = Number(input?.date?.slice(0, 4));
    return buildFortuneReportSafe(
      chart.siZhu,
      input?.gender,
      Number.isFinite(year) ? year : undefined,
    );
  }, [chart, input]);

  /** 入场：挂载后下一帧置 true，触发 CSS 过渡 */
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  /** 条形图生长：与入场分离一帧，保证浏览器先看到 0 宽 */
  const [barsGrown, setBarsGrown] = useState(false);
  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => setBarsGrown(true), 40);
    return () => window.clearTimeout(t);
  }, [shown]);

  const stamp = chart?.summary ?? '';
  const rootClass = 'fortune' + (shown ? ' is-shown' : '');

  if (!report) {
    return (
      <div className={rootClass}>
        <FortuneHud stamp={stamp} />
        <main className="fortune-main">
          <p className="fortune-empty">命盘尚未显化，无法推演。</p>
        </main>
        <FortuneNav onNext={onNext} onBack={onBack} />
      </div>
    );
  }

  return (
    <div className={rootClass}>
      <FortuneHud stamp={stamp} />

      <main className="fortune-main">
        {/* ---------- 页首 ---------- */}
        <header className="fortune-head" style={revealStyle(0)}>
          <h2 className="fortune-title">
            <span className="line-mask">
              <span className="line-inner">命理与运势解读</span>
            </span>
          </h2>
          <p className="fortune-lede">
            四柱既定，五行有其偏全，十神有其显隐。以下八节，皆由这一刻的干支推演而来，
            <strong>不作承诺，只陈述其理</strong>。
          </p>
        </header>

        <PillarBlock report={report} base={1} />
        <WuxingBlock report={report} base={2} grown={barsGrown} />
        <StrengthBlock report={report} base={3} />
        <FavorBlock report={report} base={4} />
        <PatternBlock report={report} base={5} />
        <ShenShaBlock report={report} base={6} />
        <LuckBlock report={report} base={7} />
        <FlowBlock report={report} base={8} />

        {/* ---------- 落款 + 诚实性声明 ---------- */}
        <footer className="fortune-foot" style={revealStyle(9)}>
          <p className="fortune-inscription">人身一小天地，天地一大人身。</p>
          <p className="fortune-method">{report.methodNote}</p>
          <p className="fortune-disclaimer">{FORTUNE_DISCLAIMER}</p>
        </footer>
      </main>

      <FortuneNav onNext={onNext} onBack={onBack} />
    </div>
  );
}

/* ================= 四角 HUD：与内景同一套 ================= */

function FortuneHud({ stamp }: { stamp: string }) {
  return (
    <div className="inner-hud fortune-hud">
      <span className="hud-live">
        <i className="hud-dot" aria-hidden />
        解读已成
      </span>
      {stamp && <span className="hud-stamp">{stamp}</span>}
    </div>
  );
}

/* ================= 底部导航 ================= */

function FortuneNav({ onNext, onBack }: { onNext?: () => void; onBack?: () => void }) {
  return (
    <>
      {onBack && (
        <button type="button" className="back-button" onClick={onBack}>
          <span aria-hidden>←</span> 返回内景
        </button>
      )}
      {onNext && (
        <div className="stage-advance">
          <button type="button" className="advance-button" onClick={onNext}>
            进入诞生星轨
            <span className="advance-arrow" aria-hidden>
              ↓
            </span>
          </button>
        </div>
      )}
    </>
  );
}

/* ================= ② 四柱总览 ================= */

function PillarBlock({ report, base }: { report: FortuneReport; base: number }) {
  return (
    <Section index={base} title="四柱总览" note="年、月、日、时四柱，纳音与旬空一并列出。">
      <div className="fortune-pillars">
        {report.pillars.map((p, i) => (
          <article
            className={'pillar-card' + (p.pillar === '日柱' ? ' is-self' : '')}
            key={p.pillar}
            style={revealStyle(base, i)}
          >
            <span className="pillar-name">{p.pillar}</span>
            <span className="pillar-gz" aria-label={`${p.pillar}${p.ganZhi}`}>
              {p.ganZhi}
            </span>
            <span className="pillar-meta">{p.shiShen ?? '日主本体'}</span>
            <span className="pillar-meta pillar-meta-dim">
              {p.naYin}
              {p.xunKong && <em className="pillar-kong">旬空</em>}
            </span>
          </article>
        ))}
      </div>
    </Section>
  );
}

/* ================= ③ 五行力量 ================= */

function WuxingBlock({
  report,
  base,
  grown,
}: {
  report: FortuneReport;
  base: number;
  grown: boolean;
}) {
  const max = Math.max(...report.wuxingBars.map((b) => b.score), 1);
  return (
    <Section
      index={base}
      title="五行力量分布"
      note={`天干 10 分 · 本气 8 分 · 中气 4 分 · 余气 2 分。最旺为${report.strongest}，最弱为${report.weakest}。`}
    >
      <ul className="wuxing-list">
        {report.wuxingBars.map((b, i) => (
          <WuXingRow key={b.element} bar={b} max={max} grown={grown} delay={i} base={base} />
        ))}
      </ul>
    </Section>
  );
}

function WuXingRow({
  bar,
  max,
  grown,
  delay,
  base,
}: {
  bar: WuXingScore;
  max: number;
  grown: boolean;
  delay: number;
  base: number;
}) {
  // 条长按**占最大值的比例**而非百分占比 —— 五档都接近 20% 时，
  // 用占比画出来的五条几乎一样长，看不出「最旺/最弱」。
  const target = Math.max(2, (bar.score / max) * 100);
  return (
    <li className="wuxing-row" style={revealStyle(base, delay)}>
      <span className="wuxing-name">{bar.element}</span>
      <span className="wuxing-track">
        <span
          className="wuxing-fill"
          style={{
            width: grown ? `${target}%` : '0%',
            transition: `width ${REVEAL}ms cubic-bezier(0.16,1,0.3,1) ${delay * 60}ms`,
          }}
        />
      </span>
      <span className="wuxing-val">
        {bar.score}
        <em>{bar.pct}%</em>
      </span>
    </li>
  );
}

/* ================= ④ 日主强弱 ================= */

function StrengthBlock({ report, base }: { report: FortuneReport; base: number }) {
  const s = report.strength;
  const tone = s.level === '偏强' ? 'is-strong' : s.level === '偏弱' ? 'is-weak' : 'is-even';
  return (
    <Section index={base} title="日主强弱" note="以日干为我，同类为比劫与印，异类为食伤、财、官杀。">
      <div className="strength-block" style={revealStyle(base)}>
        <p className="strength-level">
          <span className={'strength-tag ' + tone}>{s.level}</span>
          <span className="strength-eq">
            同类 {s.allyScore} 分 / 异类 {s.rivalScore} 分 · 同类占比 {s.allyPct}%
          </span>
        </p>
        <p className="strength-basis">{s.basis}</p>
      </div>
    </Section>
  );
}

/* ================= ⑤ 喜用神 / 忌神 ================= */

function FavorBlock({ report, base }: { report: FortuneReport; base: number }) {
  const f = report.favorableView;
  return (
    <Section index={base} title="喜用与忌神" note="由日主强弱推出，每一条都给出推导的原由。">
      <div className="favor-tags" style={revealStyle(base)}>
        <span className="favor-label">喜用</span>
        {f.favorable.map((e, i) => (
          <span className="favor-chip is-good" key={`g${e}`} style={revealStyle(base, i)}>
            {e}
          </span>
        ))}
        <span className="favor-label is-gap">忌神</span>
        {f.unfavorable.length === 0 ? (
          <span className="favor-none">此局无可忌</span>
        ) : (
          f.unfavorable.map((e, i) => (
            <span className="favor-chip is-bad" key={`b${e}`} style={revealStyle(base, i + 3)}>
              {e}
            </span>
          ))
        )}
      </div>

      <ol className="chain-list">
        {f.derivation.map((d, i) => (
          <li className="chain-item" key={d.title} style={revealStyle(base, i + 1)}>
            <span className="chain-title">{d.title}</span>
            <span className="chain-body">{d.body}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ================= ⑥ 十神格局 ================= */

function PatternBlock({ report, base }: { report: FortuneReport; base: number }) {
  const p = report.pattern;
  return (
    <Section
      index={base}
      title="十神格局"
      note={`十神共十种，本局以${p.dominant}为最旺，见 ${p.dominantCount} 次。`}
    >
      <div className="pattern-grid" style={revealStyle(base)}>
        {p.counts.map((c, i) => (
          <span
            className={'pattern-cell' + (c.count === 0 ? ' is-absent' : '') + (c.name === p.dominant ? ' is-dominant' : '')}
            key={c.name}
            style={revealStyle(base, i)}
          >
            <em className="pattern-nm">{c.name}</em>
            <b className="pattern-ct">{c.count}</b>
          </span>
        ))}
      </div>
      <p className="pattern-reading" style={revealStyle(base, 2)}>
        {p.reading}
      </p>
      {p.missing.length > 0 && (
        <p className="pattern-missing" style={revealStyle(base, 3)}>
          未见于本局：<strong>{p.missing.join('、')}</strong>
        </p>
      )}
    </Section>
  );
}

/* ================= ⑦ 神煞要点 ================= */

function ShenShaBlock({ report, base }: { report: FortuneReport; base: number }) {
  const { auspicious, ominous, neutral, tally } = report.shenSha;
  return (
    <Section index={base} title="神煞要点" note={`吉凶依 4.7 规则表的 luck 字段分组：${tally}。`}>
      <div className="shensha-cols">
        <div className="shensha-col" style={revealStyle(base)}>
          <h4 className="shensha-head">
            <i className="legend-swatch is-teal" aria-hidden />
            吉神
          </h4>
          <ul className="shensha-list">
            {auspicious.map((b, i) => (
              <ShenShaItem key={b.name} name={b.name} pillar={b.pillar} hitZhi={b.hitZhi} note={b.note} delay={i} base={base} />
            ))}
          </ul>
        </div>

        <div className="shensha-col" style={revealStyle(base, 1)}>
          <h4 className="shensha-head">
            <i className="legend-swatch is-purple" aria-hidden />
            凶煞
          </h4>
          <ul className="shensha-list">
            {ominous.map((b, i) => (
              <ShenShaItem key={b.name} name={b.name} pillar={b.pillar} hitZhi={b.hitZhi} note={b.note} delay={i} base={base} />
            ))}
          </ul>
        </div>
      </div>

      {neutral.length > 0 && (
        <p className="shensha-neutral" style={revealStyle(base, 4)}>
          另见中平：{neutral.map((b) => b.name).join('、')}
        </p>
      )}
    </Section>
  );
}

function ShenShaItem({
  name,
  pillar,
  hitZhi,
  note,
  delay,
  base,
}: {
  name: string;
  pillar: string;
  hitZhi: readonly string[];
  note: string;
  delay: number;
  base: number;
}) {
  return (
    <li className="shensha-item" style={revealStyle(base, delay + 1)}>
      <span className="shensha-name">{name}</span>
      <span className="shensha-where">
        {pillar}
        {hitZhi.length > 0 ? ` · ${hitZhi.join('')}` : ''}
      </span>
      {note && <span className="shensha-note">{note}</span>}
    </li>
  );
}

/* ================= ⑧ 大运八步 ================= */

function LuckBlock({ report, base }: { report: FortuneReport; base: number }) {
  return (
    <Section
      index={base}
      title="大运八步"
      note="自月柱起排，八步各十年。此处为简化排法，详见页末口径说明。"
    >
      <ol className="luck-list">
        {report.luckCycles.map((c, i) => (
          <li className={'luck-row ' + ratingClass(c.rating)} key={c.ganZhi + c.index} style={revealStyle(base, i)}>
            <span className="luck-seq">{c.index}</span>
            <span className="luck-gz">{c.ganZhi}</span>
            <span className="luck-ss">{c.shiShen}</span>
            <span className="luck-age">
              {c.startAge}–{c.endAge} 岁
            </span>
            <span className="luck-rating">{c.rating}</span>
            <span className="luck-reason">{c.reason}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ================= ⑨ 流年五年 ================= */

function FlowBlock({ report, base }: { report: FortuneReport; base: number }) {
  return (
    <Section index={base} title="流年五年" note="自出生公历年起，连续五年。">
      <ul className="flow-list">
        {report.flowYears.map((f, i) => (
          <li className={'flow-row ' + ratingClass(f.rating)} key={f.year} style={revealStyle(base, i)}>
            <span className="flow-year">{f.year}</span>
            <span className="flow-gz">{f.ganZhi}</span>
            <span className="flow-ss">{f.shiShen}</span>
            <span className="flow-rating">{f.rating}</span>
            <span className="flow-reason">{f.reason}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ================= 通用 ================= */

function Section({
  index,
  title,
  note,
  children,
}: {
  index: number;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="fortune-sec" style={revealStyle(index)}>
      <div className="sec-head">
        <h3 className="sec-title">{title}</h3>
        <p className="sec-note">{note}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * 统一的入场延迟：块序 + 块内序号，按 tokens.motion.stagger 递增。
 * 用 CSS 自定义属性传延迟，样式表里只写一次 transition。
 */
function revealStyle(base: number, inner = 0): React.CSSProperties {
  return { '--reveal-delay': `${(base * 2 + inner) * STAGGER * 0.5}ms` } as React.CSSProperties;
}

function ratingClass(r: '吉' | '平' | '凶'): string {
  return r === '吉' ? 'is-ji' : r === '凶' ? 'is-xiong' : 'is-ping';
}
