/**
 * 星符按钮：右下角的方形按钮，切换星轨的 RUNNING / PAUSED。
 *
 * 与全站控件同一形状语言：平色、4px 圆角、1px 描边；
 * 选中/激活靠**色阶**表达，不靠发光、不靠毛玻璃、不靠缩放弹跳。
 * 两种状态的动效（旋转 / 呼吸）都写在 global.css 里。
 */
import { useState } from 'react';

interface Props {
  /** 当前是否在推进（RUNNING） */
  running: boolean;
  onToggle: () => void;
  /** 是否禁用（例如尚未进入视口） */
  disabled?: boolean;
}

export default function RuneButton({ running, onToggle, disabled }: Props) {
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      className={
        'rune-button' +
        (running ? ' is-running' : ' is-paused') +
        (hover && !disabled ? ' is-hover' : '')
      }
      aria-label={running ? '暂停星轨推进' : '继续星轨推进'}
      title={running ? '暂停探索' : '继续探索'}
      disabled={disabled}
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <svg className="rune-glyph" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        {running ? (
          // 运行中：四芒星
          <path
            d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"
            fill="currentColor"
            opacity="0.92"
          />
        ) : (
          // 暂停：暂停符号被星芒包裹
          <>
            <path
              d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"
              stroke="currentColor"
              strokeWidth="1.1"
              fill="none"
              opacity="0.6"
            />
            <rect x="9.4" y="8.6" width="1.9" height="6.8" rx="0.9" fill="currentColor" />
            <rect x="12.7" y="8.6" width="1.9" height="6.8" rx="0.9" fill="currentColor" />
          </>
        )}
      </svg>
    </button>
  );
}
