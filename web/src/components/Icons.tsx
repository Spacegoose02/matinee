import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  home: <path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10" />,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4" /></>,
  stack: <><rect x="6" y="7" width="14" height="12" rx="2" /><path d="M4 16V6a2 2 0 0 1 2-2h10" /></>,
  tv: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="m9 3 3 3 3-3M8 21h8" /></>,
  book: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1z" /></>,
  download: <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  pin: <path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m4 18 5.5-5 4 3.5 3-2.5 3.5 4" /></>,
  up: <path d="m6 14 6-6 6 6" />,
  down: <path d="m6 10 6 6 6-6" />,
  left: <path d="m14 6-6 6 6 6" />,
  right: <path d="m10 6 6 6-6 6" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeoff: <path d="M3 3l18 18M10.6 6.2A9 9 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3.3 3.8M6.5 7.8A15.6 15.6 0 0 0 2.5 12S6 18 12 18c1.4 0 2.7-.3 3.8-.8" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4" />,
  star: <path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" />,
  play: <path d="M8 5.5v13l11-6.5z" />,
  alert: <><path d="M12 4 2.8 19.5h18.4L12 4z" /><path d="M12 10v4.5M12 17.2v.1" /></>,
  upload: <path d="M12 16V5m0 0-4 4m4-4 4 4M5 20h14" />,
  trash: <path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" />,
};

export function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="icon"
    >
      {paths[name]}
    </svg>
  );
}
