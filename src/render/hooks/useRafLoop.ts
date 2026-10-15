/**
 * 通用 requestAnimationFrame 循环。
 *
 * 三重省电策略：
 * 1. enabled=false（离屏 / 状态非 RUNNING）→ 不注册 rAF
 * 2. document.hidden（切到别的标签页）→ 自动挂起，回来续跑
 * 3. 页面不可见期间累积的时间被丢弃（clamp dt），避免回前台瞬移
 *
 * 返回 FPS 统计（每 ~500ms 采样一次）。
 */
import { useEffect, useRef, useState } from 'react';

export interface RafLoopOptions {
  /** 是否运行；false 时循环挂起（effect 卸载订阅，不空转） */
  enabled: boolean;
  /** 每帧回调，dt 为秒（已 clamp，最大 0.1s） */
  onFrame: (dtSeconds: number) => void;
  /** 页面不可见时是否自动暂停，默认 true */
  pauseOnHidden?: boolean;
  /** dt 上限（秒），默认 0.1，防止后台回来瞬移 */
  maxDt?: number;
}

export interface RafStats {
  fps: number;
  /** 累计帧数，便于外部断言「确实在跑」 */
  frames: number;
}

const MAX_DT_DEFAULT = 0.1;
const FPS_SAMPLE_MS = 500;

export function useRafLoop(options: RafLoopOptions): RafStats {
  const { enabled, onFrame, pauseOnHidden = true, maxDt = MAX_DT_DEFAULT } = options;

  const [stats, setStats] = useState<RafStats>({ fps: 0, frames: 0 });

  // 用 ref 持有最新回调，避免因回调身份变化而反复重启循环
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (!enabled) {
      setStats((s) => (s.fps === 0 ? s : { ...s, fps: 0 }));
      return;
    }

    let rafId: number | null = null;
    let last = 0;
    let frames = 0;
    let sampleStart = 0;
    let sampleFrames = 0;
    let stopped = false;

    const tick = (now: number) => {
      if (stopped) return;
      if (last === 0) {
        last = now;
        sampleStart = now;
      }
      const rawDt = (now - last) / 1000;
      last = now;
      const dt = Math.min(Math.max(rawDt, 0), maxDt);

      frames += 1;
      sampleFrames += 1;
      onFrameRef.current(dt);

      if (now - sampleStart >= FPS_SAMPLE_MS) {
        const fps = Math.round((sampleFrames * 1000) / Math.max(now - sampleStart, 1));
        sampleFrames = 0;
        sampleStart = now;
        setStats({ fps, frames });
      }

      rafId = requestAnimationFrame(tick);
    };

    const start = () => {
      if (stopped || rafId !== null) return;
      last = 0;
      rafId = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      last = 0;
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
        // 可见性恢复后从 0 开始计时，丢弃不可见期间的时间
        setStats((s) => ({ ...s, fps: 0, frames }));
      } else {
        start();
      }
    };

    if (!pauseOnHidden || !document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, pauseOnHidden, maxDt]);

  return stats;
}
