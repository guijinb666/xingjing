/**
 * 出生时刻的日心黄经计算。
 *
 * 铁律：相位只来自真实天象（astronomy-engine），与绘制半径 rDraw 完全无关。
 * 绘制半径是录屏标定的视觉尺寸，绝不参与角度计算。
 */
import { AstroTime, Body, Ecliptic, HelioVector } from 'astronomy-engine';
import type { BodyKey } from '../types';

/** BodyKey → astronomy-engine 的 Body 枚举（键名恰好同名，但显式映射以免耦合） */
const ASTRO_BODY: Record<BodyKey, Body> = {
  Mercury: Body.Mercury,
  Venus: Body.Venus,
  Earth: Body.Earth,
  Mars: Body.Mars,
  Jupiter: Body.Jupiter,
  Saturn: Body.Saturn,
  Uranus: Body.Uranus,
  Neptune: Body.Neptune,
};

const TAU = Math.PI * 2;

/**
 * 出生时刻某天体的日心黄经（弧度，[0, 2π)，0 = 春分点方向）。
 *
 * 步骤：HelioVector(日心赤道坐标 J2000) → Ecliptic()（EQJ→ECL 纯旋转，日心向量同样适用）
 *      → 取 elon（度，-180..180）→ 归一到 [0, 2π)。
 */
export function heliocentricLongitude(body: BodyKey, birthUtc: Date): number {
  const t = new AstroTime(birthUtc);
  const eqj = HelioVector(ASTRO_BODY[body], t);
  const ecl = Ecliptic(eqj);
  return normalizeAngle((ecl.elon * Math.PI) / 180);
}

/** 把任意角度归一到 [0, 2π) */
export function normalizeAngle(rad: number): number {
  const m = rad % TAU;
  return m < 0 ? m + TAU : m;
}

/** 一次算出八个天体的出生相位 */
export function heliocentricPhases(birthUtc: Date): Record<BodyKey, number> {
  const out = {} as Record<BodyKey, number>;
  (Object.keys(ASTRO_BODY) as BodyKey[]).forEach((k) => {
    out[k] = heliocentricLongitude(k, birthUtc);
  });
  return out;
}
