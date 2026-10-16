import { useRef, type ReactNode } from "react";
import { useNearViewport } from "../hooks";
import { Icon } from "./Icons";

interface Props {
  title: string;
  subtitle?: string;
  /** Shown to the right of the title, e.g. a "See all" link or edit controls. */
  actions?: ReactNode;
  children: ReactNode;
  /** Position on the page: the first few shelves render at once, later ones as they near the screen (or after a short stagger). */
  order?: number;
}

/** A titled, horizontally scrolling row with paging buttons. Its cards only render once it nears the screen. */
export function Shelf({ title, subtitle, actions, children, order = 99 }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [ref, near] = useNearViewport<HTMLElement>("800px", order < 3 ? 0 : 600 + order * 250);
  const page = (dir: 1 | -1) => {
    const el = track.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };
  return (
    <section className="shelf" ref={ref}>
      <header className="shelf-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <span className="muted small">{subtitle}</span>}
        </div>
        <div className="shelf-actions">{actions}</div>
      </header>
      <div className="shelf-body">
        <button className="shelf-arrow left" onClick={() => page(-1)} aria-label="Scroll left">
          <Icon name="left" size={22} />
        </button>
        <div className="shelf-track" ref={track}>
          {near ? children : <div className="shelf-placeholder" />}
        </div>
        <button className="shelf-arrow right" onClick={() => page(1)} aria-label="Scroll right">
          <Icon name="right" size={22} />
        </button>
      </div>
    </section>
  );
}
