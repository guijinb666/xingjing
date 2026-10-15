/**
 * 星轨时间轴：把 OrbitStatus 状态机 + rAF 换算成「出生后经过的天数」。
 *
 * 契约（task-2 §6）：
 *   - status === 'RUNNING'  → days += tokens.daysPerSecond * dt
 *   - status === 'IDLE'     → days 恒为 0（原片初始文案场景）
 *   - status === 'PAUSED'   → days 冻结在当前值
 *
 * 注意：useRafLoop 的 onFrame 回调收到的是 **秒**（已 clamp），
 * 所以这里直接乘 daysPerSecond 即可，不要再除以 1000。
 *
 * 该 hook 与 OrbitCanvas 共用 useRafLoop，因此同样具备「离屏暂停 / 切页暂停」。
 */
import { useCallback, useRef, useState } from 'react';
import type { OrbitStatus } from '../../domain/types';
import { tokens } from '../../styles/tokens';
import { useRafLoop } from './useRafLoop';

export interface OrbitTimeline {
  /** 出生后经过的天数 */
  days: number;
  /** 当前 FPS（调试/展示用） */
  fps: number;
  /** 重置到出生时刻 */
  reset: () => void;
}

export function useOrbitTimeline(status: OrbitStatus, active = true): OrbitTimeline {
  const [days, setDays] = useState(0);
  const daysRef = useRef(0);

  const { fps } = useRafLoop({
    enabled: active && status === 'RUNNING',
    onFrame: (dtSeconds) => {
      // 注意：useRafLoop 的 onFrame 收到的是 **秒**（内部已做过 /1000 并 clamp），
      // 故此处直接乘 daysPerSecond，绝不能再除 1000。
      daysRef.current += tokens.daysPerSecond * dtSeconds;
      setDays(daysRef.current);
    },
  });

  const reset = useCallback((): void => {
    daysRef.current = 0;
    setDays(0);
  }, []);

  // IDLE 场景固定显示出生时刻
  return { days: status === 'IDLE' ? 0 : days, fps, reset };
}
