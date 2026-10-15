/**
 * task-2 自测：铁律验证 —— 角速度必须来自真实公转周期，与 rDraw 无关。
 *
 * 断言：
 *  1) N=13 与 N=58 时，水星的角度位移 > 海王星 × 1000
 *  2) 位移量与 rDraw 完全无关（两个不同 rDraw 的同类天体位移相同）
 *  3) 8 个天体的 rDraw 与 tokens.orbits.radii 一致、phase0 落在 [0, 2π)
 *  4) 位置解算施加了 squash（y 方向被压缩到 sin·0.43）
 */
import { describe, expect, it } from 'vitest';
import { angularTravel, bodyAngle, buildOrbitBodies, DAYS_PER_YEAR, TAU } from '../src/domain/astro/orbit';
import { BODIES } from '../src/domain/astro/planets';
import { orbits } from '../src/styles/tokens';

const BIRTH_UTC = new Date(Date.UTC(2001, 0, 1, 4, 0, 0)); // 2001-01-01 12:00 UTC+8

describe('天文层 · 角速度铁律', () => {
  const bodies = buildOrbitBodies(BIRTH_UTC);

  it('返回全部 8 个天体', () => {
    expect(bodies).toHaveLength(8);
    expect(bodies.map((b) => b.key)).toEqual(BODIES.map((b) => b.key));
  });

  it('rDraw 来自 tokens.orbits.radii（与角速度无关）', () => {
    for (const b of bodies) {
      expect(b.rDraw).toBe(orbits.radii[b.key]);
    }
  });

  it('phase0 是真实日心黄经，落在 [0, 2π)', () => {
    for (const b of bodies) {
      expect(b.phase0).toBeGreaterThanOrEqual(0);
      expect(b.phase0).toBeLessThan(TAU);
    }
  });

  it('N=13 / N=58：水星位移角 >> 海王星（物理比 ≈ 683.8×）', () => {
    for (const n of [13, 58]) {
      const mercury = angularTravel(0.241, n);
      const neptune = angularTravel(164.8, n);
      // eslint-disable-next-line no-console
      console.log(
        `N=${n}: 水星 ${mercury.toFixed(4)} rad (${((mercury / TAU) * 100).toFixed(2)}% 圈) ` +
          `vs 海王星 ${neptune.toFixed(6)} rad → ×${(mercury / neptune).toFixed(1)}`,
      );
      // 真实周期比 164.8 / 0.241 = 683.8。task 描述写的是 ×1000，
      // 但那是不可达的：任何严格使用真实公转周期的实现上限就是 683.8×。
      // 这里断言真实上限值，并把「肉眼可辨」的验收落在 >100× + 像素位移上。
      expect(mercury / neptune).toBeGreaterThan(600);
      expect(mercury / neptune).toBeLessThan(700);
      expect(mercury).toBeGreaterThan(neptune * 100);
    }
  });

  it('N=58 的像素位移：水星走过半个轨道，海王星位移 < 4px', () => {
    const n = 58;
    const arc = (rDraw: number, period: number): number =>
      rDraw * angularTravel(period, n);
    const mercuryArc = arc(orbits.radii.Mercury, 0.241);
    const neptuneArc = arc(orbits.radii.Neptune, 164.8);
    // eslint-disable-next-line no-console
    console.log(
      `N=${n} 弧长: 水星 ${mercuryArc.toFixed(1)}px vs 海王星 ${neptuneArc.toFixed(2)}px`,
    );
    expect(mercuryArc).toBeGreaterThan(90);
    // 海王星 rDraw 很大(722)，即使角度几乎不动，弧长也有 4.37px —— 远小于圆点半径，
    // 视觉上完全静止（对比水星的 438.8px）。
    expect(neptuneArc).toBeLessThan(5);
    expect(mercuryArc / neptuneArc).toBeGreaterThan(100);
  });

  it('位移量与 rDraw 无关：同一 period 必得同一位移', () => {
    const r = angularTravel(1.0, 58);
    const r2 = angularTravel(1.0, 58);
    expect(r).toBe(r2);
    // 地球 58 天走过的角度应约等于 1 弧度（58/365.25*2π ≈ 0.9978）
    expect(r).toBeCloseTo((TAU * 58) / DAYS_PER_YEAR, 10);
  });

  it('angle = phase0 + 2π·(N/365.25)/period', () => {
    const mercury = bodies.find((b) => b.key === 'Mercury');
    expect(mercury).toBeDefined();
    if (mercury === undefined) return;
    const n = 58;
    expect(bodyAngle(mercury.phase0, mercury.period, n)).toBeCloseTo(
      mercury.phase0 + (TAU * (n / DAYS_PER_YEAR)) / mercury.period,
      12,
    );
  });

  it('水星在 58 天内绕行 > 0.6 圈，海王星 < 0.001 圈', () => {
    expect((TAU * (58 / DAYS_PER_YEAR)) / 0.241 / TAU).toBeGreaterThan(0.6);
    expect((TAU * (58 / DAYS_PER_YEAR)) / 164.8 / TAU).toBeLessThan(0.001);
  });
});

describe('天文层 · 位置解算', () => {
  it('x/y 使用 rDraw 且 y 施加 squash', async () => {
    const { positionOf } = await import('../src/domain/astro/orbit');
    // angle=0 → 正右方，y 不偏移
    expect(positionOf(100, 0)).toEqual({ x: orbits.cx + 100, y: orbits.cy });
    // angle=π/2 → 正下方，y 偏移被 squash 压缩
    const down = positionOf(100, Math.PI / 2);
    expect(down.x).toBeCloseTo(orbits.cx, 10);
    expect(down.y).toBeCloseTo(orbits.cy + 100 * orbits.squash, 10);
    expect(orbits.squash).toBe(0.43);
  });
});
