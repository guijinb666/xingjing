/**
 * 星轨几何与时间驱动。
 *
 * ★ 铁律（原片天文真实感的核心）★
 *   角速度只能由真实公转周期决定：
 *       angle = phase0 + 2π · (N / 365.25) / period
 *   rDraw 纯粹是绘制用的压缩半径，**绝不允许**用来推算角速度。
 *   后果：水星（period 0.241 年）在 N=13 天里转过约 0.93 rad，
 *        海王星（period 164.8 年）只转过约 0.00136 rad，比值 ≈ 684，肉眼即「水星飞驰、海王星凝固」。
 *
 * 位置解算（y 轴须施加 squash 纵向压扁）：
 *   x = cx + rDraw·cos(angle)
 *   y = cy + rDraw·sin(angle)·squash
 */
import type { BodyKey, OrbitBody } from '../types';
import { orbits, tokens } from '../../styles/tokens';
import { BODIES } from './planets';
import { heliocentricPhases } from './heliocentric';

export const TAU = Math.PI * 2;
/** 儒略年天数，用于把「天」换算成「年」 */
export const DAYS_PER_YEAR = 365.25;

/**
 * 某天体从出生时刻起经过 days 天后的日心黄经（弧度）。
 * 这是全片唯一的角度公式，渲染层与测试都必须复用。
 */
export function bodyAngle(phase0: number, period: number, days: number): number {
  return phase0 + (TAU * (days / DAYS_PER_YEAR)) / period;
}

/** 给定天体在出生后 days 天的角度（按 key 查找定义） */
export function angleAt(body: BodyDefLike, days: number): number {
  return bodyAngle(body.phase0, body.period, days);
}

interface BodyDefLike {
  phase0: number;
  period: number;
}

/** 单个天体在 days 天内的角度位移量（弧度，恒为正） */
export function angularTravel(period: number, days: number): number {
  return (TAU * (days / DAYS_PER_YEAR)) / period;
}

/**
 * 渲染坐标（参考画布坐标系 1440×1080）。
 * rDraw 可用 reveal 系数（0..1）做入场展开动画。
 */
export function positionOf(
  rDraw: number,
  angle: number,
  reveal = 1,
): { x: number; y: number } {
  const r = rDraw * reveal;
  return {
    x: orbits.cx + r * Math.cos(angle),
    y: orbits.cy + r * Math.sin(angle) * orbits.squash,
  };
}

/**
 * 按出生时刻构建八条星轨。
 * @param birthUtc 出生时刻的 UTC Date
 */
export function buildOrbitBodies(birthUtc: Date): OrbitBody[] {
  const phases = heliocentricPhases(birthUtc);
  return BODIES.map((def) => {
    const rDraw = orbits.radii[def.key];
    const phase0 = phases[def.key];
    return {
      ...def,
      rDraw,
      phase0,
      angle: phase0,
    };
  });
}

/**
 * 纯函数式推进：返回一份新的 bodies 数组，把 angle 写到 days 对应的位置。
 * 不修改入参，方便 React 渲染层做不可变更新。
 */
export function advanceBodies(bodies: OrbitBody[], days: number): OrbitBody[] {
  let changed = false;
  const next = bodies.map((b) => {
    const angle = bodyAngle(b.phase0, b.period, days);
    if (angle === b.angle) return b;
    changed = true;
    return { ...b, angle };
  });
  return changed ? next : bodies;
}

/** 参考画布下最大的 rDraw（海王星），用于把设计尺寸等比缩放到实际容器 */
export const MAX_R_DRAW: number = orbits.radii.Neptune;

/** 某天体在出生后 days 天内转过的圈数（调试/展示用） */
export function revolutions(period: number, days: number): number {
  return days / DAYS_PER_YEAR / period;
}

/** 时间轴：把状态与 dt 换算成累计天数增量 */
export function stepDays(
  status: 'IDLE' | 'RUNNING' | 'PAUSED',
  dtSeconds: number,
  currentDays: number,
): number {
  if (status !== 'RUNNING') return currentDays;
  return currentDays + tokens.daysPerSecond * dtSeconds;
}

export type { BodyKey };
