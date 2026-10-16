/**
 * 诞生星轨 · three.js 宿主组件。
 *
 * ============================ 从 2D 迁移到 3D 的说明 ============================
 * 旧版本组件直接在 2D canvas 上画椭圆轨道 + 圆点 + 标签。
 * 现在它退化为**纯粹的宿主**：持有 renderer / 场景生命周期 / 交互事件，
 * 真正的绘图全部交给 `render3d/orbitScene.ts`。
 *
 * **对外契约完全保留**（`bodies / status / onToggle / days / scale / className`），
 * 所以 `components/OrbitSection.tsx` 无需任何改动。
 *
 * ============================ 交互需求 ============================
 *   ① **滚轮缩放**：带惯性（松手后继续滑行并衰减）
 *   ② **双击**：拉近到该行星；再双击回到全景
 *   ③ **拖拽**：绕太阳水平环绕 + 俯仰（夹紧，避免翻转）
 *   ④ **捏合**（触屏双指）：缩放
 *   ⑤ 缩放范围大到**单颗行星占满屏幕**（见 orbitScene 的 MIN_DISTANCE）
 *
 * ============================ 铁律 ============================
 * ★ 本组件**不计算任何角度**。天体角度由 `bodies[].angle` 从
 *   `domain/astro/orbit` 一路传进来，再原样交给 `scene.applyDays()`。
 *   缩放/相机距离/惯性都只影响**相机**，绝不影响时间或角速度。
 *   squash 只在 orbitScene 绘制位置时作用于 z 分量。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { WebGLRenderer } from 'three';
import type { OrbitBody, OrbitStatus } from '../domain/types';
import { OrbitScene, DEFAULT_DISTANCE, MIN_DISTANCE, MAX_DISTANCE } from '../render3d/orbitScene';
import { preloadTextures, getTextureSource } from '../render3d/planetMaterials';
import RuneButton from '../components/RuneButton';
import { useInView } from './hooks/useInView';

export interface OrbitCanvasProps {
  bodies: OrbitBody[];
  status: OrbitStatus;
  onToggle: () => void;
  /** 出生后经过的天数（由外层的 useOrbitTimeline 驱动） */
  days: number;
  /** 额外缩放系数（默认 1，叠加在容器自适应缩放之上） */
  scale?: number;
  className?: string;
}

/** 滚轮每格的缩放倍率（指数缩放，保证「每格手感一致」） */
const WHEEL_STEP = 1.12;
/** 惯性：松手后每秒衰减到的比例（越小滑得越短） */
const INERTIA_DAMPING = 0.16;
/** 惯性速度低于此值就停下（世界单位/秒） */
const INERTIA_MIN_SPEED = 6;

/** 拖拽灵敏度 */
const ORBIT_SENSITIVITY = 0.0052;
/** 俯仰角限位 */
const MIN_POLAR = 0.16;
const MAX_POLAR = Math.PI / 2 + 0.42;

/**
 * 双击聚焦：把相机拉到「该行星直径约占屏幕 55%」的距离。
 *
 * 这是「放大到单颗行星占满屏幕」这条要求的兑现处。
 */
const FOCUS_FILL_RATIO = 0.55;

/** 双击判定间隔（ms）：两次点击间隔小于此值算双击 */
const DBL_INTERVAL = 340;

