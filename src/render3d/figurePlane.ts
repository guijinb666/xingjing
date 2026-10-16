/**
 * 内景页中央的**平面人体层**。
 *
 * ============================== 为什么是平面 ==============================
 * 之前用程序化 3D 几何（`bodyGeometry.ts` 的旋转体 / `lotusFigure.ts` 的图元
 * 堆叠）复刻参考图的人体，失败多轮。根因是**路线错而非参数错**：
 *   · `TubeGeometry` 等粗圆管在正交投影下必然是「黑棒」，而参考图的手臂与腿
 *     是有肌肉起伏的锥台；
 *   · 莲花瓣用「绕自身轴旋转纵剖面」的壳片表达，多层叠压必然渲染成透明三角片
 *     交叉（像冰晶/折纸），不是有厚度的叶片；
 *   · 整套规格本来就要求「连续有机曲面」，不该用图元堆叠去凑。
 * 而参考图是**风格化插画**，正对镜头、纯白底、骨骼与莲座完整 —— 它自带全部
 * 想要的信息（肋骨、脊椎、颜面、经脉、莲瓣脉络、体表发光）。
 * 所以直接把它处理成两层贴图叠在中央，几何失真归零。
 *
 * ============================== 两层材质 ==============================
 *   base  RGBA 半透明暖金剪影   正常混合（NormalBlending）
 *   glow  RGB  发光叠加层       加色混合（AdditiveBlending，黑 = 无贡献）
 *
 * glow 层是用**基座扣除**（pedestal subtraction）从源图亮度里导出的：
 * lum 低于体表中位（226）不发，高于它（骨骼白心 252 / 丹田 / 眉间 / 花心 /
 * 火焰 240）才发。因此内部结构层次完全来自源图自身，且「越亮 = 越强的光」，
 * 与参考图的单调关系一致 —— 这一点是前面所有版本搞错的地方（它们用
 * 「越暗越是实体」的取反模型，结果身体糊成灰白砂岩、火焰变成褐烟）。
 *
 * 素材生成脚本：`_probe/silhouette/make_final.py`（迭代记录写在脚本头部）。
 *
 * ============================== 为什么用 Sprite ==============================
 * 内景页是**可环绕的 3D 星图**（拖拽改变方位角/极角）。若用普通 Mesh，
 * 用户转到侧面时人体会薄成一条线。Sprite 是始终面向相机的公告板，
 * 任何视角下人体都是正的 —— 这正是「一幅画挂在球心」想要的行为。
 */
import {
  AdditiveBlending,
  Group,
  Sprite,
  SpriteMaterial,
  Texture,
  TextureLoader,
} from 'three';

/** 素材目录（public/ 下，Vite 直接按根路径提供） */
const ASSET_DIR = `${import.meta.env.BASE_URL}figure/`;

/**
 * 人体平面在世界坐标里的高度。
 *
 * 参照系：环绕节点在半径 RING_TEN_GOD=2.35 / RING_SHEN_SHA=3.15 的球面上，
 * 人体要明显小于内圈、又能占据画面中心。取 2.10。
 */
export const FIGURE_HEIGHT = 2.10;

/** 素材宽高比（1024 / 962，由 make_final.py 输出） */
export const FIGURE_ASPECT = 1024 / 962;

/** 平面中心的 y。0 附近让星环对称地环绕人体。 */
export const FIGURE_CENTER_Y = 0.02;

/** 入场淡入时长（毫秒） */
const FADE_MS = 900;

export interface FigurePlaneOptions {
  /** 整体高度倍率（调试用） */
  scale?: number;
}

/**
 * 中央人体平面。
 *
 * 生命周期：`new FigurePlane()` → `scene.add(p.group)` → 每帧 `p.update(dt)`。
 * 贴图异步加载；未加载完成时两个 Sprite 都不可见，不会闪出黑方块。
 */
export class FigurePlane {
  readonly group = new Group();

