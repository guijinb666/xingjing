/**
 * 内景星图图标绘制。
 * 每个节点是一个 14px 圆环 + 环内的一个线性 glyph。
 * 所有 glyph 都在 [-1,1] 的单位坐标内定义，由 drawGlyph 按半径缩放。
 *
 * 图标风格对齐参考录屏：细线、几何、无填充（个别用半填充），
 * 十神用青绿、神煞用紫，靠颜色 + 形状双重区分。
 */
import type { IconKey } from '@/domain/types';

export const ICON_KEYS: IconKey[] = [
  'star', 'sun', 'moon', 'cross', 'flag', 'flower', 'gem',
  'hex', 'tri', 'spark', 'diamond', 'ring', 'square', 'hourglass',
];

type Ctx = CanvasRenderingContext2D;

/** 判断一个 icon key 是否合法（供外部做 fallback 校验） */
export function isIconKey(v: string): v is IconKey {
  return (ICON_KEYS as string[]).includes(v);
}

const TAU = Math.PI * 2;

/**
 * 绘制图标。
 * @param ctx     画布上下文（调用前应已设置好 strokeStyle / fillStyle）
 * @param icon    图标键
 * @param cx,cy   图标中心
 * @param R       图标外接半径（像素）
 * @param alpha   透明度
 */
export function drawGlyph(
  ctx: Ctx,
  icon: IconKey,
  cx: number,
  cy: number,
  R: number,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const lw = Math.max(1, R * 0.14);
  ctx.lineWidth = lw;

  switch (icon) {
    case 'star': {
      // 八芒星：四条轴线 + 短对角
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU - Math.PI / 2;
        const r = i % 2 === 0 ? R : R * 0.44;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'sun': {
      // 实心圆 + 八条射线
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.34, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        ctx.moveTo(Math.cos(a) * R * 0.52, Math.sin(a) * R * 0.52);
        ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      }
      ctx.stroke();
      break;
    }
    case 'moon': {
      // 半填充月相圆
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.86, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.78, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'cross': {
      // 交叉的剑/杵
      ctx.beginPath();
      ctx.moveTo(-R, -R * 0.6);
      ctx.lineTo(R, R * 0.6);
      ctx.moveTo(R, -R * 0.6);
      ctx.lineTo(-R, R * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-R, -R * 0.6, lw * 0.9, 0, TAU);
      ctx.arc(R, -R * 0.6, lw * 0.9, 0, TAU);
      ctx.fill();
      break;
    }
    case 'flag': {
      // 旗帜：旗杆 + 三角旗面
      ctx.beginPath();
      ctx.moveTo(-R * 0.42, R);
      ctx.lineTo(-R * 0.42, -R);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-R * 0.42, -R);
      ctx.lineTo(R, -R * 0.5);
      ctx.lineTo(-R * 0.42, R * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'flower': {
      // 六瓣花（旋转的三组水滴）
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        ctx.ellipse(0, 0, R * 0.92, R * 0.34, a, 0, TAU);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.2, 0, TAU);
      ctx.fill();
      break;
    }
    case 'gem': {
      // 钻石：上梯形 + 下三角
      ctx.beginPath();
      ctx.moveTo(-R * 0.8, -R * 0.34);
      ctx.lineTo(-R * 0.42, -R);
      ctx.lineTo(R * 0.42, -R);
      ctx.lineTo(R * 0.8, -R * 0.34);
      ctx.lineTo(0, R);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-R * 0.42, -R);
      ctx.lineTo(0, -R * 0.34);
      ctx.lineTo(R * 0.42, -R);
      ctx.moveTo(-R * 0.8, -R * 0.34);
      ctx.lineTo(R * 0.8, -R * 0.34);
      ctx.moveTo(0, -R * 0.34);
      ctx.lineTo(0, R);
      ctx.stroke();
      break;
    }
    case 'hex': {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU - Math.PI / 2;
        const x = Math.cos(a) * R * 0.92;
        const y = Math.sin(a) * R * 0.92;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.24, 0, TAU);
      ctx.fill();
      break;
    }
    case 'tri': {
      // 三角 + 内部竖线（炼金风格）
      ctx.beginPath();
      ctx.moveTo(0, -R);
      ctx.lineTo(R * 0.9, R * 0.72);
      ctx.lineTo(-R * 0.9, R * 0.72);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.34);
      ctx.lineTo(0, R * 0.72);
      ctx.stroke();
      break;
    }
    case 'spark': {
      // 四角星芒（凹边）
      ctx.beginPath();
      const k = 0.24;
      ctx.moveTo(0, -R);
      ctx.quadraticCurveTo(k * R, -k * R, R, 0);
      ctx.quadraticCurveTo(k * R, k * R, 0, R);
      ctx.quadraticCurveTo(-k * R, k * R, -R, 0);
      ctx.quadraticCurveTo(-k * R, -k * R, 0, -R);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'diamond': {
      // 中空菱形 + 内菱形
      ctx.beginPath();
      ctx.moveTo(0, -R);
      ctx.lineTo(R, 0);
      ctx.lineTo(0, R);
      ctx.lineTo(-R, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.4);
      ctx.lineTo(R * 0.4, 0);
      ctx.lineTo(0, R * 0.4);
      ctx.lineTo(-R * 0.4, 0);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'ring': {
      // 同心双环
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.86, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.36, 0, TAU);
      ctx.stroke();
      break;
    }
    case 'square': {
      // 旋转 45° 的方框 + 中心点
      const s = R * 0.72;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s, 0);
      ctx.lineTo(0, s);
      ctx.lineTo(-s, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, lw * 0.85, 0, TAU);
      ctx.fill();
      break;
    }
    case 'hourglass': {
      // 沙漏 / 双三角对顶
      ctx.beginPath();
      ctx.moveTo(-R * 0.78, -R * 0.86);
      ctx.lineTo(R * 0.78, -R * 0.86);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-R * 0.78, R * 0.86);
      ctx.lineTo(R * 0.78, R * 0.86);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/**
 * 稳定的字符串 hash（用于给节点分配图标与抖动相位）。
 * 同一个名称永远得到同一个值 —— 这是「同一命盘画面固定」的前提。
 */
export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
