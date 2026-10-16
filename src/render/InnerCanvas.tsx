/**
 * 内景星图（three.js 真 3D 版）。
 *
 * 与旧 2D 版的区别：
 *  - 人体是**真三维旋转体**（剖面表 → LatheGeometry 思路的自建网格），
 *    有骨架、经脉、X 光半透明发光材质，转起来有透视纵深。
 *  - 星曜节点铺在**两个球面**上（十神内球、神煞外球，Fibonacci 均匀分布），
 *    随人体一起绕 y 轴环绕，不再是平面圆环。
 *  - 交互：拖拽上下左右环绕 / 滚轮缩放 / 双击放大-缩小 / **单击节点查看介绍**。
 *  - 用户停止操作 2.2s 后恢复自动旋转。
 *
 * 注意：本组件刻意**不含**星空背景（背景由 App 的 .starfield-layer 负责），
 * 所以渲染器开 alpha 且 clearColor 透明。
 *
 * —— 节点命中测试（task-4）——
 * 采用 **THREE.Raycaster 直接对场景里的 Sprite 做 raycast**，不改 innerScene.ts：
 * `InnerScene` 已把 `orbiting: OrbitingNode[]` 暴露为 public readonly，
 * 每项含 `src: ChartNode` 与 `sprite: Sprite`。于是本文件只需
 * `raycaster.setFromCamera(ndc, scene.camera)` + `intersectObjects(sprites)`，
 * 取最近一个有交点的 Sprite，即可由 `sprite` 反查回对应的 `ChartNode`。
 * 好处：① 完全不动 `src/render3d/**`（task-3 的工作面）；
 *      ② 节点自身在 `update()` 里呼吸缩放、入场淡入，Sprite 的
 *         world matrix 每帧都被 three 更新，raycast 天然贴合当前视觉位置。
 *
 * 「单击」的判定：pointerdown / pointerup 之间位移不超过 CLICK_SLOP 像素，
 * 且耗时不超过 CLICK_MAX_MS —— 否则算拖拽，不触发弹窗。
 */
import { useEffect, useRef } from 'react';
import { Raycaster, Vector2, Vector3, WebGLRenderer } from 'three';
import type { Sprite } from 'three';
import type { ChartNode } from '@/domain/types';
import { InnerScene } from '@/render3d/innerScene';

/** 用户停手多久后恢复自动旋转（ms）——仅对「拖拽」生效 */
const AUTO_RESUME_DELAY = 2200;

/** 相机距离限位（对应「放大缩小」） */
const MIN_DISTANCE = 2.6;
const MAX_DISTANCE = 14;

/** 双击放大的目标距离 */
const DOUBLED_DISTANCE = 3.2;

/**
 * 缩放时自动旋转的减速系数（0 = 完全停转，1 = 完全不受影响）。
 *
 * 用户明确要求：**缩放时依然保持旋转**。
 * 所以滚轮 / 双击只把自动旋转「降速」而不是「停掉」——
 * 拉近看细节时球面仍在极缓慢地转（保留「活着的星图」的观感），
 * 但不会因为转太快看不清；拖拽则维持原来的「暂时停转 + 2.2s 后恢复」。
 */
const ZOOM_SPIN_DAMP = 0.42;

/** 常速自动旋转角速度（rad/s），与 InnerScene.autoSpinSpeed 的默认值保持一致 */
const AUTO_SPIN_SPEED = 0.085;

/** 俯仰角限位，避免转到人体正上/正下造成视图翻转 */
const MIN_POLAR = 0.28;
const MAX_POLAR = Math.PI - 0.28;

/** 判定为「单击」的位移容差（CSS 像素）——超过即视为拖拽 */
const CLICK_SLOP = 6;

/** 判定为「单击」的时长上限（ms）——按住太久即视为长按/拖拽 */
const CLICK_MAX_MS = 600;

interface Props {
  /** 命盘节点（含图标键与分组） */
  nodes: ChartNode[];
  /** 是否在视口内（false 时暂停 rAF 省电） */
  active: boolean;
  /** 触发入场动画的序号，变化时重播入场 */
  replayKey?: number;
  /**
   * 单击某个节点时回调。
   *
   * 传 `null` 表示点了空白处（未命中任何节点）。
   * 由父组件 `InnerSection` 负责决定这是「打开」还是「切换/关闭」。
   */
  onPickNode?: (node: ChartNode | null) => void;
}

