import { useEffect, useRef, useState } from "react";

/**
 * Renders a long list in chunks: the first `step` items now, more as the bottom sentinel scrolls
 * near view. Thousands of cards at once is what makes a big library page crawl.
 */
export function useIncremental<T>(list: T[], step = 72) {
  const [count, setCount] = useState(step);
  const sentinel = useRef<HTMLDivElement>(null);

  // A new list (filter, sort, other page) starts again from the top.
  useEffect(() => setCount(step), [list, step]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || count >= list.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setCount((c) => Math.min(c + step, list.length)),
      { rootMargin: "1400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [count, list.length, step]);

  return {
    shown: list.length > count ? list.slice(0, count) : list,
    sentinel,
    hasMore: count < list.length,
    showMore: () => setCount((c) => Math.min(c + step * 4, list.length)),
    total: list.length,
  };
}

/** True once the element has come within `margin` of the viewport (and stays true). */
export function useNearViewport<T extends Element>(margin = "800px", fallbackMs?: number) {
  const ref = useRef<T>(null);
  // fallbackMs: 0 = render immediately; a number = render after that long even if the browser never reports it as visible.
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined" || fallbackMs === 0);

  useEffect(() => {
    if (near || fallbackMs === undefined) return;
    const t = setTimeout(() => setNear(true), fallbackMs);
    return () => clearTimeout(t);
  }, [near, fallbackMs]);

  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);

  return [ref, near] as const;
}
