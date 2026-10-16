/**
 * 星轨区块：标题 + Canvas。
 *
 * 对应原片「诞生星轨」区：
 *  - 衬线大字标题「诞生星轨」
 *  - 副标题「HELIOCENTRIC · 静止于出生时刻」/「HELIOCENTRIC · 出生后 N 天」
 *  - 8 条日心轨道 + 太阳 + 天体 + 右下角星符按钮
 *
 * 状态机（单一真相源 `status`，另有 `started` 只记录「是否已起航过」）：
 *  - IDLE    ：刚进入视口，days 固定 0，文案「静止于出生时刻」，星符按钮显示"开始"
 *  - RUNNING ：进入视口 1100ms 后自动起航；离开视口自动暂停、回屏自动恢复
 *  - PAUSED  ：手动暂停（或离屏），days 冻结
 *
 * 注意：自动起航只由「未起航 + 在视口」触发一次，之后进出视口只做 RUNNING/PAUSED
 * 之间的切换，绝不再回到 IDLE，避免两套逻辑互相覆盖。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OrbitBody, OrbitStatus } from '@/domain/types';
import { buildOrbitBodies, advanceBodies } from '@/domain/astro/orbit';
import OrbitCanvas from '@/render/OrbitCanvas';
import { useOrbitTimeline } from '@/render/hooks/useOrbitTimeline';

interface Props {
  /** 出生时刻（UTC） */
  birthUtc: Date;
  /** 是否处于激活状态（由 App 的三幕切换提供） */
  inView: boolean;
}

export default function OrbitSection({ birthUtc, inView }: Props) {
  const [status, setStatus] = useState<OrbitStatus>('IDLE');
  /** 是否已起航过（一旦为 true 就只影响"自动恢复"，不再触发 IDLE→RUNNING 的延迟） */
  const [started, setStarted] = useState(false);
  /** 用户在自动起航前就手动点过星符按钮 → 抑制自动起航 */
  const userToggled = useRef(false);

  const baseBodies = useMemo<OrbitBody[]>(() => buildOrbitBodies(birthUtc), [birthUtc]);

  // 进入星轨屏即刻起航（用户明确选择「进入即刻自动推进」）：
  // 先让「静止于出生时刻」停一拍被看见，再开始推进，不需要任何额外操作。
  useEffect(() => {
    if (!inView || started || userToggled.current) return undefined;
    const t = window.setTimeout(() => {
      if (userToggled.current) return; // 延迟期内用户已接管
      setStarted(true);
      setStatus('RUNNING');
    }, 260);
    return () => window.clearTimeout(t);
  }, [inView, started]);

  // 离开视口自动暂停，回来恢复（仅当已起航过且用户未处于手动暂停意图）
  useEffect(() => {
    if (!started) return undefined;
    if (!inView) {
      setStatus((s) => (s === 'RUNNING' ? 'PAUSED' : s));
    } else {
      setStatus((s) => (s === 'PAUSED' ? 'RUNNING' : s));
    }
    return undefined;
  }, [inView, started]);

  // 换出生时刻则整体复位
  useEffect(() => {
    userToggled.current = false;
    setStarted(false);
    setStatus('IDLE');
  }, [birthUtc]);

  const { days } = useOrbitTimeline(status, inView);

  const bodies = useMemo(
    () => (status === 'IDLE' ? baseBodies : advanceBodies(baseBodies, days)),
    [status, baseBodies, days],
  );

  const toggle = useCallback(() => {
    userToggled.current = true;
    setStatus((s) => {
      if (s === 'RUNNING') return 'PAUSED';
      setStarted(true);
      return 'RUNNING';
    });
  }, []);

  const subtitle =
    status === 'IDLE' || days === 0
      ? 'HELIOCENTRIC · 静止于出生时刻'
      : `HELIOCENTRIC · 出生后 ${Math.floor(days)} 天`;

  return (
    <div className="orbit-block">
      <header className="orbit-head">
        <h2 className="orbit-title">诞生星轨</h2>
        <p className="orbit-sub" aria-live="polite">
          {subtitle}
        </p>
      </header>
      <div className="orbit-stage">
        <OrbitCanvas
          bodies={bodies}
          status={status}
          onToggle={toggle}
          days={Math.floor(days)}
          className="orbit-canvas"
        />
      </div>
    </div>
  );
}