export default function InnerCanvas({ nodes, active, replayKey = 0, onPickNode }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<InnerScene | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  /**
   * 回调放进 ref 再在 effect 里取用。
   *
   * 原因：`onPickNode` 通常是父组件里的普通函数（每次渲染都是新引用），
   * 若进 useEffect 依赖数组会导致 WebGL 场景反复重建。用 ref 转发，
   * 既拿到最新回调，又让 effect 依赖保持在 `[nodes, replayKey]`。
   */
  const pickRef = useRef<Props['onPickNode']>(onPickNode);
  pickRef.current = onPickNode;

  // —— 创建场景（节点变化时重建） ——
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || nodes.length === 0) return;

    let disposed = false;
    let scene: InnerScene | null = null;
    let cleanupGL: (() => void) | null = null;

    // 注意：three 由 render3d/* 静态导入，这里再动态 import 也分不出独立 chunk，
    // 所以直接走同步初始化，少一层异步竞态。
    void (async () => {
      if (disposed) return;

      const rect = wrap.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));

      const renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      renderer.setClearColor(0x000000, 0);

      scene = new InnerScene({ nodes, width, height });
      sceneRef.current = scene;

      // —— 交互：拖拽环绕 / 滚轮缩放 / 双击放大 / 单击选点 ——
      const local = scene;
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      let idleTimer: number | undefined;

      // 单击判定用：按下位置与时刻
      let downX = 0;
      let downY = 0;
      let downAt = 0;

      /** 拖拽期间暂停自动旋转，停手 2.2s 后恢复 */
      const wake = () => {
        local.autoSpin = false;
        if (idleTimer !== undefined) window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => {
          local.autoSpin = true;
        }, AUTO_RESUME_DELAY);
      };

      /**
       * 缩放（滚轮 / 双击）只**降速**不停转 —— 见 ZOOM_SPIN_DAMP 的说明。
       * 恢复时不做 2.2s 等待：缩放不像拖拽，用户松开滚轮就应回到常速。
       */
      const nudgeSpin = () => {
        local.autoSpin = true;
        if (idleTimer !== undefined) window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => {
          local.autoSpinSpeed = AUTO_SPIN_SPEED;
        }, 900);
        local.autoSpinSpeed = AUTO_SPIN_SPEED * ZOOM_SPIN_DAMP;
      };

      /**
       * 射线拾取：屏幕坐标 → NDC → raycaster → 最近的 Sprite → ChartNode。
       *
       * Sprite 的 raycast 在 three 里是「屏幕空间包围盒」判定（Sprite.raycast
       * 内部把世界坐标投影回 NDC 再与四边形求交），所以图标精灵的**透明区域**
       * 也会命中 —— 对「跟着看板点」这个场景反而更宽容、更好点，
       * 因此不再额外对贴图做 alpha 测试。
       *
       * 只测节点精灵，不测人体/连线，避免点到人体就弹窗。
       */
      const raycaster = new Raycaster();
      const ndc = new Vector2();

      const pickAt = (clientX: number, clientY: number): ChartNode | null => {
        if (!scene) return null;
        const r = canvas.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
        ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
        raycaster.setFromCamera(ndc, scene.camera);
        const sprites: Sprite[] = [];
        for (const o of scene.orbiting) {
          if (o.sprite.visible) sprites.push(o.sprite);
        }
        if (sprites.length === 0) return null;
        const hits = raycaster.intersectObjects(sprites, false);
        if (hits.length === 0) return null;
        const found = scene.orbiting.find((o) => o.sprite === hits[0].object);
        return found ? found.src : null;
      };

      /**
       * 仅供自动化测试的探针：交出屏幕上**所有**可见节点的屏幕坐标。
       *
       * 做法是把每个可见精灵的世界坐标投影到 NDC 再换算成 CSS 像素，
       * 只留**面向相机**（离眼更近的那半）且不在画面边缘的点，按离屏幕中心
       * 从近到远排序 —— 这样 playwright 依次点过去，既能覆盖到不同节点，
       * 又不会落在四角 HUD 上或被画布裁掉。
       *
       * 只在 dev 下挂到 window；生产构建里 `import.meta.env.DEV` 为 false，整段被摇掉。
       */
      const w0 = window as unknown as {
        __xjPick?: () => { x: number; y: number } | null;
        __xjPickAll?: () => Array<{ x: number; y: number; name: string; id: string }>;
      };
      if (import.meta.env.DEV) {
        w0.__xjPickAll = () => {
          if (!scene) return [];
          const eye = scene.camera.position.clone();
          const eyeLen = eye.length();
          const rect = canvas.getBoundingClientRect();
          const cand: Array<{ x: number; y: number; name: string; id: string; score: number }> = [];
          for (const o of scene.orbiting) {
            if (!o.sprite.visible) continue;
            const world = o.sprite.getWorldPosition(new Vector3());
            // 远侧（相机背后那半圈）跳过 —— 它们可能被人体挡住
            if (world.distanceTo(eye) > eyeLen + 0.02) continue;
            const p = world.clone().project(scene.camera);
            if (p.z < -1 || p.z > 1) continue;
            const x = ((p.x + 1) / 2) * rect.width + rect.left;
            const y = ((1 - p.y) / 2) * rect.height + rect.top;
            if (x < 70 || x > window.innerWidth - 70) continue;
            if (y < 100 || y > window.innerHeight - 100) continue;
            const dx = (x - window.innerWidth / 2) / window.innerWidth;
            const dy = (y - window.innerHeight / 2) / window.innerHeight;
            cand.push({
              x: Math.round(x),
              y: Math.round(y),
              name: o.src.name,
              id: o.src.id,
              score: -(dx * dx + dy * dy),
            });
          }
          cand.sort((a, b) => b.score - a.score);
          return cand.map(({ x, y, name, id }) => ({ x, y, name, id }));
        };
        w0.__xjPick = () => {
          const all = w0.__xjPickAll?.() ?? [];
          return all.length > 0 ? { x: all[0].x, y: all[0].y } : null;
        };
      }

      const onPointerDown = (e: PointerEvent) => {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        downX = e.clientX;
        downY = e.clientY;
        downAt = performance.now();
        canvas.setPointerCapture(e.pointerId);
        wake();
      };

      const onPointerMove = (e: PointerEvent) => {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        // 左右拖 → 方位角；上下拖 → 极角（夹紧避免翻转）
        local.azimuth -= dx * 0.006;
        local.polar = Math.min(MAX_POLAR, Math.max(MIN_POLAR, local.polar - dy * 0.005));
        wake();
      };

      const onPointerUp = (e: PointerEvent) => {
        const wasDragging = dragging;
        dragging = false;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        if (!wasDragging) return;

        // —— 单击判定 ——
        // 位移与时长都在容差内才算「点了一下」，否则是拖拽/长按，不出面板。
        const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
        const elapsed = performance.now() - downAt;
        if (moved > CLICK_SLOP || elapsed > CLICK_MAX_MS) return;

        // 主键（左键）或触摸/笔才响应
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        const hit = pickAt(e.clientX, e.clientY);
        pickRef.current?.(hit);
      };

      const onPointerCancel = (e: PointerEvent) => {
        dragging = false;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      };

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const next = local.distance * (1 + Math.sign(e.deltaY) * 0.09);
        local.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, next));
        nudgeSpin();
      };

      // 双击：拉近放大；再双击回到全景
      let lastDouble = 0;
      const onDblClick = () => {
        const now = performance.now();
        const isZoomIn = now - lastDouble > 700 || local.distance >= MAX_DISTANCE - 1.5;
        lastDouble = now;
        local.distance = isZoomIn ? DOUBLED_DISTANCE : MAX_DISTANCE;
        nudgeSpin();
      };

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerCancel);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('dblclick', onDblClick);

      // —— 尺寸自适应 ——
      const ro = new ResizeObserver(() => {
        const r = wrap.getBoundingClientRect();
        const w = Math.max(1, Math.round(r.width));
        const h = Math.max(1, Math.round(r.height));
        renderer.setSize(w, h, false);
        local.resize(w, h);
      });
      ro.observe(wrap);

      // —— 渲染循环 ——
      let raf = 0;
      let last = 0;
      const frame = (now: number) => {
        if (disposed || !scene) return;
        raf = requestAnimationFrame(frame);
        if (!last) last = now;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        // 不在视口里就停住时间推进（画面留在原地，省电）
        if (activeRef.current) scene.update(dt, renderer);
      };
      raf = requestAnimationFrame(frame);

      cleanupGL = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        if (idleTimer !== undefined) window.clearTimeout(idleTimer);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('dblclick', onDblClick);
        scene?.dispose();
        renderer.dispose();
        sceneRef.current = null;
        scene = null;
        // 卸掉测试探针，避免热更新后指向上一个已销毁的场景
        const w = window as unknown as { __xjPick?: unknown; __xjPickAll?: unknown };
        delete w.__xjPick;
        delete w.__xjPickAll;
      };
    })();

    return () => {
      disposed = true;
      cleanupGL?.();
    };
  }, [nodes, replayKey]);

  return (
    <div ref={wrapRef} className="inner-canvas-wrap">
      <canvas ref={canvasRef} className="inner-canvas" />
    </div>
  );
}

/**
 * 仅供测试与调试：把当前场景暴露到 window，便于 playwright 无头验证
 * 「射线 → 节点」这条链路（不参与生产逻辑，且仅在 dev 下挂载）。
 */
export type { ChartNode };
