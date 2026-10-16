import { useEffect, useState } from "react";
import { TYPE_LABELS, formatRuntime, type MediaItem } from "../api";
import { useStore } from "../store";
import { qualityLabel } from "./Cards";
import { Icon } from "./Icons";

const ROTATE_MS = 9000;

/** Full-width featured banner that rotates through a handful of titles. */
export function Hero({ items }: { items: MediaItem[] }) {
  const { openItem, services } = useStore();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || items.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused, items.length]);

  const item = items[index % Math.max(items.length, 1)];
  if (!item) return null;

  const art = item.backdrop ?? item.poster;
  const quality = qualityLabel(item);
  const facts = [
    item.year,
    TYPE_LABELS[item.type],
    formatRuntime(item.runtimeMinutes),
    item.genres?.slice(0, 3).join(" · "),
  ].filter(Boolean);

  return (
    <section className="hero" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {items.map((it, i) => {
        const bg = it.backdrop ?? it.poster;
        return bg ? (
          <div key={it.key} className={`hero-art ${i === index ? "active" : ""} ${it.backdrop ? "" : "blurred"}`} style={{ backgroundImage: `url("${bg}")` }} />
        ) : null;
      })}
      <div className="hero-fade" />
      <div className="hero-body" key={item.key}>
        <div className="hero-eyebrow">
          <span className="eyebrow-dot" /> Featured
        </div>
        <h1>{item.title}</h1>
        <div className="hero-facts">
          {item.certification && <span className="cert">{item.certification}</span>}
          {item.rating ? (
            <span className="rating">
              <Icon name="star" size={14} /> {item.rating.toFixed(1)}
            </span>
          ) : null}
          {facts.map((f, i) => (
            <span key={i}>{f}</span>
          ))}
        </div>
        {item.overview && <p className="hero-overview">{item.overview}</p>}
        <div className="hero-actions">
          <button className="btn primary" onClick={() => openItem(item.key)}>
            <Icon name="play" size={16} /> Details
          </button>
          {quality && <span className="tag inline">{quality}</span>}
          {item.available.map((a) => (
            <span key={a.serviceId} className={`chip kind-${services[a.serviceId]?.kind}`}>
              {services[a.serviceId]?.name}
            </span>
          ))}
        </div>
      </div>
      {!!art && items.length > 1 && (
        <div className="hero-dots">
          {items.map((it, i) => (
            <button key={it.key} className={i === index ? "active" : undefined} onClick={() => setIndex(i)} aria-label={`Show ${it.title}`} />
          ))}
        </div>
      )}
    </section>
  );
}
