/**
 * 星境 · 主壳。
 *
 * 四幕**分屏式**叙事（复刻原片：是逐屏推进，不是单页连续滚动）：
 *   Act 01 起境   —— 你的生辰表单
 *   Act 02 内景   —— three.js 3D 打坐人体 + 星曜球面环绕（可拖拽/缩放/双击）
 *   Act 03 命理   —— 命理与运势解读（四柱/五行/日主/喜忌/十神/神煞/大运/流年八节）
 *   Act 04 星轨   —— 日心八轨道，进入即从出生时刻起算并自动推进
 *
 * 切换方式：内景底部有「进入命理与运势解读」按钮，解读页底部有
 * 「进入诞生星轨」；各幕顶部/底部有对应的返回按钮。
 * 每次切换都做一次轻微前推 + 淡出的过渡动效（见 global.css 的 .stage-view）。
 *
 * 整站共用一层恒定星空背景（fixed，不随内容滚动位移）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BaziChart, NatalInput } from '@/domain/types';
import InputForm from '@/components/InputForm';
import InnerSection from '@/components/InnerSection';
import OrbitSection from '@/components/OrbitSection';
import FortuneSection from '@/components/FortuneSection';
import { createStarfieldLayer } from '@/render/starfield';
import { preloadTextures } from '@/render3d/planetMaterials';
import { computeBaziSafe } from '@/domain/bazi/compute';

/** 黄金用例默认输入：首屏与内景的兜底展示 */
const DEFAULT_INPUT: NatalInput = {
  date: '2001-01-01',
  time: '12:00',
  tz: 'Asia/Shanghai',
  tzOffset: 8,
  gender: '女',
};

type View = 'hero' | 'inner' | 'fortune' | 'orbit';

/** 视图切换过渡时长（ms），需与 CSS 的 .stage-view 过渡一致 */
const VIEW_FADE = 620;

export default function App() {
  const [input, setInput] = useState<NatalInput | null>(null);
  const [chart, setChart] = useState<BaziChart | null>(null);
  const [view, setView] = useState<View>('hero');
  /** 过渡中：正在离开旧视图，避免两屏内容同时可交互 */
  const [leaving, setLeaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 首屏即算一次默认命盘，保证内景区与星轨区立刻有真实内容
  const initialChart = useMemo(() => computeBaziSafe(DEFAULT_INPUT), []);
  const effectiveInput = input ?? DEFAULT_INPUT;
  const effectiveChart = chart ?? initialChart;

  const birthUtc = useMemo(() => localToUtc(effectiveInput), [effectiveInput]);

  /**
   * 首屏就开始异步解码 11 张预烘焙行星贴图。
   *
   * ★ 根因记录：这些贴图原先是在**进入星轨那一刻**同步逐像素生成的，
   *   实测首次合计 7876ms，浏览器里表现为 10905ms 主线程长任务，
   *   用户看到的是「星轨加载不出来」（其实是冻住 11 秒）。
   *   在这里提前预热，等用户真的切到星轨时通常早已就绪；
   *   即便未就绪，OrbitCanvas 也会显示载入占位而不是空白。
   *
   * 失败不抛出：`preloadTextures` 内部对 404/解码失败逐张降级，
   * 缺失的走原程序化回退，功能不缺失。
   */
  useEffect(() => {
    void preloadTextures();
  }, []);

  /** 带过渡的视图切换：先淡出旧屏，再换内容，然后淡入 */
  const goto = useCallback((next: View) => {
    setLeaving(true);
    window.setTimeout(() => {
      setView(next);
      setLeaving(false);
      window.scrollTo({ top: 0, behavior: 'auto' });
      scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    }, VIEW_FADE * 0.55);
  }, []);

  const handleSubmit = useCallback(
    (next: NatalInput) => {
      setInput(next);
      setChart(computeBaziSafe(next));
      goto('inner');
    },
    [goto],
  );

  // 键盘辅助：← → 在三幕之间移动（无障碍与快捷操作）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      // 四幕次序：hero -> inner -> fortune -> orbit
      const ORDER: View[] = ['hero', 'inner', 'fortune', 'orbit'];
      const at = ORDER.indexOf(view);
      if (e.key === 'ArrowRight') {
        if (at >= 0 && at < ORDER.length - 1) goto(ORDER[at + 1]);
      } else if (e.key === 'ArrowLeft') {
        if (at > 0) goto(ORDER[at - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, goto]);

  /** 离开内景时把 three.js 画布卸掉，回收 WebGL 上下文 */
  const innerActive = view === 'inner' && !leaving;
  const orbitActive = view === 'orbit' && !leaving;
  /** 解读页是静态文档，不需要画布活性，此处只表明它在场 */
  const fortuneActive = view === 'fortune' && !leaving;

  return (
    <div className="app-shell">
      <StarfieldLayer />

      <div className={'stage-root' + (leaving ? ' is-leaving' : '')} ref={scrollRef}>
        {/* ---------------- Act 01 · 起境 ---------------- */}
        {view === 'hero' && (
          <section className="stage-view act-hero" key="hero">
            <InputForm onSubmit={handleSubmit} value={input} />
          </section>
        )}

        {/* ---------------- Act 02 · 内景 ---------------- */}
        {view === 'inner' && (
          <section className="stage-view act-inner" key="inner">
            <InnerSection
              chart={effectiveChart}
              input={effectiveInput}
              active={innerActive}
              onEnterOrbit={() => goto('fortune')}
            />
          </section>
        )}

        {/* ---------------- Act 03 · 命理与运势解读 ---------------- */}
        {view === 'fortune' && (
          <section className="stage-view act-fortune" key="fortune">
            <FortuneSection
              chart={effectiveChart}
              input={effectiveInput}
              active={fortuneActive}
              onNext={() => goto('orbit')}
              onBack={() => goto('inner')}
            />
          </section>
        )}

        {/* ---------------- Act 04 · 星轨 ---------------- */}
        {view === 'orbit' && (
          <section className="stage-view act-orbit" key="orbit">
            <button type="button" className="back-button" onClick={() => goto('inner')}>
              <span aria-hidden>←</span> 返回内景
            </button>
            <OrbitSection birthUtc={birthUtc} inView={orbitActive} />
            <footer className="orbit-foot">
              <p className="footnote">
                人身一小天地，天地一大人身。
                <br />
                半径按公转周期压缩绘制。
              </p>
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}

/** 恒定星空背景层 */
function StarfieldLayer() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const sf = createStarfieldLayer(
      window.innerWidth,
      window.innerHeight,
      Math.min(window.devicePixelRatio || 1, 2),
    );
    host.appendChild(sf.canvas);

    const fit = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sf.resize(w, h, dpr);
    };
    fit();

    let raf = 0;
    const loop = () => {
      sf.render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (raf === 0) {
        raf = requestAnimationFrame(loop);
      }
    };

    window.addEventListener('resize', fit);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
      document.removeEventListener('visibilitychange', onVis);
      sf.canvas.remove();
    };
  }, []);

  return (
    <>
      <div className="starfield-layer" ref={hostRef} aria-hidden />
      <div className="ambient-glow" aria-hidden />
    </>
  );
}

/** 把「当地钟表时间 + 时区偏移」换算成 UTC（不校正真太阳时，与原片口径一致） */
function localToUtc(input: NatalInput): Date {
  const [y, m, d] = input.date.split('-').map(Number);
  const [hh, mm] = input.time.split(':').map(Number);
  const ms = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  return new Date(ms - input.tzOffset * 3600 * 1000);
}