export function OrbitCanvas(props: OrbitCanvasProps): JSX.Element {
  const { bodies, status, onToggle, days, scale = 1, className } = props;

  const [wrapRef, inView] = useInView<HTMLDivElement>({ rootMargin: '120px' });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<OrbitScene | null>(null);

  /** 最新一次渲染用的 bodies / days（供 rAF 与 effect 之间传递，避免重建场景） */
  const bodiesRef = useRef<OrbitBody[]>(bodies);
  bodiesRef.current = bodies;
  const daysRef = useRef(days);
  daysRef.current = days;
  const inViewRef = useRef(inView);
  inViewRef.current = inView;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  /** 调试：暴露给探针/playwright */
  const statsRef = useRef<{ distance: number; drawn: number }>({ distance: 0, drawn: 0 });

  /**
   * 贴图是否已就位。
   *
   * ★ 根因记录（实测数据）：原先场景一挂载就同步烘焙 11 张贴图，
   *   `_probe/tex-bench.html` 测得首次合计 **7876ms**，浏览器里表现为
   *   **10905ms 主线程长任务** → 页面冻结 11 秒，用户报障「星轨加载不出来」。
   *   现在先 `await preloadTextures()`（异步图片解码，不占主线程），
   *   就绪后才建 three.js 场景。
   */
  const [ready, setReady] = useState(false);
  const [texSource, setTexSource] = useState<'asset' | 'procedural' | null>(null);

  useEffect(() => {
    let cancelled = false;
    void preloadTextures().then(() => {
      if (cancelled) return;
      setTexSource(getTextureSource());
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------------------------------- 场景生命周期
  useEffect(() => {
    // 贴图未就位前不建场景；就绪后本 effect 会再跑一次（deps 含 ready）
    if (!ready) return undefined;

    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (wrap === null || canvas === null) return undefined;

    const rect = wrap.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    const renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = 'srgb';

    const scene = new OrbitScene({ bodies: bodiesRef.current, width, height });
    sceneRef.current = scene;

    // —— 把上游算好的角度喂进场景（只赋值，不计算） ——
    const syncDays = (): void => {
      scene.applyDays(bodiesRef.current, daysRef.current);
    };
    syncDays();

    // ---------------------------------------------------- 交互
    /** 惯性：当前相机距离变化速度（世界单位/秒） */
    let vel = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let lastTapAt = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    /** 双击聚焦中的目标距离（null = 无目标） */
    let focusTarget: number | null = null;

    /** 把距离夹紧并同步（返回是否真的动了） */
    const setDist = (d: number): boolean => {
      const before = scene.distance;
      scene.setDistance(d);
      return Math.abs(scene.distance - before) > 1e-6;
    };

    const applyScale = (): void => {
      // props.scale 是「额外缩放系数」：>1 拉近，<1 推远
      const s = scaleRef.current;
      if (Math.abs(s - 1) < 1e-6) return;
      setDist(DEFAULT_DISTANCE / s);
    };
    applyScale();

    const onPointerDown = (e: PointerEvent): void => {
      dragging = true;
      focusTarget = null;
      vel = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      scene.azimuth += dx * ORBIT_SENSITIVITY;
      scene.polar = Math.min(MAX_POLAR, Math.max(MIN_POLAR, scene.polar - dy * ORBIT_SENSITIVITY));
    };

    const endDrag = (e: PointerEvent): void => {
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };

    /**
     * 双击：若命中某颗行星 → 聚焦到它（拉近到占屏 55%）；
     *       否则 → 在全景与中景之间切换。
     * 再双击（命中同一位置附近）→ 回到全景。
     */
    const onPointerUp = (e: PointerEvent): void => {
      const wasDragging =
        Math.abs(e.clientX - lastX) > 2 || Math.abs(e.clientY - lastY) > 2;
      endDrag(e);
      if (wasDragging) return;

      const now = performance.now();
      const isDbl =
        now - lastTapAt < DBL_INTERVAL &&
        Math.abs(e.clientX - lastTapX) < 24 &&
        Math.abs(e.clientY - lastTapY) < 24;
      lastTapAt = now;
      lastTapX = e.clientX;
      lastTapY = e.clientY;
      if (!isDbl) return;

      // 双击 → 先看是否点在某颗行星上
      const r = canvas.getBoundingClientRect();
      const key = scene.hitTest(
        e.clientX - r.left,
        e.clientY - r.top,
        r.width,
        r.height,
      );
      if (key !== null && scene.distance > MIN_DISTANCE * 2.2) {
        focusTarget = focusDistanceFor(scene, key);
        vel = 0;
        return;
      }
      // 否则在全景 / 中景之间切换
      const isWide = scene.distance > (MIN_DISTANCE + MAX_DISTANCE) / 2;
      focusTarget = isWide ? DEFAULT_DISTANCE * 0.34 : DEFAULT_DISTANCE * 1.16;
      vel = 0;
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      focusTarget = null;
      // 指数缩放：拉近/推远手感对称
      const step = e.deltaY > 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      const before = scene.distance;
      const next = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, before * step));
      scene.distance = next;
      // 惯性速度：与本次位移同向，按 deltaY 的量级给一个初速
      const mag = Math.min(3, Math.abs(e.deltaY) / 100);
      vel = ((next - before) / Math.max(0.001, Math.abs(step - 1))) * 0.06 * mag;
      vel = Math.max(-900, Math.min(900, vel));
    };

    // —— 触屏捏合 ——
    const touches = new Map<number, { x: number; y: number }>();
    let pinchStartDist = 0;
    let pinchStartCamDist = 0;

    const onTouchStart = (e: TouchEvent): void => {
      for (const t of Array.from(e.touches)) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      if (touches.size === 2) {
        const [a, b] = Array.from(touches.values());
        pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
        pinchStartCamDist = scene.distance;
        focusTarget = null;
      }
    };
    const onTouchMove = (e: TouchEvent): void => {
      for (const t of Array.from(e.touches)) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      if (touches.size !== 2 || pinchStartDist < 1) return;
      const [a, b] = Array.from(touches.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setDist(pinchStartCamDist * (pinchStartDist / Math.max(1, d)));
    };
    const onTouchEnd = (e: TouchEvent): void => {
      for (const t of Array.from(e.touches)) touches.delete(t.identifier);
      if (touches.size < 2) pinchStartDist = 0;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });

    // ---------------------------------------------------- 尺寸自适应
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      renderer.setSize(w, h, false);
      scene.resize(w, h);
    });
    ro.observe(wrap);


    // ---------------------------------------------------- 渲染循环
    let raf = 0;
    let last = 0;
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      if (last === 0) last = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // 离屏时只同步数据、不推进动画（画面留在原地，省电）
      syncDays();
      if (!inViewRef.current) return;

      if (!scene.introDone) scene.startIntro();

      // —— 惯性：松手/滚轮之后继续滑行并衰减 ——
      if (!dragging) {
        if (focusTarget !== null) {
          // 双击聚焦：平滑趋向目标距离
          const k = Math.min(1, dt * 7);
          scene.distance += (focusTarget - scene.distance) * k;
          if (Math.abs(focusTarget - scene.distance) < 1) {
            scene.distance = focusTarget;
            focusTarget = null;
          }
        } else if (Math.abs(vel) > INERTIA_MIN_SPEED) {
          const before = scene.distance;
          setDist(scene.distance + vel * dt);
          // 撞到限位就吃掉剩余速度
          if (Math.abs(scene.distance - before) < Math.abs(vel * dt) * 0.5) vel = 0;
          vel *= Math.pow(INERTIA_DAMPING, dt);
        } else {
          vel = 0;
        }
      }

      scene.update(dt, renderer);
      statsRef.current.distance = scene.cameraDistance;
      statsRef.current.drawn = Math.round(scene.lastDays);
      exposeDebug();
    };
    raf = requestAnimationFrame(frame);

    /** 把调试信息挂到 window，供 playwright 断言（生产环境也保留，无副作用） */
    const exposeDebug = (): void => {
      const w = wrap as HTMLDivElement & {
        __orbit?: { distance: number; days: number; target: number | null };
      };
      w.__orbit = {
        distance: scene.cameraDistance,
        days: scene.lastDays,
        target: focusTarget,
      };
    };

    const cleanup = (): void => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      scene.dispose();
      renderer.dispose();
      sceneRef.current = null;
    };

    return cleanup;
    // 只在贴图就位后建一次；bodies/days 通过 ref 每帧同步，避免重建 WebGL 上下文
  }, [wrapRef, ready]);

  // —— 换出生时刻 / 天体集合变化时重同步（不重建场景） ——
  useEffect(() => {
    sceneRef.current?.applyDays(bodies, days);
  }, [bodies, days]);

  const handleToggle = useCallback(() => {
    onToggle();
  }, [onToggle]);

  const isRunning = status === 'RUNNING';

  return (
    <div
      ref={wrapRef}
      className={className}
      data-days={Math.round(days)}
      data-tex-source={texSource ?? 'pending'}
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: 240 }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
      />
      {!ready && (
        <div className="orbit-loading" role="status" aria-live="polite">
          <span className="orbit-loading-ring" aria-hidden />
          <span className="orbit-loading-text">正在描摹星体…</span>
        </div>
      )}
      <RuneButton running={isRunning} onToggle={handleToggle} />
    </div>
  );
}

/**
 * 算出「该行星直径约占屏幕 FILL 比例」时的相机距离。
 *
 *   screenR = R / (dist · tan(fov/2)) · (H/2)
 *   要 screenR·2 / H = FILL  →  dist = R / (tan(fov/2) · FILL)
 */
function focusDistanceFor(scene: OrbitScene, key: string): number {
  const R = scene.planetRadius(key as never);
  const fov = (scene.camera.fov * Math.PI) / 180;
  const d = R / (Math.tan(fov / 2) * FOCUS_FILL_RATIO);
  return Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, d));
}

export default OrbitCanvas;
