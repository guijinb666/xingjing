/**
 * 背景星空：预渲染到离屏画布，避免每帧重绘数百个星点。
 *
 * 参考录屏结论：星空是**全局恒定**的 —— 内景页与星轨页共用同一片星空，
 * 且星点不随内容滚动而位移（滚动的是内容层，星空是页面级固定背景）。
 * 因此这里做成「生成一次、整站复用」的模块级缓存。
 */

interface Star {
  x: number;
  y: number;
  r: number;
  base: number;
  phase: number;
  speed: number;
  warm: boolean;
}

export class Starfield {
  private stars: Star[] = [];
  private w = 0;
  private h = 0;
  private dpr = 1;

  /** 重新按容器尺寸生成星点（等比密度） */
  resize(w: number, h: number, dpr: number): void {
    if (this.w === w && this.h === h && this.dpr === dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    // 密度：每 4200 平方像素一颗，上限 900 颗，保证低端机也不卡
    const count = Math.min(900, Math.round((w * h) / 4200));
    // 用固定种子的伪随机，保证每次刷新星空一致
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed / 0xffffffff;
    };
    this.stars = [];
    for (let i = 0; i < count; i++) {
      const t = rnd();
      this.stars.push({
        x: rnd() * w,
        y: rnd() * h,
        r: 0.4 + t * 1.5,
        base: 0.22 + rnd() * 0.62,
        phase: rnd() * Math.PI * 2,
        speed: 0.0006 + rnd() * 0.0022,
        warm: rnd() > 0.86,
      });
    }
  }

  /** 绘制一层静态星空（带轻微闪烁，由时间驱动） */
  draw(ctx: CanvasRenderingContext2D, time: number): void {
    ctx.save();
    for (const s of this.stars) {
      const tw = 0.72 + 0.28 * Math.sin(time * s.speed + s.phase);
      const a = s.base * tw;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = s.warm
        ? `rgba(217,184,119,${a * 0.85})`
        : `rgba(223,228,236,${a})`;
      ctx.fill();
      // 亮星加一点光晕
      if (s.r > 1.35) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 3.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180,200,255,${a * 0.07})`;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** 静态版本：一次性画到离屏画布（用于不需要闪烁的场景） */
  renderStatic(target: CanvasRenderingContext2D): void {
    this.draw(target, 0);
  }
}

/**
 * 按容器尺寸生成「星点纹理」Canvas，供页面的 fixed 背景层使用。
 * 返回一个可直接 appendChild / drawImage 的画布。
 */
export function createStarfieldCanvas(w: number, h: number, dpr = 1): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.floor(w * dpr));
  cv.height = Math.max(1, Math.floor(h * dpr));
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  ctx.scale(dpr, dpr);
  const sf = new Starfield();
  sf.resize(w, h, dpr);
  sf.renderStatic(ctx);
  return cv;
}

/**
 * 全局星空图层：整站只创建一次，同时支持「静态快照」与「实时闪烁」两种用法。
 *
 * - `canvas`：可直接挂到 DOM 的画布
 * - `resize(w,h,dpr)`：按容器尺寸重新生成星点并重绘快照
 * - `render()`：按当前时间重绘一帧（用于闪烁）
 */
export interface StarfieldLayerHandle {
  canvas: HTMLCanvasElement;
  resize: (w: number, h: number, dpr: number) => void;
  render: () => void;
}

export function createStarfieldLayer(w: number, h: number, dpr = 1): StarfieldLayerHandle {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const sf = new Starfield();
  let curW = w;
  let curH = h;
  let curDpr = dpr;

  const applySize = () => {
    cv.width = Math.max(1, Math.floor(curW * curDpr));
    cv.height = Math.max(1, Math.floor(curH * curDpr));
    cv.style.width = `${curW}px`;
    cv.style.height = `${curH}px`;
  };

  const paint = (time: number) => {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(curDpr, 0, 0, curDpr, 0, 0);
    sf.draw(ctx, time);
  };

  applySize();
  sf.resize(curW, curH, curDpr);
  paint(0);

  return {
    canvas: cv,
    resize(nextW, nextH, nextDpr) {
      curW = nextW;
      curH = nextH;
      curDpr = nextDpr;
      applySize();
      sf.resize(curW, curH, curDpr);
      paint(0);
    },
    render() {
      paint(performance.now());
    },
  };
}