  private readonly base: Sprite;
  private readonly glow: Sprite;
  private readonly baseMat: SpriteMaterial;
  private readonly glowMat: SpriteMaterial;
  private readonly textures: Texture[] = [];
  private loaded = 0;
  private elapsed = 0;
  private disposed = false;

  constructor(o: FigurePlaneOptions = {}) {
    const scale = o.scale ?? 1;
    const h = FIGURE_HEIGHT * scale;
    const w = h * FIGURE_ASPECT;

    // —— base：半透明暖金剪影 ——
    // depthWrite:false —— 半透明层写深度会在它与加色层之间产生排序瑕疵
    // （glow 在 base 之后绘制，若 base 写了深度就会被挡掉一部分）。
    this.baseMat = new SpriteMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 0,
    });
    this.base = new Sprite(this.baseMat);
    this.base.scale.set(w, h, 1);
    this.base.position.set(0, FIGURE_CENTER_Y, 0);
    this.base.renderOrder = 1;
    this.base.visible = false;
    this.group.add(this.base);

    // —— glow：加色发光 ——
    // 黑底贴图在加色混合下等于"无贡献"，所以不需要 alpha 通道。
    this.glowMat = new SpriteMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      opacity: 0,
    });
    this.glow = new Sprite(this.glowMat);
    this.glow.scale.set(w, h, 1);
    this.glow.position.set(0, FIGURE_CENTER_Y, 0);
    this.glow.renderOrder = 2;
    this.glow.visible = false;
    this.group.add(this.glow);

    this.load('figure-base.webp', (t) => {
      // 半透明层用 sRGB 是正确的：贴图里存的就是显示色。
      t.colorSpace = 'srgb' as never;
      this.baseMat.map = t;
      this.baseMat.needsUpdate = true;
      this.base.visible = true;
    });
    this.load('figure-glow.webp', (t) => {
      // 发光层同理：源图亮度已经是我们想要的"显示亮度"，
      // 若留在线性空间，加色后会比预期亮一截。
      t.colorSpace = 'srgb' as never;
      this.glowMat.map = t;
      this.glowMat.needsUpdate = true;
      this.glow.visible = true;
    });
  }

  /** 加载一张贴图；两个都到位后本层才算 ready */
  private load(file: string, apply: (t: Texture) => void): void {
    const tex = new TextureLoader().load(
      ASSET_DIR + file,
      (t) => {
        if (this.disposed) {
          t.dispose();
          return;
        }
        apply(t);
        this.textures.push(t);
        this.loaded += 1;
      },
      undefined,
      () => {
        // 加载失败：保持不可见，让场景其余部分照常工作（不抛异常打断渲染循环）
        this.loaded += 1;
      },
    );
    this.textures.push(tex);
  }

  /** 两个贴图是否都加载完成 */
  get ready(): boolean {
    return this.loaded >= 2;
  }

  /**
   * 每帧更新。
   *
   * @param dt    秒
   * @param breath 0..1 呼吸相位（由 InnerScene 统一计算并共享给人体与节点）
   */
  update(dt: number, breath: number): void {
    if (this.disposed) return;
    this.elapsed += dt * 1000;

    const app = Math.min(1, this.elapsed / FADE_MS);
    // easeOutCubic：入场末尾平缓，避免"啪"地出现
    const eased = 1 - Math.pow(1 - app, 3);

    // 呼吸：整体缩放 ±1.2%，与 3D 人体原来的幅度一致
    const s = 1 + breath * 0.012;
    this.base.scale.set(FIGURE_HEIGHT * FIGURE_ASPECT * s, FIGURE_HEIGHT * s, 1);
    this.glow.scale.copy(this.base.scale);

    // 半透明剪影实一点（0.92），发光层随呼吸轻微脉动（0.78~0.95）
    this.baseMat.opacity = 0.92 * eased;
    this.glowMat.opacity = (0.78 + 0.17 * breath) * eased;
  }

  /** 与 InnerScene.setFlowOnly 配合：只显示流光时把人体藏掉 */
  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.textures) t.dispose();
    this.textures.length = 0;
    this.baseMat.dispose();
    this.glowMat.dispose();
  }
}
