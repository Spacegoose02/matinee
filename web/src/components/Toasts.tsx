import { Icon } from "./Icons";
import { useStore } from "../store";

/** Short-lived confirmations (and failures) in the bottom corner. */
export function Toasts() {
  const { toasts } = useStore();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <Icon name={t.tone === "error" ? "alert" : "download"} size={16} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
