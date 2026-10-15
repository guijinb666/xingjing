/**
 * IntersectionObserver hook：判断元素是否在视口内。
 * 用于「离屏自动暂停」——不可见时星轨不必消耗 CPU。
 *
 * 返回 [ref, inView]；ref 必须挂到目标 DOM 元素上。
 * 环境不支持 IntersectionObserver 时（SSR / 老浏览器）降级为恒定可见。
 */
import { useEffect, useRef, useState, type RefObject } from 'react';

export interface UseInViewOptions {
  /** 可见比例阈值，默认 0 */
  threshold?: number | number[];
  /** 视口外扩边距，默认 '120px'，让「快进屏」提前预热 */
  rootMargin?: string;
  /** 是否只触发一次（进入后即使离开也保持 true），默认 false */
  once?: boolean;
}

export function useInView<T extends Element>(
  options: UseInViewOptions = {},
): [RefObject<T>, boolean] {
  const { threshold = 0, rootMargin = '120px', once = false } = options;

  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;

    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry === undefined) return;
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [threshold, rootMargin, once]);

  return [ref, inView];
}
